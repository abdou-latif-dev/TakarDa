// F1 — comptes et authentification (sans réseau, sans Firebase) : messages et mot de passe, état de vérification de l'adresse (refus par défaut), flux du store de compte
// (inscription → e-mail de vérification, renvoi limité, actualisation, session changée en cours de route), activation de la synchronisation refusée tant que
// l'adresse n'est pas vérifiée, et écrans (moteur unique, ancienne synchronisation seulement pour les comptes qui l'utilisent déjà).

import fs from 'fs';
import path from 'path';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { AUTH_MESSAGES, appErrorCode, checkEmailPassword, mapAuthError, passwordProblem } from '../cloudAuthErrors';
import { isEmailVerified, setEmailVerified } from '../accountVerification';
import { setSyncAccount } from '../sync/syncAccount';
import { activateEngine } from '../syncLifecycle';
import { isEngineChosen } from '../syncMode';
import { useCloudStore } from '@/store/cloudStore';

jest.mock('@react-native-async-storage/async-storage', () => jest.requireActual('@react-native-async-storage/async-storage/jest/async-storage-mock'));

type MockUser = { uid: string; email: string | null; emailVerified: boolean };
const mockAuth = {
  listener: null as null | ((u: MockUser | null) => void),
  signUp: jest.fn(async (_e?: string, _p?: string): Promise<MockUser> => ({ uid: 'u1', email: 'a@x.test', emailVerified: false })),
  sendVerification: jest.fn(async () => undefined),
  reload: jest.fn(async (): Promise<MockUser> => ({ uid: 'u1', email: 'a@x.test', emailVerified: true })),
};
jest.mock('@/services/firebase/firebaseAuthService', () => ({
  CloudAuthError: class extends Error {},
  watchCloudUser: (cb: (u: MockUser | null) => void) => {
    mockAuth.listener = cb;
    return () => undefined;
  },
  signInWithEmail: async () => undefined,
  signUpWithEmail: (e: string, p: string) => mockAuth.signUp(e, p),
  signOutCloud: async () => undefined,
  sendResetEmail: async () => undefined,
  sendVerificationEmail: () => mockAuth.sendVerification(),
  reloadCurrentUser: () => mockAuth.reload(),
}));
jest.mock('@/services/firebase/accountDeletionApi', () => ({
  firebaseAccountDeletionApi: { reauthenticate: async () => undefined, deleteCloudData: async () => ({}), deleteAuthAccount: async () => undefined },
  readDeletionLock: async () => 'unknown',
}));
jest.mock('@/services/firebase/firestoreRecordsApi', () => ({
  firestoreRecordsApi: { ensureSpace: async (uid: string) => `personal_${uid}`, fetchRecords: async () => [], writeRecord: async () => 1, markDeleted: async () => 1 },
}));

const root = path.join(__dirname, '..', '..');
const read = (rel: string) => fs.readFileSync(path.join(root, rel), 'utf8');
const store = () => useCloudStore.getState();
const settle = () => new Promise((resolve) => setTimeout(resolve, 40));
const signIn = async (user: MockUser) => {
  mockAuth.listener?.(user);
  await settle();
};
const signOut = async () => {
  mockAuth.listener?.(null);
  await settle();
};
const unverified: MockUser = { uid: 'u1', email: 'a@x.test', emailVerified: false };

beforeEach(async () => {
  await AsyncStorage.clear();
  jest.clearAllMocks();
  mockAuth.signUp.mockImplementation(async () => unverified);
  mockAuth.sendVerification.mockImplementation(async () => undefined);
  mockAuth.reload.mockImplementation(async () => ({ ...unverified, emailVerified: true }));
  store().init();
  await signOut();
  setEmailVerified(null, false);
});
afterEach(() => jest.restoreAllMocks());

describe('Messages et mot de passe', () => {
  it('aucun message destiné à l’utilisateur ne parle de console, de Firebase ni de réglage technique', () => {
    for (const [code, message] of Object.entries(AUTH_MESSAGES)) {
      expect([code, /console|firebase|méthode de connexion|projet/i.test(message)]).toEqual([code, false]);
    }
  });

  it('codes Firebase « à rallonge », erreurs de configuration et d’environnement : messages clairs, jamais le message technique', () => {
    expect(mapAuthError({ code: 'auth/api-key-not-valid.-please-pass-a-valid-api-key.' })).toMatch(/pas disponible dans cette version/);
    expect(mapAuthError({ code: 'auth/quota-exceeded' })).toMatch(/sollicité/);
    const config = new Error('Configuration Firebase invalide : apiKey est vide. Renseignez les variables EXPO_PUBLIC_FIREBASE_* (voir .env.example).');
    expect(appErrorCode(config)).toBe('app/cloud-not-configured');
    expect(mapAuthError(config)).toMatch(/pas configuré/);
    expect(mapAuthError(config)).not.toMatch(/EXPO_PUBLIC|apiKey/);
    expect(mapAuthError(new Error('Environnement Firebase refusé : …'))).toMatch(/pas disponible dans cette version/);
    expect(mapAuthError(new Error('autre'))).toBe('Une erreur est survenue. Réessayez.');
  });

  it('politique d’inscription : 8 caractères, une lettre, un chiffre, différent de l’adresse e-mail', () => {
    // trop court, sans chiffre, sans lettre : refusés avec le message de politique
    for (const bad of ['', 'a1', 'abcdefg', '12345678', 'abcdefgh', '1234567']) expect([bad, passwordProblem(bad)]).toEqual([bad, expect.stringMatching(/au moins 8 caractères/)]);
    expect(passwordProblem('abcdefg1')).toBeNull(); // exactement 8 caractères, une lettre, un chiffre
  });

  it('cas limites de la politique et des vérifications locales', () => {
    expect(passwordProblem('motdepasse1')).toBeNull();
    expect(passwordProblem('1234567a')).toBeNull();
    expect(passwordProblem('éééééééé1')).toBeNull(); // lettres accentuées admises
    expect(passwordProblem('jean.dupont1@x.test', 'jean.dupont1@x.test')).toMatch(/adresse e-mail/);
    expect(passwordProblem('Jean.Dupont1@X.test', ' jean.dupont1@x.test ')).toMatch(/adresse e-mail/);
    expect(checkEmailPassword('a@x.test', 'court1', { confirm: 'court1' }).ok).toBe(false);
    expect(checkEmailPassword('a@x.test', 'motdepasse1', { confirm: 'autre' }).message).toMatch(/pas identiques/);
    expect(checkEmailPassword('a@x.test', 'motdepasse1', { confirm: 'motdepasse1' }).ok).toBe(true);
    // la CONNEXION n'impose aucune politique : un ancien mot de passe de 6 caractères reste utilisable
    expect(checkEmailPassword('a@x.test', 'ancien').ok).toBe(true);
  });
});

describe('État de vérification de l’adresse (refus par défaut)', () => {
  it('sans information : non vérifié ; seul le compte indiqué compte ; la déconnexion remet à zéro', () => {
    expect(isEmailVerified('u1')).toBe(false);
    setEmailVerified('u1', true);
    expect(isEmailVerified('u1')).toBe(true);
    expect(isEmailVerified('u2')).toBe(false);
    setEmailVerified('u2', false);
    expect(isEmailVerified('u1')).toBe(false);
    setEmailVerified('u1', true);
    setEmailVerified(null, true);
    expect(isEmailVerified('u1')).toBe(false);
  });

  it('le store suit la session : non vérifiée à la connexion, vérifiée si le serveur le dit, effacée à la déconnexion', async () => {
    await signIn(unverified);
    expect(isEmailVerified('u1')).toBe(false);
    expect(store().user?.emailVerified).toBe(false);
    await signIn({ ...unverified, emailVerified: true });
    expect(isEmailVerified('u1')).toBe(true);
    await signOut();
    expect(isEmailVerified('u1')).toBe(false);
  });
});

describe('Inscription et e-mail de vérification', () => {
  it('inscription réussie : e-mail de vérification demandé, message affiché, aucun échec', async () => {
    await store().signUp('a@x.test', 'motdepasse1');
    expect(mockAuth.sendVerification).toHaveBeenCalledTimes(1);
    expect(store().verificationMessage).toMatch(/e-mail de vérification vient de vous être envoyé/);
    expect(store().error).toBeNull();
    expect(store().busy).toBe(false);
  });

  it('l’échec d’envoi n’annule JAMAIS l’inscription : message explicite, « Renvoyer l’e-mail » proposé, aucune exception', async () => {
    mockAuth.sendVerification.mockRejectedValue(new Error('Trop de tentatives.'));
    await expect(store().signUp('a@x.test', 'motdepasse1')).resolves.toBeUndefined();
    expect(mockAuth.signUp).toHaveBeenCalledTimes(1);
    expect(store().verificationMessage).toMatch(/n’a pas pu être envoyé.*Renvoyer l’e-mail/);
    expect(store().error).toBeNull();
  });

  it('échec de l’inscription elle-même : erreur affichée, AUCUN e-mail de vérification demandé', async () => {
    mockAuth.signUp.mockRejectedValue(new Error('Un compte existe déjà avec cette adresse. Connectez-vous plutôt.'));
    await expect(store().signUp('a@x.test', 'motdepasse1')).rejects.toThrow(/existe déjà/);
    expect(mockAuth.sendVerification).not.toHaveBeenCalled();
    expect(store().error).toMatch(/existe déjà/);
  });

  it('renvoi : refusé dans la minute qui suit un envoi (sans appel), accepté ensuite ; jamais pour une adresse déjà vérifiée', async () => {
    const now = jest.spyOn(Date, 'now');
    now.mockReturnValue(1_000_000);
    await store().signUp('a@x.test', 'motdepasse1');
    await signIn(unverified);
    mockAuth.sendVerification.mockClear();
    now.mockReturnValue(1_030_000); // 30 s plus tard
    await store().resendVerification();
    expect(mockAuth.sendVerification).not.toHaveBeenCalled();
    expect(store().verificationMessage).toBe(AUTH_MESSAGES['app/verification-too-soon']);
    now.mockReturnValue(1_061_000); // plus d'une minute
    await store().resendVerification();
    expect(mockAuth.sendVerification).toHaveBeenCalledTimes(1);
    expect(store().verificationMessage).toMatch(/renvoyé/);
    await signIn({ ...unverified, emailVerified: true });
    mockAuth.sendVerification.mockClear();
    now.mockReturnValue(9_000_000);
    await store().resendVerification();
    expect(mockAuth.sendVerification).not.toHaveBeenCalled();
  });

  it('actualisation : adresse vérifiée → état, message et statut mis à jour ; pas encore vérifiée → message d’attente', async () => {
    await signIn(unverified);
    mockAuth.reload.mockResolvedValueOnce(unverified);
    await store().refreshVerification();
    expect(store().user?.emailVerified).toBe(false);
    expect(isEmailVerified('u1')).toBe(false);
    expect(store().verificationMessage).toMatch(/pas encore vérifiée/);
    await store().refreshVerification();
    expect(store().user?.emailVerified).toBe(true);
    expect(isEmailVerified('u1')).toBe(true);
    expect(store().verificationMessage).toBeNull();
    expect(store().notice).toBe('Adresse e-mail vérifiée.');
  });

  it('actualisation en échec (réseau) : erreur affichée, rien n’est considéré comme vérifié', async () => {
    await signIn(unverified);
    mockAuth.reload.mockRejectedValue(new Error('Pas de connexion Internet. Réessayez quand vous êtes en ligne.'));
    await store().refreshVerification();
    expect(store().error).toMatch(/Internet/);
    expect(isEmailVerified('u1')).toBe(false);
    expect(store().busy).toBe(false);
  });

  it('session changée pendant l’actualisation : le résultat de l’ancien compte est ÉCARTÉ', async () => {
    await signIn(unverified);
    let release: (u: MockUser) => void = () => undefined;
    mockAuth.reload.mockImplementationOnce(() => new Promise<MockUser>((resolve) => (release = resolve)));
    const pending = store().refreshVerification();
    await signIn({ uid: 'u2', email: 'b@x.test', emailVerified: false }); // autre compte pendant l'attente
    release({ uid: 'u1', email: 'a@x.test', emailVerified: true });
    await pending;
    expect(store().user?.uid).toBe('u2');
    expect(store().user?.emailVerified).toBe(false);
    expect(isEmailVerified('u1')).toBe(false);
    expect(isEmailVerified('u2')).toBe(false);
  });

  it('la déconnexion efface le message de vérification', async () => {
    await store().signUp('a@x.test', 'motdepasse1');
    expect(store().verificationMessage).not.toBeNull();
    await signOut();
    expect(store().verificationMessage).toBeNull();
  });
});

describe('Activation de la synchronisation', () => {
  it('REFUSÉE tant que l’adresse n’est pas vérifiée : rien n’est posé ni activé', async () => {
    setSyncAccount('u1');
    const result = await activateEngine('u1', () => true);
    expect(result).toEqual({ ok: false, message: AUTH_MESSAGES['app/email-not-verified'] });
    expect(await isEngineChosen('u1')).toBe(false);
    setSyncAccount(null);
  });

  it('aucune information de vérification (état inconnu) : refusée de la même façon', async () => {
    setSyncAccount('u1');
    setEmailVerified(null, true);
    expect((await activateEngine('u1', () => true)).ok).toBe(false);
    setEmailVerified('u2', true); // l'adresse vérifiée d'un AUTRE compte ne vaut rien
    expect((await activateEngine('u1', () => true)).ok).toBe(false);
    setSyncAccount(null);
  });
});

describe('Écrans', () => {
  it('compte : carte de vérification, moteur désactivé tant que l’adresse n’est pas vérifiée, ancienne synchronisation seulement pour un compte qui l’utilise déjà', () => {
    const screen = read('features/profile/screens/CloudAccountScreen.tsx');
    expect(screen).toContain('Vérifiez votre adresse e-mail');
    expect(screen).toContain('s.refreshVerification()');
    expect(screen).toContain('s.resendVerification()');
    expect(screen).toMatch(/disabled=\{!engine \|\| !s\.user\.emailVerified\}/);
    expect(screen).toMatch(/\{s\.syncEnabled \? \(\s*<Card className="gap-3">\s*<SectionTitleText className="text-base">Biens et logements \(ancienne synchronisation\)/);
    expect(screen).not.toMatch(/label="Activer la synchronisation"/); // le bouton de l'ancienne synchronisation n'est plus proposé à un nouveau compte
    expect(screen).toContain('Les tontines, formulaires et factures CEET/TDE ne sont pas synchronisés.');
  });

  it('inscription : politique du mot de passe annoncée, e-mail de vérification annoncé ; réinitialisation : formulation neutre', () => {
    const signUp = read('features/auth/screens/SignUpScreen.tsx');
    expect(signUp).toContain('8 caractères minimum, avec une lettre et un chiffre');
    expect(signUp).toContain('Un e-mail de vérification vous sera envoyé');
    expect(signUp).not.toMatch(/6 caractères/);
    const forgot = read('features/auth/screens/ForgotPasswordScreen.tsx');
    expect(forgot).toContain('Si un compte existe avec cette adresse');
    expect(forgot).not.toContain('Firebase vous envoie');
  });

  it('le drapeau cloud reste fermé', () => {
    expect(read('constants/features.ts')).toMatch(/CLOUD_ACCOUNT_ENABLED: boolean = cloudEnabledFor\(BUILD_TARGET\);/);
  });
});
