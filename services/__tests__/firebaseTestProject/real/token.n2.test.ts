// N2-4 — ancien jeton après suppression du compte (constat A6) contre le projet de TEST réel. NON EXÉCUTÉ tant que N2 n'est pas
// autorisé. Un second appareil garde son jeton ; après la suppression du compte il tente de recréer le profil, l'espace et un
// enregistrement à des instants croissants. Calendrier (minutes) : TAKARDA_N2_TOKEN_SCHEDULE, par défaut « 0,5 » ; la mesure
// complète est « 0,5,30,60,90 » (≈ 1 h 30). Toute écriture ACCEPTÉE est consignée puis supprimée au mieux ; les restes
// éventuels sont listés (identifiant du compte) pour une purge manuelle dans la console du projet de TEST uniquement.

import type * as H from './harnessReal';

const enabled = !!process.env.TAKARDA_TEST_PROJECT_ID && !!process.env.TAKARDA_CONFIRM_TEST_PROJECT && !!process.env.TAKARDA_TEST_FIREBASE_CONFIG_FILE;
const suite = enabled ? describe : describe.skip;
const SCHEDULE = (process.env.TAKARDA_N2_TOKEN_SCHEDULE ?? '0,5')
  .split(',')
  .map((s) => Number(s.trim()))
  .filter((n) => Number.isFinite(n) && n >= 0 && n <= 120)
  .sort((x, y) => x - y);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
// TAKARDA_N2_MODULES_RULES=1 : le candidat P5 (marqueur « compte supprimé » compris) est publié sur le projet de TEST. La suppression est alors celle de l'APPLICATION (composition réelle, marqueur posé AVANT
// toute suppression) et le test EXIGE que l'ancien jeton ne recrée plus rien. Sans cette variable : mesure seule, comme avant (aucune assertion).
const PROTECTED = process.env.TAKARDA_N2_MODULES_RULES === '1';

suite('N2-4 · ancien jeton après suppression du compte (projet de test réel)', () => {
  let h: typeof H;
  let f: any;
  let guard: typeof import('./networkGuardReal');
  let composition: typeof import('../../../firebase/cloudDeletionComposition');
  let deletion: typeof import('../../../accountDeletionService');

  beforeAll(() => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    guard = require('./networkGuardReal');
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    h = require('./harnessReal');
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    f = require('firebase/firestore');
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    composition = require('../../../firebase/cloudDeletionComposition');
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    deletion = require('../../../accountDeletionService');
  });
  afterAll(async () => {
    h.observe('token.cleanup', await h.cleanupAll());
  });

  const code = (promise: Promise<unknown>) => promise.then(() => 'acceptée', (e: { code?: string }) => `refusée:${e.code ?? 'erreur'}`);

  it(`A6 · calendrier ${SCHEDULE.join(', ')} min : le second appareil peut-il encore écrire avec son ancien jeton ?`, async () => {
    const user = await h.makeUser('n24');
    const device2 = await h.secondDevice(user, 'n24-appareil2');
    await h.seedAccount(user, 3);
    const { local } = h.fakeLocal();
    const base = h.apiFor(user);
    // protégé : la suppression de l'application (marqueur, espaces partagés, synchronisation, reste) ; sinon : la suppression historique mesurée jusqu'ici
    const api = PROTECTED ? { ...base, deleteCloudData: composition.createCloudDeletion(user.client.db, { deletion: { timeoutMs: 20000 } }) } : base;
    const outcome = await deletion.deleteAccount(api, user.uid, user.password, local);
    expect(outcome.status).toBe('completed'); // compte et données supprimés
    if (PROTECTED) expect(outcome.report?.tombstone).toBe('created');
    const deletedAt = Date.now();
    const leftovers: string[] = [];
    const results: Record<string, string | number>[] = [];
    for (const minutes of SCHEDULE) {
      const wait = deletedAt + minutes * 60 * 1000 - Date.now();
      if (wait > 0) await sleep(wait);
      const row: Record<string, string | number> = { minutes, elapsedMin: Math.round((Date.now() - deletedAt) / 600) / 100 };
      // le SDK peut avoir fermé lui-même la session du second appareil à la suppression du compte : à consigner, jamais à supposer
      row.sessionBefore = device2.auth.currentUser ? 'présente' : 'perdue';
      // écritures avec le jeton déjà détenu (le SDK le rafraîchit seul s'il est expiré : l'échec éventuel est alors consigné)
      row.profile = await code(f.setDoc(f.doc(device2.db, 'users', user.uid), { defaultSpaceId: h.personalSpace(user.uid), createdAt: 'x' }));
      row.space = await code(f.setDoc(f.doc(device2.db, 'spaces', h.personalSpace(user.uid)), h.spaceDoc(user.uid)));
      row.record = await code(h.createRecords(user, 1, `zombie${minutes}-`, device2));
      const current = device2.auth.currentUser;
      row.refresh = current ? await current.getIdToken(true).then(() => 'accepté', (e: { code?: string }) => `refusé:${e.code ?? 'erreur'}`) : 'aucune session (utilisateur nul)';
      results.push(row);
      if ([row.profile, row.space, row.record].includes('acceptée')) {
        // restes à retirer au mieux, avec le même jeton, avant la mesure suivante
        for (const ref of [
          f.doc(device2.db, 'spaces', h.personalSpace(user.uid), 'records', `zombie${minutes}-0`),
          f.doc(device2.db, 'spaces', h.personalSpace(user.uid)),
          f.doc(device2.db, 'users', user.uid),
        ]) {
          const outcomeDelete = await code(f.deleteDoc(ref));
          if (outcomeDelete !== 'acceptée') leftovers.push(`${ref.path} (${outcomeDelete})`);
        }
      }
    }
    h.observe('N2-4.results', results);
    h.observe('N2-4.leftoversToPurgeInTestProject', { uid: user.uid, leftovers });
    const zombie = results.some((r) => [r.profile, r.space, r.record].includes('acceptée'));
    h.observe('N2-4.zombieWritesAccepted', zombie);
    h.observe('N2-4.protected', PROTECTED);
    // Sans protection publiée : pas d'assertion (la mesure est le résultat). Avec le candidat P5 publié : AUCUNE écriture ne doit être acceptée, à aucun instant.
    if (PROTECTED) expect(zombie).toBe(false);
  }, (SCHEDULE[SCHEDULE.length - 1] ?? 0) * 60 * 1000 + 300000);

  it('aucune tentative réseau bloquée', () => {
    expect(guard.getBlockedAttempts()).toEqual([]);
  });
});
