// Suppression des données cloud d'un compte : enregistrements → espace personnel → profil.
//
// Principes (phase E) :
//  - Toute AFFIRMATION de suppression repose sur une lecture confirmée par le SERVEUR (getDocFromServer / getDocsFromServer) :
//    jamais sur le cache local, qui peut répondre « vide » alors que le serveur contient encore des documents. Serveur
//    inaccessible = la lecture échoue = rien n'est confirmé.
//  - Chaque opération réseau a un délai maximal. Un délai dépassé ne veut dire NI « échoué » NI « réussi » : l'écriture a pu
//    être appliquée sans que le client ait reçu la réponse (et une écriture mise en file par le SDK peut partir plus tard).
//    Le résultat est alors marqué « incertain » et on S'ARRÊTE : aucune nouvelle écriture n'est lancée à l'aveugle.
//    NB : Promise.race n'annule pas l'opération abandonnée ; seul le client cesse d'attendre.
//  - La reprise est idempotente : elle attend d'abord les écritures encore en file d'une tentative précédente, puis relit le
//    serveur avant d'agir. L'espace parent n'est supprimé qu'après confirmation serveur qu'il ne reste AUCUN enregistrement ;
//    le profil n'est supprimé qu'après confirmation serveur de la suppression de l'espace.
//  - Les sous-collections ne sont pas supprimées avec leur document parent : enregistrements d'abord, par pages et par lots.
//  - Rien n'est supprimé si la propriété de l'espace n'est pas démontrée (personal_<uid>, propriétaire = uid, seul membre).
//  - VERROU DE SUPPRESSION (lot N1.1) : avant de supprimer le moindre enregistrement, l'espace reçoit `deletionLockedAt`
//    (irréversible, posé par le propriétaire). Les règles refusent alors toute création ou modification d'enregistrement,
//    de n'importe quel appareil : plus aucun orphelin ne peut apparaître entre la vérification et la suppression de l'espace.
//    Le verrou persiste sur le serveur : une suppression interrompue reprend sans le reposer. Sans verrou confirmé par le
//    serveur, RIEN n'est supprimé (fermé par défaut, y compris si les règles publiées ne connaissent pas encore le verrou).
//  - « Espace déjà absent » (suppression simultanée) : confirmé UNIQUEMENT par une lecture serveur concluante. Une erreur
//    `permission-denied` n'est JAMAIS prise pour une réussite ; si le serveur ne peut pas répondre, l'état reste incertain.
//
// L'instance Firestore (et les opérations) sont des paramètres : testé contre l'ÉMULATEUR avec les vraies règles. Un test
// d'émulateur ne prouve pas le comportement exact de Firebase en production.

import {
  collection,
  deleteDoc,
  doc,
  getDocFromServer,
  getDocsFromServer,
  limit,
  query,
  updateDoc,
  waitForPendingWrites,
  writeBatch,
  type DocumentReference,
  type DocumentSnapshot,
  type Firestore,
  type Query,
  type QuerySnapshot,
} from 'firebase/firestore';
import type { CloudDeletionReport } from '../accountDeletionService';

/** Taille des lots : sous la limite de 500 opérations par lot, et de quoi borner les contrôles d'accès des règles. */
export const DELETE_PAGE_SIZE = 100;
/** Délai maximal d'UNE opération réseau (lecture serveur, lot d'écritures, suppression d'un document). */
export const OPERATION_TIMEOUT_MS = 15000;
/** Durée maximale d'une tentative : au-delà, on s'arrête proprement (la reprise continue là où on en était). */
export const ATTEMPT_DEADLINE_MS = 5 * 60 * 1000;
const MAX_PAGES = 10000;

/** Opérations réseau, injectables pour les tests (par défaut : le SDK). */
export interface DeletionOps {
  getDocFromServer(ref: DocumentReference): Promise<DocumentSnapshot>;
  getDocsFromServer(q: Query): Promise<QuerySnapshot>;
  commitDeletes(db: Firestore, refs: DocumentReference[]): Promise<void>;
  deleteDocument(ref: DocumentReference): Promise<void>;
  /** Pose le verrou de suppression sur l'espace (champ `deletionLockedAt`). */
  lockSpace(ref: DocumentReference, lockedAt: string): Promise<void>;
  waitForPendingWrites(db: Firestore): Promise<void>;
}

export const defaultOps: DeletionOps = {
  getDocFromServer: (ref) => getDocFromServer(ref),
  getDocsFromServer: (q) => getDocsFromServer(q),
  commitDeletes: async (db, refs) => {
    const batch = writeBatch(db);
    refs.forEach((ref) => batch.delete(ref));
    await batch.commit();
  },
  deleteDocument: (ref) => deleteDoc(ref),
  lockSpace: (ref, lockedAt) => updateDoc(ref, { deletionLockedAt: lockedAt }),
  waitForPendingWrites: (db) => waitForPendingWrites(db),
};

export interface DeletionOptions {
  ops?: DeletionOps;
  timeoutMs?: number;
  deadlineMs?: number;
  now?: () => number;
}

/** Une opération n'a pas répondu à temps. Son résultat est INCONNU. */
export class StepTimeout extends Error {
  readonly code = 'client-timeout';
  constructor(readonly step: string, readonly ms: number) {
    super(`Pas de réponse du serveur en ${Math.round(ms / 1000)} s (${step}). L’opération a peut-être été appliquée.`);
    this.name = 'StepTimeout';
  }
}

function timed<T>(promise: Promise<T>, ms: number, step: string): Promise<T> {
  promise.catch(() => undefined); // l'opération abandonnée peut échouer plus tard : pas d'erreur non gérée
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new StepTimeout(step, ms)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}

const fail = (error: unknown): { code: string; message: string } => ({
  code: (error as { code?: string } | null)?.code ?? 'unknown',
  message: error instanceof Error ? error.message : 'Erreur Firestore.',
});

/** État du verrou de suppression de l'espace, établi par UNE lecture SERVEUR concluante. */
export type DeletionLockState = 'locked' | 'unlocked' | 'absent' | 'unknown';

/**
 * Lit l'espace personnel sur le serveur et dit s'il est verrouillé pour suppression (`deletionLockedAt`).
 * « unknown » dès que la lecture n'est pas concluante (réseau, délai, refus, document d'un autre propriétaire) : l'état n'est
 * JAMAIS déduit d'une erreur, en particulier pas d'un `permission-denied` d'écriture. Lecture seule : rien n'est écrit.
 */
export async function readDeletionLockState(db: Firestore, uid: string, options: DeletionOptions = {}): Promise<DeletionLockState> {
  const ops = options.ops ?? defaultOps;
  const timeoutMs = options.timeoutMs ?? OPERATION_TIMEOUT_MS;
  try {
    const snap = await timed(ops.getDocFromServer(doc(db, 'spaces', `personal_${uid}`)), timeoutMs, 'lecture du verrou');
    if (!snap.exists()) return 'absent';
    const data = snap.data();
    if (data?.ownerUid !== uid) return 'unknown';
    return typeof data.deletionLockedAt === 'string' && data.deletionLockedAt.length > 0 ? 'locked' : 'unlocked';
  } catch {
    return 'unknown';
  }
}

export async function deleteAccountCloudData(db: Firestore, uid: string, options: DeletionOptions = {}): Promise<CloudDeletionReport> {
  const ops = options.ops ?? defaultOps;
  const timeoutMs = options.timeoutMs ?? OPERATION_TIMEOUT_MS;
  const deadlineMs = options.deadlineMs ?? ATTEMPT_DEADLINE_MS;
  const now = options.now ?? Date.now;
  const startedAt = now();
  const step = <T,>(promise: Promise<T>, label: string) => timed(promise, timeoutMs, label);

  const spaceId = `personal_${uid}`;
  const report: CloudDeletionReport = {
    ownership: 'proven',
    records: { found: 0, deleted: 0, remaining: null },
    space: 'skipped',
    profile: 'skipped',
    verified: false,
    uncertain: false,
    error: null,
  };
  const spaceRef = doc(db, 'spaces', spaceId);
  const userRef = doc(db, 'users', uid);
  const recordsRef = collection(db, 'spaces', spaceId, 'records');
  let spaceDeleteAcknowledged = false;
  /** Vrai seulement si le SERVEUR répond et que l'espace n'existe pas ; toute erreur ou tout doute = faux. */
  const spaceConfirmedAbsent = async (): Promise<boolean> => {
    try {
      return !(await step(ops.getDocFromServer(spaceRef), 'confirmation de l’absence de l’espace')).exists();
    } catch {
      return false;
    }
  };

  try {
    // 0. Écritures encore en file d'une tentative précédente : on les laisse aboutir AVANT toute nouvelle écriture.
    await step(ops.waitForPendingWrites(db), 'écritures en attente d’une tentative précédente');

    // 1. Propriété démontrée par une lecture SERVEUR, avant toute suppression.
    const spaceSnap = await step(ops.getDocFromServer(spaceRef), 'lecture de l’espace');
    if (spaceSnap.exists()) {
      const data = spaceSnap.data();
      const soleMember = Array.isArray(data.memberUids) && data.memberUids.length === 1 && data.memberUids[0] === uid;
      if (data.ownerUid !== uid || !soleMember) {
        report.ownership = 'unproven';
        return report;
      }
    } else {
      report.ownership = 'space_absent'; // confirmé par le serveur ; sans espace, les enregistrements ne sont ni lisibles ni supprimables par le client
    }

    if (report.ownership === 'proven') {
      try {
        // 2. Verrou : posé puis CONFIRMÉ par le serveur avant toute suppression (déjà posé par une tentative précédente : reprise).
        if (typeof spaceSnap.data()?.deletionLockedAt === 'string') {
          report.locked = true; // verrou déjà posé (reprise) : lu sur le serveur
        } else {
          let lockError: unknown = null;
          try {
            await step(ops.lockSpace(spaceRef, new Date(now()).toISOString()), 'verrouillage de l’espace');
          } catch (error) {
            lockError = error; // refus possible parce qu'un autre appareil vient de poser le verrou : le serveur tranche
          }
          const locked = await step(ops.getDocFromServer(spaceRef), 'vérification du verrou');
          if (!locked.exists() || typeof locked.data()?.deletionLockedAt !== 'string') {
            if (lockError) throw lockError; // pas de verrou : on ne continue pas (l'absence éventuelle de l'espace est vérifiée plus bas)
            report.error = { code: 'lock-unconfirmed', message: 'Le verrou de suppression n’a pas été confirmé par le serveur : rien n’a été supprimé.' };
            return report;
          }
          report.locked = true; // confirmé par la relecture serveur
        }

        // 3. Enregistrements : pages lues SUR LE SERVEUR, un lot par page. « deleted » ne compte que les lots dont la réponse est arrivée.
        const processed = new Set<string>();
        for (let page = 0; page < MAX_PAGES; page += 1) {
          if (now() - startedAt > deadlineMs) {
            report.error = { code: 'deadline', message: 'Durée maximale d’une tentative atteinte : réessayez pour continuer là où la suppression s’est arrêtée.' };
            return report;
          }
          const snap = await step(ops.getDocsFromServer(query(recordsRef, limit(DELETE_PAGE_SIZE))), 'lecture des enregistrements');
          if (snap.empty) break;
          if (snap.docs.every((d) => processed.has(d.id))) {
            // Des documents « supprimés » réapparaissent à la lecture serveur : aucune progression, on ne tourne pas en boucle.
            report.error = { code: 'no-progress', message: 'Des enregistrements déjà supprimés sont toujours présents sur le serveur.' };
            report.records.remaining = snap.size;
            return report;
          }
          report.records.found += snap.size;
          await step(ops.commitDeletes(db, snap.docs.map((d) => d.ref)), 'suppression d’un lot d’enregistrements');
          snap.docs.forEach((d) => processed.add(d.id));
          report.records.deleted += snap.size;
        }

        // 4. Confirmation SERVEUR : plus aucun enregistrement (l'espace étant verrouillé, plus aucun ne peut apparaître).
        //    Sinon l'espace parent n'est PAS supprimé.
        const left = await step(ops.getDocsFromServer(query(recordsRef, limit(1))), 'vérification des enregistrements');
        report.records.remaining = left.size;
        if (left.size > 0) return report;

        // 5. Espace : suppression, puis confirmation serveur.
        report.space = 'unknown';
        await step(ops.deleteDocument(spaceRef), 'suppression de l’espace');
        spaceDeleteAcknowledged = true; // à partir d'ici, une erreur de vérification reste « inconnu » (pas de repli sur « absent »)
        const spaceAfter = await step(ops.getDocFromServer(spaceRef), 'vérification de l’espace');
        report.space = spaceAfter.exists() ? 'failed' : 'deleted';
        if (report.space === 'failed') return report; // le profil n'est pas touché tant que l'espace n'est pas confirmé supprimé
      } catch (error) {
        // Suppression simultanée : un autre appareil a pu supprimer l'espace entre-temps (nos opérations échouent alors, p. ex.
        // en `permission-denied`). L'absence n'est retenue que si une lecture SERVEUR la confirme ; sinon l'erreur d'origine est conservée.
        if (spaceDeleteAcknowledged || !(await spaceConfirmedAbsent())) throw error;
        report.ownership = 'space_absent';
        report.records.remaining = 0;
        report.space = 'absent';
      }
    } else {
      report.records.remaining = 0;
      report.space = 'absent';
    }

    // 6. Profil : seulement une fois l'espace confirmé supprimé ou absent (serveur), puis confirmation serveur.
    report.profile = 'unknown';
    const profileBefore = await step(ops.getDocFromServer(userRef), 'lecture du profil');
    if (profileBefore.exists()) {
      await step(ops.deleteDocument(userRef), 'suppression du profil');
      const profileAfter = await step(ops.getDocFromServer(userRef), 'vérification du profil');
      report.profile = profileAfter.exists() ? 'failed' : 'deleted';
    } else {
      report.profile = 'absent';
    }

    // l'espace « failed » a déjà interrompu le parcours : ici il est confirmé supprimé ou absent par le serveur
    report.verified = report.records.remaining === 0 && report.profile !== 'failed';
    return report;
  } catch (error) {
    // Ni réussite ni échec présumé : l'état reste celui que le serveur a confirmé ; ce qui était en cours reste « unknown ».
    report.verified = false;
    report.error = fail(error);
    if (error instanceof StepTimeout) report.uncertain = true;
    return report;
  }
}
