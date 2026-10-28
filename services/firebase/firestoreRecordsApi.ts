// Accès Firestore aux biens et logements (implémentation de CloudRecordsApi). Modèle :
//   users/{uid}                      { defaultSpaceId, createdAt }
//   spaces/{spaceId}                 { ownerUid, memberUids[], name, createdAt, schemaVersion }   spaceId = personal_<uid>
//   spaces/{spaceId}/records/{id}    { kind, values, statusKey, createdBy, createdAt, updatedAt, rev, deletedAt }
// Les règles (firestore.rules) font respecter l’isolation côté serveur ; ce code ne s’y substitue pas.
// Toute écriture passe par une transaction avec contrôle de révision : confirmée par le serveur, jamais en file d’attente
// silencieuse, et sans doublon (l’identifiant du document est l’identifiant local).

import { collection, doc, getDocs, runTransaction, type DocumentData } from 'firebase/firestore';
import { CloudError, type CloudRecordDoc, type CloudRecordsApi, type CloudRecordWrite } from '../cloudSyncService';
import { getFirestoreDb } from './firebaseClient';

export const personalSpaceId = (uid: string): string => `personal_${uid}`;

const NETWORK_CODES = new Set(['unavailable', 'deadline-exceeded', 'cancelled', 'aborted', 'resource-exhausted', 'internal']);
const PERMISSION_CODES = new Set(['permission-denied', 'unauthenticated']);

export function toCloudError(error: unknown): CloudError {
  if (error instanceof CloudError) return error;
  const code = (error as { code?: string } | null)?.code ?? '';
  const message = error instanceof Error ? error.message : 'Erreur Firestore.';
  if (NETWORK_CODES.has(code) || /offline|network/i.test(message)) return new CloudError('network', message);
  if (PERMISSION_CODES.has(code)) return new CloudError('permission', 'Accès refusé par les règles de sécurité.');
  return new CloudError('unknown', message);
}

function asDoc(id: string, data: DocumentData): CloudRecordDoc | null {
  if ((data.kind !== 'bien' && data.kind !== 'logement') || typeof data.rev !== 'number') return null;
  return {
    id,
    kind: data.kind,
    values: (data.values ?? {}) as CloudRecordDoc['values'],
    statusKey: typeof data.statusKey === 'string' ? data.statusKey : null,
    createdBy: String(data.createdBy ?? ''),
    createdAt: String(data.createdAt ?? ''),
    updatedAt: String(data.updatedAt ?? ''),
    rev: data.rev,
    deletedAt: typeof data.deletedAt === 'string' ? data.deletedAt : null,
  };
}

export const firestoreRecordsApi: CloudRecordsApi = {
  async ensureSpace(uid) {
    const db = getFirestoreDb();
    const spaceId = personalSpaceId(uid);
    try {
      await runTransaction(db, async (tx) => {
        const spaceRef = doc(db, 'spaces', spaceId);
        const userRef = doc(db, 'users', uid);
        // Firestore exige que TOUTES les lectures d'une transaction précèdent les écritures.
        const snap = await tx.get(spaceRef);
        const userSnap = await tx.get(userRef);
        const now = new Date().toISOString();
        if (!snap.exists()) {
          tx.set(spaceRef, { ownerUid: uid, memberUids: [uid], name: 'Espace personnel', createdAt: now, schemaVersion: 1 });
        }
        if (!userSnap.exists()) tx.set(userRef, { defaultSpaceId: spaceId, createdAt: now });
      });
    } catch (error) {
      throw toCloudError(error);
    }
    return spaceId;
  },

  async fetchRecords(spaceId) {
    try {
      const snap = await getDocs(collection(getFirestoreDb(), 'spaces', spaceId, 'records'));
      return snap.docs.map((d) => asDoc(d.id, d.data())).filter((d): d is CloudRecordDoc => d !== null);
    } catch (error) {
      throw toCloudError(error);
    }
  },

  async writeRecord(spaceId: string, write: CloudRecordWrite, opts) {
    const db = getFirestoreDb();
    const ref = doc(db, 'spaces', spaceId, 'records', write.id);
    try {
      return await runTransaction(db, async (tx) => {
        const snap = await tx.get(ref);
        const remote = snap.exists() ? asDoc(write.id, snap.data()) : null;
        if (remote && !opts.force && (opts.expectedRev === null || remote.rev !== opts.expectedRev || remote.deletedAt)) {
          throw new CloudError('conflict', 'Modifié ailleurs.', remote);
        }
        const rev = (remote?.rev ?? 0) + 1;
        const { id: _id, ...fields } = write;
        void _id;
        tx.set(ref, { ...fields, rev });
        return rev;
      });
    } catch (error) {
      throw toCloudError(error);
    }
  },

  async markDeleted(spaceId, id, deletedAt, opts) {
    const db = getFirestoreDb();
    const ref = doc(db, 'spaces', spaceId, 'records', id);
    try {
      return await runTransaction(db, async (tx) => {
        const snap = await tx.get(ref);
        const remote = snap.exists() ? asDoc(id, snap.data()) : null;
        if (!remote || remote.rev !== opts.expectedRev) throw new CloudError('conflict', 'Modifié ailleurs.', remote);
        const rev = remote.rev + 1;
        tx.update(ref, { deletedAt, rev });
        return rev;
      });
    } catch (error) {
      throw toCloudError(error);
    }
  },
};
