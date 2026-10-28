// Lot N1.2 : message dédié et reprise d'une suppression de compte (verrou posé, interruption, redémarrage).
// Aucun SDK, aucun réseau : le cloud est simulé. Ces tests prouvent la LOGIQUE de l'application ; ils ne disent rien du
// comportement des vrais jetons Firebase ni des règles actuellement publiées.

import fs from 'fs';
import path from 'path';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { deleteAccount, type AccountDeletionApi, type CloudDeletionReport, type DeletionOutcome } from '../accountDeletionService';
import { clearDeletionMarker, deletionJournal, describeRecovery, describeSyncRefusal, loadDeletionMarker, type DeletionMarker } from '../accountDeletionRecovery';
import { CloudError } from '../cloudSyncService';
import { records } from '../db';
import { createBien } from '../immobilierService';
import { useCloudStore } from '@/store/cloudStore';

jest.mock('../db', () => ({ ...jest.requireActual('../db'), delay: () => Promise.resolve() }));
jest.mock('@react-native-async-storage/async-storage', () => jest.requireActual('@react-native-async-storage/async-storage/jest/async-storage-mock'));

const mockAuth = { listener: null as null | ((u: { uid: string; email: string | null } | null) => void) };
const mockRecords = {
  ensureSpace: jest.fn(async (uid: string) => `personal_${uid}`),
  fetchRecords: jest.fn(async () => []),
  writeRecord: jest.fn(async (): Promise<number> => 1),
  markDeleted: jest.fn(async () => 1),
};
const mockDeletion = {
  reauthenticate: jest.fn(async (_password?: string) => undefined),
  deleteCloudData: jest.fn(async (_uid?: string): Promise<unknown> => verified()),
  deleteAuthAccount: jest.fn(async () => undefined),
  readLock: jest.fn(async (_uid?: string): Promise<string> => 'unknown'),
};

jest.mock('@/services/firebase/firebaseAuthService', () => ({
  CloudAuthError: class extends Error {},
  watchCloudUser: (cb: (u: { uid: string; email: string | null } | null) => void) => {
    mockAuth.listener = cb;
    return () => undefined;
  },
  signInWithEmail: async () => undefined,
  signUpWithEmail: async () => undefined,
  signOutCloud: async () => undefined,
  sendResetEmail: async () => undefined,
}));
jest.mock('@/services/firebase/accountDeletionApi', () => ({
  firebaseAccountDeletionApi: {
    reauthenticate: (p: string) => mockDeletion.reauthenticate(p),
    deleteCloudData: (u: string) => mockDeletion.deleteCloudData(u),
    deleteAuthAccount: () => mockDeletion.deleteAuthAccount(),
  },
  readDeletionLock: (u: string) => mockDeletion.readLock(u),
}));
jest.mock('@/services/firebase/firestoreRecordsApi', () => ({
  firestoreRecordsApi: {
    ensureSpace: (uid: string) => mockRecords.ensureSpace(uid),
    fetchRecords: () => mockRecords.fetchRecords(),
    writeRecord: () => mockRecords.writeRecord(),
    markDeleted: () => mockRecords.markDeleted(),
  },
}));

function verified(found = 2): CloudDeletionReport {
  return { ownership: 'proven', records: { found, deleted: found, remaining: 0 }, space: 'deleted', profile: 'deleted', verified: true, uncertain: false, error: null, locked: true };
}
/** Suppression interrompue après la pose du verrou : espace toujours là. */
const lockedIncomplete = (): CloudDeletionReport => ({
  ownership: 'proven',
  records: { found: 3, deleted: 1, remaining: 2 },
  space: 'skipped',
  profile: 'skipped',
  verified: false,
  uncertain: false,
  error: { code: 'unavailable', message: 'réseau coupé' },
  locked: true,
});

const UID = 'uid-1';
const api = (over: Partial<AccountDeletionApi> = {}): AccountDeletionApi => ({
  reauthenticate: async () => undefined,
  deleteCloudData: async () => verified(),
  deleteAuthAccount: async () => undefined,
  ...over,
});
const fakeLocal = () => {
  const release = jest.fn(async (_uid: string) => ({ released: 2 }));
  return { local: { release }, release };
};
const run = (a: AccountDeletionApi, password = 'secret1', timeouts?: { reauthMs: number; cloudMs: number; authMs: number }) => {
  const { local, release } = fakeLocal();
  return deleteAccount(a, UID, password, local, timeouts, deletionJournal).then((outcome) => ({ outcome, release }));
};
const FALSE_SUCCESS = /Compte supprimé|supprimé avec succès|suppression terminée/i;

beforeEach(async () => {
  await AsyncStorage.clear();
  records.length = 0;
  jest.clearAllMocks();
  mockDeletion.readLock.mockImplementation(async () => 'unknown');
  mockDeletion.deleteCloudData.mockImplementation(async () => verified());
  mockRecords.writeRecord.mockImplementation(async () => 1);
});

describe('Suppression : espace déjà verrouillé, reprise, journal persistant', () => {
  it('espace verrouillé et suppression inachevée : message explicite, mot de passe redemandé, journal conservé, données locales intactes', async () => {
    mockDeletion.deleteCloudData.mockImplementationOnce(async () => lockedIncomplete());
    const a = api({ deleteCloudData: (u) => mockDeletion.deleteCloudData(u) as Promise<CloudDeletionReport> });
    const { outcome, release } = await run(a);
    expect(outcome.status).toBe('cloud_incomplete');
    expect(outcome.message).toMatch(/verrouillé pour suppression \(confirmé par le serveur\)/);
    expect(outcome.message).toMatch(/mot de passe sera redemandé/);
    expect(outcome.message).toMatch(/réauthentification/);
    expect(outcome.message).toMatch(/données locales sont conservés|données locales aussi/);
    expect(outcome.message).not.toMatch(FALSE_SUCCESS);
    expect(release).not.toHaveBeenCalled(); // rien n'est libéré ni retiré localement tant que le serveur n'a pas tout confirmé
    expect(outcome.authDeleted).toBe(false);
    expect(await loadDeletionMarker(UID)).toMatchObject({ uid: UID, lastStatus: 'cloud_incomplete', lockConfirmed: true });
  });

  it('reprise : le journal est écrit AVANT la première opération cloud et n’est effacé qu’à la fin vérifiée', async () => {
    let during: DeletionMarker | null = null;
    const a = api({
      deleteCloudData: async (uid) => {
        during = await loadDeletionMarker(uid); // le processus pourrait être tué ici
        return verified();
      },
    });
    const { outcome } = await run(a);
    expect(during).toMatchObject({ lastStatus: 'started', lockConfirmed: false });
    expect(outcome.status).toBe('completed');
    expect(await loadDeletionMarker(UID)).toBeNull();
  });

  it('première tentative interrompue puis reprise réussie : journal conservé puis effacé, jamais de faux succès entre les deux', async () => {
    const first = await run(api({ deleteCloudData: async () => lockedIncomplete() }));
    expect(first.outcome.status).toBe('cloud_incomplete');
    expect(await loadDeletionMarker(UID)).not.toBeNull();
    const second = await run(api());
    expect(second.outcome.status).toBe('completed');
    expect(await loadDeletionMarker(UID)).toBeNull();
  });

  it('réauthentification échouée, vide ou sans réponse : rien n’est supprimé, aucun journal, le cloud n’est jamais appelé', async () => {
    const deleteCloudData = jest.fn(async () => verified());
    const wrong = await run(api({ deleteCloudData, reauthenticate: async () => Promise.reject(Object.assign(new Error('x'), { code: 'auth/wrong-password' })) }));
    expect(wrong.outcome.status).toBe('reauth_required');
    expect(wrong.outcome.message).toMatch(/Rien n’a été supprimé/);
    const empty = await run(api({ deleteCloudData }), '');
    expect(empty.outcome.status).toBe('reauth_required');
    const slow = await run(api({ deleteCloudData, reauthenticate: () => new Promise<void>(() => undefined) }), 'secret1', { reauthMs: 5, cloudMs: 50, authMs: 50 });
    expect(slow.outcome.status).toBe('reauth_required');
    expect(deleteCloudData).not.toHaveBeenCalled();
    expect(await loadDeletionMarker(UID)).toBeNull();
    for (const r of [wrong, empty, slow]) expect(r.release).not.toHaveBeenCalled();
  });

  it('une ancienne reprise reste proposée après une réauthentification échouée (le journal n’est pas effacé)', async () => {
    await run(api({ deleteCloudData: async () => lockedIncomplete() }));
    const wrong = await run(api({ reauthenticate: async () => Promise.reject(Object.assign(new Error('x'), { code: 'auth/wrong-password' })) }));
    expect(wrong.outcome.status).toBe('reauth_required');
    expect(await loadDeletionMarker(UID)).toMatchObject({ lastStatus: 'cloud_incomplete', lockConfirmed: true });
  });

  it('délai dépassé : état incertain, aucun verrou affirmé, journal conservé', async () => {
    const { outcome, release } = await run(api({ deleteCloudData: () => new Promise<CloudDeletionReport>(() => undefined) }), 'secret1', { reauthMs: 50, cloudMs: 5, authMs: 50 });
    expect(outcome.status).toBe('cloud_uncertain');
    expect(outcome.message).toMatch(/peut-être été appliquée/);
    expect(outcome.message).not.toMatch(/verrouillé/); // le verrou n'a pas été confirmé : on ne l'affirme pas
    expect(outcome.message).not.toMatch(FALSE_SUCCESS);
    expect(release).not.toHaveBeenCalled();
    expect(await loadDeletionMarker(UID)).toMatchObject({ lastStatus: 'cloud_uncertain', lockConfirmed: false });
  });

  it('propriété non démontrée : rien n’a été supprimé et aucun journal ne reste', async () => {
    const report: CloudDeletionReport = { ...lockedIncomplete(), ownership: 'unproven', locked: undefined };
    const { outcome } = await run(api({ deleteCloudData: async () => report }));
    expect(outcome.status).toBe('ownership_unproven');
    expect(await loadDeletionMarker(UID)).toBeNull();
  });

  it('espace supprimé mais profil en échec : le verrou n’est plus annoncé (il n’existe plus), la reprise reste proposée', async () => {
    const report: CloudDeletionReport = { ...lockedIncomplete(), space: 'deleted', records: { found: 3, deleted: 3, remaining: 0 }, profile: 'failed' };
    const { outcome } = await run(api({ deleteCloudData: async () => report }));
    expect(outcome.status).toBe('cloud_incomplete');
    expect(outcome.message).not.toMatch(/verrouillé/);
    expect(await loadDeletionMarker(UID)).toMatchObject({ lastStatus: 'cloud_incomplete', lockConfirmed: false });
  });

  it('données cloud vérifiées mais compte encore actif / non confirmé : jamais « terminé », reprise conservée', async () => {
    const active = await run(api({ deleteAuthAccount: async () => Promise.reject(Object.assign(new Error('x'), { code: 'auth/requires-recent-login' })) }));
    expect(active.outcome.status).toBe('cloud_deleted_account_active');
    expect(active.outcome.message).not.toMatch(/^Compte supprimé/);
    const marker1 = (await loadDeletionMarker(UID))!;
    expect(marker1.lastStatus).toBe('cloud_deleted_account_active');
    expect(describeRecovery(marker1).message).toMatch(/compte est encore actif/);
    const uncertain = await run(api({ deleteAuthAccount: () => new Promise<void>(() => undefined) }), 'secret1', { reauthMs: 50, cloudMs: 50, authMs: 5 });
    expect(uncertain.outcome.status).toBe('account_uncertain');
    const marker2 = (await loadDeletionMarker(UID))!;
    expect(describeRecovery(marker2).message).toMatch(/n’a pas été confirmée/);
    for (const m of [marker1, marker2]) expect(describeRecovery(m).message).not.toMatch(FALSE_SUCCESS);
  });

  it('un journal défaillant (stockage plein) ne change ni ne bloque la suppression', async () => {
    (AsyncStorage.setItem as jest.Mock).mockRejectedValueOnce(new Error('stockage plein')); // écriture du journal au démarrage
    (AsyncStorage.removeItem as jest.Mock).mockRejectedValueOnce(new Error('stockage plein')); // effacement final
    const { outcome } = await run(api());
    expect(outcome.status).toBe('completed');
  });

  it('le journal n’est lié qu’à son compte', async () => {
    await deletionJournal.started('uid-A');
    expect(await loadDeletionMarker('uid-A')).not.toBeNull();
    expect(await loadDeletionMarker('uid-B')).toBeNull();
    await clearDeletionMarker('uid-A');
    expect(await loadDeletionMarker('uid-A')).toBeNull();
    await AsyncStorage.setItem('@formease/cloud_deletion_uid-C', '{pas du json');
    expect(await loadDeletionMarker('uid-C')).toBeNull(); // journal illisible : pas de plantage
  });
});

describe('Messages prudents', () => {
  const marker = (over: Partial<DeletionMarker> = {}): DeletionMarker => ({ uid: UID, startedAt: 'a', lastAttemptAt: 'a', lastStatus: 'started', lockConfirmed: false, ...over });

  it('journal seul : « peut être verrouillé », jamais présenté comme un état serveur connu ; verrou confirmé : dit « confirmé »', () => {
    const unknown = describeRecovery(marker()).message;
    expect(unknown).toMatch(/peut être verrouillé/);
    expect(unknown).not.toMatch(/a confirmé/);
    const confirmed = describeRecovery(marker({ lockConfirmed: true, lastStatus: 'cloud_incomplete' })).message;
    expect(confirmed).toMatch(/Le serveur a confirmé/);
    for (const text of [unknown, confirmed]) {
      expect(text).toMatch(/Reprendre la suppression/);
      expect(text).toMatch(/mot de passe sera redemandé/);
      expect(text).toMatch(/données locales sont conservées/);
      expect(text).not.toMatch(FALSE_SUCCESS);
    }
  });

  it('refus de synchronisation : quatre états distincts, le verrou n’est affirmé que s’il est confirmé par une lecture serveur', () => {
    const messages = (['locked', 'unlocked', 'absent', 'unknown'] as const).map(describeSyncRefusal);
    expect(new Set(messages).size).toBe(4);
    expect(messages[0]).toMatch(/verrouillé pour suppression \(confirmé par le serveur\)/);
    expect(messages[0]).toMatch(/mot de passe sera redemandé/);
    for (const text of messages.slice(1)) expect(text).not.toMatch(/verrouillé pour suppression \(confirmé/);
    expect(messages[1]).toMatch(/aucune suppression de compte en cours/);
    expect(messages[3]).toMatch(/n’a pas pu être vérifié/);
    expect(messages[3]).toMatch(/Supprimer mon compte/); // actionnable même sans connaître l'état
    for (const text of messages) expect(text).toMatch(/données locales sont conservées/);
  });
});

describe('Store : redémarrage et synchronisation face à un refus', () => {
  const tick = () => new Promise((r) => setTimeout(r, 0));
  const signIn = async (uid = UID) => {
    useCloudStore.getState().init();
    mockAuth.listener?.({ uid, email: 'a@b.co' });
    await tick();
    await tick();
  };
  const reset = () => useCloudStore.setState({ deletion: null, deletionMarker: null, syncMessage: null, error: null, deleting: false, syncing: false });
  const pendingBien = async () => {
    await signIn();
    await useCloudStore.getState().enableSync();
    const bien = await createBien({ nom: 'Maison Agoè', adresse: 'Lomé' });
    return bien;
  };

  beforeEach(reset);

  it('redémarrage : le journal persistant fait réapparaître la reprise au retour de la session, sans état React ; propre à chaque compte', async () => {
    await deletionJournal.started(UID); // écrit dans le stockage, comme lors d'une suppression tuée en cours de route
    reset(); // « application relancée » : plus aucun état en mémoire
    expect(useCloudStore.getState().deletionMarker).toBeNull();
    await signIn(UID);
    expect(useCloudStore.getState().deletion).toBeNull(); // aucun résultat en mémoire…
    expect(useCloudStore.getState().deletionMarker).toMatchObject({ uid: UID, lastStatus: 'started' }); // …mais la reprise est retrouvée
    mockAuth.listener?.(null);
    await tick();
    expect(useCloudStore.getState().deletionMarker).toBeNull();
    await signIn('uid-9');
    expect(useCloudStore.getState().deletionMarker).toBeNull(); // un autre compte ne voit pas ce journal
  });

  it('refus d’écriture + verrou CONFIRMÉ par la lecture serveur : message dédié, journal mémorisé, donnée locale intacte', async () => {
    const bien = await pendingBien();
    mockRecords.writeRecord.mockRejectedValueOnce(new CloudError('permission', 'Accès refusé par les règles de sécurité.'));
    mockDeletion.readLock.mockResolvedValueOnce('locked');
    await useCloudStore.getState().syncNow();
    const s = useCloudStore.getState();
    expect(mockDeletion.readLock).toHaveBeenCalledWith(UID);
    expect(s.syncMessage).toMatch(/verrouillé pour suppression \(confirmé par le serveur\)/);
    expect(s.syncMessage).toMatch(/mot de passe sera redemandé/);
    expect(s.deletionMarker).toMatchObject({ uid: UID, lockConfirmed: true });
    expect(await loadDeletionMarker(UID)).toMatchObject({ lockConfirmed: true });
    expect(records.some((r) => r.id === bien.id)).toBe(true); // donnée locale préservée
    expect(s.deletion).toBeNull(); // aucune « suppression terminée » inventée
  });

  it('refus d’écriture ORDINAIRE (le serveur dit : non verrouillé) : pas de message de verrouillage, pas de journal', async () => {
    await pendingBien();
    mockRecords.writeRecord.mockRejectedValueOnce(new CloudError('permission', 'Accès refusé par les règles de sécurité.'));
    mockDeletion.readLock.mockResolvedValueOnce('unlocked');
    await useCloudStore.getState().syncNow();
    const s = useCloudStore.getState();
    expect(s.syncMessage).toMatch(/aucune suppression de compte en cours/);
    expect(s.syncMessage).not.toMatch(/verrouillé pour suppression/);
    expect(s.deletionMarker).toBeNull();
    expect(await loadDeletionMarker(UID)).toBeNull();
  });

  it('refus d’écriture et lecture du verrou impossible (erreur ou « inconnu ») : message prudent et actionnable, aucun verrou affirmé', async () => {
    await pendingBien();
    for (const probe of ['reject', 'unknown'] as const) {
      reset();
      mockRecords.writeRecord.mockRejectedValueOnce(new CloudError('permission', 'Accès refusé par les règles de sécurité.'));
      if (probe === 'reject') mockDeletion.readLock.mockRejectedValueOnce(new Error('réseau'));
      else mockDeletion.readLock.mockResolvedValueOnce('unknown');
      // l'enregistrement est repassé en « erreur » : on le remet en attente en le modifiant
      const [record] = records.filter((r) => r.toolId);
      if (record) record.updatedAt = new Date(Date.now() + 1000).toISOString();
      await useCloudStore.getState().syncNow();
      const s = useCloudStore.getState();
      expect(s.syncMessage).toMatch(/n’a pas pu être vérifié/);
      expect(s.syncMessage).toMatch(/Supprimer mon compte/);
      expect(s.syncMessage).not.toMatch(/verrouillé pour suppression \(confirmé/);
      expect(s.deletionMarker).toBeNull();
    }
  });

  it('erreur RÉSEAU distincte du verrouillage : message « hors ligne », le verrou n’est même pas interrogé, aucun journal', async () => {
    await pendingBien();
    mockRecords.writeRecord.mockRejectedValueOnce(new CloudError('network', 'unavailable'));
    await useCloudStore.getState().syncNow();
    const s = useCloudStore.getState();
    expect(s.syncMessage).toMatch(/Hors ligne/);
    expect(s.syncMessage).not.toMatch(/verrouill|refusé/);
    expect(mockDeletion.readLock).not.toHaveBeenCalled();
    expect(s.deletionMarker).toBeNull();
  });

  it('synchronisation normale : aucune lecture du verrou', async () => {
    await pendingBien();
    await useCloudStore.getState().syncNow();
    expect(mockDeletion.readLock).not.toHaveBeenCalled();
    expect(useCloudStore.getState().syncMessage).toMatch(/envoyé|à jour/);
  });

  it('suppression via le store : journal conservé si inachevée (reprise visible), effacé seulement à la fin vérifiée', async () => {
    await signIn();
    mockDeletion.deleteCloudData.mockImplementationOnce(async () => lockedIncomplete());
    const first = await useCloudStore.getState().deleteAccount('secret1');
    expect(first?.status).toBe('cloud_incomplete');
    expect(useCloudStore.getState().deletionMarker).toMatchObject({ lockConfirmed: true, lastStatus: 'cloud_incomplete' });
    // « redémarrage » : le résultat en mémoire disparaît, le journal reste
    useCloudStore.setState({ deletion: null, deletionMarker: null });
    mockAuth.listener?.({ uid: UID, email: 'a@b.co' });
    await tick();
    await tick();
    expect(useCloudStore.getState().deletionMarker).not.toBeNull();
    // reprise : réauthentification (mot de passe redemandé) puis fin vérifiée
    const second = await useCloudStore.getState().deleteAccount('secret1');
    expect(mockDeletion.reauthenticate).toHaveBeenCalledTimes(2);
    expect(second?.status).toBe('completed');
    expect(useCloudStore.getState().deletionMarker).toBeNull();
    expect(await loadDeletionMarker(UID)).toBeNull();
  });

  it('reprise avec un mauvais mot de passe : rien n’est supprimé, la reprise reste proposée', async () => {
    await signIn();
    mockDeletion.deleteCloudData.mockImplementationOnce(async () => lockedIncomplete());
    await useCloudStore.getState().deleteAccount('secret1');
    mockDeletion.reauthenticate.mockRejectedValueOnce(Object.assign(new Error('x'), { code: 'auth/wrong-password' }));
    const retry: DeletionOutcome | null = await useCloudStore.getState().deleteAccount('faux');
    expect(retry?.status).toBe('reauth_required');
    expect(retry?.message).toMatch(/Rien n’a été supprimé/);
    expect(mockDeletion.deleteCloudData).toHaveBeenCalledTimes(1); // pas de nouvelle tentative cloud
    expect(useCloudStore.getState().deletionMarker).not.toBeNull();
  });
});

describe('Câblage statique', () => {
  const read = (rel: string) => fs.readFileSync(path.join(__dirname, '..', '..', rel), 'utf8');

  it('l’écran affiche la reprise depuis le journal persistant (pas seulement le résultat en mémoire) et aucun déverrouillage n’existe', () => {
    const screen = read('features/profile/screens/CloudAccountScreen.tsx');
    expect(screen).toContain('s.deletionMarker');
    expect(screen).toContain('Reprendre la suppression');
    for (const file of ['services/accountDeletionRecovery.ts', 'services/firebase/firestoreAccountDeletion.ts', 'store/cloudStore.ts', 'services/firebase/accountDeletionApi.ts']) {
      expect(read(file)).not.toMatch(/deleteField\(\)|deletionLockedAt: null/); // aucun mécanisme de retrait du verrou
    }
  });

  it('l’état du verrou n’est jamais déduit d’un code d’erreur : seule la lecture serveur le décide', () => {
    const lockRead = read('services/firebase/firestoreAccountDeletion.ts').split('export async function readDeletionLockState')[1].split('export async function deleteAccountCloudData')[0];
    expect(lockRead).toContain('getDocFromServer');
    expect(lockRead).not.toMatch(/permission-denied/);
    expect(lockRead).toMatch(/catch \{\s*return 'unknown';/);
  });
});
