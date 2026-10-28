// N2-0 — contrôle préalable contre le projet de TEST « takarda-n2-test » (réel). NON EXÉCUTÉ tant que N2 n'est pas autorisé.
// Ignoré sans variables d'environnement : la suite habituelle ne contacte jamais Firebase.

import type * as H from './harnessReal';

const enabled = !!process.env.TAKARDA_TEST_PROJECT_ID && !!process.env.TAKARDA_CONFIRM_TEST_PROJECT && !!process.env.TAKARDA_TEST_FIREBASE_CONFIG_FILE;
const suite = enabled ? describe : describe.skip;

suite('N2-0 · contrôle préalable (projet de test réel)', () => {
  let h: typeof H;
  let f: any;
  let guard: typeof import('./networkGuardReal');
  let guards: typeof import('./guardsReal');

  beforeAll(() => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    guards = require('./guardsReal');
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    guard = require('./networkGuardReal');
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    h = require('./harnessReal'); // échoue (RealGuardError) si l'environnement n'est pas exactement celui du projet de test
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    f = require('firebase/firestore');
  });
  afterAll(async () => {
    const report = await h.cleanupAll();
    h.observe('N2-0.cleanup', report);
  });

  it('l’environnement est celui du projet de test, la configuration est cohérente et distincte de la production', () => {
    expect(h.N2.projectId).toBe(guards.TEST_PROJECT_ID);
    expect(h.N2.config.projectId).toBe('takarda-n2-test');
    expect(h.N2.config.messagingSenderId).toBe(guards.TEST_PROJECT_NUMBER);
    h.observe('N2-0.projectId', h.N2.projectId);
  });

  it('le garde réseau bloque une destination non autorisée AVANT l’envoi (adresse inatteignable par construction)', async () => {
    await expect(fetch('http://192.0.2.1/')).rejects.toThrow(/RÉSEAU BLOQUÉ/);
    await expect(fetch('https://example.invalid/')).rejects.toThrow(/RÉSEAU BLOQUÉ/);
    expect(guard.getBlockedAttempts().length).toBe(2);
    guard.resetBlockedAttempts(); // tentatives provoquées volontairement par ce test
  });

  it('un compte jetable : jeton émis par le projet de test (audience, émetteur, fournisseur « password » réel : A7)', async () => {
    const user = await h.makeUser('n20-compte'); // makeUser vérifie l'audience et l'émetteur et s'arrête sinon
    const claims = h.claimsOf(await user.client.auth.currentUser!.getIdToken());
    h.observe('N2-0.token', { aud: claims.aud, iss: claims.iss, provider: (claims.firebase as { sign_in_provider?: string }).sign_in_provider });
    expect(claims.aud).toBe('takarda-n2-test');
    expect(claims.iss).toBe('https://securetoken.google.com/takarda-n2-test');
    expect((claims.firebase as { sign_in_provider?: string }).sign_in_provider).toBe('password');
  });

  it('règles de N1.1 publiées sur le projet de test : le verrou est posable et bloque les créations (empreinte comportementale)', async () => {
    const user = await h.makeUser('n20-regles');
    await h.seedAccount(user, 1);
    const spaceRef = f.doc(user.client.db, 'spaces', h.personalSpace(user.uid));
    await f.updateDoc(spaceRef, { deletionLockedAt: new Date().toISOString() }); // refusé si les règles publiées n'ont pas le verrou
    await expect(h.createRecords(user, 1, 'apres-verrou-')).rejects.toMatchObject({ code: 'permission-denied' });
    const report = await h.wipeCloudData(user);
    expect(report.verified).toBe(true);
  });

  it('aucune tentative bloquée pendant ce contrôle ; destinations réellement contactées consignées', () => {
    h.observe('N2-0.destinations', guard.getAllowedDestinations());
    expect(guard.getBlockedAttempts()).toEqual([]);
  });
});
