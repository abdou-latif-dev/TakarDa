// Repérage des changements locaux — P2, sans toucher aux services métier.
//
// Au lieu de brancher des crochets dans chaque service (risque de changer le comportement de l'application), le moteur COMPARE l'état
// local actuel à la référence de synchronisation (dernière version confirmée par le cloud) :
//  - élément absent de la référence  → création ;
//  - élément dont l'empreinte a changé → modification ;
//  - élément de la référence disparu localement → suppression logique.
//
// Les anciennes données ne partent jamais d'elles-mêmes : un élément absent de la référence n'est proposé en création que s'il a été
// créé depuis l'activation (`enabledAt`) ou s'il a été explicitement adopté (migration, P6). Les types non synchronisables (journaux,
// définitions système, outils personnalisés…) sont ignorés. Aucune écriture dans ce module : les fonctions sont pures.

import type { CollectionsSnapshot } from '../persistence';
import { isKnownKind, kindOfCollection, kindOfRecord, getKindDefinition, findLogicalDuplicates, naturalKeyOf, type Kind } from './kindRegistry';
import type { BaselineStore, IncomingChange, QueueStore } from './syncQueue';
import { hashOfItem } from './wireFormat';
import type { RecordItem } from '@/types/entities';

export interface LocalItem {
  id: string;
  kind: Kind;
  item: Record<string, unknown>;
  createdAt: string;
  hash: string;
}

export interface ScanScope {
  /** Date d'activation : seuls les éléments créés à partir de cet instant sont proposés en création automatique. */
  enabledAt: string;
  /** Éléments anciens explicitement adoptés (jamais rempli automatiquement). */
  adoptedIds?: ReadonlySet<string>;
}

const str = (v: unknown): string => (typeof v === 'string' ? v : '');

/** Éléments locaux à synchroniser (types « planned » seulement), avec leur empreinte. Lecture seule. */
export function collectSyncableItems(
  snapshot: CollectionsSnapshot,
  corrections: readonly Record<string, unknown>[] = [],
): { items: LocalItem[]; skippedUnsynced: number; skippedUnknown: number } {
  const items: LocalItem[] = [];
  let skippedUnsynced = 0;
  let skippedUnknown = 0;
  // faits financiers de correction ou d'annulation (magasin propre à la synchronisation, voir financialCorrection.ts)
  for (const raw of corrections) {
    const kind = typeof raw.kind === 'string' && isKnownKind(raw.kind) ? raw.kind : null;
    const id = str(raw.id);
    if (!kind || !id || getKindDefinition(kind).source.type !== 'store') continue;
    items.push({ id, kind, item: raw, createdAt: str(raw.createdAt), hash: hashOfItem(kind, raw) });
  }
  for (const [name, list] of Object.entries(snapshot)) {
    for (const raw of list as Record<string, unknown>[]) {
      const kind = name === 'records' ? kindOfRecord(raw as unknown as RecordItem) : kindOfCollection(name);
      if (!kind) {
        if (name === 'records') skippedUnknown += 1;
        continue;
      }
      if (getKindDefinition(kind).sync !== 'planned') {
        skippedUnsynced += 1;
        continue;
      }
      const id = str(raw.id);
      if (!id) continue;
      items.push({ id, kind, item: raw, createdAt: str(raw.createdAt) || str(raw.joinedAt), hash: hashOfItem(kind, raw) });
    }
  }
  return { items, skippedUnsynced, skippedUnknown };
}

export interface ScanResult {
  changes: IncomingChange[];
  /** Éléments anciens ignorés (créés avant l'activation et non adoptés). */
  ignoredLegacy: number;
  unchanged: number;
}

/** Changements à mettre en file. Pure : ne modifie ni la file ni la référence. */
export function scanChanges(items: readonly LocalItem[], baseline: BaselineStore, scope: ScanScope, now: Date, outOfScope: ReadonlySet<string> = new Set()): ScanResult {
  const changes: IncomingChange[] = [];
  let ignoredLegacy = 0;
  let unchanged = 0;
  const present = new Set<string>();
  for (const local of items) {
    present.add(local.id);
    const known = baseline.entries[local.id];
    if (known) {
      if (known.hash !== local.hash) changes.push({ recordId: local.id, kind: local.kind, op: 'update', baseRev: known.rev });
      else unchanged += 1;
      continue;
    }
    const adopted = scope.adoptedIds?.has(local.id) === true;
    if (!adopted && local.createdAt < scope.enabledAt) {
      ignoredLegacy += 1;
      continue;
    }
    changes.push({ recordId: local.id, kind: local.kind, op: 'create', baseRev: 0 });
  }
  for (const [id, entry] of Object.entries(baseline.entries)) {
    // un élément SORTI du périmètre (toujours présent localement) n'est jamais supprimé dans le cloud : il reste figé là où il est
    if (!present.has(id) && !outOfScope.has(id)) changes.push({ recordId: id, kind: entry.kind, op: 'delete', baseRev: entry.rev, deletedAt: now.toISOString() });
  }
  return { changes, ignoredLegacy, unchanged };
}

/**
 * Opérations en attente (création ou modification) dont l'enregistrement a DISPARU localement avant d'être confirmé : elles ne figurent
 * pas dans la référence, donc `scanChanges` ne peut pas les voir. On les convertit en suppression logique ; la fusion de la file
 * annule une création jamais tentée et conserve une suppression si le cloud a pu recevoir l'enregistrement.
 */
export function scanVanishedPending(items: readonly LocalItem[], queue: QueueStore, now: Date, outOfScope: ReadonlySet<string> = new Set()): IncomingChange[] {
  const present = new Set(items.map((i) => i.id));
  return Object.values(queue.ops)
    .filter((op) => op.op !== 'delete' && !present.has(op.recordId) && !outOfScope.has(op.recordId))
    .map((op) => ({ recordId: op.recordId, kind: op.kind, op: 'delete' as const, baseRev: op.baseRev, deletedAt: now.toISOString() }));
}

export interface LogicalDuplicateReport {
  kind: Kind;
  key: string;
  ids: string[];
}

/**
 * Doublons LOGIQUES (même clé logique confirmée par le code métier, identifiants différents) parmi les éléments locaux et la
 * référence. Rapport seulement : rien n'est fusionné, supprimé ni réécrit.
 */
export function scanLogicalDuplicates(items: readonly LocalItem[], baseline?: BaselineStore): LogicalDuplicateReport[] {
  const byKind = new Map<Kind, Record<string, unknown>[]>();
  for (const local of items) {
    if (!naturalKeyOf(local.kind, local.item)) continue;
    byKind.set(local.kind, [...(byKind.get(local.kind) ?? []), local.item]);
  }
  const report: LogicalDuplicateReport[] = [];
  for (const [kind, list] of byKind) for (const dup of findLogicalDuplicates(kind, list)) report.push({ kind, key: dup.key, ids: dup.ids.sort() });
  // éléments déjà connus du cloud (référence) mais absents localement : leur clé logique compte aussi (rapport seulement)
  if (baseline) {
    const owners = externalKeyOwners(items, baseline);
    for (const [composite, ids] of owners) {
      const [kind, key] = splitComposite(composite);
      const local = items.filter((i) => i.kind === kind && naturalKeyOf(i.kind, i.item) === key).map((i) => i.id);
      const all = [...new Set([...local, ...ids])].sort();
      if (all.length > 1 && !report.some((r) => r.kind === kind && r.key === key)) report.push({ kind: kind as Kind, key, ids: all });
    }
  }
  return report.sort((a, b) => (a.kind + a.key < b.kind + b.key ? -1 : 1));
}

const compose = (kind: string, key: string): string => `${kind}|${key}`;
const splitComposite = (composite: string): [string, string] => {
  const index = composite.indexOf('|');
  return [composite.slice(0, index), composite.slice(index + 1)];
};

/**
 * Propriétaires (identifiants) des clés logiques portées par la RÉFÉRENCE de synchronisation pour des éléments qui ne sont plus
 * présents localement (supprimés ici, ou déplacés hors des collections vives par une suppression distante). Lecture seule.
 */
export function externalKeyOwners(items: readonly LocalItem[], baseline: BaselineStore): Map<string, string[]> {
  const present = new Set(items.map((i) => i.id));
  const owners = new Map<string, string[]>();
  for (const [id, entry] of Object.entries(baseline.entries)) {
    if (present.has(id) || !entry.naturalKey) continue;
    owners.set(compose(entry.kind, entry.naturalKey), [...(owners.get(compose(entry.kind, entry.naturalKey)) ?? []), id]);
  }
  return owners;
}
