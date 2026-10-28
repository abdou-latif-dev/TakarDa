// Backend EN MÉMOIRE pour les tests unitaires des transports (P4). Il imite les propriétés de Firestore dont le transport dépend :
//  - transactions optimistes (relecture si un document lu a changé avant la validation),
//  - horodatage serveur croissant (`serverUpdatedAt`), avec option d'égalité d'horodatages,
//  - tri par (serverUpdatedAt, identifiant), position stricte et borne basse,
//  - injection de pannes : réseau avant/après validation (« réponse perdue »), refus de permission, erreur de stockage.
// Il applique aussi un MODÈLE des invariants des règles (révision +1, faits financiers en création seulement, transitions de suppression
// logique) pour détecter une écriture que les vraies règles refuseraient. Ce n'est PAS une preuve : seules les règles exécutées dans
// l'émulateur ou le projet de test le sont (voir les tests d'intégration).

import { SyncTransportError } from '../../sync/syncEngine';
import { cloudFinancialKinds, cloudKinds, CLOUD_DOC_FIELDS, type CloudSyncDoc, type CloudSyncWrite } from '../../firebase/syncDocModel';
import type { PullQuery, SyncBackend, SyncTx } from '../../firebase/firestoreSyncTransport';
import type { ErasureBackend, SpaceState } from '../../firebase/syncAccountErasure';

export class RulesModelViolation extends Error {
  readonly code = 'permission-denied';
  constructor(reason: string) {
    super(`Refusé par le modèle de règles : ${reason}`);
  }
}

/** Modèle des règles de `syncRecords` (voir firestore.p4.rules). `previous` = document existant ou null. */
export function modelRules(uid: string, previous: CloudSyncDoc | null, next: CloudSyncWrite): void {
  const fail = (reason: string): never => {
    throw new RulesModelViolation(reason);
  };
  const keys = Object.keys(next).sort().join(',');
  const expected = CLOUD_DOC_FIELDS.filter((f) => f !== 'serverUpdatedAt').slice().sort().join(',');
  if (keys !== expected) fail('champs différents du modèle');
  if (!cloudKinds().includes(next.kind as never)) fail('type non autorisé');
  if (next.ownerUid !== uid) fail('propriétaire différent du compte');
  if (!previous) {
    if (next.rev !== 1 || next.deleted || next.deletedAt !== null || next.restoredAt !== null) fail('création : révision 1, non supprimé');
    return;
  }
  if (cloudFinancialKinds().includes(previous.kind as never)) fail('fait financier : création seulement');
  if (next.kind !== previous.kind || next.ownerUid !== previous.ownerUid || next.createdAt !== previous.createdAt) fail('type, propriétaire et date de création inchangés');
  if (next.rev !== previous.rev + 1) fail('révision : ancienne + 1');
  const changed = (CLOUD_DOC_FIELDS as readonly string[]).filter((f) => f !== 'serverUpdatedAt' && JSON.stringify((next as never)[f]) !== JSON.stringify((previous as never)[f]));
  const only = (allowed: string[]) => changed.every((f) => allowed.includes(f));
  if (!previous.deleted && !next.deleted) {
    if (next.deletedAt !== null || next.restoredAt !== previous.restoredAt) fail('modification : ni suppression ni restauration');
  } else if (!previous.deleted && next.deleted) {
    if (typeof next.deletedAt !== 'string' || !only(['deleted', 'deletedAt', 'rev', 'lastOpId'])) fail('suppression logique : seuls les champs de suppression changent');
  } else if (previous.deleted && !next.deleted) {
    if (next.deletedAt !== null || typeof next.restoredAt !== 'string' || !only(['deleted', 'deletedAt', 'restoredAt', 'rev', 'lastOpId'])) fail('restauration : contenu inchangé');
  } else fail('document supprimé : aucune modification');
}

export interface MemoryOptions {
  uid: string;
  start?: Date;
  /** Tous les horodatages serveur sont égaux (teste le départage par identifiant). */
  tieTimestamps?: boolean;
  /** Désactive le modèle de règles (pour tester ce que le transport refuse AVANT d'écrire). */
  skipRules?: boolean;
  /** Espace de départ (défaut : existe, propriétaire = uid, seul membre, non verrouillé). */
  space?: Partial<SpaceState>;
}

export interface MemoryCloud {
  backend: SyncBackend;
  docs: Map<string, CloudSyncDoc>;
  log: { kind: 'commit' | 'get' | 'page'; id?: string }[];
  /** Injecte une panne sur la prochaine opération qui correspond. */
  fail: {
    /** La prochaine transaction échoue AVANT de valider (rien n'est écrit). */
    beforeCommit: (error?: unknown) => void;
    /** La prochaine transaction VALIDE puis la réponse est perdue (le client voit une erreur réseau). */
    lostResponse: () => void;
    /** Les prochaines lectures échouent. */
    reads: (count: number, error?: unknown) => void;
  };
  /** État de l'espace (verrou de suppression de compte) et port de la procédure d'effacement. */
  space: SpaceState;
  erasure: ErasureBackend;
  /** Pannes de la procédure d'effacement. */
  erasureFail: {
    /** Après `n` lots supprimés avec succès, le lot suivant échoue (réseau) une fois. */
    removeAfter: (n: number) => void;
    /** La pose du verrou ne produit AUCUN effet (le serveur ne le confirme pas). */
    lockIgnored: () => void;
    /** Les suppressions répondent « succès » mais les documents restent. */
    removalIgnored: () => void;
    /** La prochaine pose du verrou échoue (réseau). */
    lockFails: () => void;
  };
  /** Écriture concurrente (autre appareil) exécutée juste avant la validation de la prochaine transaction. */
  concurrentWrite: (write: (docs: Map<string, CloudSyncDoc>) => void) => void;
  commits: () => number;
}

export function createMemoryCloud(options: MemoryOptions): MemoryCloud {
  const docs = new Map<string, CloudSyncDoc>();
  const log: MemoryCloud['log'] = [];
  let tick = (options.start ?? new Date('2026-10-19T09:00:00.000Z')).getTime();
  const stamp = (): string => new Date(options.tieTimestamps ? tick : (tick += 1)).toISOString();
  const pending = { beforeCommit: null as null | { error: unknown }, lost: false, reads: 0, readError: undefined as unknown, concurrent: null as null | ((d: Map<string, CloudSyncDoc>) => void) };
  let commits = 0;
  const space: SpaceState = { exists: true, ownerUid: options.uid, memberUids: [options.uid], locked: false, ...options.space };
  const erasePlan = { removeAfter: null as number | null, lockIgnored: false, removalIgnored: false, lockFails: false };
  const net = () => new SyncTransportError('network', 'hors ligne simulé');

  const readGuard = () => {
    if (pending.reads > 0) {
      pending.reads -= 1;
      throw pending.readError ?? net();
    }
  };

  const backend: SyncBackend = {
    async transaction<T>(run: (tx: SyncTx) => Promise<T>): Promise<T> {
      for (let attempt = 0; attempt < 5; attempt += 1) {
        readGuard();
        const reads = new Map<string, number | null>();
        const writes = new Map<string, { data: CloudSyncWrite; mode: 'create' | 'update' }>();
        const tx: SyncTx = {
          get: async (id) => {
            log.push({ kind: 'get', id });
            const current = docs.get(id) ?? null;
            reads.set(id, current ? current.rev : null);
            return current ? structuredClone(current) : null;
          },
          create: (id, data) => void writes.set(id, { data: structuredClone(data), mode: 'create' }),
          update: (id, data) => void writes.set(id, { data: structuredClone(data), mode: 'update' }),
        };
        const result = await run(tx);
        if (pending.beforeCommit) {
          const { error } = pending.beforeCommit;
          pending.beforeCommit = null;
          throw error;
        }
        if (pending.concurrent) {
          const hook = pending.concurrent;
          pending.concurrent = null;
          hook(docs);
        }
        // validation optimiste : un document lu a changé → on rejoue la transaction
        const stale = [...reads].some(([id, rev]) => (docs.get(id)?.rev ?? null) !== rev);
        if (stale) continue;
        if (writes.size > 0 && space.locked && !options.skipRules) throw new RulesModelViolation('espace verrouillé : plus aucune écriture');
        const t = stamp();
        for (const [id, w] of writes) {
          const previous = docs.get(id) ?? null;
          if (w.mode === 'create' && previous) throw new RulesModelViolation('création sur un document existant');
          if (w.mode === 'update' && !previous) throw new RulesModelViolation('modification d’un document absent');
          if (!options.skipRules) modelRules(options.uid, previous, w.data);
        }
        for (const [id, w] of writes) {
          docs.set(id, { ...w.data, serverUpdatedAt: t });
          log.push({ kind: 'commit', id });
        }
        if (writes.size > 0) commits += 1;
        if (pending.lost) {
          pending.lost = false;
          throw net(); // validé côté serveur, réponse perdue côté client
        }
        return result;
      }
      throw new SyncTransportError('network', 'transaction abandonnée après plusieurs tentatives');
    },

    async get(id) {
      readGuard();
      log.push({ kind: 'get', id });
      const d = docs.get(id);
      return d ? structuredClone(d) : null;
    },

    async page(query: PullQuery) {
      readGuard();
      log.push({ kind: 'page' });
      const sorted = [...docs.entries()].sort(([ia, a], [ib, b]) => (a.serverUpdatedAt === b.serverUpdatedAt ? (ia < ib ? -1 : 1) : a.serverUpdatedAt < b.serverUpdatedAt ? -1 : 1));
      const rows = sorted.filter(([id, d]) => {
        if (query.after) return d.serverUpdatedAt > query.after.t || (d.serverUpdatedAt === query.after.t && id > query.after.id);
        if (query.from) return d.serverUpdatedAt >= query.from;
        return true;
      });
      return rows.slice(0, query.limit).map(([id, d]) => ({ id, doc: structuredClone(d) }));
    },

  };

  const erasure: ErasureBackend = {
    async readSpace() {
      readGuard();
      return structuredClone(space);
    },
    async lockSpace() {
      if (erasePlan.lockFails) {
        erasePlan.lockFails = false;
        throw net();
      }
      if (!erasePlan.lockIgnored) space.locked = true;
    },
    async listSyncIds(limit) {
      readGuard();
      return [...docs.keys()].slice(0, limit);
    },
    async removeSyncDocs(ids) {
      if (!space.locked) throw new RulesModelViolation('suppression physique : espace non verrouillé');
      if (erasePlan.removeAfter !== null) {
        if (erasePlan.removeAfter <= 0) {
          erasePlan.removeAfter = null;
          throw net();
        }
        erasePlan.removeAfter -= 1;
      }
      if (!erasePlan.removalIgnored) for (const id of ids) docs.delete(id);
    },
  };

  return {
    backend,
    docs,
    log,
    fail: {
      beforeCommit: (error) => void (pending.beforeCommit = { error: error ?? net() }),
      lostResponse: () => void (pending.lost = true),
      reads: (count, error) => {
        pending.reads = count;
        pending.readError = error;
      },
    },
    space,
    erasure,
    erasureFail: {
      removeAfter: (n) => void (erasePlan.removeAfter = n),
      lockIgnored: () => void (erasePlan.lockIgnored = true),
      removalIgnored: () => void (erasePlan.removalIgnored = true),
      lockFails: () => void (erasePlan.lockFails = true),
    },
    concurrentWrite: (write) => void (pending.concurrent = write),
    commits: () => commits,
  };
}
