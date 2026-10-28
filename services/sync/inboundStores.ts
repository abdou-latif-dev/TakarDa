// Magasins persistants de la RÉCEPTION (P3) : suppressions logiques reçues, conflits, changements en attente, curseur de lecture.
// Mêmes garanties que la file d'envoi (localStore.ts) : propres à l'espace actif, mises à jour sérialisées, un magasin illisible n'est
// jamais traité comme vide ni écrasé. Aucun réseau, aucun SDK.

import { createPersistentStore } from './localStore';
import { isKnownKind, type Kind } from './kindRegistry';
import type { BaselineContent, BaselineEntry } from './syncQueue';
import type { WireRecord } from './wireFormat';

/** Changement reçu du cloud (avant validation). La forme réelle du transport de lecture est définie à l'étape d'intégration. */
export interface RemoteChange {
  id: string;
  kind: string;
  /** Révision cloud de cet état (entier ≥ 1, croissante). */
  rev: number;
  deleted: boolean;
  /** Horodatage de la suppression logique distante (si `deleted`). */
  deletedAt: string | null;
  /** Contenu complet (null pour une suppression). */
  wire: WireRecord | null;
}

// ---- Suppressions logiques reçues (récupérables) ------------------------------------------------------------------------------

export type TombstoneStatus = 'deleted' | 'restored' | 'superseded';

export interface Tombstone {
  recordId: string;
  kind: Kind;
  remoteRev: number;
  remoteDeletedAt: string | null;
  receivedAt: string;
  /** Élément local tel qu'il était AVANT le retrait : permet une restauration contrôlée, sans perte. */
  snapshot: Record<string, unknown>;
  /** Entrée de la référence retirée au moment de la suppression (pour traçabilité). */
  baseline: BaselineEntry | null;
  status: TombstoneStatus;
  statusAt: string | null;
}

export interface TombstoneStoreData {
  schemaVersion: 1;
  items: Record<string, Tombstone>;
}

export function validateTombstones(value: unknown): string[] {
  if (!value || typeof value !== 'object') return ['magasin illisible'];
  const s = value as Record<string, unknown>;
  if (s.schemaVersion !== 1 || !s.items || typeof s.items !== 'object') return ['structure invalide'];
  const problems: string[] = [];
  for (const [id, t] of Object.entries(s.items as Record<string, unknown>)) {
    const x = t as Record<string, unknown> | null;
    if (!x || x.recordId !== id || typeof x.kind !== 'string' || !isKnownKind(x.kind)) problems.push(`${id} : entrée invalide`);
    else if (typeof x.remoteRev !== 'number' || !x.snapshot || typeof x.snapshot !== 'object') problems.push(`${id} : contenu invalide`);
    else if (!['deleted', 'restored', 'superseded'].includes(x.status as string)) problems.push(`${id} : statut inconnu`);
  }
  return problems;
}

export const tombstoneStore = createPersistentStore<TombstoneStoreData>({ baseKey: 'sync_tombstones', name: 'suppressions reçues', empty: () => ({ schemaVersion: 1, items: {} }), validate: validateTombstones });

// ---- Conflits -----------------------------------------------------------------------------------------------------------------

export type ConflictType = 'both_modified' | 'no_base' | 'update_vs_delete' | 'delete_vs_update' | 'financial_remote_change' | 'financial_remote_delete' | 'restored_tombstone';
export const CONFLICT_TYPES: readonly ConflictType[] = ['both_modified', 'no_base', 'update_vs_delete', 'delete_vs_update', 'financial_remote_change', 'financial_remote_delete', 'restored_tombstone'];

export interface ConflictRecord {
  recordId: string;
  kind: Kind;
  type: ConflictType;
  detectedAt: string;
  /** Dernier contenu confirmé commun (null si inconnu). */
  base: BaselineContent | null;
  /** Version locale au moment du conflit (null = supprimée localement). TOUJOURS conservée. */
  local: BaselineContent | null;
  /** Version distante reçue. TOUJOURS conservée (null = supprimée à distance). */
  remote: { rev: number; deleted: boolean; deletedAt: string | null; wire: WireRecord | null };
  /** Champs en désaccord (les deux côtés les ont modifiés différemment). */
  fields: string[];
  resolvedAt: string | null;
  resolution: string | null;
  /** Version écartée par la résolution : conservée pour une reprise contrôlée. */
  discarded: BaselineContent | null;
}

export interface ConflictStoreData {
  schemaVersion: 1;
  /** Conflits ouverts : au plus un par enregistrement ; tant qu'il est ouvert, aucun envoi ni écrasement ne concerne l'enregistrement. */
  open: Record<string, ConflictRecord>;
  /** Conflits résolus (historique, jamais effacé). */
  history: ConflictRecord[];
}

export function validateConflicts(value: unknown): string[] {
  if (!value || typeof value !== 'object') return ['magasin illisible'];
  const s = value as Record<string, unknown>;
  if (s.schemaVersion !== 1 || !s.open || typeof s.open !== 'object' || !Array.isArray(s.history)) return ['structure invalide'];
  const problems: string[] = [];
  for (const [id, c] of Object.entries(s.open as Record<string, unknown>)) {
    const x = c as Record<string, unknown> | null;
    if (!x || x.recordId !== id || typeof x.kind !== 'string' || !isKnownKind(x.kind)) problems.push(`${id} : conflit invalide`);
    else if (!CONFLICT_TYPES.includes(x.type as ConflictType) || !x.remote || typeof x.remote !== 'object') problems.push(`${id} : conflit incomplet`);
  }
  return problems;
}

export const conflictStore = createPersistentStore<ConflictStoreData>({ baseKey: 'sync_conflicts', name: 'conflits de synchronisation', empty: () => ({ schemaVersion: 1, open: {}, history: [] }), validate: validateConflicts });

/** Identifiants d'enregistrements concernés par un conflit ouvert (jamais envoyés ni écrasés). */
export async function openConflictIds(): Promise<Set<string>> {
  return new Set(Object.keys((await conflictStore.load()).open));
}

// ---- Changements reçus mais pas encore applicables ----------------------------------------------------------------------------

export type PendingReason = 'waiting_parent' | 'has_dependents' | 'newer_schema' | 'logical_duplicate' | 'invalid';
export const PENDING_REASONS: readonly PendingReason[] = ['waiting_parent', 'has_dependents', 'newer_schema', 'logical_duplicate', 'invalid'];

export interface PendingInbound {
  change: RemoteChange;
  reason: PendingReason;
  detail: string;
  since: string;
  attempts: number;
}

export interface PendingStoreData {
  schemaVersion: 1;
  items: Record<string, PendingInbound>;
}

export function validatePending(value: unknown): string[] {
  if (!value || typeof value !== 'object') return ['magasin illisible'];
  const s = value as Record<string, unknown>;
  if (s.schemaVersion !== 1 || !s.items || typeof s.items !== 'object') return ['structure invalide'];
  const problems: string[] = [];
  for (const [id, p] of Object.entries(s.items as Record<string, unknown>)) {
    const x = p as Record<string, unknown> | null;
    const change = x?.change as Record<string, unknown> | undefined;
    if (!x || !change || change.id !== id || !PENDING_REASONS.includes(x.reason as PendingReason)) problems.push(`${id} : entrée invalide`);
  }
  return problems;
}

export const pendingInboundStore = createPersistentStore<PendingStoreData>({ baseKey: 'sync_inbound_pending', name: 'changements reçus en attente', empty: () => ({ schemaVersion: 1, items: {} }), validate: validatePending });

// ---- Curseur de lecture -------------------------------------------------------------------------------------------------------

export interface CursorStoreData {
  schemaVersion: 1;
  /** Jeton opaque fourni par le transport de lecture ; avancé SEULEMENT après le traitement complet d'une page. */
  cursor: string | null;
  updatedAt: string | null;
}

export function validateCursor(value: unknown): string[] {
  if (!value || typeof value !== 'object') return ['magasin illisible'];
  const s = value as Record<string, unknown>;
  if (s.schemaVersion !== 1 || (s.cursor !== null && typeof s.cursor !== 'string')) return ['structure invalide'];
  return [];
}

export const cursorStore = createPersistentStore<CursorStoreData>({ baseKey: 'sync_inbound_cursor', name: 'curseur de réception', empty: () => ({ schemaVersion: 1, cursor: null, updatedAt: null }), validate: validateCursor });
