// Réalisation Firestore du port `ModulesBackend` — F3b. Reçoit une instance `Firestore` ET le compte : aucune configuration, aucune clé, aucun import
// du client applicatif (rien ne démarre à l'import). NON branché à l'application tant que le drapeau est fermé ; JAMAIS exécuté à ce jour (ni émulateur,
// ni projet de test) : les règles candidates (firestore.p5.rules) ne sont pas publiées, donc aucune de ces opérations n'a été jouée en réel.
//
//   modules/{moduleId} ; …/members/{uid} ; …/requests/{uid}     (voir services/sharedModules/model.ts)
//
// Lectures « serveur » (jamais le cache) ; l'approbation d'une demande est UN SEUL lot d'écritures (demande + fiche du membre), exigé par les règles.

import {
  Timestamp,
  collection,
  deleteDoc,
  doc,
  getDocFromServer,
  getDocsFromServer,
  limit as limitTo,
  query,
  setDoc,
  updateDoc,
  where,
  writeBatch,
  type DocumentData,
  type Firestore,
} from 'firebase/firestore';
import { ModulesError, type ModulesBackend, type ModulesErrorCode } from '../sharedModules/modulesPort';
import type { ModuleDocPath, ModuleErasureBackend } from './moduleErasure';
import { MEMBERS_COLLECTION, MODULES_COLLECTION, MODULE_SYNC_COLLECTION, REQUESTS_COLLECTION, TENANT_ITEMS_COLLECTION, TENANT_VIEWS_COLLECTION, isModuleId, type MemberDoc, type ModuleDoc, type RequestDoc, type TenantItemDoc } from '../sharedModules/model';

/** Codes d'erreur Firestore → codes du port. Tout ce qui est inconnu reste « unknown » : jamais pris pour un succès. */
export function toModulesError(error: unknown): ModulesError {
  if (error instanceof ModulesError) return error;
  const code = ((error as { code?: string } | null)?.code ?? '').replace(/^firestore\//, '');
  const message = error instanceof Error ? error.message : 'Erreur Firestore.';
  let mapped: ModulesErrorCode = 'unknown';
  if (code === 'permission-denied' || code === 'unauthenticated') mapped = 'permission';
  else if (code === 'not-found') mapped = 'not_found';
  else if (code === 'already-exists') mapped = 'exists';
  else if (code === 'unavailable' || code === 'deadline-exceeded' || code === 'cancelled' || /offline|network/i.test(message)) mapped = 'network';
  return new ModulesError(mapped, mapped === 'permission' ? 'Accès refusé par les règles de sécurité.' : message);
}

/** `accessUntil` est un Timestamp dans le cloud (seul type comparable à l'heure du serveur par les règles) et une chaîne ISO dans le modèle. */
const toCloud = <T extends { accessUntil?: string | null }>(value: T): DocumentData => ({
  ...value,
  ...(value.accessUntil !== undefined ? { accessUntil: value.accessUntil === null ? null : Timestamp.fromDate(new Date(value.accessUntil)) } : {}),
});

function memberFromCloud(data: DocumentData): MemberDoc {
  const until = data.accessUntil;
  return { ...(data as MemberDoc), accessUntil: until instanceof Timestamp ? until.toDate().toISOString() : typeof until === 'string' ? until : null };
}

/** Écritures par lot : Firestore en accepte 500 au plus ; marge de sécurité. */
const BATCH_LIMIT = 400;

export function createFirestoreModulesBackend(db: Firestore, uid: string): ModulesBackend {
  if (!uid) throw new Error('Aucun compte : aucun accès Firestore.');
  const moduleRef = (moduleId: string) => {
    if (!isModuleId(moduleId)) throw new ModulesError('not_found', 'Identifiant d’espace invalide.');
    return doc(db, MODULES_COLLECTION, moduleId);
  };
  const memberRef = (moduleId: string, memberUid: string) => doc(db, MODULES_COLLECTION, moduleId, MEMBERS_COLLECTION, memberUid);
  const itemRef = (moduleId: string, memberUid: string, itemId: string) => doc(db, MODULES_COLLECTION, moduleId, TENANT_VIEWS_COLLECTION, memberUid, TENANT_ITEMS_COLLECTION, itemId);
  const requestRef = (moduleId: string, requesterUid: string) => doc(db, MODULES_COLLECTION, moduleId, REQUESTS_COLLECTION, requesterUid);
  const run = async <T>(work: () => Promise<T>): Promise<T> => {
    try {
      return await work();
    } catch (error) {
      throw toModulesError(error);
    }
  };

  return {
    createModule: (moduleId, data: ModuleDoc) => run(() => setDoc(moduleRef(moduleId), data)),
    getModule: (moduleId) =>
      run(async () => {
        const snapshot = await getDocFromServer(moduleRef(moduleId));
        return snapshot.exists() ? (snapshot.data() as ModuleDoc) : null;
      }),
    renameModule: (moduleId, name) => run(() => updateDoc(moduleRef(moduleId), { name })),

    createRequest: (moduleId, data: RequestDoc) => run(() => setDoc(requestRef(moduleId, data.uid), data)),
    getRequest: (moduleId, requesterUid) =>
      run(async () => {
        const snapshot = await getDocFromServer(requestRef(moduleId, requesterUid));
        return snapshot.exists() ? (snapshot.data() as RequestDoc) : null;
      }),
    listRequests: (moduleId) =>
      run(async () => {
        moduleRef(moduleId);
        const snapshot = await getDocsFromServer(collection(db, MODULES_COLLECTION, moduleId, REQUESTS_COLLECTION));
        return snapshot.docs.map((d) => d.data() as RequestDoc);
      }),
    deleteRequest: (moduleId, requesterUid) => run(() => deleteDoc(requestRef(moduleId, requesterUid))),
    decideRequest: (moduleId, requesterUid, decision, member) =>
      run(async () => {
        const batch = writeBatch(db);
        batch.update(requestRef(moduleId, requesterUid), { state: decision.state, decidedBy: decision.decidedBy, updatedAt: decision.at });
        if (decision.state === 'approved') {
          if (!member) throw new ModulesError('unknown', 'Approbation sans fiche de membre.');
          batch.set(memberRef(moduleId, requesterUid), toCloud(member));
        }
        await batch.commit(); // demande + fiche du membre : un seul lot, tout ou rien
      }),

    getMember: (moduleId, memberUid) =>
      run(async () => {
        const snapshot = await getDocFromServer(memberRef(moduleId, memberUid));
        return snapshot.exists() ? memberFromCloud(snapshot.data()) : null;
      }),
    listMembers: (moduleId) =>
      run(async () => {
        moduleRef(moduleId);
        const snapshot = await getDocsFromServer(collection(db, MODULES_COLLECTION, moduleId, MEMBERS_COLLECTION));
        return snapshot.docs.map((d) => memberFromCloud(d.data()));
      }),
    updateMember: (moduleId, memberUid, patch) => run(() => updateDoc(memberRef(moduleId, memberUid), toCloud(patch))),

    putTenantItems: (moduleId, memberUid, items) =>
      run(async () => {
        for (let i = 0; i < items.length; i += BATCH_LIMIT) {
          const batch = writeBatch(db);
          for (const item of items.slice(i, i + BATCH_LIMIT)) batch.set(itemRef(moduleId, memberUid, item.id), item.doc);
          await batch.commit();
        }
      }),
    deleteTenantItems: (moduleId, memberUid, ids) =>
      run(async () => {
        for (let i = 0; i < ids.length; i += BATCH_LIMIT) {
          const batch = writeBatch(db);
          for (const id of ids.slice(i, i + BATCH_LIMIT)) batch.delete(itemRef(moduleId, memberUid, id));
          await batch.commit();
        }
      }),
    listTenantItems: (moduleId, memberUid) =>
      run(async () => {
        moduleRef(moduleId);
        const snapshot = await getDocsFromServer(collection(db, MODULES_COLLECTION, moduleId, TENANT_VIEWS_COLLECTION, memberUid, TENANT_ITEMS_COLLECTION));
        return snapshot.docs.map((d) => ({ id: d.id, doc: d.data() as TenantItemDoc }));
      }),
  };
}

/**
 * Port de l'effacement des espaces partagés du compte (moduleErasure.ts) : la SEULE voie de suppression physique de leurs documents. Lectures « serveur » ; les règles
 * n'autorisent ces suppressions que sous le verrou posé par `lockModule`, et par le propriétaire seul.
 */
export function createFirestoreModuleErasureBackend(db: Firestore, uid: string): ModuleErasureBackend {
  if (!uid) throw new Error('Aucun compte : aucun accès Firestore.');
  const run = async <T>(work: () => Promise<T>): Promise<T> => {
    try {
      return await work();
    } catch (error) {
      throw toModulesError(error);
    }
  };
  const moduleRef = (moduleId: string) => {
    if (!isModuleId(moduleId)) throw new ModulesError('not_found', 'Identifiant d’espace invalide.');
    return doc(db, MODULES_COLLECTION, moduleId);
  };
  const ids = async (moduleId: string, ...segments: string[]): Promise<string[]> =>
    (await getDocsFromServer(collection(db, MODULES_COLLECTION, moduleId, segments[0], ...segments.slice(1)))).docs.map((d) => d.id);

  return {
    listOwnedModuleIds: () =>
      run(async () => {
        const snapshot = await getDocsFromServer(query(collection(db, MODULES_COLLECTION), where('ownerUid', '==', uid)));
        return snapshot.docs.map((d) => d.id);
      }),
    readModule: (moduleId) =>
      run(async () => {
        const snapshot = await getDocFromServer(moduleRef(moduleId));
        if (!snapshot.exists()) return { exists: false, ownerUid: null, locked: false };
        const data = snapshot.data();
        return { exists: true, ownerUid: typeof data.ownerUid === 'string' ? data.ownerUid : null, locked: typeof data.deletionLockedAt === 'string' && data.deletionLockedAt.length > 0 };
      }),
    lockModule: (moduleId, at) => run(() => updateDoc(moduleRef(moduleId), { deletionLockedAt: at })),
    listModuleDocs: (moduleId, limit) =>
      run(async () => {
        moduleRef(moduleId);
        const found: ModuleDocPath[] = [];
        const room = () => limit - found.length;
        // 1. vues des locataires : retrouvées par les fiches de membres et les demandes, qui sont supprimées EN DERNIER
        const owners = [...new Set([...(await ids(moduleId, MEMBERS_COLLECTION)), ...(await ids(moduleId, REQUESTS_COLLECTION))])];
        for (const owner of owners) {
          if (room() <= 0) return found;
          const snapshot = await getDocsFromServer(query(collection(db, MODULES_COLLECTION, moduleId, TENANT_VIEWS_COLLECTION, owner, TENANT_ITEMS_COLLECTION), limitTo(room())));
          for (const d of snapshot.docs) found.push([TENANT_VIEWS_COLLECTION, owner, TENANT_ITEMS_COLLECTION, d.id]);
        }
        if (found.length > 0) return found; // les autres documents seulement quand plus aucune vue ne reste
        // 2. données, 3. demandes, 4. fiches de membres
        for (const name of [MODULE_SYNC_COLLECTION, REQUESTS_COLLECTION, MEMBERS_COLLECTION]) {
          const snapshot = await getDocsFromServer(query(collection(db, MODULES_COLLECTION, moduleId, name), limitTo(room())));
          for (const d of snapshot.docs) found.push([name, d.id]);
          if (found.length > 0) return found;
        }
        return found;
      }),
    removeModuleDocs: (moduleId, paths) =>
      run(async () => {
        const batch = writeBatch(db);
        for (const path of paths) batch.delete(doc(db, MODULES_COLLECTION, moduleId, ...path));
        await batch.commit();
      }),
    deleteModule: (moduleId) => run(() => deleteDoc(moduleRef(moduleId))),
  };
}
