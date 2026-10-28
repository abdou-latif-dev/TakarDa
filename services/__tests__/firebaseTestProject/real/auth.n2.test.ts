// N2-8 — Authentication réelle (projet de TEST) : codes d'erreur, réponse perdue, connexion ancienne. NON EXÉCUTÉ tant que N2 n'est
// pas autorisé. Pas de test d'e-mail de réinitialisation (A9) : il enverrait un vrai e-mail ; à décider séparément avec une boîte de test.

import type * as H from './harnessReal';

const enabled = !!process.env.TAKARDA_TEST_PROJECT_ID && !!process.env.TAKARDA_CONFIRM_TEST_PROJECT && !!process.env.TAKARDA_TEST_FIREBASE_CONFIG_FILE;
const suite = enabled ? describe : describe.skip;
/** A4 (connexion ancienne) : minutes d'attente avant deleteUser ; absent = scénario ignoré. */
const RECENT_LOGIN_WAIT_MINUTES = Number(process.env.TAKARDA_N2_WAIT_RECENT_LOGIN) || 0;

suite('N2-8 · Authentication réelle (projet de test)', () => {
  let h: typeof H;
  let a: any;
  let errors: { mapAuthError: (e: unknown) => string };
  let guard: typeof import('./networkGuardReal');

  beforeAll(() => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    guard = require('./networkGuardReal');
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    h = require('./harnessReal');
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    a = require('firebase/auth');
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    errors = require('../../../cloudAuthErrors');
  });
  afterAll(async () => {
    h.observe('auth.cleanup', await h.cleanupAll());
  });

  const caught = async (promise: Promise<unknown>): Promise<any> => {
    try {
      await promise;
    } catch (error) {
      return error;
    }
    throw new Error('une erreur était attendue');
  };

  it('A2 · mauvais mot de passe : code RÉEL consigné (dépend de la protection contre l’énumération), message français, rien supprimé', async () => {
    const user = await h.makeUser('n28-a2');
    await h.seedAccount(user, 3);
    const error = await caught(h.apiFor(user).reauthenticate('mauvais-mot-de-passe'));
    h.observe('A2.code', error.code);
    expect(['auth/invalid-credential', 'auth/wrong-password']).toContain(error.code);
    expect(errors.mapAuthError(error)).toMatch(/incorrect/i);
    const { local, released } = h.fakeLocal();
    const outcome = await h.runDeletion(user, 'mauvais-mot-de-passe', local);
    expect(outcome.status).toBe('reauth_required');
    expect(released).toEqual([]);
    expect(await h.ownerCount(user)).toBe(3);
  });

  it('A3 · identifiants d’un autre compte : refusé, les deux comptes intacts', async () => {
    const owner = await h.makeUser('n28-a3-a');
    const other = await h.makeUser('n28-a3-b');
    const error = await caught(a.reauthenticateWithCredential(owner.client.auth.currentUser, a.EmailAuthProvider.credential(other.email, other.password)));
    h.observe('A3.code', error.code);
    expect(['auth/user-mismatch', 'auth/invalid-credential']).toContain(error.code);
    expect((await h.accountStatus(owner)).exists).toBe(true);
    expect((await h.accountStatus(other)).exists).toBe(true);
  });

  it('A5b · délai client dépassé pendant deleteUser : « non confirmé » alors que le compte a pu être supprimé (consigner le délai réel)', async () => {
    const user = await h.makeUser('n28-a5b');
    await h.seedAccount(user, 3);
    const { local } = h.fakeLocal();
    const outcome = await h.runDeletion(user, user.password, local, {}, { reauthMs: 20000, cloudMs: 60000, authMs: 1 });
    expect(outcome.status).toBe('account_uncertain');
    expect(outcome.message).not.toMatch(/^Compte supprimé/);
    let deleted = false;
    let waitedMs = 0;
    for (let i = 0; i < 40 && !deleted; i += 1) {
      deleted = !(await h.accountStatus(user)).exists;
      if (!deleted) { await new Promise((r) => setTimeout(r, 500)); waitedMs += 500; }
    }
    h.observe('A5b.accountActuallyDeleted', { deleted, waitedMs });
  }, 120000);

  (RECENT_LOGIN_WAIT_MINUTES > 0 ? it : it.skip)(`A4 · deleteUser après ${RECENT_LOGIN_WAIT_MINUTES} min sans réauthentification : auth/requires-recent-login ? (puis réussite après réauthentification)`, async () => {
    const user = await h.makeUser('n28-a4');
    await new Promise((r) => setTimeout(r, RECENT_LOGIN_WAIT_MINUTES * 60 * 1000));
    const error = await caught(h.apiFor(user).deleteAuthAccount()).catch((e) => ({ code: `inattendu:${String(e)}` }));
    h.observe('A4.codeAfterWait', { minutes: RECENT_LOGIN_WAIT_MINUTES, code: error.code });
    await h.apiFor(user).reauthenticate(user.password);
    await h.apiFor(user).deleteAuthAccount();
    expect((await h.accountStatus(user)).exists).toBe(false);
  }, RECENT_LOGIN_WAIT_MINUTES * 60 * 1000 + 120000);

  it('aucune tentative réseau bloquée', () => {
    expect(guard.getBlockedAttempts()).toEqual([]);
  });
});
