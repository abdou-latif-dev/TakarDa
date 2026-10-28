// Réception des changements distants — P3. LOCAL ET ISOLÉ : aucun SDK, aucun réseau, aucun transport réel. Le moteur ne sait pas
// COMMENT les changements arrivent : `PullTransport` est une interface, fournie par l'appelant (dans P3, uniquement les tests).
// Rien n'est branché aux services métier ni à l'interface : ces fonctions ne s'exécutent que lorsqu'on les appelle explicitement.
//
// Règles (décidées avec le propriétaire du produit) :
//  - un fait financier (paiement, cotisation, correction) déjà confirmé n'est JAMAIS supprimé ni réécrit silencieusement : une
//    modification ou une suppression distante est retenue comme conflit explicite ; la correction passe par un nouveau fait tracé
//    (financialCorrection.ts) ;
//  - une suppression distante non financière est une suppression LOGIQUE réversible : l'élément quitte les collections vives, une
//    copie complète est conservée (pierre tombale) et peut être restaurée ;
//  - une modification concurrente est fusionnée automatiquement SEULEMENT si les deux côtés ont touché des champs différents ; sinon
//    les deux versions sont conservées dans un conflit à résoudre — jamais un choix arbitraire ;
//  - les doublons logiques sont signalés et retenus, jamais fusionnés ni effacés ;
//  - tout est idempotent : rejouer un changement ou une page ne change rien, et une interruption à n'importe quel moment est reprise
//    sans perte ni doublon ;
//  - l'espace de démonstration ne reçoit jamais rien ; un changement d'un autre compte est refusé.

import { workspaceId } from '../persistence';
import { differingFields, mergeThreeWay, contentEquals, STATUS_FIELD_NAME } from './merge';
import { createDefaultApplier, type LocalApplier } from './localApplier';
import { externalKeyOwners, type LocalItem } from './changeScanner';
import { correctionStore } from './financialCorrection';
import {
  conflictStore,
  cursorStore,
  pendingInboundStore,
  tombstoneStore,
  type ConflictRecord,
  type ConflictType,
  type PendingReason,
  type RemoteChange,
} from './inboundStores';
import { getKindDefinition, isKnownKind, naturalKeyOf, type Kind } from './kindRegistry';
import { createMeta, loadSyncMeta, markConflict, markPending, markSynced, updateSyncMeta, type LocalSyncMeta } from './localSyncMeta';
import { entityReferencesOf, extractReferences, syncOrder } from './relationManifest';
import { enqueueChange, SyncEngineError, SyncTransportError } from './syncEngine';
import { accountChangePending, requireSyncAccount } from './syncAccount';
import { isSyncKind } from './syncScope';
import { requireActivation } from './syncActivation';
import { tryAcquireSyncLock } from './syncLock';
import { baselineStore, queueStore, type BaselineContent, type BaselineEntry, type QueuedOperation } from './syncQueue';
import { buildWireRecord, contentHash, contentOfWire, hashOfItem, itemFromWire, localOnlyFields, naturalKeyOfWire, type WireRecord } from './wireFormat';

// ---- Interface de lecture (aucune réalisation réseau) ---------------------------------------------------------------------------

export interface PullPage {
  changes: RemoteChange[];
  /** Jeton opaque à fournir à la page suivante. */
  nextCursor: string | null;
  hasMore: boolean;
}

export interface PullTransport {
  pull(request: { cursor: string | null; limit: number }): Promise<PullPage>;
}

// ---- Rapport ------------------------------------------------------------------------------------------------------------------

export interface InboundReport {
  /** Créés localement. */
  applied: string[];
  /** Mis à jour sans conflit (l'appareil n'avait pas modifié l'élément). */
  updated: string[];
  /** Fusionnés automatiquement (champs distincts). */
  merged: string[];
  /** Suppressions logiques appliquées (récupérables). */
  tombstoned: string[];
  /** Déjà identiques ou déjà connus : rien à faire. */
  converged: string[];
  /** Plus anciens que la version connue : ignorés. */
  stale: string[];
  conflicts: { recordId: string; type: ConflictType; fields: string[] }[];
  deferred: { recordId: string; reason: PendingReason; detail: string }[];
  duplicates: { recordId: string; kind: Kind; key: string; with: string[] }[];
  rejected: { recordId: string; problems: string[] }[];
}

export const emptyInboundReport = (): InboundReport => ({ applied: [], updated: [], merged: [], tombstoned: [], converged: [], stale: [], conflicts: [], deferred: [], duplicates: [], rejected: [] });

export interface InboundEnv {
  ownerUid: string;
  applier: LocalApplier;
  now: Date;
}

// ---- Validation -------------------------------------------------------------------------------------------------------------------

export interface RemoteValidation {
  problems: string[];
  /** Le changement vient d'une version plus récente de l'application : conservé, jamais appliqué à l'aveugle. */
  newerSchema: boolean;
}

const isPlainObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

/** Valide un changement reçu AVANT toute écriture : type connu et synchronisable, version, propriétaire, références déclarées, cohérence. */
export function validateRemoteChange(change: unknown, ownerUid: string): RemoteValidation {
  const problems: string[] = [];
  if (!isPlainObject(change)) return { problems: ['changement illisible'], newerSchema: false };
  const c = change as Record<string, unknown>;
  if (typeof c.id !== 'string' || c.id === '') problems.push('identifiant manquant');
  if (typeof c.kind !== 'string' || !isKnownKind(c.kind)) problems.push('type inconnu');
  else if (getKindDefinition(c.kind).sync !== 'planned') problems.push('type non synchronisable');
  else if (!isSyncKind(c.kind)) problems.push('type hors du périmètre de la synchronisation (Immobilier seul)'); // jamais appliqué depuis le cloud
  if (typeof c.rev !== 'number' || !Number.isInteger(c.rev) || c.rev < 1) problems.push('révision invalide');
  if (typeof c.deleted !== 'boolean') problems.push('indicateur de suppression invalide');
  if (problems.length > 0) return { problems, newerSchema: false };
  const kind = c.kind as Kind;

  if (c.deleted === true) {
    if (typeof c.deletedAt !== 'string' || c.deletedAt === '') problems.push('suppression sans horodatage');
    return { problems, newerSchema: false };
  }
  const wire = c.wire as WireRecord | null | undefined;
  if (!isPlainObject(wire)) return { problems: ['contenu manquant'], newerSchema: false };
  if (wire.id !== c.id) problems.push('identifiant du contenu différent');
  if (wire.kind !== kind) problems.push('type du contenu différent');
  if (wire.ownerUid !== ownerUid) problems.push('enregistrement d’un autre compte');
  if (typeof wire.schemaVersion !== 'number' || !Number.isInteger(wire.schemaVersion) || wire.schemaVersion < 1) problems.push('version de schéma invalide');
  if (typeof wire.createdAt !== 'string' || wire.createdAt === '' || typeof wire.updatedAt !== 'string') problems.push('dates invalides');
  if (wire.statusKey !== null && typeof wire.statusKey !== 'string') problems.push('statut invalide');
  if (!isPlainObject(wire.body)) problems.push('contenu métier invalide');
  if (!isPlainObject(wire.refs)) problems.push('références invalides');
  if (problems.length > 0) return { problems, newerSchema: false };

  const newerSchema = wire.schemaVersion > getKindDefinition(kind).schemaVersion;
  if (newerSchema) return { problems: [], newerSchema: true };

  const forbidden = localOnlyFields(kind);
  for (const key of Object.keys(wire.body)) if (forbidden.has(key)) problems.push(`champ réservé à l’appareil : ${key}`);
  const declared = new Set(entityReferencesOf(kind).map((r) => r.field));
  for (const [field, id] of Object.entries(wire.refs)) {
    if (!declared.has(field)) problems.push(`référence non déclarée : ${field}`);
    else if (typeof id !== 'string' || id === '') problems.push(`référence vide : ${field}`);
  }
  if (problems.length > 0) return { problems, newerSchema: false };
  // le corps et les références doivent dire la même chose (empreinte recalculée à partir de l'élément reconstruit)
  const derived = itemFromWire(wire, null, { toolId: '-', entityDefinitionId: '-' });
  if (hashOfItem(kind, derived) !== contentHash(wire)) problems.push('références incohérentes avec le contenu');
  return { problems, newerSchema: false };
}

// ---- Petits utilitaires d'écriture (chacun est une mise à jour sérialisée d'un magasin) -------------------------------------------

async function setBaseline(id: string, entry: BaselineEntry | null): Promise<void> {
  await baselineStore.update((b) => {
    const entries = { ...b.entries };
    if (entry === null) delete entries[id];
    else entries[id] = entry;
    return { ...b, entries };
  });
}

async function dropOperation(id: string, only?: (op: QueuedOperation) => boolean): Promise<void> {
  await queueStore.update((q) => {
    const op = q.ops[id];
    if (!op || (only && !only(op))) return q;
    const ops = { ...q.ops };
    delete ops[id];
    return { ...q, ops };
  });
}

/** Aligne l'opération en attente sur la nouvelle révision distante (et lève un blocage « conflit » devenu sans objet). */
async function rebaseOperation(id: string, rev: number): Promise<void> {
  await queueStore.update((q) => {
    const op = q.ops[id];
    if (!op) return q;
    const block = op.block && op.block.reason === 'conflict' ? null : op.block;
    return { ...q, ops: { ...q.ops, [id]: { ...op, baseRev: rev, block, nextRetryAt: null } } };
  });
}

async function patchMeta(id: string, kind: Kind, change: (meta: LocalSyncMeta) => LocalSyncMeta | null, now: Date, origin: 'user' | 'remote' = 'user'): Promise<void> {
  await updateSyncMeta((store) => {
    const entries = { ...store.entries };
    const next = change(entries[id] ?? createMeta(kind, origin, now));
    if (next === null) delete entries[id];
    else entries[id] = next;
    return { ...store, entries };
  });
}

const entryFor = (wire: WireRecord, rev: number): BaselineEntry => ({ kind: wire.kind, hash: contentHash(wire), rev, base: contentOfWire(wire), naturalKey: naturalKeyOfWire(wire) });

const localContent = (kind: Kind, item: Record<string, unknown>, ownerUid: string): BaselineContent => contentOfWire(buildWireRecord(kind, item, ownerUid));

async function closeConflict(id: string, resolution: string, discarded: BaselineContent | null, now: Date): Promise<void> {
  await conflictStore.update((s) => {
    const open = s.open[id];
    if (!open) return s;
    const rest = { ...s.open };
    delete rest[id];
    return { ...s, open: rest, history: [...s.history, { ...open, resolvedAt: now.toISOString(), resolution, discarded }] };
  });
}

async function closeConflictIfOpen(id: string, resolution: string, now: Date): Promise<void> {
  const open = (await conflictStore.load()).open[id];
  if (open) await closeConflict(id, resolution, null, now);
}

async function openConflict(env: InboundEnv, report: InboundReport, record: Omit<ConflictRecord, 'detectedAt' | 'resolvedAt' | 'resolution' | 'discarded'>): Promise<void> {
  await conflictStore.update((s) => ({ ...s, open: { ...s.open, [record.recordId]: { ...record, detectedAt: env.now.toISOString(), resolvedAt: null, resolution: null, discarded: null } } }));
  await patchMeta(record.recordId, record.kind, (m) => markConflict(m, `Conflit de réception (${record.type})`, env.now), env.now);
  report.conflicts.push({ recordId: record.recordId, type: record.type, fields: record.fields });
}

async function applyRemoteUpsert(env: InboundEnv, wire: WireRecord, rev: number, isNew: boolean): Promise<void> {
  // ordre : élément local, puis référence. Une interruption entre les deux est reprise sans effet (contenu identique → adopté).
  await env.applier.upsert(wire);
  await setBaseline(wire.id, entryFor(wire, rev));
  await patchMeta(wire.id, wire.kind, (m) => markSynced(m, rev, env.now), env.now, isNew ? 'remote' : 'user');
}

function referencesOf(items: readonly LocalItem[], id: string): LocalItem[] {
  return items.filter((i) => i.id !== id && extractReferences(i.kind, i.item).some((r) => r.id === id));
}

// ---- Traitement d'un changement ------------------------------------------------------------------------------------------------

type Outcome = { status: 'done' } | { status: 'deferred' | 'held'; reason: PendingReason; detail: string };
const done: Outcome = { status: 'done' };

interface ProcessOptions {
  allowDuplicate?: boolean;
}

async function processUpsert(change: RemoteChange, wire: WireRecord, env: InboundEnv, report: InboundReport, options: ProcessOptions): Promise<Outcome> {
  const { id, kind: rawKind, rev } = change;
  const kind = rawKind as Kind;
  const financial = getKindDefinition(kind).financialFact;
  const baseline = await baselineStore.load();
  const conflicts = await conflictStore.load();
  const tombs = await tombstoneStore.load();
  const items = await env.applier.snapshot();
  const be = baseline.entries[id];
  const open = conflicts.open[id];
  const tomb = tombs.items[id];
  const local = items.find((i) => i.id === id) ?? null;
  const remoteHash = contentHash(wire);

  if ((be && rev <= be.rev) || (open && rev <= open.remote.rev) || (tomb?.status === 'deleted' && !local && rev <= tomb.remoteRev)) {
    report.stale.push(id);
    return done;
  }

  // parents : chaque référence vers un type synchronisable doit déjà exister localement (sinon on attend, sans rien écrire)
  for (const ref of extractReferences(kind, itemFromWire(wire, null, { toolId: '-', entityDefinitionId: '-' }))) {
    if (!ref.targetKind || getKindDefinition(ref.targetKind).sync !== 'planned') continue;
    const parent = items.find((i) => i.id === ref.id);
    if (parent && parent.kind !== ref.targetKind) {
      report.rejected.push({ recordId: id, problems: [`${ref.field} : ${ref.id} désigne un autre type (${parent.kind}).`] });
      return { status: 'held', reason: 'invalid', detail: `${ref.field} désigne un autre type` };
    }
    if (!parent) return { status: 'deferred', reason: 'waiting_parent', detail: `${ref.field} : ${ref.id} n’est pas encore présent localement.` };
  }

  if (!local) {
    if (be) {
      // supprimé ici depuis la dernière synchronisation, modifié ailleurs : on ne choisit pas
      await openConflict(env, report, { recordId: id, kind, type: 'delete_vs_update', base: be.base ?? null, local: null, remote: { rev, deleted: false, deletedAt: null, wire }, fields: [] });
      return done;
    }
    const key = naturalKeyOfWire(wire);
    if (key && !options.allowDuplicate) {
      const owners = [
        ...items.filter((i) => i.id !== id && i.kind === kind && naturalKeyOf(i.kind, i.item) === key).map((i) => i.id),
        ...(externalKeyOwners(items, baseline).get(`${kind}|${key}`) ?? []).filter((x) => x !== id),
      ];
      if (owners.length > 0) {
        report.duplicates.push({ recordId: id, kind, key, with: [...new Set(owners)].sort() });
        return { status: 'held', reason: 'logical_duplicate', detail: `Même clé logique que ${[...new Set(owners)].sort().join(', ')} : aucune fusion automatique.` };
      }
    }
    await applyRemoteUpsert(env, wire, rev, true);
    if (tomb && tomb.status === 'deleted') await tombstoneStore.update((s) => ({ ...s, items: { ...s.items, [id]: { ...tomb, status: 'superseded', statusAt: env.now.toISOString() } } }));
    await closeConflictIfOpen(id, 'résolu par une version distante plus récente', env.now);
    report.applied.push(id);
    return done;
  }

  const lh = local.hash;
  if (!be) {
    if (lh === remoteHash) {
      // reprise après interruption (élément déjà écrit, référence manquante) ou même contenu des deux côtés : on adopte
      await setBaseline(id, entryFor(wire, rev));
      await dropOperation(id, (op) => op.op !== 'delete');
      await patchMeta(id, kind, (m) => markSynced(m, rev, env.now), env.now, 'remote');
      await closeConflictIfOpen(id, 'contenu identique des deux côtés', env.now);
      report.converged.push(id);
      return done;
    }
    const l = localContent(kind, local.item, env.ownerUid);
    const r = contentOfWire(wire);
    await openConflict(env, report, { recordId: id, kind, type: 'no_base', base: null, local: l, remote: { rev, deleted: false, deletedAt: null, wire }, fields: differingFields(l, r) });
    return done;
  }

  if (lh === remoteHash) {
    await setBaseline(id, entryFor(wire, rev));
    await dropOperation(id, (op) => op.op === 'update');
    await patchMeta(id, kind, (m) => markSynced(m, rev, env.now), env.now);
    await closeConflictIfOpen(id, 'contenu identique des deux côtés', env.now);
    report.converged.push(id);
    return done;
  }

  const l = localContent(kind, local.item, env.ownerUid);
  const r = contentOfWire(wire);

  if (financial) {
    await openConflict(env, report, { recordId: id, kind, type: 'financial_remote_change', base: be.base ?? null, local: l, remote: { rev, deleted: false, deletedAt: null, wire }, fields: differingFields(l, r) });
    return done;
  }

  if (lh === be.hash) {
    await applyRemoteUpsert(env, wire, rev, false);
    await closeConflictIfOpen(id, 'résolu par une version distante plus récente', env.now);
    report.updated.push(id);
    return done;
  }

  const merge = mergeThreeWay(be.base, l, r);
  if (merge.status === 'clean') {
    const mergedWire: WireRecord = { ...wire, body: merge.merged.body, refs: merge.merged.refs, statusKey: merge.merged.statusKey, updatedAt: [wire.updatedAt, str(local.item.updatedAt)].sort().pop() as string };
    await env.applier.upsert(mergedWire);
    await setBaseline(id, entryFor(wire, rev)); // la référence reste la version DISTANTE : la partie locale part ensuite comme une modification
    await rebaseOperation(id, rev);
    const merged = contentOfWire(mergedWire);
    if (contentEquals(merged, r)) await dropOperation(id, (op) => op.op === 'update');
    await patchMeta(id, kind, (m) => (contentEquals(merged, r) ? markSynced(m, rev, env.now) : markPending(m, 'update', env.now)), env.now);
    await closeConflictIfOpen(id, 'fusion automatique (champs distincts)', env.now);
    report.merged.push(id);
    return done;
  }
  const type: ConflictType = merge.status === 'conflict' ? 'both_modified' : 'no_base';
  await openConflict(env, report, { recordId: id, kind, type, base: be.base ?? null, local: l, remote: { rev, deleted: false, deletedAt: null, wire }, fields: merge.status === 'conflict' ? merge.fields : differingFields(l, r) });
  return done;
}

const str = (v: unknown): string => (typeof v === 'string' ? v : '');

async function processDelete(change: RemoteChange, env: InboundEnv, report: InboundReport): Promise<Outcome> {
  const { id, rev } = change;
  const kind = change.kind as Kind;
  const baseline = await baselineStore.load();
  const conflicts = await conflictStore.load();
  const tombs = await tombstoneStore.load();
  const items = await env.applier.snapshot();
  const be = baseline.entries[id];
  const open = conflicts.open[id];
  const tomb = tombs.items[id];
  const local = items.find((i) => i.id === id) ?? null;

  const resumingRemoval = !!tomb && tomb.status === 'deleted' && tomb.remoteRev === rev && !!local; // interruption après la copie, avant le retrait
  if (!resumingRemoval && ((be && rev <= be.rev) || (open && rev <= open.remote.rev) || (tomb?.status === 'deleted' && rev <= tomb.remoteRev))) {
    report.stale.push(id);
    return done;
  }

  if (!local) {
    if (be) {
      // supprimé des deux côtés : on retire simplement le suivi, sans rien envoyer
      await setBaseline(id, null);
      await dropOperation(id, (op) => op.op === 'delete');
      await patchMeta(id, kind, () => null, env.now);
    }
    await closeConflictIfOpen(id, 'supprimé des deux côtés', env.now);
    report.converged.push(id);
    return done;
  }

  const financial = getKindDefinition(kind).financialFact;
  const l = localContent(kind, local.item, env.ownerUid);
  const remoteSide = { rev, deleted: true, deletedAt: change.deletedAt, wire: null };
  if (financial) {
    await openConflict(env, report, { recordId: id, kind, type: 'financial_remote_delete', base: be?.base ?? null, local: l, remote: remoteSide, fields: [] });
    return done;
  }
  if (!be) {
    await openConflict(env, report, { recordId: id, kind, type: 'no_base', base: null, local: l, remote: remoteSide, fields: [] });
    return done;
  }
  if (local.hash !== be.hash) {
    await openConflict(env, report, { recordId: id, kind, type: 'update_vs_delete', base: be.base ?? null, local: l, remote: remoteSide, fields: [] });
    return done;
  }
  const dependents = referencesOf(items, id);
  if (dependents.length > 0) {
    return { status: 'deferred', reason: 'has_dependents', detail: `Encore référencé par ${dependents.map((d) => d.id).sort().join(', ')} : suppression distante appliquée quand ils ne dépendent plus de cet élément.` };
  }
  await removeToTombstone(env, local, be, rev, change.deletedAt);
  await closeConflictIfOpen(id, 'suppression distante appliquée', env.now);
  report.tombstoned.push(id);
  return done;
}

/** Suppression logique réversible : copie complète d'abord, retrait ensuite, puis fin du suivi (aucun envoi de suppression en écho). */
async function removeToTombstone(env: InboundEnv, local: LocalItem, be: BaselineEntry | null, rev: number, deletedAt: string | null): Promise<void> {
  await tombstoneStore.update((s) => ({
    ...s,
    items: { ...s.items, [local.id]: { recordId: local.id, kind: local.kind, remoteRev: rev, remoteDeletedAt: deletedAt, receivedAt: env.now.toISOString(), snapshot: JSON.parse(JSON.stringify(local.item)), baseline: be, status: 'deleted', statusAt: env.now.toISOString() } },
  }));
  await env.applier.remove(local.kind, local.id);
  await setBaseline(local.id, null);
  await dropOperation(local.id);
  await patchMeta(local.id, local.kind, () => null, env.now);
}

// ---- Application d'un lot ---------------------------------------------------------------------------------------------------------

async function storePending(env: InboundEnv, change: RemoteChange, reason: PendingReason, detail: string): Promise<void> {
  await pendingInboundStore.update((s) => {
    const existing = s.items[change.id];
    if (existing && existing.change.rev > change.rev) return s; // une version plus récente est déjà retenue
    return { ...s, items: { ...s.items, [change.id]: { change, reason, detail, since: existing?.since ?? env.now.toISOString(), attempts: (existing?.attempts ?? 0) + 1 } } };
  });
}

async function clearPending(id: string, upToRev: number): Promise<void> {
  const current = (await pendingInboundStore.load()).items[id];
  if (!current || current.change.rev > upToRev) return;
  await pendingInboundStore.update((s) => {
    const rest = { ...s.items };
    delete rest[id];
    return { ...s, items: rest };
  });
}

async function processChange(change: RemoteChange, env: InboundEnv, report: InboundReport, options: ProcessOptions): Promise<Outcome> {
  if (change.deleted) return processDelete(change, env, report);
  return processUpsert(change, change.wire as WireRecord, env, report, options);
}

/**
 * Applique un lot de changements reçus. Idempotent. Les changements invalides ou d'une version de schéma plus récente sont retenus
 * (jamais perdus, jamais appliqués à l'aveugle). Les parents sont traités avant les enfants ; un enfant dont le parent manque attend.
 * Lève une erreur si l'enregistrement local échoue : l'appelant ne doit alors PAS avancer son curseur (le rejeu est sans effet).
 */
export async function applyRemoteChanges(changes: readonly RemoteChange[], env: InboundEnv, options: ProcessOptions = {}): Promise<InboundReport> {
  const report = emptyInboundReport();
  const latest = new Map<string, RemoteChange>();
  for (const change of changes) {
    const id = isPlainObject(change) && typeof (change as RemoteChange).id === 'string' ? (change as RemoteChange).id : '';
    if (!id) {
      report.rejected.push({ recordId: '', problems: ['changement sans identifiant'] });
      continue;
    }
    const known = latest.get(id);
    if (!known || (typeof change.rev === 'number' && change.rev >= (known.rev as number))) latest.set(id, change);
  }

  const valid: RemoteChange[] = [];
  for (const change of latest.values()) {
    const check = validateRemoteChange(change, env.ownerUid);
    if (check.newerSchema) {
      await storePending(env, change, 'newer_schema', 'Version de données plus récente que cette application : mettre l’application à jour.');
      report.deferred.push({ recordId: change.id, reason: 'newer_schema', detail: 'version plus récente' });
    } else if (check.problems.length > 0) {
      if (typeof change.rev === 'number' && change.rev >= 1) await storePending(env, change, 'invalid', check.problems.join(' ; '));
      report.rejected.push({ recordId: change.id, problems: check.problems });
    } else valid.push(change);
  }

  const order = new Map(syncOrder().map((kind, index) => [kind as string, index]));
  const rank = (c: RemoteChange) => order.get(c.kind) ?? 0;
  const upserts = valid.filter((c) => !c.deleted).sort((a, b) => rank(a) - rank(b) || a.rev - b.rev);
  const deletes = valid.filter((c) => c.deleted).sort((a, b) => rank(b) - rank(a) || a.rev - b.rev);

  let queue = [...upserts, ...deletes];
  const waiting = new Map<string, Outcome & { status: 'deferred' | 'held' }>();
  for (let pass = 0; pass < 20 && queue.length > 0; pass += 1) {
    const next: RemoteChange[] = [];
    let progressed = false;
    for (const change of queue) {
      const outcome = await processChange(change, env, report, options);
      if (outcome.status === 'done') {
        progressed = true;
        waiting.delete(change.id);
        await clearPending(change.id, change.rev);
      } else if (outcome.status === 'deferred') {
        next.push(change);
        waiting.set(change.id, outcome);
      } else {
        waiting.set(change.id, outcome);
      }
    }
    if (!progressed) break;
    queue = next;
  }
  for (const change of valid) {
    const w = waiting.get(change.id);
    if (!w) continue;
    await storePending(env, change, w.reason, w.detail);
    report.deferred.push({ recordId: change.id, reason: w.reason, detail: w.detail });
  }
  return report;
}

/** Retente les changements retenus (parents arrivés depuis, enfants disparus…). Les changements invalides ne sont pas rejoués. */
export async function retryPendingInbound(env: InboundEnv): Promise<InboundReport> {
  const pending = await pendingInboundStore.load();
  const retry = Object.values(pending.items).filter((p) => p.reason !== 'invalid' && p.reason !== 'logical_duplicate').map((p) => p.change);
  return applyRemoteChanges(retry, env);
}

/** Décision EXPLICITE : applique un changement distant retenu comme doublon logique (les deux éléments existent alors, rien n'est fusionné). */
export async function releaseHeldDuplicate(recordId: string, env: InboundEnv): Promise<InboundReport> {
  guardDemo();
  requireSyncAccount(env.ownerUid);
  const entry = (await pendingInboundStore.load()).items[recordId];
  if (!entry || entry.reason !== 'logical_duplicate') throw new InboundError('not_found', 'Aucun doublon retenu pour cet enregistrement.');
  return applyRemoteChanges([entry.change], env, { allowDuplicate: true });
}

// ---- Exécution complète (lecture par pages) ------------------------------------------------------------------------------------

export class InboundError extends Error {
  constructor(readonly code: 'not_found' | 'unsupported' | 'invalid_pick' | 'parent_missing' | 'exists', message: string) {
    super(message);
    this.name = 'InboundError';
  }
}

function guardDemo(): void {
  if (workspaceId() !== 'personal') throw new SyncEngineError('demo_workspace', 'L’espace de démonstration ne reçoit jamais de changements distants.');
}

/** `suspended` : le cloud refuse la lecture (règles d'urgence, accès retiré) ; le curseur est conservé, rien n'est perdu. */
export type InboundStop = 'network' | 'pull_error' | 'persistence_error' | 'account_changed' | 'suspended' | null;

export interface InboundRunReport extends InboundReport {
  skipped?: 'already_running';
  stopped: InboundStop;
  error?: string;
  pages: number;
  cursor: string | null;
}

export interface InboundRunOptions {
  pull: PullTransport;
  ownerUid: string;
  applier?: LocalApplier;
  now?: () => Date;
  pageSize?: number;
  maxPages?: number;
  /** Arrêt demandé par l'appelant (arrêt du cycle) : arrêt propre avant la prochaine page, le curseur est conservé. */
  shouldStop?: () => boolean;
}

function mergeReports(into: InboundReport, from: InboundReport): void {
  for (const key of Object.keys(emptyInboundReport()) as (keyof InboundReport)[]) (into[key] as unknown[]).push(...(from[key] as unknown[]));
}

/**
 * Lit les changements par pages et les applique. Le curseur n'avance qu'APRÈS le traitement complet d'une page : une interruption
 * (réseau, stockage, arrêt du processus) rejoue la page suivante, sans effet sur ce qui est déjà appliqué (idempotent).
 */
export async function runInbound(options: InboundRunOptions): Promise<InboundRunReport> {
  guardDemo();
  if (!options.ownerUid) throw new SyncEngineError('no_owner', 'Aucun compte propriétaire fourni : rien n’est reçu.');
  const account = requireSyncAccount(options.ownerUid); // le compte annoncé doit être le compte actif
  await requireActivation(); // la réception n'a lieu que pour un compte dont la synchronisation a été ACTIVÉE
  const release = tryAcquireSyncLock();
  const empty = (): InboundRunReport => ({ ...emptyInboundReport(), stopped: null, pages: 0, cursor: null });
  if (!release) return { ...empty(), skipped: 'already_running' };
  const report = empty();
  try {
    try {
      await Promise.all([queueStore.load(), baselineStore.load(), loadSyncMeta(), correctionStore.load(), conflictStore.load(), pendingInboundStore.load(), tombstoneStore.load(), cursorStore.load()]);
    } catch (error) {
      throw new SyncEngineError('store_corrupted', 'Un magasin de synchronisation est illisible : réception arrêtée, rien n’a été modifié.', [error instanceof Error ? error.message : String(error)]);
    }
    const clock = options.now ?? (() => new Date());
    const applier = options.applier ?? createDefaultApplier(account);
    const env = (): InboundEnv => ({ ownerUid: options.ownerUid, applier, now: clock() });
    const maxPages = options.maxPages ?? 50;

    try {
      mergeReports(report, await retryPendingInbound(env()));
    } catch (error) {
      report.stopped = 'persistence_error';
      report.error = error instanceof Error ? error.message : String(error);
      return report;
    }

    let cursor = (await cursorStore.load()).cursor;
    report.cursor = cursor;
    for (let page = 0; page < maxPages; page += 1) {
      if (accountChangePending() || options.shouldStop?.()) {
        report.stopped = 'account_changed'; // déconnexion ou changement de compte : arrêt propre, le curseur du compte est conservé
        return report;
      }
      let result: PullPage;
      try {
        result = await options.pull.pull({ cursor, limit: options.pageSize ?? 100 });
      } catch (error) {
        report.stopped = error instanceof SyncTransportError && error.code === 'network' ? 'network' : error instanceof SyncTransportError && error.code === 'permission' ? 'suspended' : 'pull_error';
        report.error = error instanceof Error ? error.message : String(error);
        return report;
      }
      report.pages = page + 1;
      try {
        mergeReports(report, await applyRemoteChanges(result.changes, env()));
        mergeReports(report, await retryPendingInbound(env())); // un parent arrivé dans cette page peut débloquer un enfant retenu
        if (result.nextCursor !== null && result.nextCursor !== cursor) {
          const at = clock().toISOString();
          await cursorStore.update((s) => ({ ...s, cursor: result.nextCursor, updatedAt: at }));
        }
      } catch (error) {
        // le curseur n'a PAS avancé : la page sera rejouée, sans effet sur ce qui est déjà appliqué
        report.stopped = 'persistence_error';
        report.error = error instanceof Error ? error.message : String(error);
        return report;
      }
      const advanced = result.nextCursor !== null && result.nextCursor !== cursor;
      cursor = result.nextCursor ?? cursor;
      report.cursor = cursor;
      if (!result.hasMore || !advanced) break;
    }
    return report;
  } finally {
    release();
  }
}

// ---- Résolution explicite des conflits -------------------------------------------------------------------------------------------

export type Resolution = { type: 'keep_local' } | { type: 'keep_remote' } | { type: 'fields'; picks: Record<string, 'local' | 'remote'> };

const UNSUPPORTED_RESTORE = 'Un fait financier supprimé à distance ne se restaure pas par cette voie : conservez la suppression et enregistrez une correction explicite.';

/**
 * Résout un conflit OUVERT par une décision explicite. La version écartée est conservée dans l'historique du conflit. Les décisions
 * qui exigeraient une opération cloud non définie (restaurer un élément supprimé à distance, effacer un fait financier) sont refusées
 * (`unsupported`) : le conflit reste ouvert, rien n'est modifié.
 */
export async function resolveConflict(recordId: string, resolution: Resolution, env: InboundEnv): Promise<void> {
  guardDemo();
  requireSyncAccount(env.ownerUid);
  const release = tryAcquireSyncLock();
  if (!release) throw new InboundError('exists', 'Une synchronisation est en cours : réessayez dans un instant.');
  try {
    await resolveConflictLocked(recordId, resolution, env);
  } finally {
    release();
  }
}

async function resolveConflictLocked(recordId: string, resolution: Resolution, env: InboundEnv): Promise<void> {
  const conflict = (await conflictStore.load()).open[recordId];
  if (!conflict) throw new InboundError('not_found', 'Aucun conflit ouvert pour cet enregistrement.');
  const kind = conflict.kind;
  const wire = conflict.remote.wire;
  const items = await env.applier.snapshot();
  const local = items.find((i) => i.id === recordId) ?? null;
  const rev = conflict.remote.rev;

  switch (conflict.type) {
    case 'both_modified':
    case 'no_base':
    case 'financial_remote_change': {
      if (!local || !wire) throw new InboundError('not_found', 'Élément local ou version distante introuvable : conflit laissé ouvert.');
      const l = localContent(kind, local.item, env.ownerUid);
      const r = contentOfWire(wire);
      if (resolution.type === 'keep_remote') {
        await applyRemoteUpsert(env, wire, rev, false);
        await dropOperation(recordId);
        await closeConflict(recordId, 'version distante conservée', l, env.now);
      } else if (resolution.type === 'keep_local') {
        await setBaseline(recordId, entryFor(wire, rev)); // la version locale part ensuite comme modification, au-dessus de la révision distante
        await rebaseOperation(recordId, rev);
        await patchMeta(recordId, kind, (m) => markPending(m, 'update', env.now), env.now);
        await closeConflict(recordId, 'version locale conservée', r, env.now);
      } else {
        const differing = differingFields(l, r);
        const missing = differing.filter((f) => !(f in resolution.picks));
        const unknown = Object.keys(resolution.picks).filter((f) => !differing.includes(f));
        if (missing.length > 0 || unknown.length > 0) throw new InboundError('invalid_pick', `Chaque champ en désaccord doit être choisi (manquants : ${missing.join(', ') || '—'} ; inconnus : ${unknown.join(', ') || '—'}).`);
        const body: Record<string, unknown> = {};
        for (const key of new Set([...Object.keys(l.body), ...Object.keys(r.body)])) {
          const side = differing.includes(key) ? resolution.picks[key] : 'local';
          const source = side === 'remote' ? r.body : l.body;
          if (Object.prototype.hasOwnProperty.call(source, key)) body[key] = source[key];
        }
        const statusKey = differing.includes(STATUS_FIELD_NAME) ? (resolution.picks[STATUS_FIELD_NAME] === 'remote' ? r.statusKey : l.statusKey) : l.statusKey;
        const refs: Record<string, string> = {};
        for (const field of new Set([...Object.keys(l.refs), ...Object.keys(r.refs)])) if (typeof body[field] === 'string' && body[field] !== '') refs[field] = body[field] as string;
        await env.applier.upsert({ ...wire, body, refs, statusKey });
        await setBaseline(recordId, entryFor(wire, rev));
        await rebaseOperation(recordId, rev);
        await patchMeta(recordId, kind, (m) => markPending(m, 'update', env.now), env.now);
        await closeConflict(recordId, 'choix champ par champ', null, env.now);
      }
      return;
    }
    case 'delete_vs_update': {
      if (!wire) throw new InboundError('not_found', 'Version distante introuvable : conflit laissé ouvert.');
      if (resolution.type === 'keep_remote') {
        await applyRemoteUpsert(env, wire, rev, false);
        await dropOperation(recordId);
        await closeConflict(recordId, 'version distante rétablie localement', null, env.now);
      } else if (resolution.type === 'keep_local') {
        // la suppression locale est maintenue : elle repart au-dessus de la révision distante
        await setBaseline(recordId, entryFor(wire, rev));
        await rebaseOperation(recordId, rev);
        await patchMeta(recordId, kind, (m) => markPending(m, 'delete', env.now), env.now);
        await closeConflict(recordId, 'suppression locale maintenue', contentOfWire(wire), env.now);
      } else throw new InboundError('unsupported', 'Aucun champ à choisir : la version locale est une suppression.');
      return;
    }
    case 'update_vs_delete':
    case 'restored_tombstone': {
      if (resolution.type === 'fields') throw new InboundError('unsupported', 'Aucun champ à choisir : la version distante est une suppression.');
      if (resolution.type === 'keep_local') {
        // Garder la version locale = RESTAURER explicitement l'élément dans le cloud (opération `restore`, au-dessus de la révision de la
        // suppression), puis envoyer le contenu local comme modification. Jamais pour un fait financier (ces types ont leur propre cas).
        if (!local) throw new InboundError('not_found', 'Élément local introuvable : conflit laissé ouvert.');
        if (getKindDefinition(kind).financialFact) throw new InboundError('unsupported', UNSUPPORTED_RESTORE);
        if (!conflict.remote.deleted) throw new InboundError('unsupported', 'La version distante n’est pas une suppression : conflit laissé ouvert.');
        await enqueueChange({ recordId, kind, op: 'restore', baseRev: rev }, env.now);
        await patchMeta(recordId, kind, (m) => markPending(m, 'update', env.now), env.now);
        await closeConflict(recordId, 'restauration cloud demandée (version locale conservée)', null, env.now);
        return;
      }
      if (local) {
        const baselineEntry = (await baselineStore.load()).entries[recordId] ?? null;
        await removeToTombstone(env, local, baselineEntry, rev, conflict.remote.deletedAt);
      }
      await closeConflict(recordId, 'suppression distante appliquée (copie conservée)', conflict.local, env.now);
      return;
    }
    case 'financial_remote_delete':
      throw new InboundError('unsupported', 'Un fait financier ne se supprime jamais : enregistrez une annulation ou une correction explicite (financialCorrection.ts). ' + UNSUPPORTED_RESTORE);
  }
}

// ---- Restauration locale d'une suppression reçue ------------------------------------------------------------------------------------

/**
 * Restaure LOCALEMENT un élément supprimé à distance (copie conservée par la pierre tombale). L'élément est réinséré tel qu'il était ; comme
 * le cloud n'a pas d'opération de restauration définie, un conflit « restauré après suppression » est ouvert : il retient tout envoi.
 */
export async function restoreTombstone(recordId: string, env: InboundEnv): Promise<void> {
  guardDemo();
  requireSyncAccount(env.ownerUid);
  const release = tryAcquireSyncLock();
  if (!release) throw new InboundError('exists', 'Une synchronisation est en cours : réessayez dans un instant.');
  try {
    const tomb = (await tombstoneStore.load()).items[recordId];
    if (!tomb || tomb.status !== 'deleted') throw new InboundError('not_found', 'Aucune suppression reçue à restaurer pour cet enregistrement.');
    const items = await env.applier.snapshot();
    if (items.some((i) => i.id === recordId)) throw new InboundError('exists', 'Un élément portant cet identifiant existe déjà.');
    for (const ref of extractReferences(tomb.kind, tomb.snapshot)) {
      if (ref.targetKind && getKindDefinition(ref.targetKind).sync === 'planned' && !items.some((i) => i.id === ref.id)) {
        throw new InboundError('parent_missing', `Restauration impossible : ${ref.field} (${ref.id}) n’existe plus localement.`);
      }
    }
    await env.applier.insert(tomb.kind, tomb.snapshot);
    await tombstoneStore.update((s) => ({ ...s, items: { ...s.items, [recordId]: { ...tomb, status: 'restored', statusAt: env.now.toISOString() } } }));
    const content = localContent(tomb.kind, tomb.snapshot, env.ownerUid);
    await conflictStore.update((s) => ({
      ...s,
      open: { ...s.open, [recordId]: { recordId, kind: tomb.kind, type: 'restored_tombstone', detectedAt: env.now.toISOString(), base: tomb.baseline?.base ?? null, local: content, remote: { rev: tomb.remoteRev, deleted: true, deletedAt: tomb.remoteDeletedAt, wire: null }, fields: [], resolvedAt: null, resolution: null, discarded: null } },
    }));
  } finally {
    release();
  }
}
