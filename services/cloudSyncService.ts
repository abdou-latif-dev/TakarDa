// Synchronisation cloud des BIENS et LOGEMENTS d'Immobilier (pilote V1) — logique SANS SDK Firebase.
//
// Principes :
//  - AsyncStorage / la base locale restent la source de travail : on lit et on écrit les enregistrements locaux comme
//    avant ; le cloud est une copie confirmée, jamais une condition pour travailler hors ligne.
//  - Rien ne part sans action explicite : l'activation de la synchronisation fixe une date de référence ; seuls les
//    enregistrements créés APRÈS cette date sont suivis. Les anciennes données ne sont envoyées que par un envoi
//    volontaire (aperçu + confirmation + sauvegarde), jamais par la connexion.
//  - Un enregistrement n'est « synchronisé » qu'après confirmation de Firestore. Sinon il reste « en attente »
//    (réseau), ou « conflit » (modifié ailleurs), ou « erreur » (accès refusé…).
//  - Les identifiants et relations locaux sont conservés (le même identifiant sert de clé de document) : réessayer
//    ne crée jamais de doublon.
//  - Paiements, avances, reçus, répartitions et tontines ne sont PAS concernés.
//  - Les suppressions faites sur CET appareil sont envoyées comme « supprimé » (suppression logique) ; les
//    suppressions faites ailleurs ne sont pas appliquées automatiquement ici (aucune suppression de données).

import { coreService } from './coreService';
import { activityEvents as dbActivities, CURRENT_USER_ID, externalContacts as dbContacts, records as dbRecords } from './db';
import { visibleRecordsFor } from './cloudVisibility';
import { ensureImmobilierTool } from './immobilierService';
import { storage } from './storage';
import { noteV1State, runV1Operation } from './syncMode';
import type { FieldValue, RecordItem } from '@/types/entities';

export type SyncKind = 'bien' | 'logement';
export type SyncStatus = 'pending' | 'synced' | 'conflict' | 'error';

export interface CloudRecordDoc {
  id: string;
  kind: SyncKind;
  values: Record<string, FieldValue>;
  statusKey: string | null;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  rev: number;
  deletedAt: string | null;
}

export type CloudRecordWrite = Omit<CloudRecordDoc, 'rev'>;

/** Accès au cloud : implémenté par services/firebase/firestoreRecordsApi.ts (Firestore) ; remplaçable dans les tests. */
export interface CloudRecordsApi {
  /** Crée l'espace personnel s'il n'existe pas (identifiant déterministe) et renvoie son identifiant. */
  ensureSpace(uid: string): Promise<string>;
  fetchRecords(spaceId: string): Promise<CloudRecordDoc[]>;
  /** Écrit un enregistrement. `expectedRev` = null pour une création. Lève un conflit si la révision distante diffère
   * (sauf `force`). Renvoie la nouvelle révision, confirmée par le serveur. */
  writeRecord(spaceId: string, doc: CloudRecordWrite, opts: { expectedRev: number | null; force?: boolean }): Promise<number>;
  /** Suppression logique (deletedAt), avec contrôle de révision. */
  markDeleted(spaceId: string, id: string, deletedAt: string, opts: { expectedRev: number }): Promise<number>;
}

export type CloudErrorCode = 'conflict' | 'network' | 'permission' | 'unknown';

export class CloudError extends Error {
  readonly code: CloudErrorCode;
  readonly remote: CloudRecordDoc | null;
  constructor(code: CloudErrorCode, message: string, remote: CloudRecordDoc | null = null) {
    super(message);
    this.name = 'CloudError';
    this.code = code;
    this.remote = remote;
    Object.setPrototypeOf(this, CloudError.prototype);
  }
}
export const isCloudError = (e: unknown, code?: CloudErrorCode): e is CloudError => e instanceof CloudError && (!code || e.code === code);

// ------------------------------------------------------------------------------------------------
// État de synchronisation, un par compte (clé = uid), dans le même stockage local (préfixe historique)
// ------------------------------------------------------------------------------------------------

export interface SyncEntry {
  kind: SyncKind;
  status: SyncStatus;
  /** Dernière révision cloud connue (0 = jamais envoyé). */
  rev: number;
  /** `updatedAt` local au moment de la dernière synchronisation : s'il change, l'enregistrement est « en attente ». */
  localUpdatedAt: string;
  /** Empreinte du contenu local à ce moment (détecte aussi une modification dans la même milliseconde). */
  localHash?: string;
  /** Supprimé sur cet appareil : envoyé comme suppression logique. */
  deleted?: boolean;
  lastError?: string | null;
}

export interface SyncState {
  uid: string;
  spaceId: string;
  enabledAt: string;
  entries: Record<string, SyncEntry>;
  lastSyncAt: string | null;
}

const stateKey = (uid: string) => `cloud_sync_${uid}`;

export async function loadSyncState(uid: string): Promise<SyncState | null> {
  try {
    const state = await storage.get<SyncState>(stateKey(uid));
    const valid = state && state.uid === uid ? state : null;
    noteV1State(uid, valid !== null); // l'exclusion avec le nouveau moteur s'appuie sur cet état persisté
    return valid;
  } catch {
    return null; // illisible : l'état reste « inconnu » pour l'exclusion (le nouveau moteur ne démarre pas)
  }
}
export async function saveSyncState(state: SyncState): Promise<void> {
  await storage.set(stateKey(state.uid), state);
  noteV1State(state.uid, true);
}

// ------------------------------------------------------------------------------------------------
// Lecture locale (aucune création d'outil)
// ------------------------------------------------------------------------------------------------

export interface LocalImmobilier {
  toolId: string;
  definitionIds: Record<SyncKind, string>;
  bien: RecordItem[];
  logement: RecordItem[];
}

/** Lecture locale explicitement liée à un compte : données historiques + celles de CE compte, jamais celles d'un autre.
 * Ne dépend pas du compte actif de l'interface (une synchronisation ne doit jamais voir un autre compte comme « supprimé »). */
export async function readLocalImmobilier(uid: string): Promise<LocalImmobilier | null> {
  const tool = (await coreService.getTools({ kind: 'immobilier' }))[0];
  if (!tool) return null;
  const definitions = await coreService.getEntityDefinitions(tool.id);
  const bienDef = definitions.find((d) => d.key === 'bien');
  const logementDef = definitions.find((d) => d.key === 'logement');
  if (!bienDef || !logementDef) return null;
  const visible = visibleRecordsFor(dbRecords, uid);
  const byUpdate = (a: RecordItem, b: RecordItem) => (a.updatedAt < b.updatedAt ? 1 : -1);
  const bien = visible.filter((r) => r.toolId === tool.id && r.entityDefinitionId === bienDef.id).sort(byUpdate);
  const logement = visible.filter((r) => r.toolId === tool.id && r.entityDefinitionId === logementDef.id).sort(byUpdate);
  return { toolId: tool.id, definitionIds: { bien: bienDef.id, logement: logementDef.id }, bien, logement };
}

const clean = <T,>(value: T): T => JSON.parse(JSON.stringify(value ?? null)) as T;

export function toCloudDoc(record: RecordItem, kind: SyncKind, uid: string): CloudRecordWrite {
  return {
    id: record.id,
    kind,
    values: clean(record.values),
    statusKey: record.statusKey ?? null,
    createdBy: uid,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    deletedAt: null,
  };
}

const stable = (v: unknown): string => JSON.stringify(v, (_k, val) => (val && typeof val === 'object' && !Array.isArray(val) ? Object.fromEntries(Object.entries(val).sort(([a], [b]) => a.localeCompare(b))) : val));

const fingerprint = (r: Pick<RecordItem, 'values' | 'statusKey'>): string => stable({ v: r.values, s: r.statusKey ?? null });

/** Modifié ici depuis la dernière synchronisation ? */
const locallyModified = (entry: SyncEntry, r: RecordItem): boolean => r.updatedAt !== entry.localUpdatedAt || (entry.localHash !== undefined && entry.localHash !== fingerprint(r));

/** Le document distant est-il déjà exactement ce que nous voulions écrire ? (reprise après une réponse perdue) */
export function sameContent(remote: CloudRecordDoc, doc: CloudRecordWrite): boolean {
  return remote.updatedAt === doc.updatedAt && (remote.statusKey ?? null) === (doc.statusKey ?? null) && stable(remote.values) === stable(doc.values);
}

// ------------------------------------------------------------------------------------------------
// Activation, suivi des changements
// ------------------------------------------------------------------------------------------------

export function enableSync(api: CloudRecordsApi, uid: string, now: Date = new Date()): Promise<SyncState> {
  return runV1Operation(uid, () => enableSyncUnguarded(api, uid, now));
}

async function enableSyncUnguarded(api: CloudRecordsApi, uid: string, now: Date): Promise<SyncState> {
  const existing = await loadSyncState(uid);
  if (existing) return existing;
  const spaceId = await api.ensureSpace(uid);
  const state: SyncState = { uid, spaceId, enabledAt: now.toISOString(), entries: {}, lastSyncAt: null };
  await saveSyncState(state);
  return state;
}

/** Repère les changements locaux : nouveaux (après l'activation), modifiés, supprimés. Ne touche pas aux anciennes données. */
export function scanLocalChanges(state: SyncState, local: LocalImmobilier | null): SyncState {
  const entries = { ...state.entries };
  const present = new Set<string>();
  const trackedBien = (id: unknown) => typeof id === 'string' && !!entries[id] && !entries[id].deleted;

  const visit = (record: RecordItem, kind: SyncKind) => {
    present.add(record.id);
    const entry = entries[record.id];
    if (entry) {
      if (entry.deleted) entries[record.id] = { ...entry, deleted: false, status: 'pending' }; // recréé avec le même identifiant
      else if (locallyModified(entry, record) && entry.status !== 'conflict') entries[record.id] = { ...entry, status: 'pending', lastError: null };
      return;
    }
    if (record.createdAt < state.enabledAt) return; // ancienne donnée : envoi volontaire seulement
    if (kind === 'logement' && !trackedBien(record.values.bien)) return; // son bien n'est pas dans le cloud : reste local
    entries[record.id] = { kind, status: 'pending', rev: 0, localUpdatedAt: '' };
    if (!record.cloudOwnerUid) record.cloudOwnerUid = state.uid; // suivi par la synchronisation de ce compte : visible pour lui seul
  };
  // Les biens d'abord : un logement n'est suivi que si son bien l'est.
  local?.bien.forEach((r) => visit(r, 'bien'));
  local?.logement.forEach((r) => visit(r, 'logement'));

  if (local) {
    for (const [id, entry] of Object.entries(entries)) {
      if (!present.has(id) && !entry.deleted && entry.rev > 0) entries[id] = { ...entry, deleted: true, status: 'pending' };
      else if (!present.has(id) && !entry.deleted && entry.rev === 0) delete entries[id]; // jamais envoyé, déjà supprimé : rien à faire
    }
  }
  return { ...state, entries };
}

// ------------------------------------------------------------------------------------------------
// Envoi
// ------------------------------------------------------------------------------------------------

export interface PushResult {
  confirmed: number;
  conflicts: number;
  errors: number;
  /** Arrêté par une erreur réseau : le reste reste « en attente ». */
  offline: boolean;
  /** Au moins une écriture a été refusée par les règles (permission-denied) : le refus seul n'explique pas pourquoi. */
  permissionDenied?: boolean;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : 'Erreur inconnue.';
}

export async function pushPending(api: CloudRecordsApi, state: SyncState, local: LocalImmobilier | null, now: Date = new Date()): Promise<{ state: SyncState; result: PushResult }> {
  const entries = { ...state.entries };
  const result: PushResult = { confirmed: 0, conflicts: 0, errors: 0, offline: false };
  const byId = new Map<string, RecordItem>([...(local?.bien ?? []), ...(local?.logement ?? [])].map((r) => [r.id, r]));
  // Biens avant logements : le cloud ne reçoit jamais un logement dont le bien n'y est pas encore.
  const pendingIds = Object.keys(entries)
    .filter((id) => entries[id].status === 'pending')
    .sort((a, b) => (entries[a].kind === entries[b].kind ? 0 : entries[a].kind === 'bien' ? -1 : 1));

  for (const id of pendingIds) {
    const entry = entries[id];
    try {
      if (entry.deleted) {
        const rev = await api.markDeleted(state.spaceId, id, now.toISOString(), { expectedRev: entry.rev });
        entries[id] = { ...entry, status: 'synced', rev, lastError: null };
      } else {
        const record = byId.get(id);
        if (!record) continue;
        const doc = toCloudDoc(record, entry.kind, state.uid);
        try {
          const rev = await api.writeRecord(state.spaceId, doc, { expectedRev: entry.rev === 0 ? null : entry.rev });
          entries[id] = { ...entry, status: 'synced', rev, localUpdatedAt: record.updatedAt, localHash: fingerprint(record), lastError: null };
        } catch (error) {
          // Réponse perdue lors d'un essai précédent : si le cloud contient déjà exactement cette version, c'est confirmé.
          if (isCloudError(error, 'conflict') && error.remote && sameContent(error.remote, doc)) {
            entries[id] = { ...entry, status: 'synced', rev: error.remote.rev, localUpdatedAt: record.updatedAt, localHash: fingerprint(record), lastError: null };
          } else {
            throw error;
          }
        }
      }
      result.confirmed += 1;
    } catch (error) {
      if (isCloudError(error, 'conflict')) {
        entries[id] = { ...entry, status: 'conflict', lastError: 'Modifié ailleurs.' };
        result.conflicts += 1;
      } else if (isCloudError(error, 'network')) {
        entries[id] = { ...entry, lastError: 'Hors ligne : sera renvoyé.' };
        result.offline = true;
        break; // inutile d'insister : le reste reste en attente
      } else {
        if (isCloudError(error, 'permission')) result.permissionDenied = true;
        entries[id] = { ...entry, status: 'error', lastError: messageOf(error) };
        result.errors += 1;
      }
    }
  }
  return { state: { ...state, entries, lastSyncAt: result.confirmed > 0 || !result.offline ? now.toISOString() : state.lastSyncAt }, result };
}

// ------------------------------------------------------------------------------------------------
// Réception (second appareil, modifications venues du cloud)
// ------------------------------------------------------------------------------------------------

export interface PullResult {
  created: number;
  updated: number;
  conflicts: number;
  /** Supprimés sur un autre appareil : signalés, pas appliqués ici. */
  deletedElsewhere: number;
}

function writeLocal(local: RecordItem | undefined, doc: CloudRecordDoc, toolId: string, definitionId: string, uid: string): void {
  if (local) {
    local.values = clean(doc.values);
    local.statusKey = doc.statusKey ?? undefined;
    local.updatedAt = doc.updatedAt;
    return;
  }
  dbRecords.push({
    id: doc.id,
    entityDefinitionId: definitionId,
    toolId,
    values: clean(doc.values),
    statusKey: doc.statusKey ?? undefined,
    createdBy: CURRENT_USER_ID, // identité locale conservée ; l'auteur cloud est l'UID
    cloudOwnerUid: uid, // reçu du cloud de ce compte : visible pour lui seul
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
  });
}

export async function pullFromCloud(api: CloudRecordsApi, state: SyncState, now: Date = new Date()): Promise<{ state: SyncState; result: PullResult }> {
  const docs = await api.fetchRecords(state.spaceId);
  const result: PullResult = { created: 0, updated: 0, conflicts: 0, deletedElsewhere: 0 };
  const entries = { ...state.entries };
  if (docs.length === 0) return { state, result };

  const ents = await ensureImmobilierTool();
  const definitionIds: Record<SyncKind, string> = { bien: ents.bien.id, logement: ents.logement.id };
  const localById = new Map(dbRecords.filter((r) => r.toolId === ents.tool.id && (!r.cloudOwnerUid || r.cloudOwnerUid === state.uid)).map((r) => [r.id, r]));
  const ownedElsewhere = new Set(dbRecords.filter((r) => r.cloudOwnerUid && r.cloudOwnerUid !== state.uid).map((r) => r.id));

  // Biens avant logements (relations).
  const ordered = [...docs].sort((a, b) => (a.kind === b.kind ? 0 : a.kind === 'bien' ? -1 : 1));
  for (const doc of ordered) {
    if (doc.kind !== 'bien' && doc.kind !== 'logement') continue;
    if (ownedElsewhere.has(doc.id)) continue; // même identifiant chez un autre compte : jamais écrasé, jamais dupliqué
    const entry = entries[doc.id];
    const local = localById.get(doc.id);
    if (doc.deletedAt) {
      // Supprimé par CET appareil (entrée marquée supprimée, en attente ou confirmée) : ce n'est pas une suppression
      // « ailleurs ». Un document supprimé que cet appareil n'a jamais eu n'a rien à signaler non plus. Seule la
      // suppression, par un autre appareil, d'un enregistrement présent ici est signalée (jamais appliquée).
      if (!entry?.deleted && local) result.deletedElsewhere += 1;
      continue;
    }
    if (!local) {
      writeLocal(undefined, doc, ents.tool.id, definitionIds[doc.kind], state.uid);
      entries[doc.id] = { kind: doc.kind, status: 'synced', rev: doc.rev, localUpdatedAt: doc.updatedAt, localHash: fingerprint({ values: doc.values, statusKey: doc.statusKey ?? undefined }) };
      result.created += 1;
    } else if (!entry) {
      // Même identifiant déjà présent ici sans être suivi : on ne l'écrase pas.
      if (stable(local.values) !== stable(doc.values)) {
        entries[doc.id] = { kind: doc.kind, status: 'conflict', rev: doc.rev, localUpdatedAt: local.updatedAt, lastError: 'Version locale différente.' };
        result.conflicts += 1;
      } else {
        entries[doc.id] = { kind: doc.kind, status: 'synced', rev: doc.rev, localUpdatedAt: local.updatedAt, localHash: fingerprint(local) };
      }
    } else if (doc.rev > entry.rev) {
      if (entry.status === 'pending' || locallyModified(entry, local)) {
        entries[doc.id] = { ...entry, status: 'conflict', lastError: 'Modifié ailleurs.' };
        result.conflicts += 1;
      } else {
        writeLocal(local, doc, ents.tool.id, definitionIds[doc.kind], state.uid);
        entries[doc.id] = { ...entry, status: 'synced', rev: doc.rev, localUpdatedAt: doc.updatedAt, localHash: fingerprint(local), lastError: null };
        result.updated += 1;
      }
    }
  }
  return { state: { ...state, entries, lastSyncAt: now.toISOString() }, result };
}

// ------------------------------------------------------------------------------------------------
// Cycle complet, conflits, envoi volontaire des anciennes données
// ------------------------------------------------------------------------------------------------

export interface SyncOutcome {
  state: SyncState;
  push: PushResult;
  pull: PullResult | null;
  error: string | null;
}

/** Repère, envoie, puis reçoit. Les erreurs réseau ne perdent rien : l'état reste « en attente ». */
export function syncNow(api: CloudRecordsApi, uid: string, now: Date = new Date()): Promise<SyncOutcome> {
  return runV1Operation(uid, () => syncNowUnguarded(api, uid, now));
}

async function syncNowUnguarded(api: CloudRecordsApi, uid: string, now: Date): Promise<SyncOutcome> {
  let state = await loadSyncState(uid);
  if (!state) throw new Error('La synchronisation n’est pas activée.');
  const emptyPush: PushResult = { confirmed: 0, conflicts: 0, errors: 0, offline: false };
  const local = await readLocalImmobilier(uid);
  state = scanLocalChanges(state, local);
  await saveSyncState(state);

  const pushed = await pushPending(api, state, local, now);
  state = pushed.state;
  await saveSyncState(state);
  if (pushed.result.offline) return { state, push: pushed.result, pull: null, error: 'Hors ligne : vos modifications restent en attente.' };

  try {
    const pulled = await pullFromCloud(api, state, now);
    state = pulled.state;
    await saveSyncState(state);
    return { state, push: pushed.result, pull: pulled.result, error: null };
  } catch (error) {
    return { state, push: pushed.result ?? emptyPush, pull: null, error: isCloudError(error, 'network') ? 'Hors ligne : réception impossible pour l’instant.' : messageOf(error) };
  }
}

/** Résout un conflit : garder la version du cloud, ou envoyer la locale en remplaçant celle du cloud. */
export function resolveConflict(api: CloudRecordsApi, uid: string, recordId: string, choice: 'cloud' | 'local', now: Date = new Date()): Promise<SyncState> {
  return runV1Operation(uid, () => resolveConflictUnguarded(api, uid, recordId, choice, now));
}

async function resolveConflictUnguarded(api: CloudRecordsApi, uid: string, recordId: string, choice: 'cloud' | 'local', now: Date): Promise<SyncState> {
  const state = await loadSyncState(uid);
  const entry = state?.entries[recordId];
  if (!state || !entry) throw new Error('Enregistrement inconnu.');
  const docs = await api.fetchRecords(state.spaceId);
  const remote = docs.find((d) => d.id === recordId);
  const entries = { ...state.entries };
  if (!remote) throw new Error('Version du cloud introuvable.');

  if (choice === 'cloud') {
    const ents = await ensureImmobilierTool();
    const local = dbRecords.find((r) => r.id === recordId);
    writeLocal(local, remote, ents.tool.id, remote.kind === 'bien' ? ents.bien.id : ents.logement.id, uid);
    entries[recordId] = { ...entry, status: 'synced', rev: remote.rev, localUpdatedAt: remote.updatedAt, localHash: fingerprint({ values: remote.values, statusKey: remote.statusKey ?? undefined }), lastError: null };
  } else {
    const local = dbRecords.find((r) => r.id === recordId);
    if (!local) throw new Error('Version locale introuvable.');
    const rev = await api.writeRecord(state.spaceId, toCloudDoc(local, entry.kind, uid), { expectedRev: remote.rev, force: false });
    entries[recordId] = { ...entry, status: 'synced', rev, localUpdatedAt: local.updatedAt, localHash: fingerprint(local), lastError: null };
  }
  const next = { ...state, entries, lastSyncAt: now.toISOString() };
  await saveSyncState(next);
  return next;
}

export interface ImportPreview {
  biens: number;
  logements: number;
  ids: string[];
}

/** Anciennes données locales qui ne sont pas (encore) suivies : à envoyer seulement après confirmation explicite. */
export function previewLocalImport(state: SyncState, local: LocalImmobilier | null): ImportPreview {
  const untracked = (r: RecordItem) => !state.entries[r.id];
  const biens = (local?.bien ?? []).filter(untracked);
  const bienIds = new Set((local?.bien ?? []).map((b) => b.id));
  // Un logement n'est proposé que si son bien existe localement (relation intacte).
  const logements = (local?.logement ?? []).filter((l) => untracked(l) && (bienIds.has(String(l.values.bien)) || !!state.entries[String(l.values.bien)]));
  return { biens: biens.length, logements: logements.length, ids: [...biens, ...logements].map((r) => r.id) };
}

/** Envoi volontaire : sauvegarde locale datée des enregistrements concernés, puis suivi « en attente » (l'envoi se fait
 * par la synchronisation habituelle, avec confirmation du cloud). Idempotent : un enregistrement déjà suivi est ignoré. */
export function importLocalRecords(uid: string, now: Date = new Date()): Promise<{ state: SyncState; backupKey: string; imported: number }> {
  return runV1Operation(uid, () => importLocalRecordsUnguarded(uid, now));
}

async function importLocalRecordsUnguarded(uid: string, now: Date): Promise<{ state: SyncState; backupKey: string; imported: number }> {
  const state = await loadSyncState(uid);
  if (!state) throw new Error('La synchronisation n’est pas activée.');
  const local = await readLocalImmobilier(uid);
  const preview = previewLocalImport(state, local);
  const wanted = new Set(preview.ids);
  const picked = [...(local?.bien ?? []).map((r) => [r, 'bien'] as const), ...(local?.logement ?? []).map((r) => [r, 'logement'] as const)].filter(([r]) => wanted.has(r.id));
  const backupKey = `cloud_backup_${now.getTime()}`;
  await storage.set(backupKey, { uid, at: now.toISOString(), records: picked.map(([r, kind]) => ({ kind, record: r })) });
  const entries = { ...state.entries };
  for (const [record, kind] of picked) entries[record.id] = { kind, status: 'pending', rev: 0, localUpdatedAt: '' };
  const next = { ...state, entries };
  await saveSyncState(next);
  return { state: next, backupKey, imported: picked.length };
}

// ------------------------------------------------------------------------------------------------
// Affichage
// ------------------------------------------------------------------------------------------------

export type DisplaySync = 'local' | 'pending' | 'synced' | 'conflict' | 'error';

/** État à montrer pour un enregistrement : « local » = pas suivi (jamais envoyé). Jamais « synchronisé » sans confirmation :
 * si l'enregistrement local a changé depuis la dernière version confirmée par le cloud, il est « en attente », même
 * avant que la synchronisation ne l'ait repéré. Conflit et erreur ne sont jamais masqués. */
export function displayState(state: SyncState | null, recordId: string, local?: RecordItem | null): DisplaySync {
  const entry = state?.entries[recordId];
  if (!entry) return 'local';
  if (entry.status === 'conflict' || entry.status === 'error') return entry.status;
  if (entry.status === 'pending') return 'pending';
  if (local && locallyModified(entry, local)) return 'pending'; // modifié ici, pas encore confirmé
  return 'synced';
}

/** États affichables de tous les enregistrements suivis, calculés avec leur version locale actuelle (lecture locale, sans réseau). */
export function displayStates(state: SyncState | null): Record<string, DisplaySync> {
  const out: Record<string, DisplaySync> = {};
  if (!state) return out;
  const byId = new Map(dbRecords.map((r) => [r.id, r]));
  for (const id of Object.keys(state.entries)) out[id] = displayState(state, id, byId.get(id) ?? null);
  return out;
}

/** Ce que montre le badge : « en attente » devient « synchronisation en cours » pendant un envoi. */
export type BadgeState = DisplaySync | 'syncing';
export function badgeState(display: DisplaySync, syncing: boolean): BadgeState {
  return display === 'pending' && syncing ? 'syncing' : display;
}

export function countPending(state: SyncState | null): number {
  return Object.values(state?.entries ?? {}).filter((e) => e.status === 'pending').length;
}

/** Après suppression des données cloud d'un compte : les enregistrements qu'il marquait redeviennent des données locales
 * visibles (rien n'est supprimé, seul le marquage de propriété cloud est retiré) et l'état de synchronisation du compte
 * est oublié (il ne décrit plus rien). Les données des AUTRES comptes ne sont pas touchées. */
export async function releaseLocalOwnership(uid: string): Promise<{ released: number }> {
  let released = 0;
  for (const record of dbRecords) {
    if (record.cloudOwnerUid === uid) {
      delete record.cloudOwnerUid;
      released += 1;
    }
  }
  for (const contact of dbContacts) {
    if (contact.cloudOwnerUid === uid) {
      delete contact.cloudOwnerUid; // libérés avec leur compte, mais le décompte annoncé ne compte que les enregistrements
    }
  }
  for (const event of dbActivities) {
    if (event.cloudOwnerUid === uid) {
      delete event.cloudOwnerUid;
    }
  }
  await storage.remove(stateKey(uid));
  noteV1State(uid, false);
  return { released };
}

/** Enregistrements masqués parce qu'ils appartiennent à un autre compte que `activeUid` : combien, par compte. */
export function hiddenOwnerSummary(activeUid: string | null): { total: number; owners: Record<string, number> } {
  const owners: Record<string, number> = {};
  for (const record of dbRecords) {
    if (record.cloudOwnerUid && record.cloudOwnerUid !== activeUid) owners[record.cloudOwnerUid] = (owners[record.cloudOwnerUid] ?? 0) + 1;
  }
  // les contacts et les activités d'un autre compte sont masqués de même, mais ne sont pas comptés : le décompte reste celui des enregistrements
  const orphanOwners = new Set([...dbContacts, ...dbActivities].map((x) => x.cloudOwnerUid).filter((u): u is string => !!u && u !== activeUid));
  for (const uid of orphanOwners) owners[uid] = owners[uid] ?? 0; // le compte reste listé pour que sa libération rende aussi ses contacts et activités
  return { total: Object.values(owners).reduce((a, b) => a + b, 0), owners };
}

/** Geste explicite de l'utilisateur : rend locaux (donc visibles) les enregistrements masqués d'autres comptes, par exemple
 * ceux d'un compte supprimé depuis un autre appareil. Rien n'est supprimé. */
export async function releaseHiddenOwnership(activeUid: string | null): Promise<{ released: number }> {
  const { owners } = hiddenOwnerSummary(activeUid);
  let released = 0;
  for (const uid of Object.keys(owners)) released += (await releaseLocalOwnership(uid)).released;
  return { released };
}

/** Marque (sans réseau) les biens et logements créés pour ce compte et pas encore suivis, avant un changement de compte :
 * ils ne doivent pas rester visibles pour le suivant. N'envoie rien, ne touche pas aux anciennes données. */
export async function stampTrackedRecords(uid: string): Promise<void> {
  const state = await loadSyncState(uid);
  if (!state) return;
  const next = scanLocalChanges(state, await readLocalImmobilier(uid));
  await saveSyncState(next);
}
