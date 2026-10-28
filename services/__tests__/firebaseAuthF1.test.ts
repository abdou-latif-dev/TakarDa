// F1 — service d'authentification avec le SDK REMPLACÉ (aucun réseau, aucun compte, aucun Firebase) : vérification d'adresse, rechargement du compte, réinitialisation
// sans fuite d'existence de compte, erreurs mappées, et garde d'environnement avant toute initialisation.

import fs from 'fs';
import path from 'path';
import { CloudAuthError, reloadCurrentUser, sendResetEmail, sendVerificationEmail, signUpWithEmail, watchCloudUser } from '../firebase/firebaseAuthService';
import { PRODUCTION_PROJECT_ID, TEST_PROJECT_ID, assertFirebaseEnvironment, environmentProblems } from '../firebase/firebaseEnvironment';
import { PRODUCTION_PROJECT_IDS, TEST_PROJECT_ID as REAL_TEST_PROJECT_ID } from './firebaseTestProject/real/guardsReal';

const mockSdk = {
  createUserWithEmailAndPassword: jest.fn(),
  signInWithEmailAndPassword: jest.fn(),
  sendPasswordResetEmail: jest.fn(),
  sendEmailVerification: jest.fn(),
  reload: jest.fn(),
  signOut: jest.fn(),
  deleteUser: jest.fn(),
  reauthenticateWithCredential: jest.fn(),
  onAuthStateChanged: jest.fn(),
};
const mockAuthObject: { currentUser: null | { uid: string; email: string | null; emailVerified?: boolean; getIdToken: jest.Mock } } = { currentUser: null };

jest.mock('firebase/auth', () => ({
  createUserWithEmailAndPassword: (...a: unknown[]) => mockSdk.createUserWithEmailAndPassword(...a),
  signInWithEmailAndPassword: (...a: unknown[]) => mockSdk.signInWithEmailAndPassword(...a),
  sendPasswordResetEmail: (...a: unknown[]) => mockSdk.sendPasswordResetEmail(...a),
  sendEmailVerification: (...a: unknown[]) => mockSdk.sendEmailVerification(...a),
  reload: (...a: unknown[]) => mockSdk.reload(...a),
  signOut: (...a: unknown[]) => mockSdk.signOut(...a),
  deleteUser: (...a: unknown[]) => mockSdk.deleteUser(...a),
  reauthenticateWithCredential: (...a: unknown[]) => mockSdk.reauthenticateWithCredential(...a),
  onAuthStateChanged: (...a: unknown[]) => mockSdk.onAuthStateChanged(...a),
  EmailAuthProvider: { credential: () => ({}) },
}));
jest.mock('../firebase/firebaseClient', () => ({ getFirebaseAuth: () => mockAuthObject }));

const root = path.join(__dirname, '..', '..');
const read = (rel: string) => fs.readFileSync(path.join(root, rel), 'utf8');

beforeEach(() => {
  for (const fn of Object.values(mockSdk)) fn.mockReset();
  mockAuthObject.currentUser = null;
});

describe('Utilisateur retourné', () => {
  it('l’adresse n’est JAMAIS supposée vérifiée : absente ou fausse = non vérifiée', async () => {
    mockSdk.createUserWithEmailAndPassword.mockResolvedValue({ user: { uid: 'u1', email: 'a@x.test' } });
    expect(await signUpWithEmail('a@x.test', 'motdepasse1')).toEqual({ uid: 'u1', email: 'a@x.test', emailVerified: false });
    mockSdk.createUserWithEmailAndPassword.mockResolvedValue({ user: { uid: 'u2', email: 'b@x.test', emailVerified: false } });
    expect((await signUpWithEmail('b@x.test', 'motdepasse1')).emailVerified).toBe(false);
    mockSdk.createUserWithEmailAndPassword.mockResolvedValue({ user: { uid: 'u3', email: 'c@x.test', emailVerified: true } });
    expect((await signUpWithEmail('c@x.test', 'motdepasse1')).emailVerified).toBe(true);
  });

  it('la session restaurée transmet l’état de vérification', () => {
    const callback = jest.fn();
    mockSdk.onAuthStateChanged.mockImplementation((_auth, cb) => {
      cb({ uid: 'u1', email: 'a@x.test', emailVerified: true });
      cb(null);
      return () => undefined;
    });
    watchCloudUser(callback);
    expect(callback.mock.calls).toEqual([[{ uid: 'u1', email: 'a@x.test', emailVerified: true }], [null]]);
  });
});

describe('E-mail de vérification', () => {
  it('envoyé au compte connecté ; sans session : erreur claire sans appel au SDK', async () => {
    await expect(sendVerificationEmail()).rejects.toMatchObject({ code: 'app/no-session', message: expect.stringMatching(/Aucune session/) });
    expect(mockSdk.sendEmailVerification).not.toHaveBeenCalled();
    mockAuthObject.currentUser = { uid: 'u1', email: 'a@x.test', getIdToken: jest.fn() };
    mockSdk.sendEmailVerification.mockResolvedValue(undefined);
    await sendVerificationEmail();
    expect(mockSdk.sendEmailVerification).toHaveBeenCalledWith(mockAuthObject.currentUser);
  });

  it('une erreur du SDK est traduite en français (trop de demandes, réseau)', async () => {
    mockAuthObject.currentUser = { uid: 'u1', email: 'a@x.test', getIdToken: jest.fn() };
    mockSdk.sendEmailVerification.mockRejectedValue({ code: 'auth/too-many-requests' });
    await expect(sendVerificationEmail()).rejects.toThrow(/Trop de tentatives/);
    mockSdk.sendEmailVerification.mockRejectedValue({ code: 'auth/network-request-failed' });
    await expect(sendVerificationEmail()).rejects.toBeInstanceOf(CloudAuthError);
  });

  it('rechargement : relit le compte puis RENOUVELLE le jeton (les règles verront l’état à jour) ; l’état retourné est celui du serveur', async () => {
    const getIdToken = jest.fn().mockResolvedValue('jeton');
    const user = { uid: 'u1', email: 'a@x.test', emailVerified: false, getIdToken };
    mockAuthObject.currentUser = user;
    mockSdk.reload.mockImplementation(async () => {
      user.emailVerified = true; // l'adresse a été vérifiée entre-temps
    });
    expect(await reloadCurrentUser()).toEqual({ uid: 'u1', email: 'a@x.test', emailVerified: true });
    expect(mockSdk.reload).toHaveBeenCalledWith(user);
    expect(getIdToken).toHaveBeenCalledWith(true);
  });

  it('rechargement impossible : erreur claire, le jeton n’est pas renouvelé ; sans session : refus', async () => {
    await expect(reloadCurrentUser()).rejects.toMatchObject({ code: 'app/no-session' });
    const getIdToken = jest.fn();
    mockAuthObject.currentUser = { uid: 'u1', email: 'a@x.test', getIdToken };
    mockSdk.reload.mockRejectedValue({ code: 'auth/network-request-failed' });
    await expect(reloadCurrentUser()).rejects.toThrow(/Internet/);
    expect(getIdToken).not.toHaveBeenCalled();
  });
});

describe('Réinitialisation du mot de passe : aucune fuite d’existence de compte', () => {
  it('adresse inconnue : même résultat qu’un compte existant (aucune erreur)', async () => {
    mockSdk.sendPasswordResetEmail.mockRejectedValue({ code: 'auth/user-not-found' });
    await expect(sendResetEmail(' inconnu@x.test ')).resolves.toBeUndefined();
    expect(mockSdk.sendPasswordResetEmail.mock.calls[0][1]).toBe('inconnu@x.test');
  });

  it('les VRAIES erreurs restent signalées : adresse invalide, réseau, quota', async () => {
    for (const [code, message] of [['auth/invalid-email', /pas valide/], ['auth/network-request-failed', /Internet/], ['auth/too-many-requests', /Trop de tentatives/]] as const) {
      mockSdk.sendPasswordResetEmail.mockRejectedValue({ code });
      await expect(sendResetEmail('a@x.test')).rejects.toThrow(message);
    }
  });
});

describe('Garde d’environnement Firebase (version publiée ↔ production, développement ↔ test)', () => {
  it('les identifiants du garde sont identiques à ceux des garde-fous N2', () => {
    expect([PRODUCTION_PROJECT_ID]).toEqual(PRODUCTION_PROJECT_IDS);
    expect(TEST_PROJECT_ID).toBe(REAL_TEST_PROJECT_ID);
  });

  it('version PUBLIÉE : production seule ; le projet de test est refusé', () => {
    expect(environmentProblems(PRODUCTION_PROJECT_ID, { isDev: false })).toEqual([]);
    expect(environmentProblems(TEST_PROJECT_ID, { isDev: false }).join(' ')).toMatch(/version publiée.*TEST/);
    // l'autorisation « production en développement » ne change rien pour une version publiée
    expect(environmentProblems(TEST_PROJECT_ID, { isDev: false, allowProductionInDev: true })).toHaveLength(1);
  });

  it('version de DÉVELOPPEMENT : projet de test seul ; la production exige une autorisation explicite', () => {
    expect(environmentProblems(TEST_PROJECT_ID, { isDev: true })).toEqual([]);
    expect(environmentProblems(PRODUCTION_PROJECT_ID, { isDev: true }).join(' ')).toMatch(/PRODUCTION sans autorisation/);
    expect(environmentProblems(PRODUCTION_PROJECT_ID, { isDev: true, allowProductionInDev: false })).toHaveLength(1);
    expect(environmentProblems(PRODUCTION_PROJECT_ID, { isDev: true, allowProductionInDev: true })).toEqual([]);
  });

  it('projet inconnu ou vide : refusé dans tous les modes', () => {
    for (const isDev of [true, false]) {
      for (const id of ['autre-projet', '', 'takarda-c8cd8x', 'TAKARDA-C8CD8']) {
        expect([isDev, id, environmentProblems(id, { isDev, allowProductionInDev: true }).length > 0]).toEqual([isDev, id, true]);
      }
    }
  });

  it('l’erreur est explicite, ne contient que des noms de projets publics et est reconnue par le mappage des messages', () => {
    expect(() => assertFirebaseEnvironment(TEST_PROJECT_ID, { isDev: false })).toThrow(/^Environnement Firebase refusé/);
    let error: unknown;
    try {
      assertFirebaseEnvironment('autre-projet', { isDev: false });
    } catch (e) {
      error = e;
    }
    expect(new CloudAuthError(error).code).toBe('app/environment-refused');
    expect(new CloudAuthError(error).message).toMatch(/pas disponible dans cette version/);
  });

  it('le client Firebase applique le garde APRÈS la validation de la configuration et AVANT l’initialisation', () => {
    const client = read('services/firebase/firebaseClient.ts');
    const validate = client.indexOf('assertFirebaseWebConfig(firebaseWebConfig)');
    const guard = client.indexOf('assertFirebaseEnvironment(config.projectId');
    const init = client.indexOf('initializeApp(config)');
    expect(validate).toBeGreaterThan(-1);
    expect(guard).toBeGreaterThan(validate);
    expect(init).toBeGreaterThan(guard);
    expect(client).toContain('isDev: __DEV__');
    expect(client).toContain("process.env.EXPO_PUBLIC_ALLOW_PRODUCTION_IN_DEV === 'true'");
  });
});
