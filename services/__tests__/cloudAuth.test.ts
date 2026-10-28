// Compte cloud (Firebase Authentication) : messages, vérifications locales, store, aucune migration par la connexion.

import fs from 'fs';
import path from 'path';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { AUTH_MESSAGES, checkEmailPassword, mapAuthError } from '../cloudAuthErrors';
import { useCloudStore } from '@/store/cloudStore';
import { loadSyncState } from '../cloudSyncService';
import { records } from '../db';
import { getActiveCloudUid } from '../cloudVisibility';

jest.mock('@react-native-async-storage/async-storage', () => jest.requireActual('@react-native-async-storage/async-storage/jest/async-storage-mock'));

// SDK Firebase remplacé : aucun réseau, aucun compte réel.
const mockAuth = {
  listener: null as null | ((u: { uid: string; email: string | null } | null) => void),
  signIn: jest.fn(async (email: string, _password?: string) => ({ uid: 'uid-1', email })),
  signUp: jest.fn(async (email: string, _password?: string) => ({ uid: 'uid-2', email })),
  signOut: jest.fn(async () => undefined),
  reset: jest.fn(async (_email?: string) => undefined),
};
const mockApi = { ensureSpace: jest.fn(async (uid: string) => `personal_${uid}`), fetchRecords: jest.fn(async () => []), writeRecord: jest.fn(async () => 1), markDeleted: jest.fn(async () => 1) };

jest.mock('@/services/firebase/firebaseAuthService', () => ({
  CloudAuthError: class extends Error {},
  watchCloudUser: (cb: (u: { uid: string; email: string | null } | null) => void) => {
    mockAuth.listener = cb;
    return () => undefined;
  },
  signInWithEmail: (...a: [string, string]) => mockAuth.signIn(...a),
  signUpWithEmail: (...a: [string, string]) => mockAuth.signUp(...a),
  signOutCloud: () => mockAuth.signOut(),
  sendResetEmail: (e: string) => mockAuth.reset(e),
}));
// Suppression de compte : faux (aucun SDK, aucun réseau).
const verifiedReport = (found = 2) => ({
  ownership: 'proven' as const,
  records: { found, deleted: found, remaining: 0 },
  space: 'deleted' as const,
  profile: 'deleted' as const,
  verified: true,
  uncertain: false,
  error: null,
});
const mockDeletion = {
  reauthenticate: jest.fn(async (_password?: string) => undefined),
  deleteCloudData: jest.fn(async (_uid?: string): Promise<unknown> => verifiedReport()),
  deleteAuthAccount: jest.fn(async () => undefined),
};
jest.mock('@/services/firebase/accountDeletionApi', () => ({
  firebaseAccountDeletionApi: {
    reauthenticate: (p: string) => mockDeletion.reauthenticate(p),
    deleteCloudData: (u: string) => mockDeletion.deleteCloudData(u),
    deleteAuthAccount: () => mockDeletion.deleteAuthAccount(),
  },
}));
jest.mock('@/services/firebase/firestoreRecordsApi', () => ({
  firestoreRecordsApi: {
    ensureSpace: (uid: string) => mockApi.ensureSpace(uid),
    fetchRecords: () => mockApi.fetchRecords(),
    writeRecord: () => mockApi.writeRecord(),
    markDeleted: () => mockApi.markDeleted(),
  },
}));


const root = path.join(__dirname, '..', '..');
const read = (rel: string) => fs.readFileSync(path.join(root, rel), 'utf8');

describe('Messages et vérifications', () => {
  it('chaque erreur courante a un message français clair ; une erreur inconnue reste générique', () => {
    expect(mapAuthError({ code: 'auth/invalid-credential' })).toBe(AUTH_MESSAGES['auth/invalid-credential']);
    expect(mapAuthError({ code: 'auth/email-already-in-use' })).toMatch(/existe déjà/);
    expect(mapAuthError({ code: 'auth/network-request-failed' })).toMatch(/Internet/);
    expect(mapAuthError({ code: 'auth/operation-not-allowed' })).toMatch(/momentanément indisponible/); // F1 : aucun message utilisateur ne renvoie à la console Firebase
    expect(mapAuthError({ code: 'auth/inconnu' })).toBe('Une erreur est survenue. Réessayez.');
    expect(mapAuthError(new Error('x'))).toBe('Une erreur est survenue. Réessayez.');
  });

  it('vérifie l’e-mail et le mot de passe avant tout appel', () => {
    expect(checkEmailPassword('', 'x').ok).toBe(false);
    expect(checkEmailPassword('pas-un-email', 'x').message).toMatch(/pas valide/);
    expect(checkEmailPassword('a@b.co', '').ok).toBe(false);
    expect(checkEmailPassword('a@b.co', 'secret').ok).toBe(true);
    // politique d'inscription (F1) : 8 caractères minimum, une lettre et un chiffre
    expect(checkEmailPassword('a@b.co', '12345', { confirm: '12345' }).message).toMatch(/8 caractères/);
    expect(checkEmailPassword('a@b.co', 'secret12', { confirm: 'autre' }).message).toMatch(/pas identiques/);
    expect(checkEmailPassword(' a@b.co ', 'secret12', { confirm: 'secret12' }).ok).toBe(true);
  });
});

describe('Store du compte cloud', () => {
  beforeEach(async () => {
    await AsyncStorage.clear();
    jest.clearAllMocks();
  });

  it('au démarrage la session est restaurée par l’écouteur ; sans compte, l’application reste utilisable', () => {
    useCloudStore.getState().init();
    expect(useCloudStore.getState().authStatus).toBe('initializing');
    mockAuth.listener?.(null);
    expect(useCloudStore.getState().authStatus).toBe('signedOut');
  });

  it('se connecter ne synchronise rien et ne migre rien : aucun état de synchronisation, aucun appel au cloud de données', async () => {
    await useCloudStore.getState().signIn('a@b.co', 'secret1');
    mockAuth.listener?.({ uid: 'uid-1', email: 'a@b.co' });
    await new Promise((r) => setTimeout(r, 0));
    const s = useCloudStore.getState();
    expect(s.authStatus).toBe('signedIn');
    expect(s.syncEnabled).toBe(false);
    expect(await loadSyncState('uid-1')).toBeNull();
    expect(mockApi.ensureSpace).not.toHaveBeenCalled();
    expect(mockApi.writeRecord).not.toHaveBeenCalled();
    expect(mockApi.fetchRecords).not.toHaveBeenCalled();
    await useCloudStore.getState().syncIfEnabled(); // sans activation : ne fait rien
    expect(mockApi.fetchRecords).not.toHaveBeenCalled();
  });

  it('l’activation est un geste explicite ; elle crée l’espace personnel mais n’envoie aucune donnée existante', async () => {
    mockAuth.listener?.({ uid: 'uid-1', email: 'a@b.co' });
    await new Promise((r) => setTimeout(r, 0));
    await useCloudStore.getState().enableSync();
    expect(mockApi.ensureSpace).toHaveBeenCalledWith('uid-1');
    expect(mockApi.writeRecord).not.toHaveBeenCalled();
    const state = await loadSyncState('uid-1');
    expect(state).toMatchObject({ spaceId: 'personal_uid-1', entries: {} });
    expect(useCloudStore.getState().syncEnabled).toBe(true);
  });

  it('une erreur de connexion est affichée, remonte à l’appelant, et ne laisse pas l’écran en chargement', async () => {
    mockAuth.signIn.mockRejectedValueOnce(Object.assign(new Error('E-mail ou mot de passe incorrect.'), { code: 'auth/invalid-credential' }));
    await expect(useCloudStore.getState().signIn('a@b.co', 'faux')).rejects.toThrow(/incorrect/);
    expect(useCloudStore.getState().error).toMatch(/incorrect/);
    expect(useCloudStore.getState().busy).toBe(false);
  });

  it('se déconnecter retire la session mais ne touche à aucune donnée locale', async () => {
    await AsyncStorage.setItem('@formease/db_snapshot', '{"users":[]}');
    await useCloudStore.getState().signOut();
    expect(mockAuth.signOut).toHaveBeenCalled();
    expect(await AsyncStorage.getItem('@formease/db_snapshot')).toBe('{"users":[]}');
    mockAuth.listener?.(null);
    await new Promise((r) => setTimeout(r, 20)); // l'écouteur marque d'abord les données du compte sortant
    expect(useCloudStore.getState().authStatus).toBe('signedOut');
    expect(useCloudStore.getState().syncEnabled).toBe(false);
  });
});

describe('Changement de compte : époque et résultats d’un ancien compte', () => {
  const tick = () => new Promise((r) => setTimeout(r, 30));

  it('accountEpoch change à chaque changement de compte, pas quand le même compte est notifié de nouveau', async () => {
    await AsyncStorage.clear();
    useCloudStore.getState().init();
    mockAuth.listener?.({ uid: 'uid-1', email: 'a@b.co' });
    await tick();
    const e1 = useCloudStore.getState().accountEpoch;
    mockAuth.listener?.({ uid: 'uid-1', email: 'a@b.co' });
    await tick();
    expect(useCloudStore.getState().accountEpoch).toBe(e1);
    mockAuth.listener?.({ uid: 'uid-2', email: 'c@d.co' });
    await tick();
    expect(useCloudStore.getState().accountEpoch).toBe(e1 + 1);
    mockAuth.listener?.(null);
    await tick();
    expect(useCloudStore.getState().accountEpoch).toBe(e1 + 2);
  });

  it('le résultat d’une synchronisation lancée sous le compte A n’est jamais montré au compte B', async () => {
    await AsyncStorage.clear();
    mockAuth.listener?.({ uid: 'uid-1', email: 'a@b.co' });
    await tick();
    await useCloudStore.getState().enableSync();
    let release: (v: never[]) => void = () => undefined;
    const gate = new Promise<never[]>((resolve) => { release = resolve; });
    mockApi.fetchRecords.mockReturnValueOnce(gate as never);
    const pending = useCloudStore.getState().syncNow();
    await tick();
    mockAuth.listener?.({ uid: 'uid-2', email: 'c@d.co' }); // B se connecte pendant la synchronisation de A
    await tick();
    release([]);
    await pending;
    const s = useCloudStore.getState();
    expect(s.user?.uid).toBe('uid-2');
    expect(s.syncEnabled).toBe(false); // l'état de A n'est pas celui de B
    expect(s.syncMessage).toBeNull();
    expect(s.lastSyncAt).toBeNull();
    expect(s.syncing).toBe(false);
  });
});

describe('Défaut 4 — les messages de la session ne survivent pas à la déconnexion', () => {
  const tick = () => new Promise((r) => setTimeout(r, 30));
  const connecteAvecSynchro = async () => {
    mockAuth.listener?.({ uid: 'uid-1', email: 'a@b.co' });
    await tick();
    await useCloudStore.getState().enableSync();
    expect(useCloudStore.getState().notice).toMatch(/Synchronisation activée/);
  };
  beforeEach(async () => {
    await AsyncStorage.clear();
    jest.clearAllMocks();
    mockAuth.listener?.(null);
    await tick();
    useCloudStore.getState().clearMessages();
  });

  it('après une déconnexion confirmée, « Synchronisation activée… » disparaît ; les données locales restent', async () => {
    await connecteAvecSynchro();
    await AsyncStorage.setItem('@formease/db_snapshot', '{"users":[]}');
    await useCloudStore.getState().signOut();
    expect(mockAuth.signOut).toHaveBeenCalledTimes(1);
    expect(useCloudStore.getState().notice).toBeNull();
    expect(useCloudStore.getState().syncMessage).toBeNull();
    expect(useCloudStore.getState().error).toBeNull();
    mockAuth.listener?.(null); // l'écouteur confirme la déconnexion
    await tick();
    expect(useCloudStore.getState()).toMatchObject({ authStatus: 'signedOut', syncEnabled: false, notice: null });
    expect(await AsyncStorage.getItem('@formease/db_snapshot')).toBe('{"users":[]}'); // aucune donnée locale supprimée
    expect(await loadSyncState('uid-1')).not.toBeNull(); // la préférence de synchronisation du compte est conservée pour la reconnexion
  });

  it('si la déconnexion échoue, la session reste active avec son message, et l’erreur est affichée', async () => {
    await connecteAvecSynchro();
    mockAuth.signOut.mockRejectedValueOnce(new Error('réseau'));
    await useCloudStore.getState().signOut();
    const s = useCloudStore.getState();
    expect(s.authStatus).toBe('signedIn');
    expect(s.notice).toMatch(/Synchronisation activée/); // pas de « déconnexion réussie » avant sa confirmation
    expect(s.error).toBe('Déconnexion impossible.');
    expect(s.busy).toBe(false);
  });

  it('déconnexion non demandée par l’utilisateur (session expirée) : le message d’activation est aussi effacé', async () => {
    await connecteAvecSynchro();
    mockAuth.listener?.(null);
    await tick();
    expect(useCloudStore.getState().notice).toBeNull();
    expect(useCloudStore.getState().authStatus).toBe('signedOut');
  });

  it('changer de compte efface aussi le message du compte précédent', async () => {
    await connecteAvecSynchro();
    mockAuth.listener?.({ uid: 'uid-2', email: 'c@d.co' });
    await tick();
    expect(useCloudStore.getState().notice).toBeNull();
    expect(useCloudStore.getState().user?.uid).toBe('uid-2');
  });
});

describe('Suppression du compte (store) — états explicites, données locales conservées', () => {
  const tick = () => new Promise((r) => setTimeout(r, 30));
  const rec = (id: string, owner?: string) => ({ id, entityDefinitionId: 'ed-x', toolId: 'tool-x', values: { nom: id }, createdBy: 'u-me', createdAt: '2026-10-14T10:00:00.000Z', updatedAt: '2026-10-14T10:00:00.000Z', ...(owner ? { cloudOwnerUid: owner } : {}) });
  const PASSWORD = 'mot-de-passe-secret-123';

  const connecteAvecSynchro = async () => {
    mockAuth.listener?.({ uid: 'uid-1', email: 'a@b.co' });
    await tick();
    await useCloudStore.getState().enableSync();
    records.length = 0;
    records.push(rec('r-a1', 'uid-1'), rec('r-a2', 'uid-1'), rec('r-b1', 'uid-2'), rec('r-hist'));
  };
  const owner = (id: string) => (records.find((r) => r.id === id) as { cloudOwnerUid?: string } | undefined)?.cloudOwnerUid;

  beforeEach(async () => {
    await AsyncStorage.clear();
    jest.clearAllMocks();
    mockDeletion.reauthenticate.mockImplementation(async () => undefined);
    mockDeletion.deleteCloudData.mockImplementation(async () => verifiedReport());
    mockDeletion.deleteAuthAccount.mockImplementation(async () => undefined);
    mockAuth.listener?.(null);
    await tick();
    useCloudStore.getState().clearMessages();
  });

  it('succès : réauthentification, puis données cloud, puis compte ; données locales conservées et redevenues visibles ; autre compte intact ; mot de passe non conservé', async () => {
    await connecteAvecSynchro();
    const outcome = await useCloudStore.getState().deleteAccount(PASSWORD);
    expect(outcome?.status).toBe('completed');
    expect(outcome?.authDeleted).toBe(true);
    // ordre : réauthentification → données cloud → compte Firebase
    const order = (m: jest.Mock) => m.mock.invocationCallOrder[0];
    expect(mockDeletion.reauthenticate).toHaveBeenCalledWith(PASSWORD);
    expect(order(mockDeletion.reauthenticate)).toBeLessThan(order(mockDeletion.deleteCloudData));
    expect(order(mockDeletion.deleteCloudData)).toBeLessThan(order(mockDeletion.deleteAuthAccount));
    // données locales : toutes conservées, marquage retiré pour CE compte seulement
    expect(records.map((r) => r.id)).toEqual(['r-a1', 'r-a2', 'r-b1', 'r-hist']);
    expect(owner('r-a1')).toBeUndefined();
    expect(owner('r-a2')).toBeUndefined();
    expect(owner('r-b1')).toBe('uid-2'); // l'autre compte local n'est pas touché
    expect(outcome?.localReleased).toBe(2);
    expect(await loadSyncState('uid-1')).toBeNull(); // l'état de synchronisation du compte supprimé est oublié
    const s = useCloudStore.getState();
    expect(s.syncEnabled).toBe(false);
    expect(s.deletion?.status).toBe('completed');
    expect(JSON.stringify(s)).not.toContain(PASSWORD); // le mot de passe n'est conservé nulle part
    expect(JSON.stringify(outcome)).not.toContain(PASSWORD);
    // la déconnexion qui suit ne relance ni synchronisation ni recréation de documents
    mockAuth.listener?.(null);
    await tick();
    await useCloudStore.getState().syncIfEnabled();
    expect(mockApi.fetchRecords).not.toHaveBeenCalled();
    expect(mockApi.writeRecord).not.toHaveBeenCalled();
    expect(mockApi.ensureSpace).toHaveBeenCalledTimes(1); // celui de l'activation initiale, rien d'autre
    expect(useCloudStore.getState().deletion?.status).toBe('completed'); // « Compte supprimé » reste affichable
    expect(getActiveCloudUid()).toBeNull();
  });

  it('réauthentification refusée : rien n’est supprimé, aucune donnée ni état modifiés', async () => {
    await connecteAvecSynchro();
    mockDeletion.reauthenticate.mockRejectedValueOnce(Object.assign(new Error('x'), { code: 'auth/invalid-credential' }));
    const outcome = await useCloudStore.getState().deleteAccount('mauvais');
    expect(outcome?.status).toBe('reauth_required');
    expect(outcome?.message).toMatch(/Réauthentification nécessaire/);
    expect(outcome?.message).toMatch(/Rien n’a été supprimé/);
    expect(mockDeletion.deleteCloudData).not.toHaveBeenCalled();
    expect(mockDeletion.deleteAuthAccount).not.toHaveBeenCalled();
    expect(owner('r-a1')).toBe('uid-1');
    expect(await loadSyncState('uid-1')).not.toBeNull();
    expect(useCloudStore.getState().syncEnabled).toBe(true);
  });

  it('mot de passe vide : aucune réauthentification tentée, aucune suppression', async () => {
    await connecteAvecSynchro();
    const outcome = await useCloudStore.getState().deleteAccount('');
    expect(outcome?.status).toBe('reauth_required');
    expect(mockDeletion.reauthenticate).not.toHaveBeenCalled();
    expect(mockDeletion.deleteCloudData).not.toHaveBeenCalled();
  });

  it('« connexion récente requise » est traduite et ne supprime rien', async () => {
    await connecteAvecSynchro();
    mockDeletion.reauthenticate.mockRejectedValueOnce(Object.assign(new Error('x'), { code: 'auth/requires-recent-login' }));
    const outcome = await useCloudStore.getState().deleteAccount(PASSWORD);
    expect(outcome?.status).toBe('reauth_required');
    expect(outcome?.message).toMatch(/Reconnectez-vous/);
    expect(mockDeletion.deleteCloudData).not.toHaveBeenCalled();
  });

  it('suppression cloud incomplète : pas de succès annoncé, compte et données locales conservés, état de synchro gardé, reprise possible', async () => {
    await connecteAvecSynchro();
    mockDeletion.deleteCloudData.mockResolvedValueOnce({ ...verifiedReport(5), records: { found: 5, deleted: 2, remaining: 3 }, space: 'skipped', profile: 'skipped', verified: false, error: { code: 'unavailable', message: 'réseau' } });
    const outcome = await useCloudStore.getState().deleteAccount(PASSWORD);
    expect(outcome?.status).toBe('cloud_incomplete');
    expect(outcome?.message).toMatch(/Suppression cloud incomplète/);
    expect(outcome?.message).toMatch(/3 restent dans le cloud/);
    expect(outcome?.authDeleted).toBe(false);
    expect(mockDeletion.deleteAuthAccount).not.toHaveBeenCalled(); // jamais de suppression du compte tant que le cloud n'est pas vérifié
    expect(owner('r-a1')).toBe('uid-1'); // pas de libération : les données sont encore dans le cloud
    expect(await loadSyncState('uid-1')).not.toBeNull();
    expect(useCloudStore.getState()).toMatchObject({ authStatus: 'signedIn', syncEnabled: true });
    // reprise : la seconde tentative aboutit
    const retry = await useCloudStore.getState().deleteAccount(PASSWORD);
    expect(retry?.status).toBe('completed');
    expect(owner('r-a1')).toBeUndefined();
  });

  it('exception inattendue pendant la suppression cloud : incomplète, rien d’annoncé, compte conservé', async () => {
    await connecteAvecSynchro();
    mockDeletion.deleteCloudData.mockRejectedValueOnce(new Error('coupure'));
    const outcome = await useCloudStore.getState().deleteAccount(PASSWORD);
    expect(outcome?.status).toBe('cloud_incomplete');
    expect(mockDeletion.deleteAuthAccount).not.toHaveBeenCalled();
    expect(owner('r-a1')).toBe('uid-1');
  });

  it('données cloud supprimées mais compte Firebase encore actif : état explicite, données locales visibles, aucune synchronisation automatique', async () => {
    await connecteAvecSynchro();
    mockDeletion.deleteAuthAccount.mockRejectedValueOnce(Object.assign(new Error('x'), { code: 'auth/requires-recent-login' }));
    const outcome = await useCloudStore.getState().deleteAccount(PASSWORD);
    expect(outcome?.status).toBe('cloud_deleted_account_active');
    expect(outcome?.message).toMatch(/Données cloud supprimées, compte encore actif/);
    expect(outcome?.authDeleted).toBe(false);
    expect(owner('r-a1')).toBeUndefined(); // données locales de nouveau visibles
    expect(records).toHaveLength(4);
    const s = useCloudStore.getState();
    expect(s.authStatus).toBe('signedIn'); // le compte existe encore
    expect(s.syncEnabled).toBe(false); // la synchronisation ne peut pas recréer les documents supprimés
    await s.syncIfEnabled();
    expect(mockApi.fetchRecords).not.toHaveBeenCalled();
    expect(mockApi.writeRecord).not.toHaveBeenCalled();
    expect(mockApi.ensureSpace).toHaveBeenCalledTimes(1);
    // nouvelle tentative : il ne reste rien dans le cloud, le compte est supprimé
    const retry = await useCloudStore.getState().deleteAccount(PASSWORD);
    expect(retry?.status).toBe('completed');
  });

  it('résultat incertain (délai côté serveur) : jamais un succès, écran non bloqué, rien libéré, reprise possible', async () => {
    await connecteAvecSynchro();
    mockDeletion.deleteCloudData.mockResolvedValueOnce({ ...verifiedReport(100), uncertain: true, verified: false, records: { found: 100, deleted: 0, remaining: null }, space: 'skipped', profile: 'skipped', error: { code: 'client-timeout', message: 'délai' } });
    const outcome = await useCloudStore.getState().deleteAccount(PASSWORD);
    expect(outcome?.status).toBe('cloud_uncertain');
    expect(outcome?.message).toMatch(/Suppression cloud incertaine/);
    const s = useCloudStore.getState();
    expect(s.deleting).toBe(false); // l'écran n'est pas laissé en chargement
    expect(s.busy).toBe(false);
    expect(s).toMatchObject({ authStatus: 'signedIn', syncEnabled: true });
    expect(mockDeletion.deleteAuthAccount).not.toHaveBeenCalled();
    expect(owner('r-a1')).toBe('uid-1'); // données locales et marquage intacts
    expect(await loadSyncState('uid-1')).not.toBeNull();
    expect(records).toHaveLength(4);
    const retry = await useCloudStore.getState().deleteAccount(PASSWORD);
    expect(retry?.status).toBe('completed');
  });

  it('le store traite « compte non confirmé » comme « données cloud supprimées » : synchronisation désactivée, pas de succès annoncé', () => {
    const src = read('store/cloudStore.ts');
    expect(src).toContain("outcome.status === 'account_uncertain'");
    expect(src).not.toMatch(/status === 'completed'[^\n]*account_uncertain[^\n]*Compte supprimé/);
  });

  it('propriété de l’espace non démontrée : rien n’est supprimé ni libéré', async () => {
    await connecteAvecSynchro();
    mockDeletion.deleteCloudData.mockResolvedValueOnce({ ...verifiedReport(0), ownership: 'unproven', space: 'skipped', profile: 'skipped', verified: false });
    const outcome = await useCloudStore.getState().deleteAccount(PASSWORD);
    expect(outcome?.status).toBe('ownership_unproven');
    expect(mockDeletion.deleteAuthAccount).not.toHaveBeenCalled();
    expect(owner('r-a1')).toBe('uid-1');
    expect(await loadSyncState('uid-1')).not.toBeNull();
  });

  it('pendant la suppression, ni synchronisation ni activation ne peuvent se lancer', async () => {
    await connecteAvecSynchro();
    let release: () => void = () => undefined;
    mockDeletion.reauthenticate.mockImplementationOnce(() => new Promise<undefined>((resolve) => { release = () => resolve(undefined); }));
    const pending = useCloudStore.getState().deleteAccount(PASSWORD);
    await tick();
    expect(useCloudStore.getState().deleting).toBe(true);
    await useCloudStore.getState().syncNow();
    await useCloudStore.getState().enableSync();
    expect(mockApi.fetchRecords).not.toHaveBeenCalled();
    expect(mockApi.ensureSpace).toHaveBeenCalledTimes(1);
    release();
    await pending;
    expect(useCloudStore.getState().deleting).toBe(false);
  });

  it('données masquées d’un autre compte : l’action explicite les rend locales sans rien supprimer', async () => {
    await connecteAvecSynchro();
    mockAuth.listener?.(null); // plus de compte : les données de uid-1 et uid-2 sont masquées
    await tick();
    const released = await useCloudStore.getState().releaseHiddenData();
    expect(released).toBe(3);
    expect(records).toHaveLength(4);
    expect([owner('r-a1'), owner('r-a2'), owner('r-b1')]).toEqual([undefined, undefined, undefined]);
  });
});

describe('Câblage : mode local conservé, aucune simulation, aucune migration automatique', () => {
  it('les écrans de connexion, d’inscription et de réinitialisation utilisent Firebase (plus la simulation locale)', () => {
    for (const file of ['features/auth/screens/LoginScreen.tsx', 'features/auth/screens/SignUpScreen.tsx', 'features/auth/screens/ForgotPasswordScreen.tsx']) {
      const src = read(file);
      expect(src).toContain('useCloudStore');
      expect(src).not.toMatch(/authService\.|useAuthStore\(\(s\) => s\.(login|signUp)\)/);
      expect(src).not.toContain('arrivera dans une prochaine version');
    }
    expect(read('features/auth/screens/LoginScreen.tsx')).toContain('Continuer sans compte');
  });

  it('la connexion et l’inscription ne déclenchent ni activation, ni envoi, ni migration', () => {
    const store = read('store/cloudStore.ts');
    const body = (name: string) => store.slice(store.indexOf(`${name}: async`), store.indexOf('},', store.indexOf(`${name}: async`)));
    for (const name of ['signIn', 'signUp', 'signOut', 'resetPassword']) {
      expect(body(name)).not.toMatch(/enableSync|syncNow|importLocalRecords|ensureSpace/);
    }
    expect(read('app/_layout.tsx')).toMatch(/useCloudStore\.getState\(\)\.init\(\)/);
    expect(read('app/_layout.tsx')).not.toMatch(/syncNow|syncIfEnabled|enableSync/);
  });

  it('l’identité locale u-me et la base locale ne sont pas remplacées par l’UID', () => {
    for (const file of ['services/cloudSyncService.ts', 'store/cloudStore.ts', 'services/firebase/firestoreRecordsApi.ts']) {
      expect(read(file)).not.toMatch(/CURRENT_USER_ID\s*=|'u-me'\s*=|users\.(push|splice)|authStore/);
    }
    expect(read('services/db.ts')).toContain("export const CURRENT_USER_ID = 'u-me'");
    // les enregistrements reçus du cloud gardent l'identité locale comme auteur local
    expect(read('services/cloudSyncService.ts')).toContain('createdBy: CURRENT_USER_ID');
  });

  it('seuls biens et logements sont concernés : aucune référence aux paiements, avances, reçus, CEET/TDE ou tontines', () => {
    const sync = read('services/cloudSyncService.ts');
    const code = sync.split('\n').filter((l) => !l.trim().startsWith('//') && !l.trim().startsWith('*')).join('\n');
    expect(code).not.toMatch(/paiement|rentAdvance|rentReceipt|utilityBilling|tontine/i);
    expect(code).toMatch(/kind: SyncKind/);
  });

  it('l’interface montre l’état réel (local, en attente, synchronisé, conflit) et ne synchronise que si le compte est connecté et la synchronisation activée', () => {
    const badge = read('components/immobilier/SyncBadge.tsx');
    for (const label of ['Local', 'En attente', 'Synchronisé', 'Conflit']) expect(badge).toContain(label);
    expect(read('features/immobilier/screens/BiensListScreen.tsx')).toContain('syncIfEnabled');
    expect(read('features/immobilier/screens/BienDetailScreen.tsx')).toContain('syncIfEnabled');
    expect(read('store/cloudStore.ts')).toMatch(/authStatus !== 'signedIn' \|\| !get\(\)\.syncEnabled/);
  });
});
