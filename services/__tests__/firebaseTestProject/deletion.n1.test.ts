// N1 — suppression de compte de bout en bout (vrais jetons de l'émulateur Authentication + vraies règles chargées dans
// l'émulateur Firestore), partielle, perdue, reprise, concurrence, isolation. ÉMULATEURS LOCAUX UNIQUEMENT.
// Rien ici ne prouve le comportement de Firebase en production (limites réelles, latences, jetons réels).

import type * as H from './harness';

const enabled = !!process.env.FIREBASE_AUTH_EMULATOR_HOST && !!process.env.FIRESTORE_EMULATOR_HOST;
const suite = enabled ? describe : describe.skip;

suite('N1 · suppression de compte (émulateurs)', () => {
  let h: typeof H;
  let f: any;
  let del: any;
  let guard: typeof import('./networkGuard');
  const never = () => new Promise<void>(() => undefined);

  beforeAll(() => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    guard = require('./networkGuard');
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    h = require('./harness');
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    f = require('firebase/firestore');
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    del = require('../../firebase/firestoreAccountDeletion');
  });
  beforeEach(async () => {
    await h.clearEmulators();
  });
  afterAll(async () => {
    await h.disposeClients();
    await h.disposeAdmin();
  });

  const account = async (label: string, n: number) => {
    const user = await h.makeUser(label);
    await h.seedAccount(user, n);
    return user;
  };
  const recordsRef = (user: H.TestUser) => f.collection(user.client.db, 'spaces', h.personalSpace(user.uid), 'records');
  const intact = async (user: H.TestUser, n: number) => {
    expect(await h.adminCount(h.personalSpace(user.uid))).toBe(n);
    expect(await h.adminExists('spaces', h.personalSpace(user.uid))).toBe(true);
    expect(await h.adminExists('users', user.uid)).toBe(true);
    expect((await h.accountStatus(user)).exists).toBe(true);
  };
  const settle = async (db: unknown) => {
    await f.enableNetwork(db);
    await f.waitForPendingWrites(db);
  };

  describe('B · suppression complète et limites de lots', () => {
    it.each([100, 250])('B3 · %i enregistrements : suppression complète vérifiée, compte supprimé, compte voisin intact', async (n) => {
      const user = await account(`b3-${n}`, n);
      const neighbour = await account(`b3v-${n}`, 7);
      const { local, released } = h.fakeLocal();
      const t0 = Date.now();
      const outcome = await h.runDeletion(user, user.password, local);
      h.observe(`B3.${n}.ms`, Date.now() - t0);
      expect(outcome.status).toBe('completed');
      expect(outcome.report?.records).toEqual({ found: n, deleted: n, remaining: 0 });
      expect(outcome.report).toMatchObject({ verified: true, uncertain: false, space: 'deleted', profile: 'deleted' });
      expect(released).toEqual([user.uid]);
      expect(await h.adminCount(h.personalSpace(user.uid))).toBe(0);
      expect(await h.adminExists('spaces', h.personalSpace(user.uid))).toBe(false);
      expect(await h.adminExists('users', user.uid)).toBe(false);
      expect((await h.accountStatus(user)).exists).toBe(false);
      await intact(neighbour, 7);
    });

    it('B2 · courbe de taille de lot : suppressions d’un seul lot de N documents (information sur les limites d’appels des règles)', async () => {
      const user = await account('b2', 0);
      const sizes = [1, 5, 10, 20, 21, 25, 50, 100, 150, 200, 300, 500];
      const results: Record<string, string> = {};
      let largestPassing = 0;
      for (const n of sizes) {
        const ids = await h.createRecords(user, n, `c${n}-`);
        const refs = ids.map((id) => f.doc(user.client.db, 'spaces', h.personalSpace(user.uid), 'records', id));
        try {
          await del.defaultOps.commitDeletes(user.client.db, refs);
          results[String(n)] = 'ok';
          largestPassing = n;
        } catch (error) {
          results[String(n)] = `échec:${(error as { code?: string }).code}`;
          break;
        }
      }
      h.observe('B2.curve', results);
      h.observe('B2.largestPassingBatch', largestPassing);
      expect(largestPassing).toBeGreaterThanOrEqual(del.DELETE_PAGE_SIZE); // la taille de lot réellement utilisée doit passer
      // L'émulateur n'applique peut-être pas la limite de production : si tout passe jusqu'à 500, la limite n'est PAS représentée ici.
      h.observe('B2.limitReproducedByEmulator', largestPassing < 500);
    });
  });

  describe('C · échecs partiels, réponses perdues, reprises', () => {
    it('C1 · lot appliqué mais réponse en erreur : « incomplète », reprise complète, voisin intact', async () => {
      const n = del.DELETE_PAGE_SIZE + 20;
      const user = await account('c1', n);
      const neighbour = await account('c1v', 4);
      let first = true;
      const ops = {
        ...del.defaultOps,
        commitDeletes: async (db: unknown, refs: unknown[]) => {
          await del.defaultOps.commitDeletes(db, refs);
          if (first) { first = false; throw new Error('réponse perdue'); }
        },
      };
      const { local, released } = h.fakeLocal();
      const lost = await h.runDeletion(user, user.password, local, { ops, timeoutMs: 1500 });
      expect(lost.status).toBe('cloud_incomplete');
      expect(lost.authDeleted).toBe(false);
      expect(released).toEqual([]);
      expect((await h.accountStatus(user)).exists).toBe(true); // compte conservé
      expect(await h.adminCount(h.personalSpace(user.uid))).toBe(20); // le serveur avait bien appliqué la première page
      const resumed = await h.runDeletion(user, user.password, local);
      expect(resumed.status).toBe('completed');
      expect(resumed.report?.records).toEqual({ found: 20, deleted: 20, remaining: 0 });
      await intact(neighbour, 4);
    });

    it('C2 · lot appliqué, réponse jamais reçue : « incertain » (jamais un succès), reprise complète', async () => {
      const user = await account('c2', 30);
      const neighbour = await account('c2v', 3);
      const ops = { ...del.defaultOps, commitDeletes: async (db: unknown, refs: unknown[]) => { await del.defaultOps.commitDeletes(db, refs); await never(); } };
      const { local, released } = h.fakeLocal();
      const t0 = Date.now();
      const stuck = await h.runDeletion(user, user.password, local, { ops, timeoutMs: 1500 });
      expect(Date.now() - t0).toBeLessThan(10000); // borné
      expect(stuck.status).toBe('cloud_uncertain');
      expect(stuck.message).toMatch(/incertaine/);
      expect(stuck.message).toMatch(/peut-être été appliquée/);
      expect(stuck.authDeleted).toBe(false);
      expect(released).toEqual([]);
      expect(await h.adminExists('spaces', h.personalSpace(user.uid))).toBe(true); // espace non touché sans confirmation
      expect((await h.accountStatus(user)).exists).toBe(true);
      const resumed = await h.runDeletion(user, user.password, local);
      expect(resumed.status).toBe('completed');
      await intact(neighbour, 3);
    });

    it('C3 · réseau Firestore coupé en route : incertain ; 2ᵉ tentative sans nouvelle écriture ; réseau rétabli ; reprise complète', async () => {
      const n = del.DELETE_PAGE_SIZE + 50;
      const user = await account('c3', n);
      const neighbour = await account('c3v', 5);
      const db = user.client.db;
      let commits = 0;
      const dropAfterFirstPage = {
        ...del.defaultOps,
        getDocsFromServer: async (q: unknown) => {
          const snap = await del.defaultOps.getDocsFromServer(q);
          if (!snap.empty) await f.disableNetwork(db);
          return snap;
        },
        commitDeletes: async (d: unknown, refs: unknown[]) => { commits += 1; return del.defaultOps.commitDeletes(d, refs); },
      };
      const { local, released } = h.fakeLocal();
      const first = await h.runDeletion(user, user.password, local, { ops: dropAfterFirstPage, timeoutMs: 1500 });
      expect(first.status).toBe('cloud_uncertain');
      expect(commits).toBe(1);
      expect(await h.adminCount(h.personalSpace(user.uid))).toBe(n); // rien n'est parti
      let commits2 = 0;
      const second = await h.runDeletion(user, user.password, local, { ops: { ...del.defaultOps, commitDeletes: async () => { commits2 += 1; } }, timeoutMs: 1500 });
      expect(second.status).toBe('cloud_uncertain');
      expect(commits2).toBe(0); // aucune relance aveugle d'un lot
      expect(released).toEqual([]);
      await settle(db);
      expect(await h.adminCount(h.personalSpace(user.uid))).toBe(n - del.DELETE_PAGE_SIZE);
      const third = await h.runDeletion(user, user.password, local);
      expect(third.status).toBe('completed');
      expect(third.report?.records).toEqual({ found: 50, deleted: 50, remaining: 0 });
      await intact(neighbour, 5);
    });

    it('données cloud supprimées mais suppression du compte en échec : « compte encore actif », données locales libérées, reprise termine', async () => {
      const user = await account('c4', 12);
      const real = h.apiFor(user);
      const failing = { ...real, deleteAuthAccount: async () => { throw Object.assign(new Error('x'), { code: 'auth/requires-recent-login' }); } };
      const { deleteAccount } = require('../../accountDeletionService'); // eslint-disable-line @typescript-eslint/no-require-imports
      const { local, released } = h.fakeLocal();
      const partial = await deleteAccount(failing, user.uid, user.password, local);
      expect(partial.status).toBe('cloud_deleted_account_active');
      expect(partial.message).toMatch(/compte encore actif/);
      expect(released).toEqual([user.uid]);
      expect(await h.adminExists('spaces', h.personalSpace(user.uid))).toBe(false);
      expect((await h.accountStatus(user)).exists).toBe(true);
      const resumed = await deleteAccount(real, user.uid, user.password, local);
      expect(resumed.status).toBe('completed');
      expect((await h.accountStatus(user)).exists).toBe(false);
    });
  });

  describe('D · concurrence : verrou de suppression (N1.1) et résultat « espace déjà absent »', () => {
    const spaceOf = (user: H.TestUser) => `spaces/${h.personalSpace(user.uid)}`;
    const lockOf = async (user: H.TestUser) =>
      ((await h.adminRun((db: unknown) => f.getDoc(f.doc(db, 'spaces', h.personalSpace(user.uid))))) as any).data()?.deletionLockedAt ?? null;
    const spaceDoc = (user: H.TestUser, over: Record<string, unknown> = {}) => ({
      ownerUid: user.uid, memberUids: [user.uid], name: 'Espace', createdAt: 'x', schemaVersion: 1, ...over,
    });
    const code = (promise: Promise<unknown>) => promise.then(() => 'ok', (e: { code?: string }) => e.code ?? 'erreur');

    it('D1 · écriture concurrente AVANT la suppression : acceptée, puis effacée avec le reste', async () => {
      const user = await account('d1-avant', 3);
      const device2 = await h.secondDevice(user, 'd1-avant-appareil2');
      await h.createRecords(user, 1, 'avant-', device2); // pas encore de verrou : permis
      expect(await lockOf(user)).toBeNull();
      const report = await del.deleteAccountCloudData(user.client.db, user.uid, { timeoutMs: 5000 });
      expect(report.verified).toBe(true);
      expect(report.records.deleted).toBe(4);
      expect(await h.adminCount(h.personalSpace(user.uid))).toBe(0);
    });

    it('D1 · écritures concurrentes PENDANT la suppression (création et modification, pendant les lots puis juste avant l’espace) : refusées, aucun orphelin', async () => {
      const user = await account('d1-pendant', 3);
      const device2 = await h.secondDevice(user, 'd1-pendant-appareil2');
      const during: Record<string, string> = {};
      let batches = 0;
      const ops = {
        ...del.defaultOps,
        commitDeletes: async (db: unknown, refs: unknown[]) => {
          batches += 1;
          if (batches === 1) {
            during.createInBatch = await code(h.createRecords(user, 1, 'tardif-', device2));
            during.updateInBatch = await code(
              f.setDoc(f.doc(device2.db, 'spaces', h.personalSpace(user.uid), 'records', 'r0'), h.recordDoc(user.uid, { rev: 2, values: { nom: 'modifié' } })),
            );
          }
          return del.defaultOps.commitDeletes(db, refs);
        },
        deleteDocument: async (ref: { path: string }) => {
          if (ref.path === spaceOf(user)) during.createBeforeSpaceDelete = await code(h.createRecords(user, 1, 'tardif2-', device2));
          return del.defaultOps.deleteDocument(ref);
        },
      };
      const report = await del.deleteAccountCloudData(user.client.db, user.uid, { ops, timeoutMs: 5000 });
      h.observe('D1.concurrentWritesDuringDeletion', during);
      expect(during).toEqual({ createInBatch: 'permission-denied', updateInBatch: 'permission-denied', createBeforeSpaceDelete: 'permission-denied' });
      expect(report.verified).toBe(true);
      expect(await h.adminExists('spaces', h.personalSpace(user.uid))).toBe(false);
      expect(await h.adminCount(h.personalSpace(user.uid))).toBe(0); // aucun orphelin (avant correction : 1)
      expect(await h.adminExists('spaces', h.personalSpace(user.uid), 'records', 'tardif2-0')).toBe(false);
    });

    it('D1 · écriture concurrente APRÈS la suppression : refusée (l’espace n’existe plus), aucun orphelin', async () => {
      const user = await account('d1-apres', 3);
      const device2 = await h.secondDevice(user, 'd1-apres-appareil2');
      const report = await del.deleteAccountCloudData(user.client.db, user.uid, { timeoutMs: 5000 });
      expect(report.verified).toBe(true);
      expect(await code(h.createRecords(user, 1, 'apres-', device2))).toBe('permission-denied');
      expect(await h.adminCount(h.personalSpace(user.uid))).toBe(0);
    });

    it('D2 · recréer l’espace : refusé tant que le verrou existe ; une fois supprimé, le nouvel espace est VIDE (aucune résurrection)', async () => {
      const user = await account('d2', 3);
      const device2 = await h.secondDevice(user, 'd2-appareil2');
      const attempts: Record<string, string> = {};
      const ops = {
        ...del.defaultOps,
        deleteDocument: async (ref: { path: string }) => {
          if (ref.path === spaceOf(user)) {
            attempts.recreateOwner = await code(f.setDoc(f.doc(user.client.db, 'spaces', h.personalSpace(user.uid)), spaceDoc(user)));
            attempts.recreateDevice2 = await code(f.setDoc(f.doc(device2.db, 'spaces', h.personalSpace(user.uid)), spaceDoc(user)));
          }
          return del.defaultOps.deleteDocument(ref);
        },
      };
      const report = await del.deleteAccountCloudData(user.client.db, user.uid, { ops, timeoutMs: 5000 });
      h.observe('D2.recreateWhileLocked', attempts);
      expect(attempts).toEqual({ recreateOwner: 'permission-denied', recreateDevice2: 'permission-denied' });
      expect(report.verified).toBe(true);
      // après suppression : recréer est permis (nouveau compte cloud), et l'espace est vide
      await f.setDoc(f.doc(user.client.db, 'spaces', h.personalSpace(user.uid)), spaceDoc(user));
      expect((await f.getDocs(recordsRef(user))).size).toBe(0);
      expect(await lockOf(user)).toBeNull();
    });

    it('verrou : irréversible, réservé au propriétaire de son espace ; renommer reste possible ; ne touche pas les autres comptes', async () => {
      const a = await account('lock-a', 4);
      const b = await account('lock-b', 4);
      const spaceA = f.doc(a.client.db, 'spaces', h.personalSpace(a.uid));
      // un autre compte ne peut pas verrouiller l'espace de A
      expect(await code(f.updateDoc(f.doc(b.client.db, 'spaces', h.personalSpace(a.uid)), { deletionLockedAt: 'x' }))).toBe('permission-denied');
      expect(await lockOf(a)).toBeNull();
      // renommer fonctionne avant et pendant le verrou ; pas d'autre champ avec le verrou
      expect(await code(f.updateDoc(spaceA, { name: 'Renommé' }))).toBe('ok');
      expect(await code(f.setDoc(f.doc(a.client.db, 'spaces', h.personalSpace(a.uid), 'records', 'r1'), h.recordDoc(a.uid, { rev: 2 })))).toBe('ok'); // témoin : avant le verrou, la modification est permise
      expect(await code(f.updateDoc(spaceA, { deletionLockedAt: 'x', name: 'Mélange' }))).toBe('permission-denied');
      expect(await code(f.updateDoc(spaceA, { deletionLockedAt: '' }))).toBe('permission-denied'); // chaîne vide refusée
      expect(await code(f.updateDoc(spaceA, { deletionLockedAt: 'a'.repeat(41) }))).toBe('permission-denied');
      expect(await code(f.updateDoc(spaceA, { deletionLockedAt: '2026-10-14T10:00:00.000Z' }))).toBe('ok');
      expect(await lockOf(a)).toBe('2026-10-14T10:00:00.000Z');
      expect(await code(f.updateDoc(spaceA, { name: 'Renommé encore' }))).toBe('ok');
      // irréversible : ni retrait, ni changement, ni espace réécrit sans le champ
      expect(await code(f.updateDoc(spaceA, { deletionLockedAt: f.deleteField() }))).toBe('permission-denied');
      expect(await code(f.updateDoc(spaceA, { deletionLockedAt: 'autre' }))).toBe('permission-denied');
      expect(await code(f.setDoc(spaceA, spaceDoc(a)))).toBe('permission-denied');
      expect(await lockOf(a)).toBe('2026-10-14T10:00:00.000Z');
      // verrouillé : lecture et suppression des enregistrements restent possibles, création/modification non
      expect(await code(f.getDocs(recordsRef(a)))).toBe('ok');
      expect(await code(h.createRecords(a, 1, 'nouveau-'))).toBe('permission-denied');
      expect(await code(f.setDoc(f.doc(a.client.db, 'spaces', h.personalSpace(a.uid), 'records', 'r0'), h.recordDoc(a.uid, { rev: 2 })))).toBe('permission-denied');
      expect(await code(f.deleteDoc(f.doc(a.client.db, 'spaces', h.personalSpace(a.uid), 'records', 'r0')))).toBe('ok');
      // B : intact et toujours modifiable
      expect(await lockOf(b)).toBeNull();
      expect(await code(h.createRecords(b, 1, 'b-nouveau-'))).toBe('ok');
      expect(await h.adminCount(h.personalSpace(b.uid))).toBe(5);
    });

    it('reprise : suppression interrompue APRÈS le verrou → le verrou persiste (écritures refusées), la reprise termine sans le reposer', async () => {
      const user = await account('resume', 130);
      const device2 = await h.secondDevice(user, 'resume-appareil2');
      const interrupted = {
        ...del.defaultOps,
        commitDeletes: async () => {
          throw Object.assign(new Error('coupure'), { code: 'unavailable' });
        },
      };
      const first = await del.deleteAccountCloudData(user.client.db, user.uid, { ops: interrupted, timeoutMs: 5000 });
      expect(first.verified).toBe(false);
      expect(first.error?.code).toBe('unavailable');
      expect(await h.adminExists('spaces', h.personalSpace(user.uid))).toBe(true); // espace non supprimé
      expect(await lockOf(user)).not.toBeNull(); // verrou persistant sur le serveur
      expect(await code(h.createRecords(user, 1, 'pendant-interruption-', device2))).toBe('permission-denied');
      let locks = 0;
      const counting = { ...del.defaultOps, lockSpace: (...args: unknown[]) => (locks += 1, del.defaultOps.lockSpace(...args)) };
      const resumed = await del.deleteAccountCloudData(user.client.db, user.uid, { ops: counting, timeoutMs: 5000 });
      expect(locks).toBe(0);
      expect(resumed.verified).toBe(true);
      expect(await h.adminCount(h.personalSpace(user.uid))).toBe(0);
      expect(await h.adminExists('spaces', h.personalSpace(user.uid))).toBe(false);
    });

    it('fermé par défaut : verrou refusé (règles anciennes) ou non confirmé → RIEN n’est supprimé', async () => {
      const user = await account('lock-fail', 5);
      const denied = { ...del.defaultOps, lockSpace: async () => Promise.reject(Object.assign(new Error('refusé'), { code: 'permission-denied' })) };
      const r1 = await del.deleteAccountCloudData(user.client.db, user.uid, { ops: denied, timeoutMs: 5000 });
      expect(r1.verified).toBe(false);
      expect(r1.error?.code).toBe('permission-denied'); // jamais pris pour une réussite : l'espace existe encore
      const silent = { ...del.defaultOps, lockSpace: async () => undefined }; // « réussit » sans rien écrire
      const r2 = await del.deleteAccountCloudData(user.client.db, user.uid, { ops: silent, timeoutMs: 5000 });
      expect(r2.verified).toBe(false);
      expect(r2.error?.code).toBe('lock-unconfirmed');
      await intact(user, 5);
      expect(await lockOf(user)).toBeNull();
    });

    it('D3 · deux suppressions simultanées : état final propre, résultats cohérents, reprise idempotente', async () => {
      const user = await account('d3', 120);
      const device2 = await h.secondDevice(user, 'd3-appareil2');
      const [r1, r2] = await Promise.all([
        del.deleteAccountCloudData(user.client.db, user.uid, { timeoutMs: 8000 }),
        del.deleteAccountCloudData(device2.db, user.uid, { timeoutMs: 8000 }),
      ]);
      h.observe('D3.reports', [r1, r2].map((r: any) => ({ verified: r.verified, ownership: r.ownership, space: r.space, profile: r.profile, error: r.error?.code ?? null })));
      for (const r of [r1, r2]) expect(r.verified).toBe(true); // avant N1.1 : la seconde échouait en permission-denied alors que tout était supprimé
      for (const r of [r1, r2]) expect(r.ownership).not.toBe('unproven');
      expect(await h.adminCount(h.personalSpace(user.uid))).toBe(0);
      expect(await h.adminExists('spaces', h.personalSpace(user.uid))).toBe(false);
      expect(await h.adminExists('users', user.uid)).toBe(false);
      const again = await del.deleteAccountCloudData(device2.db, user.uid, { timeoutMs: 8000 });
      expect(again.verified).toBe(true);
    });

    it('D3 · espace supprimé par l’autre appareil juste avant notre suppression : « absent » confirmé par le SERVEUR, jamais déduit de permission-denied', async () => {
      const user = await account('d3-absent', 10);
      const device2 = await h.secondDevice(user, 'd3-absent-appareil2');
      let nativeError: string | null = null;
      let serverReads = 0;
      const ops = {
        ...del.defaultOps,
        getDocFromServer: (ref: { path: string }) => (ref.path === spaceOf(user) && (serverReads += 1), del.defaultOps.getDocFromServer(ref)),
        deleteDocument: async (ref: { path: string }) => {
          if (ref.path === spaceOf(user)) {
            const other = await del.deleteAccountCloudData(device2.db, user.uid, { timeoutMs: 8000 }); // l'autre appareil termine d'abord
            expect(other.verified).toBe(true);
            nativeError = await code(del.defaultOps.deleteDocument(ref)); // notre suppression vise un espace déjà absent
          }
          return del.defaultOps.deleteDocument(ref);
        },
      };
      const report = await del.deleteAccountCloudData(user.client.db, user.uid, { ops, timeoutMs: 8000 });
      h.observe('D3.absentSpace', { nativeError, report: { verified: report.verified, ownership: report.ownership, space: report.space, profile: report.profile, error: report.error?.code ?? null } });
      expect(nativeError).toBe('permission-denied'); // le SDK renvoie bien cette erreur…
      expect(report.verified).toBe(true); // …et le résultat n'est « vérifié » que parce qu'une lecture serveur a CONFIRMÉ l'absence
      expect(report.space).toBe('absent');
      expect(report.ownership).toBe('space_absent');
      expect(serverReads).toBeGreaterThanOrEqual(3); // lecture initiale, vérification du verrou, confirmation de l’absence
    });

    it('D3 · si le serveur ne peut pas confirmer l’absence : état incertain, jamais un succès (puis reprise)', async () => {
      const user = await account('d3-incertain', 10);
      const device2 = await h.secondDevice(user, 'd3-incertain-appareil2');
      let armed = false;
      const ops = {
        ...del.defaultOps,
        getDocFromServer: (ref: { path: string }) =>
          armed && ref.path === spaceOf(user) ? Promise.reject(Object.assign(new Error('serveur injoignable'), { code: 'unavailable' })) : del.defaultOps.getDocFromServer(ref),
        deleteDocument: async (ref: { path: string }) => {
          if (ref.path === spaceOf(user)) {
            await del.deleteAccountCloudData(device2.db, user.uid, { timeoutMs: 8000 });
            armed = true; // à partir d'ici, plus aucune lecture serveur de l'espace
          }
          return del.defaultOps.deleteDocument(ref);
        },
      };
      const report = await del.deleteAccountCloudData(user.client.db, user.uid, { ops, timeoutMs: 8000 });
      expect(report.verified).toBe(false);
      expect(report.error?.code).toBe('permission-denied'); // l'erreur d'origine est conservée, pas un succès
      expect(report.space).not.toBe('absent');
      expect(report.space).not.toBe('deleted');
      const again = await del.deleteAccountCloudData(user.client.db, user.uid, { timeoutMs: 8000 }); // reprise avec le serveur joignable
      expect(again.verified).toBe(true);
      expect(again.ownership).toBe('space_absent');
    });

    it('permission-denied alors que l’espace existe encore : jamais un succès', async () => {
      const user = await account('d3-refus', 5);
      const ops = { ...del.defaultOps, deleteDocument: async () => Promise.reject(Object.assign(new Error('refusé'), { code: 'permission-denied' })) };
      const report = await del.deleteAccountCloudData(user.client.db, user.uid, { ops, timeoutMs: 5000 });
      expect(report.verified).toBe(false);
      expect(report.error?.code).toBe('permission-denied');
      expect(await h.adminExists('spaces', h.personalSpace(user.uid))).toBe(true);
    });
  });

  describe('N1.2 · état du verrou lu sur le SERVEUR (message dédié et reprise)', () => {
    const lockState = (user: H.TestUser, options: Record<string, unknown> = {}, db: unknown = user.client.db) => del.readDeletionLockState(db, user.uid, { timeoutMs: 4000, ...options });

    it('non verrouillé → « unlocked » ; verrou posé par une suppression interrompue → « locked » (report.locked) ; après la reprise → « absent »', async () => {
      const user = await account('n12-etat', 130);
      expect(await lockState(user)).toBe('unlocked');
      const interrupted = { ...del.defaultOps, commitDeletes: async () => Promise.reject(Object.assign(new Error('coupure'), { code: 'unavailable' })) };
      const first = await del.deleteAccountCloudData(user.client.db, user.uid, { ops: interrupted, timeoutMs: 5000 });
      expect(first.verified).toBe(false);
      expect(first.locked).toBe(true);
      expect(await lockState(user)).toBe('locked');
      const device2 = await h.secondDevice(user, 'n12-appareil2');
      expect(await lockState(user, {}, device2.db)).toBe('locked'); // un autre appareil du même compte voit le même état
      const resumed = await del.deleteAccountCloudData(user.client.db, user.uid, { timeoutMs: 5000 });
      expect(resumed.verified).toBe(true);
      expect(resumed.locked).toBe(true); // vu sur le serveur lors de la reprise
      expect(await lockState(user)).toBe('absent');
      h.observe('N12.lockStates', 'unlocked → locked → locked(2e appareil) → absent');
    });

    it('un refus d’écriture ordinaire n’est PAS un verrou : refus sur un espace non verrouillé, état serveur « unlocked »', async () => {
      const a = await account('n12-ordinaire-a', 3);
      const b = await account('n12-ordinaire-b', 3);
      // B tente d'écrire dans l'espace de A : refus ordinaire (isolation), alors que l'espace de A n'est pas verrouillé
      await expect(h.createRecords(a, 1, 'intrus-', b.client)).rejects.toMatchObject({ code: 'permission-denied' });
      expect(await lockState(a)).toBe('unlocked');
    });

    it('lecture serveur impossible : « unknown » (jamais « unlocked » ni « locked ») — espace d’un autre compte, réseau coupé', async () => {
      const a = await account('n12-inconnu-a', 3);
      const b = await account('n12-inconnu-b', 3);
      // lecture de l'espace d'un AUTRE compte : refusée par les règles → « unknown »
      expect(await del.readDeletionLockState(a.client.db, b.uid, { timeoutMs: 4000 })).toBe('unknown');
      // verrouiller A, puis couper le réseau de son client : le serveur ne répond pas → « unknown », pas « unlocked »
      const interrupted = { ...del.defaultOps, commitDeletes: async () => Promise.reject(Object.assign(new Error('coupure'), { code: 'unavailable' })) };
      await del.deleteAccountCloudData(a.client.db, a.uid, { ops: interrupted, timeoutMs: 5000 });
      expect(await lockState(a)).toBe('locked');
      await f.disableNetwork(a.client.db);
      try {
        expect(await lockState(a, { timeoutMs: 3000 })).toBe('unknown');
      } finally {
        await settle(a.client.db);
      }
      expect(await lockState(a)).toBe('locked');
      await intact(b, 3); // B n'a pas été touché
    });
  });

  describe('E · isolation entre utilisateurs', () => {
    it('E1+E2 · A ne peut rien faire sur les données de B, un client non connecté non plus ; la suppression de A ne touche pas B', async () => {
      const a = await account('e1-a', 150);
      const b = await account('e1-b', 80);
      const bRecord = f.doc(a.client.db, 'spaces', h.personalSpace(b.uid), 'records', 'r1');
      await expect(f.deleteDoc(bRecord)).rejects.toMatchObject({ code: 'permission-denied' });
      await expect(f.getDocs(f.collection(a.client.db, 'spaces', h.personalSpace(b.uid), 'records'))).rejects.toMatchObject({ code: 'permission-denied' });
      await expect(f.deleteDoc(f.doc(a.client.db, 'spaces', h.personalSpace(b.uid)))).rejects.toMatchObject({ code: 'permission-denied' });
      await expect(f.deleteDoc(f.doc(a.client.db, 'users', b.uid))).rejects.toMatchObject({ code: 'permission-denied' });
      const anonymous = h.newClient('e1-non-connecte');
      await expect(f.deleteDoc(f.doc(anonymous.db, 'spaces', h.personalSpace(b.uid), 'records', 'r1'))).rejects.toMatchObject({ code: 'permission-denied' });
      await expect(f.getDoc(f.doc(anonymous.db, 'users', b.uid))).rejects.toMatchObject({ code: 'permission-denied' });
      // mauvais usage de la fonction : A vise l'identifiant de B → rien n'est supprimé
      const misuse = await del.deleteAccountCloudData(a.client.db, b.uid, { timeoutMs: 5000 });
      expect(misuse.verified).toBe(false);
      expect(misuse.error?.code).toBe('permission-denied');
      await intact(b, 80);
      // suppression complète de A
      const { local } = h.fakeLocal();
      const outcome = await h.runDeletion(a, a.password, local);
      expect(outcome.status).toBe('completed');
      await intact(b, 80);
      // B se connecte et lit toujours ses données
      const probe = h.newClient('e1-b-sonde');
      await a_signIn(probe, b);
      expect((await f.getDocs(f.collection(probe.db, 'spaces', h.personalSpace(b.uid), 'records'))).size).toBe(80);
    });

    it('espace partagé (plusieurs membres) : propriété non démontrée → rien supprimé, compte conservé', async () => {
      const user = await account('e3', 6);
      await h.adminRun((db) => f.setDoc(f.doc(db, 'spaces', h.personalSpace(user.uid)), { ownerUid: user.uid, memberUids: [user.uid, 'autre-personne'], name: 'Espace', createdAt: 'x', schemaVersion: 1 }));
      const { local, released } = h.fakeLocal();
      const outcome = await h.runDeletion(user, user.password, local);
      expect(outcome.status).toBe('ownership_unproven');
      expect(released).toEqual([]);
      expect(await h.adminCount(h.personalSpace(user.uid))).toBe(6);
      expect((await h.accountStatus(user)).exists).toBe(true);
    });
  });

  it('aucune tentative de connexion non locale pendant ces essais', () => {
    expect(guard.getBlockedAttempts()).toEqual([]);
  });

  async function a_signIn(client: H.Client, user: H.TestUser) {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const auth = require('firebase/auth');
    await auth.signInWithEmailAndPassword(client.auth, user.email, user.password);
  }
});
