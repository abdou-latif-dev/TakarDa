// Réalisation Firestore du port `SyncBackend` — P4. Reçoit une instance `Firestore` ET le compte : aucune configuration, aucune clé, aucun
// import du client applicatif (donc rien ne démarre à l'import). NON branché à l'application ; utilisé seulement par les tests
// d'intégration du projet de TEST (jamais la production).
//
//   spaces/personal_<uid>/syncRecords/{recordId}
//
// Lectures « serveur » (jamais le cache), écritures par transaction : confirmées par le serveur, jamais en file d'attente silencieuse.

import {
  collection,
  doc,
  documentId,
  getDocFromServer,
  getDocsFromServer,
  limit as limitTo,
  orderBy,
  query,
  runTransaction,
  serverTimestamp,
  startAfter,
  Timestamp,
  updateDoc,
  where,
  writeBatch,
  type DocumentData,
  type Firestore,
} from 'firebase/firestore';
import { personalSpaceOf, syncCollectionPath, SYNC_COLLECTION, type CloudSyncDoc, type CloudSyncWrite, type SyncSpace } from './syncDocModel';
import type { PullQuery, SyncBackend, SyncTx } from './firestoreSyncTransport';
import type { ErasureBackend } from './syncAccountErasure';

function decode(data: DocumentData | undefined): CloudSyncDoc | null {
  if (!data) return null;
  const stamp = data.serverUpdatedAt;
  const serverUpdatedAt = stamp instanceof Timestamp ? stamp.toDate().toISOString() : typeof stamp === 'string' ? stamp : '';
  return { ...(data as Omit<CloudSyncDoc, 'serverUpdatedAt'>), serverUpdatedAt };
}

const encode = (data: CloudSyncWrite): DocumentData => ({ ...data, serverUpdatedAt: serverTimestamp() });

/** Par défaut, l'espace PERSONNEL du compte (seul usage branché). Un module partagé (`space.kind === 'module'`) n'est pas branché à l'application : F3a. */
export function createFirestoreSyncBackend(db: Firestore, uid: string, space: SyncSpace = { kind: 'personal', uid }): SyncBackend {
  if (!uid) throw new Error('Aucun compte : aucun accès Firestore.');
  const [root, spaceId, name] = syncCollectionPath(space);
  const records = () => collection(db, root, spaceId, name);
  const ref = (id: string) => doc(db, root, spaceId, name, id);

  return {
    async transaction<T>(run: (tx: SyncTx) => Promise<T>): Promise<T> {
      return runTransaction(db, async (t) => {
        const tx: SyncTx = {
          get: async (id) => {
            const snapshot = await t.get(ref(id));
            return snapshot.exists() ? decode(snapshot.data()) : null;
          },
          create: (id, data) => {
            t.set(ref(id), encode(data));
          },
          update: (id, data) => {
            t.set(ref(id), encode(data));
          },
        };
        return run(tx);
      });
    },

    async get(id) {
      const snapshot = await getDocFromServer(ref(id));
      return snapshot.exists() ? decode(snapshot.data()) : null;
    },

    async page(request: PullQuery) {
      const base = [orderBy('serverUpdatedAt'), orderBy(documentId())] as const;
      const q = request.after
        ? query(records(), ...base, startAfter(Timestamp.fromDate(new Date(request.after.t)), request.after.id), limitTo(request.limit))
        : request.from
          ? query(records(), where('serverUpdatedAt', '>=', Timestamp.fromDate(new Date(request.from))), ...base, limitTo(request.limit))
          : query(records(), ...base, limitTo(request.limit));
      const snapshot = await getDocsFromServer(q);
      return snapshot.docs.flatMap((d) => {
        const decoded = decode(d.data());
        return decoded ? [{ id: d.id, doc: decoded }] : [];
      });
    },
  };
}

/**
 * Port de la procédure d'effacement du compte (syncAccountErasure.ts) : la SEULE voie de suppression physique des documents de
 * synchronisation. Lectures « serveur » ; les règles n'autorisent la suppression que si l'espace est verrouillé.
 */
export function createFirestoreErasureBackend(db: Firestore, uid: string): ErasureBackend {
  if (!uid) throw new Error('Aucun compte : aucun accès Firestore.');
  const spaceId = personalSpaceOf(uid);
  const spaceRef = doc(db, 'spaces', spaceId);
  const records = collection(db, 'spaces', spaceId, SYNC_COLLECTION);
  return {
    async readSpace() {
      const snapshot = await getDocFromServer(spaceRef);
      if (!snapshot.exists()) return { exists: false, ownerUid: null, memberUids: [], locked: false };
      const data = snapshot.data();
      return {
        exists: true,
        ownerUid: typeof data.ownerUid === 'string' ? data.ownerUid : null,
        memberUids: Array.isArray(data.memberUids) ? (data.memberUids as string[]) : [],
        locked: typeof data.deletionLockedAt === 'string' && data.deletionLockedAt.length > 0,
      };
    },
    async lockSpace(at) {
      await updateDoc(spaceRef, { deletionLockedAt: at });
    },
    async listSyncIds(count) {
      const snapshot = await getDocsFromServer(query(records, limitTo(count)));
      return snapshot.docs.map((d) => d.id);
    },
    async removeSyncDocs(ids) {
      const batch = writeBatch(db);
      ids.forEach((id) => batch.delete(doc(db, 'spaces', spaceId, SYNC_COLLECTION, id)));
      await batch.commit();
    },
  };
}
