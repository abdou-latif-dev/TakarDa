// Planification de l'envoi — P2, pure : décide quelles opérations de la file sont PRÊTES, lesquelles sont BLOQUÉES (et pourquoi), et
// dans quel ordre envoyer les premières. Ne modifie rien et ne contacte rien.
//
// Ordre : les créations et modifications partent parents d'abord (ordre de dépendance du manifeste de relations) ; les suppressions
// partent enfants d'abord (ordre inverse). Une opération qui dépend d'un parent encore en attente d'envoi attend ; une référence
// absente, non suivie ou en cours de suppression est signalée (« invalid_reference ») et l'opération n'est JAMAIS envoyée.
//
// Politique financière (préparation de P3) : les paiements et cotisations ne doivent jamais être modifiés ni supprimés
// silencieusement. Par défaut, toute modification ou suppression d'un fait financier est RETENUE (« financial_policy »), jamais
// envoyée ni abandonnée, jusqu'à une décision explicite. La création reste possible. Aucune politique irréversible n'est appliquée.
//
// Doublons logiques : une création dont la clé logique existe déjà sous un autre identifiant est retenue (« logical_duplicate ») :
// rien n'est fusionné automatiquement, rien n'est envoyé en double.

import { getKindDefinition, KIND, naturalKeyOf, type Kind } from './kindRegistry';
import { isSyncKind } from './syncScope';
import type { LocalItem } from './changeScanner';
import { extractReferences, syncOrder } from './relationManifest';
import { STICKY_BLOCKS, type BaselineStore, type BlockReason, type QueuedOperation, type QueueStore } from './syncQueue';

export interface FinancialPolicy {
  /** `hold` : l'opération reste en file, bloquée, jusqu'à une décision explicite. */
  decide(op: QueuedOperation): 'allow' | 'hold';
}

/** Politique par défaut de P2 : retenir toute modification ou suppression d'un fait financier. Réversible : aucune donnée n'est touchée. */
export const HOLD_FINANCIAL_CHANGES: FinancialPolicy = {
  decide: (op) => (getKindDefinition(op.kind).financialFact && op.op !== 'create' ? 'hold' : 'allow'),
};

export interface PlannedBlock {
  op: QueuedOperation;
  reason: BlockReason;
  detail: string;
}

export interface Plan {
  ready: QueuedOperation[];
  blocked: PlannedBlock[];
}

export interface PlanInput {
  queue: QueueStore;
  baseline: BaselineStore;
  items: readonly LocalItem[];
  now: Date;
  policy?: FinancialPolicy;
  /** Enregistrements concernés par un conflit de réception OUVERT : leurs opérations restent retenues, jamais envoyées (P3). */
  heldIds?: ReadonlySet<string>;
  /** Clés logiques d'éléments déjà connus du cloud mais absents localement (« type|clé » → identifiants), pour détecter les doublons (P3). */
  externalKeys?: ReadonlyMap<string, readonly string[]>;
  /** Éléments HORS du périmètre de la synchronisation V1 (voir syncScope.ts) : leurs opérations restent retenues, jamais envoyées. */
  excludedIds?: ReadonlySet<string>;
}

const kindIndex = (): Map<Kind, number> => new Map(syncOrder().map((kind, index) => [kind, index]));

export function planOperations(input: PlanInput): Plan {
  const { queue, baseline, items, now } = input;
  const policy = input.policy ?? HOLD_FINANCIAL_CHANGES;
  const byId = new Map(items.map((i) => [i.id, i]));
  const index = kindIndex();

  // doublons logiques parmi les éléments locaux (clé logique partagée par plusieurs identifiants)
  const keyOwners = new Map<string, string[]>();
  for (const local of items) {
    const key = naturalKeyOf(local.kind, local.item);
    if (key) keyOwners.set(`${local.kind}|${key}`, [...(keyOwners.get(`${local.kind}|${key}`) ?? []), local.id]);
  }

  const ready: QueuedOperation[] = [];
  const blocked: PlannedBlock[] = [];
  const block = (op: QueuedOperation, reason: BlockReason, detail: string) => blocked.push({ op, reason, detail });

  for (const op of Object.values(queue.ops)) {
    // périmètre : deuxième barrière, indépendante de la capture (une opération mise en file par un autre chemin ne part pas non plus)
    if (!isSyncKind(op.kind) || input.excludedIds?.has(op.recordId)) {
      block(op, 'out_of_scope', 'Hors du périmètre de la synchronisation (Immobilier seul) : conservé localement, jamais envoyé.');
      continue;
    }
    if (op.block && STICKY_BLOCKS.includes(op.block.reason)) {
      block(op, op.block.reason, op.block.detail);
      continue;
    }
    if (input.heldIds?.has(op.recordId)) {
      block(op, 'conflict', 'Un conflit de réception est ouvert sur cet enregistrement : résolution explicite requise avant tout envoi.');
      continue;
    }
    if (op.nextRetryAt && new Date(op.nextRetryAt).getTime() > now.getTime()) {
      block(op, 'retry_later', `Prochaine tentative après ${op.nextRetryAt}.`);
      continue;
    }
    if (policy.decide(op) === 'hold') {
      block(op, 'financial_policy', 'Modification ou suppression d’un fait financier : décision explicite requise avant tout envoi.');
      continue;
    }
    if (op.op === 'delete') {
      // un locataire encore référencé par un contrat CONFIRMÉ dans le cloud (et non supprimé en même temps) n'est jamais supprimé seul
      if (op.kind === KIND.CORE_CONTACT) {
        const holder = Object.entries(baseline.entries).find(([id, entry]) => entry.kind === KIND.IMMOBILIER_CONTRAT && entry.base?.refs.locataire_id === op.recordId && queue.ops[id]?.op !== 'delete');
        if (holder) {
          block(op, 'invalid_reference', `Locataire encore référencé par le contrat ${holder[0]} : suppression retenue, jamais envoyée seule.`);
          continue;
        }
      }
      ready.push(op);
      continue;
    }

    const local = byId.get(op.recordId);
    if (!local) {
      block(op, 'invalid_reference', 'Enregistrement local introuvable : rien à envoyer.');
      continue;
    }
    if (op.op === 'create') {
      const key = naturalKeyOf(local.kind, local.item);
      const owners = key ? [...(keyOwners.get(`${local.kind}|${key}`) ?? []), ...(input.externalKeys?.get(`${local.kind}|${key}`) ?? [])] : [];
      if (owners.length > 1) {
        block(op, 'logical_duplicate', `Même clé logique que ${owners.filter((id) => id !== op.recordId).join(', ')} : décision explicite requise, aucune fusion automatique.`);
        continue;
      }
    }

    let problem: PlannedBlock | null = null;
    for (const ref of extractReferences(local.kind, local.item)) {
      if (!ref.targetKind || getKindDefinition(ref.targetKind).sync !== 'planned') continue;
      const parentOp = queue.ops[ref.id];
      const parent = byId.get(ref.id);
      if (parent && parent.kind !== ref.targetKind) {
        problem = { op, reason: 'invalid_reference', detail: `${ref.field} : l’identifiant ${ref.id} désigne un autre type (${parent.kind}).` };
      } else if (parentOp?.op === 'delete') {
        problem = { op, reason: 'invalid_reference', detail: `${ref.field} : ${ref.id} est en cours de suppression.` };
      } else if (parentOp && parentOp.op === 'create') {
        problem = { op, reason: 'waiting_parent', detail: `${ref.field} : ${ref.id} n’est pas encore confirmé par le cloud.` };
      } else if (!parentOp && !baseline.entries[ref.id]) {
        problem = {
          op,
          reason: 'invalid_reference',
          detail: parent ? `${ref.field} : ${ref.id} existe localement mais n’est pas suivi (jamais envoyé).` : `${ref.field} : ${ref.id} est introuvable.`,
        };
      }
      if (problem) break;
    }
    if (problem) blocked.push(problem);
    else ready.push(op);
  }

  const order = (op: QueuedOperation) => index.get(op.kind) ?? 0;
  const bySeq = (a: QueuedOperation, b: QueuedOperation) => (a.enqueuedAt === b.enqueuedAt ? (a.opId < b.opId ? -1 : 1) : a.enqueuedAt < b.enqueuedAt ? -1 : 1);
  const upserts = ready.filter((o) => o.op !== 'delete').sort((a, b) => order(a) - order(b) || bySeq(a, b));
  const deletes = ready.filter((o) => o.op === 'delete').sort((a, b) => order(b) - order(a) || bySeq(a, b));
  return { ready: [...upserts, ...deletes], blocked };
}
