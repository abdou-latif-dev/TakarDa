// Transports de synchronisation et de réception — P4. Ils implémentent `SyncTransport` (envoi, lecture d'un document) et `PullTransport`
// (lecture par pages) du moteur local, plus la RESTAURATION d'un élément supprimé. Aucune suppression physique (voir syncAccountErasure.ts).
//
// Ce module ne contient AUCUN appel au SDK : il s'appuie sur un `SyncBackend` (port minimal : transaction, lecture, page, suppression).
// La réalisation Firestore est dans firestoreSyncBackend.ts ; les tests unitaires utilisent un backend en mémoire. Rien n'est branché
// à l'application : ces fabriques ne sont appelées que par des tests (et, plus tard, par le branchement explicite du moteur).
//
// Garanties :
//  - une seule écriture à la fois par document, dans une TRANSACTION : lecture de la révision courante, écriture de la suivante ;
//  - idempotence : `lastOpId` identifie la dernière opération appliquée ; rejouer le même `opId` (réponse perdue) renvoie la révision
//    déjà obtenue, sans nouvelle écriture ; un autre cas de désaccord de révision est un CONFLIT (le moteur lit alors le cloud et
//    compare les empreintes avant de décider) ;
//  - suppression LOGIQUE seulement (le contenu reste dans le cloud) ; restauration explicite ;
//  - faits financiers : création seulement (refusé ici, et refusé par les règles) ;
//  - un seul espace : `personal_<uid>` du compte fourni ; rien ne permet de viser un autre espace.

import { SyncTransportError, type PushRequest, type RemoteDoc, type SyncTransport } from '../sync/syncEngine';
import type { PullPage, PullTransport } from '../sync/inbound';
import { isKnownKind, type Kind } from '../sync/kindRegistry';
import {
  changeFromDoc,
  checkFirestoreCompat,
  cloudKinds,
  decodeCursor,
  docFromWire,
  encodeCursor,
  hashOfDoc,
  isCloudFinancialKind,
  toTransportError,
  type CloudSyncDoc,
  type CloudSyncWrite,
  type PullPosition,
} from './syncDocModel';

// ---- Port ------------------------------------------------------------------------------------------------------------------------

export interface SyncTx {
  get(id: string): Promise<CloudSyncDoc | null>;
  /** Écrit un document NOUVEAU (les règles le jugent comme une création). */
  create(id: string, data: CloudSyncWrite): void;
  /** Remplace un document EXISTANT (les règles le jugent comme une modification). */
  update(id: string, data: CloudSyncWrite): void;
}

export interface PullQuery {
  /** Position strictement après laquelle lire (null : depuis `from` ou depuis le début). */
  after: PullPosition | null;
  /** Borne basse inclusive sur `serverUpdatedAt` (recouvrement de sécurité) ; ignorée si `after` est fourni. */
  from: string | null;
  limit: number;
}

export interface SyncBackend {
  transaction<T>(run: (tx: SyncTx) => Promise<T>): Promise<T>;
  get(id: string): Promise<CloudSyncDoc | null>;
  /** Documents triés par `serverUpdatedAt` puis identifiant. */
  page(query: PullQuery): Promise<{ id: string; doc: CloudSyncDoc }[]>;
  // Aucune suppression PHYSIQUE ici : elle n'est pas une opération ordinaire. Elle n'existe que dans la procédure d'effacement du compte
  // (syncAccountErasure.ts, port `ErasureBackend`), derrière le verrou de suppression de l'espace.
}

export interface RestoreRequest {
  opId: string;
  recordId: string;
  kind: Kind;
  /** Révision de la suppression logique à lever. */
  expectedRev: number;
}

export interface FirestoreSyncOptions {
  backend: SyncBackend;
  /** Compte propriétaire : la seule portée de ces transports est son espace personnel. */
  uid: string;
  now?: () => Date;
  /** Recouvrement appliqué à la PREMIÈRE page de chaque instance (créer une instance par exécution). Défaut : 10 s. */
  overlapMs?: number;
}

export interface FirestoreSyncTransport extends SyncTransport, PullTransport {
  /** Lève une suppression logique : explicite, vérifie le propriétaire et la révision, jamais pour un fait financier. */
  restore(request: RestoreRequest): Promise<{ rev: number }>;
}

export const DEFAULT_OVERLAP_MS = 10_000;
export const MAX_PAGE_SIZE = 300;

const conflict = (message: string): SyncTransportError => new SyncTransportError('conflict', message);
const invalid = (message: string): SyncTransportError => new SyncTransportError('invalid', message);

export function createFirestoreSyncTransport(options: FirestoreSyncOptions): FirestoreSyncTransport {
  const { backend, uid } = options;
  if (!uid) throw invalid('Aucun compte propriétaire : aucun transport.');
  const clock = options.now ?? (() => new Date());
  let firstPull = true;

  const guardKind = (kind: string): void => {
    if (!isKnownKind(kind) || !cloudKinds().includes(kind)) throw invalid(`Type non synchronisable : ${kind}.`);
  };

  const run = async <T>(work: () => Promise<T>): Promise<T> => {
    try {
      return await work();
    } catch (error) {
      throw toTransportError(error);
    }
  };

  const transport: FirestoreSyncTransport = {
    async push(request: PushRequest) {
      guardKind(request.kind);
      if (!request.opId) throw invalid('Opération sans identifiant d’idempotence.');
      if (request.op !== 'create' && isCloudFinancialKind(request.kind)) throw invalid('Fait financier : création seulement (aucune modification ni suppression dans le cloud).');
      if (request.op === 'restore') {
        // restauration explicite : même contrôle que `restore` (propriétaire, type, révision de la suppression), jamais pour un fait financier
        if (request.expectedRev === null) throw invalid('Restauration sans révision attendue.');
        return transport.restore({ opId: request.opId, recordId: request.recordId, kind: request.kind, expectedRev: request.expectedRev });
      }
      const wire = request.wire;
      if (request.op !== 'delete') {
        if (!wire) throw invalid('Contenu manquant.');
        if (wire.id !== request.recordId || wire.kind !== request.kind) throw invalid('Contenu incohérent avec l’opération.');
        if (wire.ownerUid !== uid) throw invalid('Le propriétaire du contenu n’est pas le compte connecté.');
        const problems = checkFirestoreCompat(wire);
        if (problems.length > 0) throw invalid(`Non envoyable à Firestore : ${problems.join(' ; ')}`);
      } else if (request.recordId === '' || request.recordId.includes('/')) {
        throw invalid('Identifiant inutilisable.');
      }

      return run(() =>
        backend.transaction(async (tx) => {
          const current = await tx.get(request.recordId);
          // réponse perdue : cette opération est déjà la dernière appliquée
          if (current && current.lastOpId === request.opId) return { rev: current.rev };

          if (request.op === 'create') {
            if (current) throw conflict('Un document existe déjà sous cet identifiant.');
            tx.create(request.recordId, docFromWire(wire!, { opId: request.opId, rev: 1 }, null));
            return { rev: 1 };
          }
          if (!current) throw conflict('Le document n’existe pas dans le cloud.');
          if (current.ownerUid !== uid) throw invalid('Le document n’appartient pas au compte connecté.');
          if (current.kind !== request.kind) throw invalid('Le type du document ne peut pas changer.');
          if (current.deleted) throw conflict('Le document est supprimé dans le cloud (restauration explicite requise).');
          if (current.rev !== request.expectedRev) throw conflict(`Révision attendue ${request.expectedRev}, révision du cloud ${current.rev}.`);
          const rev = current.rev + 1;
          if (request.op === 'update') {
            tx.update(request.recordId, docFromWire(wire!, { opId: request.opId, rev }, current));
          } else {
            const { serverUpdatedAt: _ignored, ...kept } = current;
            void _ignored;
            tx.update(request.recordId, { ...kept, rev, deleted: true, deletedAt: request.deletedAt ?? clock().toISOString(), lastOpId: request.opId });
          }
          return { rev };
        }),
      );
    },

    async read(kind: Kind, id: string): Promise<RemoteDoc | null> {
      guardKind(kind);
      const doc = await run(() => backend.get(id));
      if (!doc) return null;
      return { rev: doc.rev, hash: hashOfDoc(doc), deleted: doc.deleted === true };
    },

    async pull(request: { cursor: string | null; limit: number }): Promise<PullPage> {
      const limit = Math.min(Math.max(1, Math.floor(request.limit) || 1), MAX_PAGE_SIZE);
      const position = decodeCursor(request.cursor);
      let after: PullPosition | null = position;
      let from: string | null = null;
      if (position && firstPull) {
        // recouvrement : relire un peu en arrière (les changements reçus sont idempotents) pour ne rien manquer si deux écritures
        // se valident presque en même temps ; la position stricte reprend ensuite pour les pages suivantes
        from = new Date(Date.parse(position.t) - (options.overlapMs ?? DEFAULT_OVERLAP_MS)).toISOString();
        after = null;
      }
      firstPull = false;
      let rows = await run(() => backend.page({ after, from, limit }));
      // Page de recouvrement SATURÉE (au moins `limit` documents dans la fenêtre, tous avant le curseur) : la lecture n'avancerait jamais.
      // On relit alors strictement APRÈS le curseur (le recouvrement ne protège plus que quand la fenêtre tient dans une page).
      const tail = rows[rows.length - 1];
      if (position && from !== null && tail && rows.length >= limit && !(tail.doc.serverUpdatedAt > position.t || (tail.doc.serverUpdatedAt === position.t && tail.id > position.id))) {
        rows = await run(() => backend.page({ after: position, from: null, limit }));
      }
      const changes = rows.map((row) => changeFromDoc(row.id, row.doc));
      const last = rows[rows.length - 1];
      if (last && !last.doc.serverUpdatedAt) throw invalid('Document sans horodatage serveur : curseur impossible (lecture arrêtée).');
      return {
        changes,
        nextCursor: last ? encodeCursor({ t: last.doc.serverUpdatedAt, id: last.id }) : request.cursor,
        hasMore: rows.length >= limit,
      };
    },

    async restore(request: RestoreRequest) {
      guardKind(request.kind);
      if (!request.opId) throw invalid('Opération sans identifiant d’idempotence.');
      if (isCloudFinancialKind(request.kind)) throw invalid('Un fait financier n’est jamais supprimé : rien à restaurer.');
      return run(() =>
        backend.transaction(async (tx) => {
          const current = await tx.get(request.recordId);
          if (current && current.lastOpId === request.opId) return { rev: current.rev };
          if (!current) throw conflict('Le document n’existe pas dans le cloud.');
          if (current.ownerUid !== uid) throw invalid('Le document n’appartient pas au compte connecté.');
          if (current.kind !== request.kind) throw invalid('Le type du document ne peut pas changer.');
          if (!current.deleted) throw conflict('Le document n’est pas supprimé : rien à restaurer.');
          if (current.rev !== request.expectedRev) throw conflict(`Révision attendue ${request.expectedRev}, révision du cloud ${current.rev}.`);
          const rev = current.rev + 1;
          const { serverUpdatedAt: _ignored, ...kept } = current;
          void _ignored;
          tx.update(request.recordId, { ...kept, rev, deleted: false, deletedAt: null, restoredAt: clock().toISOString(), lastOpId: request.opId });
          return { rev };
        }),
      );
    },
  };
  return transport;
}
