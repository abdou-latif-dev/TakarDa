// N2-3 — écritures concurrentes pendant la suppression (sérialisation réelle du verrou) contre le projet de TEST réel.
// NON EXÉCUTÉ tant que N2 n'est pas autorisé. Un seul compte et un seul second appareil servent à toutes les itérations
// (plafond de comptes jetables) : l'espace est recréé puis nettoyé à chaque tour.
// Critère d'acceptation : 0 orphelin dans TOUTES les itérations (détecté par recréation de l'espace, sans accès administrateur).

import type * as H from './harnessReal';

const enabled = !!process.env.TAKARDA_TEST_PROJECT_ID && !!process.env.TAKARDA_CONFIRM_TEST_PROJECT && !!process.env.TAKARDA_TEST_FIREBASE_CONFIG_FILE;
const suite = enabled ? describe : describe.skip;
const ITERATIONS = Math.min(Math.max(Number(process.env.TAKARDA_N2_ITERATIONS) || 10, 1), 200);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

suite('N2-3 · écritures concurrentes avec le verrou (projet de test réel)', () => {
  let h: typeof H;
  let f: any;
  let guard: typeof import('./networkGuardReal');

  beforeAll(() => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    guard = require('./networkGuardReal');
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    h = require('./harnessReal');
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    f = require('firebase/firestore');
  });
  afterAll(async () => {
    h.observe('concurrency.operationsSpent', h.operationsSpent());
    h.observe('concurrency.cleanup', await h.cleanupAll());
  });

  const code = (e: unknown) => (e as { code?: string }).code ?? 'erreur';

  it(`N2-3 · ${ITERATIONS} itérations : un second appareil écrit en continu pendant la suppression ; après chaque suppression vérifiée, l'espace recréé est VIDE`, async () => {
    const user = await h.makeUser('n23');
    const device2 = await h.secondDevice(user, 'n23-appareil2');
    const rounds: { accepted: number; denied: number; other: number; orphans: number; verified: boolean }[] = [];
    for (let i = 0; i < ITERATIONS; i += 1) {
      await h.seedAccount(user, 10, `s${i}-`);
      const stats = { accepted: 0, denied: 0, other: 0 };
      let stop = false;
      const writer = (async () => {
        let k = 0;
        while (!stop) {
          try {
            await h.createRecords(user, 1, `w${i}-${k}-`, device2);
            stats.accepted += 1;
          } catch (error) {
            if (code(error) === 'permission-denied') stats.denied += 1;
            else stats.other += 1;
          }
          k += 1;
          await sleep(40); // quotas : un rythme modéré, pas une rafale
        }
      })();
      await sleep(150); // laisser l'écrivain démarrer avant la suppression
      const report = await h.wipeCloudData(user);
      stop = true;
      await writer;
      const orphans = await h.resurrectionCount(user); // recrée l'espace : un orphelin éventuel réapparaît
      await h.wipeCloudData(user); // nettoyage de l'espace recréé (le compte reste actif)
      rounds.push({ ...stats, orphans, verified: report.verified });
      expect(report.verified).toBe(true);
      expect(orphans).toBe(0);
    }
    h.observe('N2-3.rounds', rounds);
    h.observe('N2-3.totals', {
      iterations: ITERATIONS,
      accepted: rounds.reduce((s, r) => s + r.accepted, 0),
      denied: rounds.reduce((s, r) => s + r.denied, 0),
      other: rounds.reduce((s, r) => s + r.other, 0),
      orphans: rounds.reduce((s, r) => s + r.orphans, 0),
    });
  }, ITERATIONS * 30000 + 60000);

  it('N2-3 · écritures mises en file HORS LIGNE par un autre appareil : refusées à son retour en ligne, aucun orphelin', async () => {
    const user = await h.makeUser('n23-hors-ligne');
    const device2 = await h.secondDevice(user, 'n23-hors-ligne-appareil2');
    await h.seedAccount(user, 5);
    await f.disableNetwork(device2.db);
    const queued = h.createRecords(user, 3, 'en-file-', device2).then(() => 'acceptée', (e: unknown) => `refusée:${code(e)}`);
    const report = await h.wipeCloudData(user);
    expect(report.verified).toBe(true);
    await f.enableNetwork(device2.db);
    const outcome = await Promise.race([queued, sleep(30000).then(() => 'sans réponse')]);
    h.observe('N2-3.queuedOffline', outcome);
    expect(outcome).not.toBe('acceptée');
    expect(await h.resurrectionCount(user)).toBe(0);
    await h.wipeCloudData(user);
  }, 120000);

  it('aucune tentative réseau bloquée', () => {
    expect(guard.getBlockedAttempts()).toEqual([]);
  });
});
