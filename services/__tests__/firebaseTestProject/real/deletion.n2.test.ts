// N2-5 (interruptions en processus), N2-6 (suppressions simultanées, « espace absent ») et N2-7 (abandon après verrou, reprise)
// contre le projet de TEST réel. NON EXÉCUTÉ tant que N2 n'est pas autorisé. Le processus tué est dans processKill.n2.test.ts.

import type * as H from './harnessReal';

const enabled = !!process.env.TAKARDA_TEST_PROJECT_ID && !!process.env.TAKARDA_CONFIRM_TEST_PROJECT && !!process.env.TAKARDA_TEST_FIREBASE_CONFIG_FILE;
const suite = enabled ? describe : describe.skip;
const SIM_ITERATIONS = Math.min(Math.max(Number(process.env.TAKARDA_N2_SIM_ITERATIONS) || 3, 1), 20);

suite('N2-5 / N2-6 / N2-7 · suppression de compte (projet de test réel)', () => {
  let h: typeof H;
  let f: any;
  let del: any;
  let guard: typeof import('./networkGuardReal');
  const never = () => new Promise<void>(() => undefined);

  beforeAll(() => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    guard = require('./networkGuardReal');
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    h = require('./harnessReal');
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    f = require('firebase/firestore');
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    del = require('../../../firebase/firestoreAccountDeletion');
  });
  afterAll(async () => {
    h.observe('deletion.operationsSpent', h.operationsSpent());
    h.observe('deletion.cleanup', await h.cleanupAll());
  });

  const account = async (label: string, n: number) => {
    const user = await h.makeUser(label);
    await h.seedAccount(user, n);
    return user;
  };
  const code = (promise: Promise<unknown>) => promise.then(() => 'ok', (e: { code?: string }) => e.code ?? 'erreur');
  const settle = async (db: unknown) => {
    await f.enableNetwork(db);
    await f.waitForPendingWrites(db);
  };
  const spaceRefOf = (user: H.TestUser) => `spaces/${h.personalSpace(user.uid)}`;

  it('B3 · 100 enregistrements : suppression complète vérifiée, compte supprimé, compte voisin intact', async () => {
    const user = await account('b3', 100);
    const neighbour = await account('b3v', 7);
    const { local, released } = h.fakeLocal();
    const t0 = Date.now();
    const outcome = await h.runDeletion(user, user.password, local);
    h.observe('B3.100.ms', Date.now() - t0);
    expect(outcome.status).toBe('completed');
    expect(outcome.report).toMatchObject({ verified: true, uncertain: false, space: 'deleted', profile: 'deleted', locked: true });
    expect(outcome.report?.records).toEqual({ found: 100, deleted: 100, remaining: 0 });
    expect(released).toEqual([user.uid]);
    expect((await h.accountStatus(user)).exists).toBe(false);
    expect(await h.ownerCount(neighbour)).toBe(7);
    expect(await h.spaceExists(neighbour)).toBe(true);
  }, 120000);

  it('C1 · lot appliqué mais réponse en erreur : « incomplète », reprise complète', async () => {
    const n = del.DELETE_PAGE_SIZE + 20;
    const user = await account('c1', n);
    let first = true;
    const ops = { ...del.defaultOps, commitDeletes: async (db: unknown, refs: unknown[]) => { await del.defaultOps.commitDeletes(db, refs); if (first) { first = false; throw new Error('réponse perdue'); } } };
    const { local, released } = h.fakeLocal();
    const lost = await h.runDeletion(user, user.password, local, { ops, timeoutMs: 8000 });
    expect(lost.status).toBe('cloud_incomplete');
    expect(released).toEqual([]);
    expect(await h.ownerCount(user)).toBe(20);
    const resumed = await h.runDeletion(user, user.password, local);
    expect(resumed.status).toBe('completed');
    expect(resumed.report?.records).toEqual({ found: 20, deleted: 20, remaining: 0 });
  }, 120000);

  it('C2 · lot appliqué, réponse jamais reçue : « incertain », espace non touché, reprise complète', async () => {
    const user = await account('c2', 30);
    const ops = { ...del.defaultOps, commitDeletes: async (db: unknown, refs: unknown[]) => { await del.defaultOps.commitDeletes(db, refs); await never(); } };
    const { local, released } = h.fakeLocal();
    const stuck = await h.runDeletion(user, user.password, local, { ops, timeoutMs: 8000 });
    expect(stuck.status).toBe('cloud_uncertain');
    expect(released).toEqual([]);
    expect(await h.spaceExists(user)).toBe(true);
    const resumed = await h.runDeletion(user, user.password, local);
    expect(resumed.status).toBe('completed');
  }, 120000);

  it('C3 · réseau coupé en route (comportement réel de waitForPendingWrites) : incertain, 2ᵉ tentative sans nouvelle écriture, reprise complète', async () => {
    const n = del.DELETE_PAGE_SIZE + 50;
    const user = await account('c3', n);
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
    const first = await h.runDeletion(user, user.password, local, { ops: dropAfterFirstPage, timeoutMs: 8000 });
    expect(first.status).toBe('cloud_uncertain');
    expect(commits).toBe(1);
    let commits2 = 0;
    const second = await h.runDeletion(user, user.password, local, { ops: { ...del.defaultOps, commitDeletes: async () => { commits2 += 1; } }, timeoutMs: 8000 });
    expect(second.status).toBe('cloud_uncertain');
    expect(commits2).toBe(0);
    expect(released).toEqual([]);
    await settle(db);
    const third = await h.runDeletion(user, user.password, local);
    h.observe('C3.thirdStatus', third.status);
    expect(third.status).toBe('completed');
  }, 180000);

  it('N2-7 · suppression interrompue APRÈS le verrou : le verrou persiste (écriture d’un 2ᵉ appareil refusée, état « locked » lu sur le serveur), la reprise ne le repose pas et termine', async () => {
    const user = await account('n27', 130);
    const device2 = await h.secondDevice(user, 'n27-appareil2');
    const interrupted = { ...del.defaultOps, commitDeletes: async () => Promise.reject(Object.assign(new Error('coupure'), { code: 'unavailable' })) };
    const first = await del.deleteAccountCloudData(user.client.db, user.uid, { ops: interrupted, timeoutMs: 8000 });
    expect(first.verified).toBe(false);
    expect(first.locked).toBe(true);
    expect(await del.readDeletionLockState(user.client.db, user.uid)).toBe('locked');
    expect(await code(h.createRecords(user, 1, 'pendant-', device2))).toBe('permission-denied');
    let locks = 0;
    const counting = { ...del.defaultOps, lockSpace: (...a: unknown[]) => (locks += 1, del.defaultOps.lockSpace(...a)) };
    const resumed = await del.deleteAccountCloudData(user.client.db, user.uid, { ops: counting, timeoutMs: 20000 });
    expect(locks).toBe(0);
    expect(resumed.verified).toBe(true);
    expect(await del.readDeletionLockState(user.client.db, user.uid)).toBe('absent');
  }, 120000);

  it(`N2-6 · ${SIM_ITERATIONS} suppressions réellement simultanées : les deux vérifiées (ou incertitude explicite), aucun orphelin`, async () => {
    const user = await h.makeUser('n26');
    const device2 = await h.secondDevice(user, 'n26-appareil2');
    const rounds: unknown[] = [];
    for (let i = 0; i < SIM_ITERATIONS; i += 1) {
      await h.seedAccount(user, 120, `s${i}-`);
      const [r1, r2] = await Promise.all([
        del.deleteAccountCloudData(user.client.db, user.uid, { timeoutMs: 20000 }),
        del.deleteAccountCloudData(device2.db, user.uid, { timeoutMs: 20000 }),
      ]);
      rounds.push([r1, r2].map((r: any) => ({ verified: r.verified, uncertain: r.uncertain, ownership: r.ownership, space: r.space, error: r.error?.code ?? null })));
      for (const r of [r1, r2]) {
        expect(r.ownership).not.toBe('unproven');
        // jamais un succès sans confirmation : soit vérifié, soit un état explicitement non vérifié
        if (!r.verified) expect(r.error ?? r.uncertain).toBeTruthy();
      }
      expect([r1, r2].some((r: any) => r.verified)).toBe(true);
      expect(await h.resurrectionCount(user)).toBe(0);
      await h.wipeCloudData(user);
    }
    h.observe('N2-6.rounds', rounds);
  }, SIM_ITERATIONS * 60000 + 60000);

  it('N2-6 · espace supprimé par l’autre appareil juste avant notre suppression : « absent » confirmé par le SERVEUR, jamais déduit de permission-denied', async () => {
    const user = await account('n26-absent', 10);
    const device2 = await h.secondDevice(user, 'n26-absent-appareil2');
    let nativeError: string | null = null;
    const ops = {
      ...del.defaultOps,
      deleteDocument: async (ref: { path: string }) => {
        if (ref.path === spaceRefOf(user)) {
          const other = await del.deleteAccountCloudData(device2.db, user.uid, { timeoutMs: 20000 });
          expect(other.verified).toBe(true);
          nativeError = await code(del.defaultOps.deleteDocument(ref));
        }
        return del.defaultOps.deleteDocument(ref);
      },
    };
    const report = await del.deleteAccountCloudData(user.client.db, user.uid, { ops, timeoutMs: 20000 });
    h.observe('N2-6.absentSpace', { nativeError, verified: report.verified, ownership: report.ownership, space: report.space });
    expect(nativeError).toBe('permission-denied');
    expect(report.verified).toBe(true);
    expect(report.space).toBe('absent');
  }, 120000);

  it('N2-6 · serveur injoignable pour confirmer l’absence : incertain, jamais un succès, puis reprise', async () => {
    const user = await account('n26-incertain', 10);
    const device2 = await h.secondDevice(user, 'n26-incertain-appareil2');
    let armed = false;
    const ops = {
      ...del.defaultOps,
      getDocFromServer: (ref: { path: string }) =>
        armed && ref.path === spaceRefOf(user) ? Promise.reject(Object.assign(new Error('serveur injoignable'), { code: 'unavailable' })) : del.defaultOps.getDocFromServer(ref),
      deleteDocument: async (ref: { path: string }) => {
        if (ref.path === spaceRefOf(user)) {
          await del.deleteAccountCloudData(device2.db, user.uid, { timeoutMs: 20000 });
          armed = true;
        }
        return del.defaultOps.deleteDocument(ref);
      },
    };
    const report = await del.deleteAccountCloudData(user.client.db, user.uid, { ops, timeoutMs: 20000 });
    expect(report.verified).toBe(false);
    expect(report.error?.code).toBe('permission-denied');
    expect(['absent', 'deleted']).not.toContain(report.space);
    const again = await del.deleteAccountCloudData(user.client.db, user.uid, { timeoutMs: 20000 });
    expect(again.verified).toBe(true);
  }, 120000);

  it('aucune tentative réseau bloquée', () => {
    expect(guard.getBlockedAttempts()).toEqual([]);
  });
});
