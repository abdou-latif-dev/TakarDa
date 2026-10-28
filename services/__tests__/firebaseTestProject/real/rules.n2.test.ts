// N2-1 (verrou et règles) et N2-2 (limite de lot, coût des règles) contre le projet de TEST réel. NON EXÉCUTÉ tant que N2 n'est
// pas autorisé. Aucun accès administrateur : tout passe par des comptes jetables et les vraies règles.

import type * as H from './harnessReal';

const enabled = !!process.env.TAKARDA_TEST_PROJECT_ID && !!process.env.TAKARDA_CONFIRM_TEST_PROJECT && !!process.env.TAKARDA_TEST_FIREBASE_CONFIG_FILE;
const suite = enabled ? describe : describe.skip;

suite('N2-1 / N2-2 · règles (projet de test réel)', () => {
  let h: typeof H;
  let f: any;
  let del: any;
  let guard: typeof import('./networkGuardReal');

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
    h.observe('rules.cleanup', await h.cleanupAll());
  });

  const code = (promise: Promise<unknown>) => promise.then(() => 'ok', (e: { code?: string }) => e.code ?? 'erreur');
  const lockOf = async (user: H.TestUser) => (await f.getDocFromServer(f.doc(user.client.db, 'spaces', h.personalSpace(user.uid)))).data()?.deletionLockedAt ?? null;

  it('N2-1 · verrou : propriétaire seul, irréversible, renommage permis ; verrouillé : lecture et suppression permises, création et modification refusées ; un autre compte reste isolé', async () => {
    const a = await h.makeUser('n21-a');
    const b = await h.makeUser('n21-b');
    await h.seedAccount(a, 4);
    await h.seedAccount(b, 4);
    const spaceA = f.doc(a.client.db, 'spaces', h.personalSpace(a.uid));
    expect(await code(f.updateDoc(f.doc(b.client.db, 'spaces', h.personalSpace(a.uid)), { deletionLockedAt: 'x' }))).toBe('permission-denied');
    expect(await lockOf(a)).toBeNull();
    expect(await code(f.updateDoc(spaceA, { name: 'Renommé' }))).toBe('ok');
    expect(await code(f.setDoc(f.doc(a.client.db, 'spaces', h.personalSpace(a.uid), 'records', 'r1'), h.recordDoc(a.uid, { rev: 2 })))).toBe('ok'); // témoin avant verrou
    expect(await code(f.updateDoc(spaceA, { deletionLockedAt: 'x', name: 'Mélange' }))).toBe('permission-denied');
    expect(await code(f.updateDoc(spaceA, { deletionLockedAt: '' }))).toBe('permission-denied');
    expect(await code(f.updateDoc(spaceA, { deletionLockedAt: 'a'.repeat(41) }))).toBe('permission-denied');
    expect(await code(f.updateDoc(spaceA, { deletionLockedAt: '2026-10-16T10:00:00.000Z' }))).toBe('ok');
    expect(await lockOf(a)).toBe('2026-10-16T10:00:00.000Z');
    expect(await code(f.updateDoc(spaceA, { name: 'Renommé encore' }))).toBe('ok');
    expect(await code(f.updateDoc(spaceA, { deletionLockedAt: f.deleteField() }))).toBe('permission-denied');
    expect(await code(f.updateDoc(spaceA, { deletionLockedAt: 'autre' }))).toBe('permission-denied');
    expect(await code(f.setDoc(spaceA, h.spaceDoc(a.uid)))).toBe('permission-denied');
    expect(await code(f.getDocs(f.collection(a.client.db, 'spaces', h.personalSpace(a.uid), 'records')))).toBe('ok');
    expect(await code(h.createRecords(a, 1, 'nouveau-'))).toBe('permission-denied');
    expect(await code(f.setDoc(f.doc(a.client.db, 'spaces', h.personalSpace(a.uid), 'records', 'r0'), h.recordDoc(a.uid, { rev: 2 })))).toBe('permission-denied');
    expect(await code(f.deleteDoc(f.doc(a.client.db, 'spaces', h.personalSpace(a.uid), 'records', 'r0')))).toBe('ok');
    // isolation : B n'est ni verrouillé ni touché
    expect(await lockOf(b)).toBeNull();
    expect(await code(h.createRecords(b, 1, 'b-nouveau-'))).toBe('ok');
    expect(await h.ownerCount(b)).toBe(5);
    await expect(f.getDocs(f.collection(a.client.db, 'spaces', h.personalSpace(b.uid), 'records'))).rejects.toMatchObject({ code: 'permission-denied' });
    await expect(f.deleteDoc(f.doc(a.client.db, 'spaces', h.personalSpace(b.uid)))).rejects.toMatchObject({ code: 'permission-denied' });
  });

  it('N2-2 · création de 20 enregistrements en un lot (coût du verrou dans les règles) puis courbe de taille de lot de suppression, arrêt au premier échec', async () => {
    const user = await h.makeUser('n22');
    await h.seedAccount(user, 0);
    const created = await code(h.createRecords(user, 20, 'lot20-'));
    h.observe('N2-2.create20', created);
    expect(created).toBe('ok'); // la règle de création appelle get() sur l'espace : doit rester sous la limite d'accès
    const sizes = [1, 20, 50, 100, 200, 500];
    const results: Record<string, string> = {};
    let largestPassing = 0;
    for (const n of sizes) {
      const ids = await h.createRecords(user, n, `c${n}-`);
      const refs = ids.map((id) => f.doc(user.client.db, 'spaces', h.personalSpace(user.uid), 'records', id));
      const started = Date.now();
      try {
        await del.defaultOps.commitDeletes(user.client.db, refs);
        results[String(n)] = `ok ${Date.now() - started} ms`;
        largestPassing = n;
      } catch (error) {
        results[String(n)] = `échec:${(error as { code?: string }).code}`;
        break;
      }
    }
    h.observe('N2-2.curve', results);
    h.observe('N2-2.largestPassingBatch', largestPassing);
    expect(largestPassing).toBeGreaterThanOrEqual(del.DELETE_PAGE_SIZE); // un échec ici est un CONSTAT : la taille de page de production doit baisser
    const report = await h.wipeCloudData(user);
    expect(report.verified).toBe(true);
  });

  it('aucune tentative réseau bloquée', () => {
    expect(guard.getBlockedAttempts()).toEqual([]);
  });
});
