// Suppression du compte : orchestration (ordre, états, messages), libération locale des données, câblage de l'écran.
// L'API est simulée (aucun SDK, aucun réseau) ; les règles et la fonction Firestore réelle sont testées dans
// accountDeletion.emulator.test.ts (émulateur).

import fs from 'fs';
import path from 'path';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { deleteAccount, type AccountDeletionApi, type CloudDeletionReport, type LocalCleanup } from '../accountDeletionService';
import { coreService } from '../coreService';
import { externalContacts, records } from '../db';
import { createBien, createLocataireEtContrat, createLogement, ensureImmobilierTool } from '../immobilierService';
import { hiddenOwnerSummary, loadSyncState, releaseHiddenOwnership, releaseLocalOwnership, saveSyncState, type SyncState } from '../cloudSyncService';
import { setActiveCloudUid, setCloudStampUid, visibleRecordsFor } from '../cloudVisibility';

jest.mock('../db', () => ({ ...jest.requireActual('../db'), delay: () => Promise.resolve() }));
jest.mock('@react-native-async-storage/async-storage', () => jest.requireActual('@react-native-async-storage/async-storage/jest/async-storage-mock'));

const root = path.join(__dirname, '..', '..');
const read = (rel: string) => fs.readFileSync(path.join(root, rel), 'utf8');

const report = (over: Partial<CloudDeletionReport> = {}): CloudDeletionReport => ({
  ownership: 'proven',
  records: { found: 3, deleted: 3, remaining: 0 },
  space: 'deleted',
  profile: 'deleted',
  verified: true,
  uncertain: false,
  error: null,
  ...over,
});

function fakeApi(over: Partial<AccountDeletionApi> = {}) {
  const calls: string[] = [];
  const api: AccountDeletionApi = {
    reauthenticate: async () => void calls.push('reauth'),
    deleteCloudData: async () => (calls.push('cloud'), report()),
    deleteAuthAccount: async () => void calls.push('auth'),
    ...over,
  };
  return { api, calls };
}
const fakeLocal = () => {
  const released: string[] = [];
  const local: LocalCleanup = { release: async (uid) => (released.push(uid), { released: 2 }) };
  return { local, released };
};
const err = (code: string, message = 'x') => Object.assign(new Error(message), { code });

describe('Orchestration de la suppression de compte', () => {
  it('ordre : réauthentification → données cloud → nettoyage local → compte ; « Compte supprimé » seulement après la confirmation', async () => {
    const { api, calls } = fakeApi();
    const { local, released } = fakeLocal();
    const out = await deleteAccount(api, 'uid-1', 'pw', local);
    expect(calls).toEqual(['reauth', 'cloud', 'auth']);
    expect(released).toEqual(['uid-1']);
    expect(out).toMatchObject({ status: 'completed', authDeleted: true, localReleased: 2 });
    expect(out.message).toMatch(/Compte supprimé/);
    expect(out.message).toMatch(/données locales restent sur cet appareil/);
    expect(out.message).toMatch(/autres appareils conservent/);
  });

  it('réauthentification refusée : aucune opération destructive, aucun nettoyage local', async () => {
    const { api, calls } = fakeApi({ reauthenticate: async () => { throw err('auth/invalid-credential'); } });
    const { local, released } = fakeLocal();
    const out = await deleteAccount(api, 'uid-1', 'faux', local);
    expect(out.status).toBe('reauth_required');
    expect(calls).toEqual([]);
    expect(released).toEqual([]);
    expect(out.message).toMatch(/Réauthentification nécessaire/);
    expect(out.message).toMatch(/Rien n’a été supprimé/);
  });

  it('mot de passe vide : refus immédiat, aucun appel', async () => {
    const { api, calls } = fakeApi();
    const out = await deleteAccount(api, 'uid-1', '', fakeLocal().local);
    expect(out.status).toBe('reauth_required');
    expect(calls).toEqual([]);
  });

  it('réseau indisponible à la réauthentification : refus explicite, rien supprimé', async () => {
    const { api, calls } = fakeApi({ reauthenticate: async () => { throw err('auth/network-request-failed'); } });
    const out = await deleteAccount(api, 'uid-1', 'pw', fakeLocal().local);
    expect(out.status).toBe('reauth_required');
    expect(out.message).toMatch(/Internet/);
    expect(calls).toEqual([]);
  });

  it('suppression cloud partielle : « incomplète », compte et données locales conservés, détail des restes, aucune suppression du compte', async () => {
    const partial = report({ records: { found: 10, deleted: 4, remaining: 6 }, space: 'skipped', profile: 'skipped', verified: false, error: { code: 'unavailable', message: 'réseau coupé' } });
    const { api, calls } = fakeApi({ deleteCloudData: async () => (calls.push('cloud'), partial) });
    const { local, released } = fakeLocal();
    const out = await deleteAccount(api, 'uid-1', 'pw', local);
    expect(out.status).toBe('cloud_incomplete');
    expect(calls).toEqual(['reauth', 'cloud']); // pas de suppression du compte
    expect(released).toEqual([]); // pas de libération : les données sont encore dans le cloud
    expect(out.message).toMatch(/Suppression cloud incomplète/);
    expect(out.message).toMatch(/4 enregistrement\(s\) supprimé\(s\) et confirmé\(s\) sur 10/);
    expect(out.message).toMatch(/6 restent dans le cloud/);
    expect(out.message).toMatch(/réseau coupé/);
    expect(out.authDeleted).toBe(false);
    expect(out.localReleased).toBe(0);
  });

  it('un rapport non vérifié n’est jamais un succès, même si les compteurs semblent complets', async () => {
    const { api, calls } = fakeApi({ deleteCloudData: async () => (calls.push('cloud'), report({ verified: false, space: 'failed' })) });
    const out = await deleteAccount(api, 'uid-1', 'pw', fakeLocal().local);
    expect(out.status).toBe('cloud_incomplete');
    expect(out.message).toMatch(/espace personnel non supprimé/);
    expect(calls).not.toContain('auth');
  });

  it('erreur inattendue pendant la suppression cloud : incomplète, compte conservé', async () => {
    const { api, calls } = fakeApi({ deleteCloudData: async () => { calls.push('cloud'); throw new Error('boum'); } });
    const out = await deleteAccount(api, 'uid-1', 'pw', fakeLocal().local);
    expect(out.status).toBe('cloud_incomplete');
    expect(out.message).toMatch(/boum/);
    expect(calls).toEqual(['reauth', 'cloud']);
  });

  it('propriété non démontrée : refus, rien supprimé, aucune libération', async () => {
    const { api, calls } = fakeApi({ deleteCloudData: async () => (calls.push('cloud'), report({ ownership: 'unproven', verified: false, records: { found: 0, deleted: 0, remaining: null }, space: 'skipped', profile: 'skipped' })) });
    const { local, released } = fakeLocal();
    const out = await deleteAccount(api, 'uid-1', 'pw', local);
    expect(out.status).toBe('ownership_unproven');
    expect(calls).toEqual(['reauth', 'cloud']);
    expect(released).toEqual([]);
  });

  it('données cloud supprimées mais compte encore actif : état explicite, données locales libérées, jamais « Compte supprimé »', async () => {
    const { api } = fakeApi({ deleteAuthAccount: async () => { throw err('auth/requires-recent-login'); } });
    const { local, released } = fakeLocal();
    const out = await deleteAccount(api, 'uid-1', 'pw', local);
    expect(out.status).toBe('cloud_deleted_account_active');
    expect(out.authDeleted).toBe(false);
    expect(out.localReleased).toBe(2);
    expect(released).toEqual(['uid-1']);
    expect(out.message).toMatch(/Données cloud supprimées, compte encore actif/);
    expect(out.message).toMatch(/Reconnectez-vous/);
    expect(out.message).not.toMatch(/Compte supprimé/);
  });

  it('échec du nettoyage local : signalé, la suppression du compte continue, les données ne sont pas supprimées', async () => {
    const { api, calls } = fakeApi();
    const local: LocalCleanup = { release: async () => { throw new Error('stockage'); } };
    const out = await deleteAccount(api, 'uid-1', 'pw', local);
    expect(out.status).toBe('completed');
    expect(out.localReleased).toBe(0);
    expect(out.message).toMatch(/peuvent rester masquées/);
    expect(calls).toEqual(['reauth', 'cloud', 'auth']);
  });

  it('le mot de passe n’apparaît dans aucun résultat', async () => {
    const out = await deleteAccount(fakeApi().api, 'uid-1', 'très-secret-42', fakeLocal().local);
    expect(JSON.stringify(out)).not.toContain('très-secret-42');
  });
});

describe('Délais et états incertains (phase E)', () => {
  const FAST = { reauthMs: 40, cloudMs: 40, authMs: 40 };
  const never = () => new Promise<never>(() => undefined);

  it('un rapport « incertain » (délai côté serveur) n’est jamais un succès : compte et données locales conservés, aucun nettoyage', async () => {
    const uncertainReport = report({ uncertain: true, verified: false, records: { found: 100, deleted: 0, remaining: null }, space: 'skipped', profile: 'skipped', error: { code: 'client-timeout', message: 'délai' } });
    const { api, calls } = fakeApi({ deleteCloudData: async () => (calls.push('cloud'), uncertainReport) });
    const { local, released } = fakeLocal();
    const out = await deleteAccount(api, 'uid-1', 'pw', local, FAST);
    expect(out.status).toBe('cloud_uncertain');
    expect(out.message).toMatch(/Suppression cloud incertaine/);
    expect(out.message).toMatch(/peut-être été appliquée/);
    expect(out.message).toMatch(/relit d’abord le serveur/);
    expect(out.message).not.toMatch(/Compte supprimé/);
    expect(calls).toEqual(['reauth', 'cloud']);
    expect(released).toEqual([]);
    expect(out.authDeleted).toBe(false);
  });

  it('la suppression cloud ne répond jamais : état incertain borné, pas de suppression du compte', async () => {
    const { api, calls } = fakeApi({ deleteCloudData: () => (calls.push('cloud'), never()) });
    const { local, released } = fakeLocal();
    const t0 = Date.now();
    const out = await deleteAccount(api, 'uid-1', 'pw', local, FAST);
    expect(Date.now() - t0).toBeLessThan(2000);
    expect(out.status).toBe('cloud_uncertain');
    expect(calls).toEqual(['reauth', 'cloud']);
    expect(released).toEqual([]);
  });

  it('la réauthentification ne répond jamais : « réauthentification nécessaire », rien n’a été supprimé', async () => {
    const { api, calls } = fakeApi({ reauthenticate: () => (calls.push('reauth'), never()) });
    const out = await deleteAccount(api, 'uid-1', 'pw', fakeLocal().local, FAST);
    expect(out.status).toBe('reauth_required');
    expect(out.message).toMatch(/n’a pas répondu à temps/);
    expect(out.message).toMatch(/Rien n’a été supprimé/);
    expect(calls).toEqual(['reauth']);
  });

  it('la suppression du compte ne répond jamais : « non confirmée », jamais « Compte supprimé » ; données locales déjà libérées', async () => {
    const { api, calls } = fakeApi({ deleteAuthAccount: () => (calls.push('auth'), never()) });
    const { local, released } = fakeLocal();
    const out = await deleteAccount(api, 'uid-1', 'pw', local, FAST);
    expect(out.status).toBe('account_uncertain');
    expect(out.authDeleted).toBe(false);
    expect(out.localReleased).toBe(2);
    expect(released).toEqual(['uid-1']);
    expect(out.message).toMatch(/n’a pas été confirmée/);
    expect(out.message).toMatch(/peut-être été appliquée/);
    expect(out.message).not.toMatch(/^Compte supprimé/);
    expect(calls).toEqual(['reauth', 'cloud', 'auth']);
  });

  it('un résultat tardif d’une opération abandonnée ne change pas l’état déjà rendu et ne provoque aucune erreur non gérée', async () => {
    const late = new Promise<CloudDeletionReport>((resolve) => setTimeout(() => resolve(report()), 120));
    const { api } = fakeApi({ deleteCloudData: () => late });
    const out = await deleteAccount(api, 'uid-1', 'pw', fakeLocal().local, FAST);
    expect(out.status).toBe('cloud_uncertain');
    await new Promise((r) => setTimeout(r, 200)); // la promesse abandonnée se résout après coup
    expect(out.status).toBe('cloud_uncertain');
  });

  it('un échec tardif d’une opération abandonnée ne casse rien non plus', async () => {
    const late = new Promise<CloudDeletionReport>((_, reject) => setTimeout(() => reject(new Error('trop tard')), 120));
    const { api } = fakeApi({ deleteCloudData: () => late });
    const out = await deleteAccount(api, 'uid-1', 'pw', fakeLocal().local, FAST);
    expect(out.status).toBe('cloud_uncertain');
    await new Promise((r) => setTimeout(r, 200));
  });

  it('un rapport avec espace ou profil « inconnu » est décrit sans rien affirmer, et n’est pas un succès', async () => {
    const unknown = report({ verified: false, space: 'unknown', profile: 'skipped', records: { found: 3, deleted: 3, remaining: 0 } });
    const { api, calls } = fakeApi({ deleteCloudData: async () => (calls.push('cloud'), unknown) });
    const out = await deleteAccount(api, 'uid-1', 'pw', fakeLocal().local, FAST);
    expect(out.status).toBe('cloud_incomplete');
    expect(out.message).toMatch(/suppression de l’espace non confirmée/);
    expect(calls).not.toContain('auth');
  });

  it('délais par défaut : bornés et raisonnables (aucune étape réseau sans délai maximal)', () => {
    const src = read('services/accountDeletionService.ts');
    expect(src).toMatch(/DEFAULT_TIMEOUTS: DeletionTimeouts = \{ reauthMs: 20_000, cloudMs: 10 \* 60 \* 1000, authMs: 20_000 \}/);
    for (const call of ['api.reauthenticate(password)', 'api.deleteCloudData(uid)', 'api.deleteAuthAccount()']) {
      expect(src).toContain(`withTimeout(${call}`);
    }
    const deletion = read('services/firebase/firestoreAccountDeletion.ts');
    expect(deletion).not.toMatch(/\bgetDoc\(|\bgetDocs\(/); // jamais de lecture pouvant venir du cache
    expect(deletion).toContain('getDocFromServer');
    expect(deletion).toContain('getDocsFromServer');
  });
});

describe('Données locales après la suppression cloud : conservées, de nouveau visibles', () => {
  const fakeState = (uid: string): SyncState => ({ uid, spaceId: `personal_${uid}`, enabledAt: '2026-01-01T00:00:00.000Z', entries: {}, lastSyncAt: null });
  const idsVisible = async (uid: string | null) => {
    setActiveCloudUid(uid);
    const ents = await ensureImmobilierTool();
    return (await coreService.getRecords({ toolId: ents.tool.id })).map((r) => r.id);
  };

  beforeEach(async () => {
    records.length = 0;
    externalContacts.length = 0;
    await AsyncStorage.clear();
    setActiveCloudUid(null);
    setCloudStampUid(null);
  });

  async function seed() {
    // Compte A : bien + logement synchronisés (marqués) + un contrat local qui en dépend ; compte B : un bien ; plus un bien historique.
    const historique = await createBien({ nom: 'Maison historique', adresse: 'Lomé' });
    setCloudStampUid('uidA');
    setActiveCloudUid('uidA');
    const bienA = await createBien({ nom: 'Maison A', adresse: 'Lomé' });
    const logementA = await createLogement({ bienId: bienA.id, nom: 'Chambre A', loyerReference: 10000 });
    const { contrat } = await createLocataireEtContrat({ bienId: bienA.id, logementId: logementA.id, nom: 'Ama', telephone: '90123456', loyerMensuel: 10000, dateEntree: new Date() });
    setCloudStampUid('uidB');
    setActiveCloudUid('uidB');
    const bienB = await createBien({ nom: 'Maison B', adresse: 'Kara' });
    setCloudStampUid(null);
    setActiveCloudUid(null);
    await saveSyncState(fakeState('uidA'));
    await saveSyncState(fakeState('uidB'));
    return { historique, bienA, logementA, contrat, bienB };
  }

  it('releaseLocalOwnership : les données du compte supprimé redeviennent locales et visibles ; rien n’est supprimé ; l’autre compte reste masqué et intact', async () => {
    const s = await seed();
    const total = records.length;
    expect(await idsVisible(null)).toEqual([s.historique.id]); // avant : seules les données historiques sont visibles sans compte

    const out = await releaseLocalOwnership('uidA');
    expect(out.released).toBe(2); // bien et logement marqués
    expect(records).toHaveLength(total); // aucune suppression
    const visible = await idsVisible(null);
    expect(visible).toEqual(expect.arrayContaining([s.historique.id, s.bienA.id, s.logementA.id, s.contrat.id])); // le contrat dépendant réapparaît aussi
    expect(visible).not.toContain(s.bienB.id); // le compte B reste masqué
    expect(records.find((r) => r.id === s.bienB.id)?.cloudOwnerUid).toBe('uidB');
    expect(records.find((r) => r.id === s.bienA.id)?.values.nom).toBe('Maison A'); // contenu inchangé
    expect(await loadSyncState('uidA')).toBeNull(); // état du compte supprimé oublié
    expect(await loadSyncState('uidB')).not.toBeNull(); // l'état de l'autre compte est conservé
    // et visibles aussi sous un autre compte : ce sont désormais des données locales
    expect(await idsVisible('uidB')).toEqual(expect.arrayContaining([s.bienA.id, s.bienB.id]));
  });

  it('un compte sans donnée marquée : rien à libérer, aucune erreur', async () => {
    await seed();
    expect((await releaseLocalOwnership('uidZ')).released).toBe(0);
  });

  it('hiddenOwnerSummary et releaseHiddenOwnership : l’utilisateur peut rendre visibles les données masquées d’autres comptes (action explicite)', async () => {
    const s = await seed();
    expect(hiddenOwnerSummary(null)).toEqual({ total: 3, owners: { uidA: 2, uidB: 1 } });
    expect(hiddenOwnerSummary('uidA')).toEqual({ total: 1, owners: { uidB: 1 } }); // les siennes ne comptent pas
    const total = records.length;
    const out = await releaseHiddenOwnership(null);
    expect(out.released).toBe(3);
    expect(records).toHaveLength(total);
    expect(hiddenOwnerSummary(null).total).toBe(0);
    expect((await idsVisible(null)).sort()).toEqual(expect.arrayContaining([s.bienA.id, s.bienB.id, s.logementA.id, s.contrat.id, s.historique.id].sort()));
    expect(visibleRecordsFor(records, null)).toHaveLength(total);
  });
});

describe('Écran : aucune suppression sans confirmation explicite', () => {
  const screen = read('features/profile/screens/CloudAccountScreen.tsx');

  it('l’entrée « Supprimer mon compte » ouvre seulement la confirmation ; la suppression ne part que de l’action confirmée', () => {
    expect(screen).toContain('<DestructiveButton label="Supprimer mon compte"');
    expect(screen).toMatch(/<DestructiveButton label="Supprimer mon compte"[^>]*onPress=\{\(\) => setConfirmDelete\(true\)\}/);
    expect(screen.match(/s\.deleteAccount\(/g)).toHaveLength(1); // un seul appel, dans runDelete
    expect(screen).toMatch(/const runDelete = async \(\) => \{[\s\S]*?await s\.deleteAccount\(pwd\);/);
    expect(screen).toMatch(/label: 'Supprimer définitivement', variant: 'destructive'[^}]*onPress: \(\) => \{ if \(password\) void runDelete\(\); \}/);
  });

  it('la confirmation explique ce qui est supprimé, conservé, irréversible et ce qui reste sur les autres appareils ; le mot de passe est effacé après usage', () => {
    for (const phrase of ['irréversible', 'Seront supprimés dans le cloud', 'Seront conservées', 'autres appareils', 'saisissez votre mot de passe']) {
      expect(screen).toContain(phrase);
    }
    expect(screen).toContain("setPassword(''); // le mot de passe n'est conservé nulle part");
    expect(screen).toContain('secureToggle');
  });

  it('les états d’échec ont leur propre affichage et la reprise est proposée ; « Compte supprimé » seulement pour un succès confirmé', () => {
    expect(screen).toContain("outcome.status === 'completed' ? 'Compte supprimé' : 'Suppression du compte'");
    expect(screen).toContain('Réessayer la suppression');
  });
});
