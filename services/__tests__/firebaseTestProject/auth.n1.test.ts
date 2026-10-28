// N1 — Authentication contre l'ÉMULATEUR local (projet fictif demo-takarda). Les codes d'erreur et comportements observés ici sont
// ceux de l'ÉMULATEUR : ils ne prouvent pas ceux du service réel (voir docs/validation-firebase-test-RESULTATS.md).

import type * as H from './harness';

const enabled = !!process.env.FIREBASE_AUTH_EMULATOR_HOST && !!process.env.FIRESTORE_EMULATOR_HOST;
const suite = enabled ? describe : describe.skip;
const GENERIC = 'Une erreur est survenue. Réessayez.';

suite('N1 · Authentication (émulateur)', () => {
  let h: typeof H;
  let f: any;
  let a: any;
  let errors: { mapAuthError: (e: unknown) => string; authErrorCode: (e: unknown) => string | null };
  let guard: typeof import('./networkGuard');

  beforeAll(() => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    guard = require('./networkGuard');
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    h = require('./harness');
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    f = require('firebase/firestore');
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    a = require('firebase/auth');
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    errors = require('../../cloudAuthErrors');
  });
  beforeEach(async () => {
    await h.clearEmulators();
  });
  afterAll(async () => {
    await h.disposeClients();
    await h.disposeAdmin();
  });

  const caught = async (promise: Promise<unknown>): Promise<any> => {
    try {
      await promise;
    } catch (error) {
      return error;
    }
    throw new Error('une erreur était attendue');
  };

  it('A1 · réauthentification avec le bon mot de passe : aboutit', async () => {
    const user = await h.makeUser('a1');
    await expect(h.apiFor(user).reauthenticate(user.password)).resolves.toBeUndefined();
  });

  it('A2 · mauvais mot de passe : erreur d’identifiants gérée, message français, et AUCUNE suppression ensuite', async () => {
    const user = await h.makeUser('a2');
    await h.seedAccount(user, 5);
    const error = await caught(h.apiFor(user).reauthenticate('mauvais-mot-de-passe'));
    h.observe('A2.code', error.code);
    expect(['auth/invalid-credential', 'auth/wrong-password']).toContain(error.code);
    expect(errors.mapAuthError(error)).not.toBe(GENERIC);
    expect(errors.mapAuthError(error)).toMatch(/incorrect/i);
    // de bout en bout : la suppression ne démarre pas
    const { local, released } = h.fakeLocal();
    const outcome = await h.runDeletion(user, 'mauvais-mot-de-passe', local);
    expect(outcome.status).toBe('reauth_required');
    expect(outcome.message).toMatch(/Rien n’a été supprimé/);
    expect(released).toEqual([]);
    expect(await h.adminCount(h.personalSpace(user.uid))).toBe(5);
    expect((await h.accountStatus(user)).exists).toBe(true);
  });

  it('A3 · identifiants d’un AUTRE compte lors de la réauthentification : refusé', async () => {
    const owner = await h.makeUser('a3-a');
    const other = await h.makeUser('a3-b');
    const error = await caught(a.reauthenticateWithCredential(owner.client.auth.currentUser, a.EmailAuthProvider.credential(other.email, other.password)));
    h.observe('A3.code', error.code);
    expect(['auth/user-mismatch', 'auth/invalid-credential']).toContain(error.code);
    expect(errors.mapAuthError(error)).not.toBe(GENERIC);
    expect((await h.accountStatus(owner)).exists).toBe(true);
    expect((await h.accountStatus(other)).exists).toBe(true);
  });

  it('A5 · suppression du compte : confirmée par l’échec d’une nouvelle connexion', async () => {
    const user = await h.makeUser('a5');
    await h.apiFor(user).deleteAuthAccount();
    const status = await h.accountStatus(user);
    h.observe('A5.signInAfterDelete', status);
    expect(status.exists).toBe(false);
    expect(['auth/invalid-credential', 'auth/user-not-found']).toContain(status.code);
    expect(user.client.auth.currentUser).toBeNull();
  });

  it('A5b · délai client dépassé pendant la suppression du compte : « non confirmé » alors que l’opération a pu être appliquée', async () => {
    const user = await h.makeUser('a5b');
    await h.seedAccount(user, 3);
    const { local } = h.fakeLocal();
    // délai de 1 ms pour la suppression du compte : le client cesse d'attendre, l'opération abandonnée continue
    const outcome = await h.runDeletion(user, user.password, local, {}, { reauthMs: 20000, cloudMs: 60000, authMs: 1 });
    h.observe('A5b.status', outcome.status);
    expect(outcome.status).toBe('account_uncertain');
    expect(outcome.authDeleted).toBe(false);
    expect(outcome.message).toMatch(/n’a pas été confirmée/);
    expect(outcome.message).not.toMatch(/^Compte supprimé/);
    // réalité côté émulateur : le compte a-t-il malgré tout été supprimé ?
    let deleted = false;
    for (let i = 0; i < 20 && !deleted; i += 1) {
      deleted = !(await h.accountStatus(user)).exists;
      if (!deleted) await new Promise((r) => setTimeout(r, 250));
    }
    h.observe('A5b.accountActuallyDeleted', deleted);
    expect(deleted).toBe(true); // l'opération abandonnée a abouti : exactement ce que « incertain » doit couvrir
  });

  it('A6 · après suppression, un SECOND appareil : jeton rafraîchi, puis écriture avec l’ancien jeton (caractérisation de l’émulateur)', async () => {
    const user = await h.makeUser('a6');
    const device2 = await h.secondDevice(user, 'a6-appareil2');
    await h.apiFor(user).deleteAuthAccount();
    const refresh = await caught(device2.auth.currentUser!.getIdToken(true));
    h.observe('A6.refreshCode', refresh.code);
    expect(typeof refresh.code).toBe('string'); // le rafraîchissement est refusé : le compte n'existe plus
    // écriture Firestore avec le jeton déjà émis (non rafraîchi)
    let write: string;
    try {
      await f.setDoc(f.doc(device2.db, 'users', user.uid), { defaultSpaceId: `personal_${user.uid}`, createdAt: 'x' });
      write = 'acceptée';
    } catch (error) {
      write = `refusée:${(error as { code?: string }).code}`;
    }
    h.observe('A6.zombieWriteWithOldToken', write);
    expect(write).toMatch(/^(acceptée|refusée:)/); // observation : voir le rapport (le service réel peut différer)
  });

  it('A7 · jeton réel de l’émulateur : fournisseur « password » et règles satisfaites de bout en bout', async () => {
    const user = await h.makeUser('a7');
    const claims = h.claimsOf(await user.client.auth.currentUser!.getIdToken());
    h.observe('A7.firebaseClaim', claims.firebase);
    expect(claims.firebase.sign_in_provider).toBe('password');
    await h.seedAccount(user, 3); // créations réelles sous les règles, avec le jeton d'Authentication
    expect(await h.adminCount(h.personalSpace(user.uid))).toBe(3);
    const mine = await f.getDocs(f.collection(user.client.db, 'spaces', h.personalSpace(user.uid), 'records'));
    expect(mine.size).toBe(3);
  });

  it('A8 · connexion anonyme : jeton « anonymous », toutes les opérations refusées par les règles', async () => {
    const client = h.newClient('a8');
    const credential = await h.signInAnonymouslyOn(client);
    const claims = h.claimsOf(await credential.user.getIdToken());
    h.observe('A8.provider', claims.firebase.sign_in_provider);
    expect(claims.firebase.sign_in_provider).toBe('anonymous');
    const space = `personal_${credential.user.uid}`;
    await expect(f.setDoc(f.doc(client.db, 'spaces', space), { ownerUid: credential.user.uid, memberUids: [credential.user.uid], name: 'x', createdAt: 'x', schemaVersion: 1 })).rejects.toMatchObject({ code: 'permission-denied' });
    await expect(f.setDoc(f.doc(client.db, 'users', credential.user.uid), { defaultSpaceId: space, createdAt: 'x' })).rejects.toMatchObject({ code: 'permission-denied' });
    await expect(f.getDoc(f.doc(client.db, 'users', credential.user.uid))).rejects.toMatchObject({ code: 'permission-denied' });
  });

  it('aucune tentative de connexion non locale pendant ces essais', () => {
    expect(guard.getBlockedAttempts()).toEqual([]);
  });
});
