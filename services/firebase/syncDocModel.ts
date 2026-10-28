// Modèle des documents de synchronisation dans le cloud — P4. Module PUR : aucun SDK, aucun réseau.
//
//   spaces/{personal_<uid>}/syncRecords/{recordId}   (recordId = identifiant local de l'enregistrement)
//
// Champs (tous TOUJOURS présents, pour que les règles Firestore puissent les valider strictement) :
//   kind, schemaVersion, ownerUid, statusKey|null, createdAt, updatedAt, body{}, refs{},
//   rev (entier, +1 à chaque écriture, vérifié par les règles), deleted (bool), deletedAt|null, restoredAt|null,
//   lastOpId (jeton d'idempotence de la dernière opération appliquée), serverUpdatedAt (horodatage SERVEUR, sert de curseur de lecture).
//
// Le cloud ne pose AUCUN compteur : `rev` est calculé par le client DANS une transaction (lecture de la révision courante, écriture
// de la suivante), et les règles refusent toute écriture qui ne vaut pas exactement « ancienne révision + 1 ». `serverUpdatedAt` est
// imposé égal à l'heure du serveur par les règles (`request.time`).

import { contentHash, type WireRecord } from '../sync/wireFormat';
import { isKnownKind, getKindDefinition, type Kind } from '../sync/kindRegistry';
import { activeSyncKinds } from '../sync/syncScope';
import type { RemoteChange } from '../sync/inboundStores';
import { SyncTransportError, type TransportErrorCode } from '../sync/syncEngine';
import { isModuleId } from '../sharedModules/model';

export const SYNC_COLLECTION = 'syncRecords';
export const personalSpaceOf = (uid: string): string => `personal_${uid}`;

/**
 * Espace où le moteur lit et écrit : l'espace PERSONNEL du compte (seul usage branché aujourd'hui) ou un MODULE partagé dont le compte est le
 * propriétaire (F3a ; règles candidates firestore.p5.rules, non publiées, non branché à l'application).
 */
export type SyncSpace = { kind: 'personal'; uid: string } | { kind: 'module'; moduleId: string };

/** Segments du chemin de la collection de documents de synchronisation de l'espace. Refuse un compte ou un module vide ou mal formé. */
export function syncCollectionPath(space: SyncSpace): [string, string, string] {
  if (space.kind === 'personal') {
    if (!space.uid) throw new Error('Aucun compte : aucun chemin de synchronisation.');
    return ['spaces', personalSpaceOf(space.uid), SYNC_COLLECTION];
  }
  if (!isModuleId(space.moduleId)) throw new Error('Identifiant de module invalide : aucun chemin de synchronisation.');
  return ['modules', space.moduleId, SYNC_COLLECTION];
}

/** Document tel qu'il est stocké (le champ `serverUpdatedAt` est une chaîne ISO côté client ; le SDK le lit comme Timestamp). */
export interface CloudSyncDoc {
  kind: string;
  schemaVersion: number;
  ownerUid: string;
  statusKey: string | null;
  createdAt: string;
  updatedAt: string;
  body: Record<string, unknown>;
  refs: Record<string, string>;
  rev: number;
  deleted: boolean;
  deletedAt: string | null;
  restoredAt: string | null;
  lastOpId: string;
  serverUpdatedAt: string;
}

/** Document à écrire : l'horodatage serveur est posé par le backend (jamais fourni par le client). */
export type CloudSyncWrite = Omit<CloudSyncDoc, 'serverUpdatedAt'>;

export const CLOUD_DOC_FIELDS: readonly (keyof CloudSyncDoc)[] = [
  'kind', 'schemaVersion', 'ownerUid', 'statusKey', 'createdAt', 'updatedAt', 'body', 'refs', 'rev', 'deleted', 'deletedAt', 'restoredAt', 'lastOpId', 'serverUpdatedAt',
];

/** Types admis dans le cloud (miroir EXACT des règles : un test compare les deux listes). */
export const cloudKinds = (): Kind[] => [...activeSyncKinds()];
/** Faits financiers : CRÉATION SEULEMENT dans le cloud (ni modification, ni suppression logique, ni restauration). */
export const cloudFinancialKinds = (): Kind[] => cloudKinds().filter((k) => getKindDefinition(k).financialFact);
export const isCloudFinancialKind = (kind: string): boolean => isKnownKind(kind) && getKindDefinition(kind).financialFact;

// ---- Limites réelles de Firestore (voir docs/p4-transport-firebase.md) ---------------------------------------------------------
export const FIRESTORE_LIMITS = {
  maxDocBytes: 1_048_576,
  /** Marge de sécurité : on refuse bien avant la limite stricte (les index et métadonnées comptent aussi). */
  softMaxDocBytes: 900_000,
  maxMapDepth: 20,
  maxIdBytes: 1500,
  maxStringBytes: 1_048_487,
  bodyKeys: 100,
  refsKeys: 20,
} as const;

const utf8Bytes = (s: string): number => Buffer.byteLength(s, 'utf8');

function walk(value: unknown, path: string, depth: number, problems: string[]): number {
  if (depth > FIRESTORE_LIMITS.maxMapDepth) {
    problems.push(`${path} : profondeur supérieure à ${FIRESTORE_LIMITS.maxMapDepth}`);
    return 0;
  }
  if (value === null || typeof value === 'boolean') return 1;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) problems.push(`${path} : nombre non fini`);
    return 8;
  }
  if (typeof value === 'string') {
    const bytes = utf8Bytes(value);
    if (bytes > FIRESTORE_LIMITS.maxStringBytes) problems.push(`${path} : chaîne trop longue`);
    return bytes + 1;
  }
  if (Array.isArray(value)) {
    let size = 32;
    value.forEach((item, index) => {
      if (Array.isArray(item)) problems.push(`${path}[${index}] : tableau imbriqué (non pris en charge par Firestore)`);
      size += walk(item, `${path}[${index}]`, depth + 1, problems);
    });
    return size;
  }
  if (typeof value === 'object') {
    let size = 32;
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      if (key === '') problems.push(`${path} : nom de champ vide`);
      if (/^__.*__$/.test(key)) problems.push(`${path}.${key} : nom de champ réservé`);
      if (utf8Bytes(key) > 1500) problems.push(`${path}.${key} : nom de champ trop long`);
      if (child === undefined) problems.push(`${path}.${key} : valeur indéfinie (non prise en charge)`);
      else size += utf8Bytes(key) + 1 + walk(child, `${path}.${key}`, depth + 1, problems);
    }
    return size;
  }
  problems.push(`${path} : type non pris en charge (${typeof value})`);
  return 0;
}

/** Contraintes réelles de Firestore sur un enregistrement à envoyer. Retourne la liste des problèmes (vide = envoyable). */
export function checkFirestoreCompat(wire: WireRecord): string[] {
  const problems: string[] = [];
  const id = wire.id;
  if (typeof id !== 'string' || id === '' || id === '.' || id === '..' || id.includes('/') || /^__.*__$/.test(id) || utf8Bytes(id) > FIRESTORE_LIMITS.maxIdBytes) {
    problems.push('identifiant inutilisable comme nom de document');
  }
  if (Object.keys(wire.body).length > FIRESTORE_LIMITS.bodyKeys) problems.push(`contenu : plus de ${FIRESTORE_LIMITS.bodyKeys} champs`);
  if (Object.keys(wire.refs).length > FIRESTORE_LIMITS.refsKeys) problems.push(`références : plus de ${FIRESTORE_LIMITS.refsKeys}`);
  const size = walk(wire.body, 'body', 1, problems) + walk(wire.refs, 'refs', 1, problems);
  if (size > FIRESTORE_LIMITS.softMaxDocBytes) problems.push(`document trop volumineux (≈ ${size} octets, limite prudente ${FIRESTORE_LIMITS.softMaxDocBytes})`);
  return problems;
}

// ---- Conversions ------------------------------------------------------------------------------------------------------------

export interface WriteContext {
  opId: string;
  rev: number;
}

/** Document à écrire pour un enregistrement (création, modification). */
export function docFromWire(wire: WireRecord, context: WriteContext, previous: CloudSyncDoc | null): CloudSyncWrite {
  return {
    kind: wire.kind,
    schemaVersion: wire.schemaVersion,
    ownerUid: wire.ownerUid,
    statusKey: wire.statusKey,
    createdAt: previous?.createdAt ?? wire.createdAt,
    updatedAt: wire.updatedAt,
    body: wire.body,
    refs: wire.refs,
    rev: context.rev,
    deleted: false,
    deletedAt: null,
    restoredAt: previous?.restoredAt ?? null,
    lastOpId: context.opId,
  };
}

/** Enregistrement d'échange reconstruit depuis un document. null si le document est incomplet ou malformé. */
export function wireFromDoc(id: string, doc: Partial<CloudSyncDoc> | null | undefined): WireRecord | null {
  if (!doc || typeof doc.kind !== 'string' || typeof doc.ownerUid !== 'string' || typeof doc.schemaVersion !== 'number') return null;
  if (typeof doc.body !== 'object' || doc.body === null || Array.isArray(doc.body) || typeof doc.refs !== 'object' || doc.refs === null || Array.isArray(doc.refs)) return null;
  if (typeof doc.createdAt !== 'string' || typeof doc.updatedAt !== 'string') return null;
  return {
    id,
    kind: doc.kind as Kind,
    schemaVersion: doc.schemaVersion,
    ownerUid: doc.ownerUid,
    statusKey: typeof doc.statusKey === 'string' ? doc.statusKey : null,
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
    body: doc.body,
    refs: doc.refs as Record<string, string>,
  };
}

/** Changement de réception correspondant à un document. Un document malformé donne un changement SANS contenu : la validation le refuse. */
export function changeFromDoc(id: string, doc: Partial<CloudSyncDoc>): RemoteChange {
  const rev = typeof doc.rev === 'number' && Number.isInteger(doc.rev) ? doc.rev : 0;
  const kind = typeof doc.kind === 'string' ? doc.kind : '';
  if (doc.deleted === true) return { id, kind, rev, deleted: true, deletedAt: typeof doc.deletedAt === 'string' && doc.deletedAt !== '' ? doc.deletedAt : null, wire: null };
  return { id, kind, rev, deleted: false, deletedAt: null, wire: wireFromDoc(id, doc) };
}

/** Empreinte du CONTENU stocké (même fonction que côté appareil) : sert à reconnaître « c'est déjà exactement mon contenu ». */
export function hashOfDoc(doc: Pick<CloudSyncDoc, 'kind' | 'body' | 'refs' | 'statusKey'>): string {
  return contentHash({ kind: doc.kind as Kind, body: doc.body, refs: doc.refs, statusKey: doc.statusKey });
}

// ---- Curseur de lecture -------------------------------------------------------------------------------------------------------------

export interface PullPosition {
  /** `serverUpdatedAt` (ISO) du dernier document lu. */
  t: string;
  /** Identifiant du dernier document lu (départage les égalités d'horodatage). */
  id: string;
}

export const encodeCursor = (position: PullPosition): string => `v1|${position.t}|${position.id}`;

export function decodeCursor(cursor: string | null): PullPosition | null {
  if (cursor === null) return null;
  const match = /^v1\|([^|]+)\|(.*)$/.exec(cursor);
  if (!match || Number.isNaN(Date.parse(match[1]))) throw new SyncTransportError('invalid', 'Curseur de lecture illisible.');
  return { t: match[1], id: match[2] };
}

// ---- Erreurs --------------------------------------------------------------------------------------------------------------------

const NETWORK_CODES = new Set(['unavailable', 'deadline-exceeded', 'cancelled', 'aborted', 'resource-exhausted', 'internal']);
const PERMISSION_CODES = new Set(['permission-denied', 'unauthenticated']);
const INVALID_CODES = new Set(['invalid-argument', 'out-of-range', 'failed-precondition', 'already-exists', 'not-found', 'data-loss']);

/** Traduit une erreur du SDK en erreur de transport (les codes décident de la suite côté moteur : réessai, conflit, blocage). */
export function toTransportError(error: unknown): SyncTransportError {
  if (error instanceof SyncTransportError) return error;
  const code = (error as { code?: string } | null)?.code ?? '';
  const bare = code.replace(/^firestore\//, '');
  const message = error instanceof Error ? error.message : 'Erreur Firestore.';
  let mapped: TransportErrorCode = 'unknown';
  if (PERMISSION_CODES.has(bare)) mapped = 'permission';
  else if (NETWORK_CODES.has(bare) || /offline|network/i.test(message)) mapped = 'network';
  else if (INVALID_CODES.has(bare)) mapped = 'invalid';
  return new SyncTransportError(mapped, mapped === 'permission' ? 'Accès refusé par les règles de sécurité.' : message);
}

