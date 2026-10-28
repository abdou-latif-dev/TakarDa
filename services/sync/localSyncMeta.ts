// Métadonnées LOCALES de synchronisation — fondation P1.
//
// Un enregistrement métier ne porte AUCUNE information de synchronisation : ces métadonnées vivent dans un magasin séparé, indexé
// par identifiant d'enregistrement, persistant, et propre à l'espace de travail actif (personnel ou démonstration : jamais mélangés).
// Elles ne sont jamais ajoutées automatiquement aux documents métier et ne sont jamais envoyées à Firestore. Dans P1, aucun
// enregistrement n'est synchronisé par ce système : il décrit l'état local, rien d'autre.
//
// Module sans SDK ni réseau. Le mécanisme de synchronisation actuel (cloudSyncService.ts) n'est pas modifié.

import { accountKeyIfAny } from './syncAccount';
import { storage } from '../storage';
import { workspaceId, workspaceKey } from '../persistence';
import { isKnownKind, type Kind } from './kindRegistry';

export type LocalSyncStatus = 'local' | 'pending' | 'synced' | 'conflict' | 'error';
export type PendingOp = 'create' | 'update' | 'delete';
export type SyncOrigin = 'user' | 'migrated' | 'remote' | 'demo';

export const LOCAL_SYNC_STATUSES: readonly LocalSyncStatus[] = ['local', 'pending', 'synced', 'conflict', 'error'];
export const PENDING_OPS: readonly PendingOp[] = ['create', 'update', 'delete'];
export const SYNC_ORIGINS: readonly SyncOrigin[] = ['user', 'migrated', 'remote', 'demo'];

export interface LocalSyncMeta {
  kind: Kind;
  status: LocalSyncStatus;
  /** Opération en attente d'envoi ; null quand il n'y en a pas. Obligatoire quand le statut est « pending ». */
  pendingOp: PendingOp | null;
  /** Dernière révision cloud connue (0 = jamais envoyé). */
  baseRev: number;
  origin: SyncOrigin;
  attempts: number;
  lastAttemptAt: string | null;
  nextRetryAt: string | null;
  lastError: string | null;
  /** Lot de migration d'origine, le cas échéant (traçabilité). */
  migrationBatchId: string | null;
  updatedAt: string;
}

export interface LocalSyncMetaStore {
  schemaVersion: 1;
  entries: Record<string, LocalSyncMeta>;
}

const BASE_KEY = 'sync_meta';
export const SYNC_META_SCHEMA_VERSION = 1 as const;

/** Clé de stockage de l'espace ACTIF : 'sync_meta' (personnel) ou 'demo/sync_meta' (démonstration). */
export const syncMetaStorageKey = (): string => workspaceKey(accountKeyIfAny(BASE_KEY));

// ---- Transitions pures (aucune écriture) --------------------------------------------------------------------------------

/** Métadonnées initiales d'un enregistrement local. L'origine d'un enregistrement de démonstration est toujours « demo ». */
export function createMeta(kind: Kind, origin: SyncOrigin, now: Date = new Date()): LocalSyncMeta {
  return {
    kind,
    status: 'local',
    pendingOp: null,
    baseRev: 0,
    origin,
    attempts: 0,
    lastAttemptAt: null,
    nextRetryAt: null,
    lastError: null,
    migrationBatchId: null,
    updatedAt: now.toISOString(),
  };
}

/** Mise en attente d'une opération. Une suppression en attente reste une suppression : elle n'est jamais rétrogradée en modification. */
export function markPending(meta: LocalSyncMeta, op: PendingOp, now: Date = new Date()): LocalSyncMeta {
  const pendingOp: PendingOp = meta.pendingOp === 'delete' ? 'delete' : meta.pendingOp === 'create' && op === 'update' ? 'create' : op;
  return { ...meta, status: 'pending', pendingOp, lastError: null, nextRetryAt: null, updatedAt: now.toISOString() };
}

/** Confirmation par le cloud : seule transition qui remet les compteurs d'échec à zéro. */
export function markSynced(meta: LocalSyncMeta, rev: number, now: Date = new Date()): LocalSyncMeta {
  return { ...meta, status: 'synced', pendingOp: null, baseRev: rev, attempts: 0, lastAttemptAt: now.toISOString(), nextRetryAt: null, lastError: null, updatedAt: now.toISOString() };
}

/** Échec d'une tentative : l'opération reste en attente (rien n'est perdu) et le nombre de tentatives augmente. */
export function markError(meta: LocalSyncMeta, error: string, nextRetryAt: Date | null, now: Date = new Date()): LocalSyncMeta {
  return {
    ...meta,
    status: 'error',
    attempts: meta.attempts + 1,
    lastAttemptAt: now.toISOString(),
    nextRetryAt: nextRetryAt ? nextRetryAt.toISOString() : null,
    lastError: error.slice(0, 300),
    updatedAt: now.toISOString(),
  };
}

/** Conflit détecté : l'opération reste en attente jusqu'à résolution explicite. */
export function markConflict(meta: LocalSyncMeta, error: string, now: Date = new Date()): LocalSyncMeta {
  return { ...meta, status: 'conflict', lastError: error.slice(0, 300), updatedAt: now.toISOString() };
}

// ---- Validation ----------------------------------------------------------------------------------------------------------

/** Problèmes de cohérence d'une entrée (liste vide = valide). */
export function validateMeta(value: unknown): string[] {
  const problems: string[] = [];
  if (!value || typeof value !== 'object') return ['entrée absente ou illisible'];
  const m = value as Record<string, unknown>;
  if (typeof m.kind !== 'string' || !isKnownKind(m.kind)) problems.push('type inconnu');
  if (!LOCAL_SYNC_STATUSES.includes(m.status as LocalSyncStatus)) problems.push('statut inconnu');
  if (m.pendingOp !== null && !PENDING_OPS.includes(m.pendingOp as PendingOp)) problems.push('opération en attente inconnue');
  if (m.status === 'pending' && m.pendingOp === null) problems.push('statut « pending » sans opération');
  if (!SYNC_ORIGINS.includes(m.origin as SyncOrigin)) problems.push('origine inconnue');
  if (typeof m.baseRev !== 'number' || !Number.isInteger(m.baseRev) || m.baseRev < 0) problems.push('révision invalide');
  if (typeof m.attempts !== 'number' || !Number.isInteger(m.attempts) || m.attempts < 0) problems.push('nombre de tentatives invalide');
  return problems;
}

// ---- Persistance (espace actif) -------------------------------------------------------------------------------------------

export class SyncMetaCorruptedError extends Error {
  constructor(readonly problems: string[]) {
    super(`Métadonnées de synchronisation illisibles : ${problems.slice(0, 3).join(' ; ')}`);
    this.name = 'SyncMetaCorruptedError';
  }
}

const emptyStore = (): LocalSyncMetaStore => ({ schemaVersion: SYNC_META_SCHEMA_VERSION, entries: {} });

/**
 * Lit le magasin de l'espace actif. Absent = magasin vide. Contenu illisible ou incohérent = erreur : on ne le traite JAMAIS comme
 * vide, pour ne pas l'écraser (il reste en place, intact, pour analyse).
 */
export async function loadSyncMeta(): Promise<LocalSyncMetaStore> {
  const raw = await storage.get<LocalSyncMetaStore>(syncMetaStorageKey());
  if (raw === null) return emptyStore();
  if (typeof raw !== 'object' || raw.schemaVersion !== SYNC_META_SCHEMA_VERSION || !raw.entries || typeof raw.entries !== 'object') {
    throw new SyncMetaCorruptedError(['structure du magasin invalide']);
  }
  for (const [id, entry] of Object.entries(raw.entries)) {
    const problems = validateMeta(entry);
    if (problems.length > 0) throw new SyncMetaCorruptedError([`${id} : ${problems.join(', ')}`]);
  }
  return raw;
}

let chain: Promise<unknown> = Promise.resolve();

/**
 * Modifie le magasin de l'espace actif : lecture, transformation, validation, écriture — sérialisées (jamais deux écritures qui
 * s'écrasent). Si la transformation produit des entrées invalides, RIEN n'est écrit.
 */
export function updateSyncMeta(change: (store: LocalSyncMetaStore) => LocalSyncMetaStore): Promise<LocalSyncMetaStore> {
  const run = chain.then(async () => {
    const next = change(await loadSyncMeta());
    for (const [id, entry] of Object.entries(next.entries)) {
      const problems = validateMeta(entry);
      if (problems.length > 0) throw new SyncMetaCorruptedError([`${id} : ${problems.join(', ')}`]);
    }
    await storage.set(syncMetaStorageKey(), next);
    return next;
  });
  chain = run.catch(() => undefined);
  return run;
}

/** Origine par défaut d'un enregistrement créé dans l'espace actif : la démonstration n'est jamais « user ». */
export const defaultOrigin = (): SyncOrigin => (workspaceId() === 'demo' ? 'demo' : 'user');

/** Enregistre (ou met à jour) l'état local d'un enregistrement. N'envoie rien nulle part. */
export function trackRecord(id: string, kind: Kind, origin: SyncOrigin = defaultOrigin(), now: Date = new Date()): Promise<LocalSyncMetaStore> {
  return updateSyncMeta((store) => ({ ...store, entries: { ...store.entries, [id]: store.entries[id] ?? createMeta(kind, origin, now) } }));
}

export async function getSyncMeta(id: string): Promise<LocalSyncMeta | null> {
  return (await loadSyncMeta()).entries[id] ?? null;
}
