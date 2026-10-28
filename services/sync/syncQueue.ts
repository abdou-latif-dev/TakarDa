// File d'opérations PERSISTANTE et référence de synchronisation — P2, strictement locale.
//
// La file garde, par enregistrement, UNE seule opération explicite en attente : création, mise à jour ou suppression logique.
// Les opérations successives sur le même enregistrement sont fusionnées sans perte (voir `coalesce`). Chaque opération porte son
// état de tentative (nombre, dernière tentative, prochaine tentative, dernière erreur) et un éventuel blocage explicite
// (référence absente, parent en attente, politique financière, conflit, doublon logique, erreur définitive) : une opération bloquée
// n'est jamais envoyée ni perdue.
//
// La « référence » (baseline) mémorise, pour chaque enregistrement confirmé par le cloud, l'empreinte du contenu envoyé : c'est elle
// qui permet de repérer les modifications et suppressions locales sans toucher aux services métier.
//
// Aucun réseau, aucun SDK. Non branché à l'application dans P2.

import { createPersistentStore } from './localStore';
import { isKnownKind, type Kind } from './kindRegistry';

/**
 * `restore` (P5) : lève une suppression logique FAITE DANS LE CLOUD (décision explicite de l'utilisateur sur un conflit). Elle ne porte aucun
 * contenu : le contenu local part ensuite comme une modification ordinaire, au-dessus de la révision de restauration.
 */
export type OperationType = 'create' | 'update' | 'delete' | 'restore';
export const OPERATION_TYPES: readonly OperationType[] = ['create', 'update', 'delete', 'restore'];

/** Empreinte de référence posée après une restauration confirmée : le contenu du cloud est INCONNU, donc différent du contenu local (qui part ensuite). */
export const RESTORED_PLACEHOLDER_HASH = '0'.repeat(64);

/**
 * Raisons de blocage persistantes. `conflict` et `permanent_error` sont COLLANTES : seule une décision explicite les lève (P3).
 * Les autres sont recalculées à chaque planification.
 */
export type BlockReason = 'waiting_parent' | 'invalid_reference' | 'financial_policy' | 'logical_duplicate' | 'conflict' | 'permanent_error' | 'retry_later' | 'out_of_scope';
export const BLOCK_REASONS: readonly BlockReason[] = ['waiting_parent', 'invalid_reference', 'financial_policy', 'logical_duplicate', 'conflict', 'permanent_error', 'retry_later', 'out_of_scope'];
export const STICKY_BLOCKS: readonly BlockReason[] = ['conflict', 'permanent_error'];

export interface OperationBlock {
  reason: BlockReason;
  detail: string;
}

export interface QueuedOperation {
  /** Identifiant d'opération, stable pendant toute la vie de l'opération (jeton d'idempotence côté cloud). */
  opId: string;
  recordId: string;
  kind: Kind;
  op: OperationType;
  /** Dernière révision cloud connue (0 = jamais confirmé). */
  baseRev: number;
  /** Suppression LOGIQUE : horodatage de la suppression (opération « delete » uniquement). */
  deletedAt: string | null;
  enqueuedAt: string;
  updatedAt: string;
  attempts: number;
  lastAttemptAt: string | null;
  nextRetryAt: string | null;
  lastError: string | null;
  /** Envoi commencé et résultat non enregistré (interruption possible) : la reprise vérifie l'état du cloud avant de renvoyer. */
  inFlight: boolean;
  /** Résultat inconnu après une interruption : à vérifier, jamais renvoyé à l'aveugle. */
  uncertain: boolean;
  block: OperationBlock | null;
}

export interface QueueStore {
  schemaVersion: 1;
  seq: number;
  /**
   * Marque UNIQUE de cette file (tirée au hasard à la première capture). Elle rend les identifiants d'opération uniques entre appareils et
   * entre réinitialisations de la file : un identifiant sert de jeton d'idempotence dans le cloud, il ne doit jamais se répéter.
   */
  nonce?: string;
  /** Une opération au plus par enregistrement. */
  ops: Record<string, QueuedOperation>;
}

/** Contenu métier confirmé (corps, références, statut) : version de BASE de la fusion à trois voies. */
export interface BaselineContent {
  body: Record<string, unknown>;
  refs: Record<string, string>;
  statusKey: string | null;
}

export interface BaselineEntry {
  kind: Kind;
  /** Empreinte du contenu confirmé par le cloud (voir wireFormat.contentHash). */
  hash: string;
  rev: number;
  /** Contenu confirmé, quand il est connu : sans lui, une modification concurrente est un conflit (jamais une fusion devinée). */
  base?: BaselineContent;
  /** Clé logique de l'enregistrement confirmé (détection de doublons avec des éléments déjà connus du cloud). */
  naturalKey?: string | null;
}

export interface BaselineStore {
  schemaVersion: 1;
  entries: Record<string, BaselineEntry>;
}

// ---- Validation ---------------------------------------------------------------------------------------------------------

export function validateOperation(value: unknown): string[] {
  if (!value || typeof value !== 'object') return ['opération illisible'];
  const o = value as Record<string, unknown>;
  const problems: string[] = [];
  if (typeof o.opId !== 'string' || o.opId === '') problems.push('opId manquant');
  if (typeof o.recordId !== 'string' || o.recordId === '') problems.push('recordId manquant');
  if (typeof o.kind !== 'string' || !isKnownKind(o.kind)) problems.push('type inconnu');
  if (!OPERATION_TYPES.includes(o.op as OperationType)) problems.push('opération inconnue');
  if (typeof o.baseRev !== 'number' || !Number.isInteger(o.baseRev) || o.baseRev < 0) problems.push('révision invalide');
  if (typeof o.attempts !== 'number' || !Number.isInteger(o.attempts) || o.attempts < 0) problems.push('tentatives invalides');
  if (o.op === 'delete' && (typeof o.deletedAt !== 'string' || o.deletedAt === '')) problems.push('suppression sans horodatage');
  if (o.op !== 'delete' && o.deletedAt !== null) problems.push('horodatage de suppression sur une opération qui n’en est pas une');
  if (typeof o.inFlight !== 'boolean' || typeof o.uncertain !== 'boolean') problems.push('indicateurs d’envoi invalides');
  if (o.block !== null) {
    const b = o.block as Record<string, unknown> | undefined;
    if (!b || !BLOCK_REASONS.includes(b.reason as BlockReason) || typeof b.detail !== 'string') problems.push('blocage invalide');
  }
  return problems;
}

export function validateQueue(value: unknown): string[] {
  if (!value || typeof value !== 'object') return ['magasin illisible'];
  const q = value as Record<string, unknown>;
  if (q.schemaVersion !== 1) return ['version de schéma inconnue'];
  if (typeof q.seq !== 'number' || !Number.isInteger(q.seq) || q.seq < 0) return ['compteur invalide'];
  if (q.nonce !== undefined && (typeof q.nonce !== 'string' || q.nonce === '')) return ['marque de file invalide'];
  if (!q.ops || typeof q.ops !== 'object') return ['opérations absentes'];
  const problems: string[] = [];
  for (const [id, op] of Object.entries(q.ops as Record<string, unknown>)) {
    for (const p of validateOperation(op)) problems.push(`${id} : ${p}`);
    if ((op as QueuedOperation)?.recordId !== id) problems.push(`${id} : clé différente de l’enregistrement`);
  }
  return problems;
}

export function validateBaseline(value: unknown): string[] {
  if (!value || typeof value !== 'object') return ['magasin illisible'];
  const b = value as Record<string, unknown>;
  if (b.schemaVersion !== 1 || !b.entries || typeof b.entries !== 'object') return ['structure invalide'];
  const problems: string[] = [];
  for (const [id, e] of Object.entries(b.entries as Record<string, unknown>)) {
    const entry = e as Record<string, unknown> | null;
    if (!entry || typeof entry.kind !== 'string' || !isKnownKind(entry.kind) || typeof entry.hash !== 'string' || entry.hash.length !== 64 || typeof entry.rev !== 'number' || entry.rev < 0) problems.push(`${id} : entrée invalide`);
    else if (entry.base !== undefined && (!entry.base || typeof entry.base !== 'object' || typeof (entry.base as BaselineContent).body !== 'object' || typeof (entry.base as BaselineContent).refs !== 'object')) problems.push(`${id} : contenu de base invalide`);
    else if (entry.naturalKey !== undefined && entry.naturalKey !== null && typeof entry.naturalKey !== 'string') problems.push(`${id} : clé logique invalide`);
  }
  return problems;
}

export const queueStore = createPersistentStore<QueueStore>({ baseKey: 'sync_queue', name: 'file d’opérations', empty: () => ({ schemaVersion: 1, seq: 0, ops: {} }), validate: validateQueue });
export const baselineStore = createPersistentStore<BaselineStore>({ baseKey: 'sync_baseline', name: 'référence de synchronisation', empty: () => ({ schemaVersion: 1, entries: {} }), validate: validateBaseline });

// ---- Fusion d'opérations (pure) ------------------------------------------------------------------------------------------

export interface IncomingChange {
  recordId: string;
  kind: Kind;
  op: OperationType;
  /** Dernière révision cloud connue de l'enregistrement (0 si jamais confirmé). */
  baseRev: number;
  deletedAt?: string;
}

const fresh = (change: IncomingChange, opId: string, now: Date): QueuedOperation => ({
  opId,
  recordId: change.recordId,
  kind: change.kind,
  op: change.op,
  baseRev: change.baseRev,
  deletedAt: change.op === 'delete' ? change.deletedAt ?? now.toISOString() : null,
  enqueuedAt: now.toISOString(),
  updatedAt: now.toISOString(),
  attempts: 0,
  lastAttemptAt: null,
  nextRetryAt: null,
  lastError: null,
  inFlight: false,
  uncertain: false,
  block: null,
});

/**
 * Fusionne un changement avec l'opération déjà en attente pour le même enregistrement, SANS PERTE :
 *  - création puis modification : reste une création (le contenu envoyé est celui du moment de l'envoi) ;
 *  - modification puis modification : reste une modification ;
 *  - création jamais tentée puis suppression : annulées (rien n'a jamais quitté l'appareil) ;
 *  - création déjà tentée puis suppression : devient une SUPPRESSION (le cloud peut déjà contenir l'enregistrement) ;
 *  - modification puis suppression : suppression ;
 *  - suppression puis recréation (même identifiant) avant l'envoi : devient une modification (rien n'a été supprimé côté cloud) ;
 *  - une suppression en attente n'est jamais rétrogradée par une modification.
 * Retourne l'opération résultante, ou null si les deux changements s'annulent.
 */
export function coalesce(existing: QueuedOperation | undefined, change: IncomingChange, opId: string, now: Date): QueuedOperation | null {
  if (!existing) return fresh(change, opId, now);
  const touch = (patch: Partial<QueuedOperation>): QueuedOperation => ({ ...existing, ...patch, updatedAt: now.toISOString() });
  const neverTried = existing.attempts === 0 && existing.lastAttemptAt === null && !existing.inFlight && !existing.uncertain;
  // restauration demandée : remplace une modification ou création en attente (le contenu partira ensuite) ; jamais au-dessus d'une suppression locale
  if (change.op === 'restore') return existing.op === 'delete' ? existing : touch({ op: 'restore', baseRev: change.baseRev, deletedAt: null, block: null, nextRetryAt: null });
  switch (existing.op) {
    case 'create':
      if (change.op === 'delete') return neverTried ? null : touch({ op: 'delete', deletedAt: change.deletedAt ?? now.toISOString(), block: null });
      return touch({});
    case 'update':
      if (change.op === 'delete') return touch({ op: 'delete', deletedAt: change.deletedAt ?? now.toISOString(), block: null });
      return touch({});
    case 'delete':
      if (change.op === 'create' || change.op === 'update') return touch({ op: 'update', deletedAt: null, block: null });
      return touch({});
    case 'restore':
      if (change.op === 'delete') return null; // supprimé localement avant d'avoir restauré : plus rien à faire (le cloud est déjà supprimé)
      return touch({}); // les modifications locales partiront après la restauration
    default:
      return existing;
  }
}

/** Applique une série de changements à la file (pure) : une opération par enregistrement, identifiants d'opération attribués une fois. */
export function applyChanges(queue: QueueStore, changes: readonly IncomingChange[], now: Date): QueueStore {
  const ops = { ...queue.ops };
  let seq = queue.seq;
  for (const change of changes) {
    const existing = ops[change.recordId];
    const merged = coalesce(existing, change, existing ? existing.opId : `op-${queue.nonce ? `${queue.nonce}-` : ''}${(seq += 1)}`, now);
    if (merged) ops[change.recordId] = merged;
    else delete ops[change.recordId];
  }
  return { ...queue, seq, ops };
}

/** Délai avant la prochaine tentative : exponentiel (2^n secondes), plafonné à 15 minutes, avec une gigue bornée (`random` ∈ [0,1)). */
export function backoffMs(attempts: number, random: () => number = Math.random): number {
  const base = Math.min(1000 * 2 ** Math.max(0, attempts - 1), 15 * 60 * 1000);
  return Math.round(base * (0.75 + 0.5 * random()));
}

export const MAX_TRANSIENT_ATTEMPTS = 8;
