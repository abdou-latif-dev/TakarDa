// Phase 7 — correctifs bloquants : (1) isolation locale d'un compte en MODE MOTEUR (création, avant la première capture, pendant la capture), (2) suppression de
// compte jamais poursuivie si l'arrêt de la synchronisation n'est pas confirmé, (3) gardes de coreService et des statistiques de formulaire contre l'appel direct.
// Aucun réseau, aucun Firebase : cloud et authentification simulés.

import AsyncStorage from '@react-native-async-storage/async-storage';
import * as dbModule from '../db';
import { documents, entityDefinitions, externalContacts, records, roleDefinitions, tools } from '../db';
import { coreService } from '../coreService';
import { setActiveCloudUid, setEngineStampUid } from '../cloudVisibility';
import { __resetDeviceAccountsForTests, registerDeviceAccount } from '../deviceAccounts';
import { __useLockFlagForTests, ModuleLockedError } from '../moduleLock';
import { createBien, createLocataireEtContrat, listBiensWithSummary, resetImmobilierToolCache } from '../immobilierService';
import { ensureFacturesTool } from '../facturesService';
import { statisticsService } from '../statisticsService';
import { switchWorkspace } from '../persistence';
import { setSyncAccount } from '../sync/syncAccount';
import { __useActivationForTests, activateSync } from '../sync/syncActivation';
import { captureLocalChanges } from '../sync/syncEngine';
import { __useSyncScopeForTests } from '../sync/syncScope';
import { __resetSyncModeForTests, noteV1State } from '../syncMode';
import { activateEngine, createSyncLifecycle } from '../syncLifecycle';
import { setEmailVerified } from '../accountVerification';
import { useCloudStore } from '@/store/cloudStore';

jest.mock('../db', () => ({ ...jest.requireActual('../db'), delay: () => Promise.resolve() }));
jest.mock('@react-native-async-storage/async-storage', () => jest.requireActual('@react-native-async-storage/async-storage/jest/async-storage-mock'));

const mockAuth = { listener: null as null | ((u: { uid: string; email: string | null } | null) => void) };
const mockDeletion = {
  reauthenticate: jest.fn(async (_password?: string) => undefined),
  deleteCloudData: jest.fn(async (_uid?: string): Promise<unknown> => ({ ownership: 'proven', records: { found: 0, deleted: 0, remaining: 0 }, space: 'deleted', profile: 'deleted', verified: true, uncertain: false, error: null, locked: true })),
  deleteAuthAccount: jest.fn(async () => undefined),
};
const mockQuiesce = { result: true };

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
  readDeletionLock: async () => 'unknown',
}));
jest.mock('@/services/firebase/firestoreRecordsApi', () => ({ firestoreRecordsApi: { ensureSpace: async (uid: string) => `personal_${uid}`, fetchRecords: async () => [], writeRecord: async () => 1, markDeleted: async () => 1 } }));
jest.mock('@/services/syncLifecycle', () => ({ ...jest.requireActual('@/services/syncLifecycle'), quiesceSyncLifecycle: async () => mockQuiesce.result }));

const open = () => true;

beforeEach(async () => {
  await AsyncStorage.clear();
  __useSyncScopeForTests(null);
  __useActivationForTests(true);
  await switchWorkspace('personal');
  for (const [name, value] of Object.entries(dbModule)) if (Array.isArray(value) && name !== 'formTemplates') value.length = 0;
  dbModule.users.push(dbModule.defaultLocalUser());
  resetImmobilierToolCache();
  __resetDeviceAccountsForTests();
  __resetSyncModeForTests();
  __useLockFlagForTests(null);
  setEngineStampUid(null);
  setActiveCloudUid('alice');
  setSyncAccount('alice');
  setEmailVerified('alice', true); // F1 : adresse vérifiée requise pour activer le moteur
  noteV1State('alice', false);
  noteV1State('bob', false);
  mockQuiesce.result = true;
  jest.clearAllMocks();
});
afterEach(() => {
  __useLockFlagForTests(null);
  __useActivationForTests(false);
  setEngineStampUid(null);
  setActiveCloudUid(null);
});

const asBob = () => {
  setEngineStampUid(null); // le pilotage retire la marque du compte précédent (voir syncLifecycle) ; Bob n'a pas choisi le moteur
  setActiveCloudUid('bob');
  setSyncAccount('bob');
};
const asAlice = () => {
  setActiveCloudUid('alice');
  setSyncAccount('alice');
};
const bobCannotReach = async (ids: { bien: string; contact: string }) => {
  expect(await coreService.getRecord(ids.bien)).toBeNull();
  expect((await coreService.getRecords({})).map((r) => r.id)).not.toContain(ids.bien);
  await expect(coreService.updateRecord(ids.bien, { values: { nom: 'piraté' } })).rejects.toThrow(/introuvable/);
  await coreService.deleteRecord(ids.bien);
  expect(records.find((r) => r.id === ids.bien)?.values.nom).not.toBe('piraté');
  expect(records.some((r) => r.id === ids.bien)).toBe(true); // jamais supprimé
  expect((await listBiensWithSummary()).map((b) => b.bien.id)).not.toContain(ids.bien);
  expect(await coreService.getExternalContact(ids.contact)).toBeNull();
  await expect(coreService.updateExternalContact(ids.contact, { name: 'piraté' })).rejects.toThrow(/introuvable/);
  await coreService.deleteExternalContact(ids.contact);
  expect(externalContacts.some((c) => c.id === ids.contact)).toBe(true);
};

describe('Isolation d’un compte en mode moteur', () => {
  it('Alice choisit le moteur, crée un bien, se déconnecte ; Bob se connecte : il ne peut ni le voir, ni le modifier, ni le supprimer ; Alice le retrouve intact', async () => {
    expect(await activateEngine('alice', open)).toEqual({ ok: true });
    const bien = await createBien({ nom: 'Maison Alice', adresse: 'Lomé' });
    const { contrat } = await createLocataireEtContrat({ bienId: bien.id, nouveauLogement: { nom: 'Chambre' }, nom: 'Koffi', telephone: '90123456', loyerMensuel: 25000, dateEntree: new Date(2026, 0, 5), dernierLoyerPaye: '2026-09' });
    expect(records.find((r) => r.id === bien.id)?.cloudOwnerUid).toBe('alice'); // marqué dès la création, AVANT toute capture
    const contact = String(contrat.values.locataire_id);
    asBob();
    await bobCannotReach({ bien: bien.id, contact });
    // les enfants (logement, contrat) suivent le bien : introuvables pour Bob
    expect(await coreService.getRecord(contrat.id)).toBeNull();
    // Bob crée son propre bien : invisible pour Alice, qui retrouve les siens
    const bobBien = await createBien({ nom: 'Maison Bob', adresse: 'Kara' });
    expect(records.find((r) => r.id === bobBien.id)?.cloudOwnerUid).toBeUndefined(); // Bob n'est pas en mode moteur : comportement actuel inchangé
    asAlice();
    expect((await coreService.getRecord(bien.id))?.values.nom).toBe('Maison Alice');
    expect((await coreService.getExternalContact(contact))?.name).toBe('Koffi');
  });

  it('créé AVANT la première capture (aucune marque posée à la création) : la capture inscrit le compte ET pose la marque d’affichage ; Bob ne le voit plus', async () => {
    await activateSync(new Date(Date.now() - 60_000)); // activation sans marque d'affichage (marqueur persistant non lu, pilotage absent)
    const bien = await createBien({ nom: 'Créé avant capture', adresse: 'X' });
    const { contrat } = await createLocataireEtContrat({ bienId: bien.id, nouveauLogement: { nom: 'C' }, nom: 'Ama', telephone: '90123456', loyerMensuel: 20000, dateEntree: new Date(2026, 0, 5), dernierLoyerPaye: '2026-09' });
    expect(records.find((r) => r.id === bien.id)?.cloudOwnerUid).toBeUndefined();
    asBob();
    expect(await coreService.getRecord(bien.id)).not.toBeNull(); // avant la capture : encore une donnée sans marque (cas fenêtre courte)
    asAlice();
    await captureLocalChanges({ scope: { enabledAt: '2000-01-01T00:00:00.000Z' }, now: new Date() });
    expect(records.find((r) => r.id === bien.id)?.cloudOwnerUid).toBe('alice');
    const contact = String(contrat.values.locataire_id);
    expect(externalContacts.find((c) => c.id === contact)?.cloudOwnerUid).toBe('alice');
    asBob();
    await bobCannotReach({ bien: bien.id, contact });
  });

  it('contexte incohérent (compte de synchronisation ≠ compte cloud actif) : la capture ne pose AUCUNE marque d’affichage ; le registre de propriété seul inscrit le compte', async () => {
    await activateSync(new Date(Date.now() - 60_000));
    const bien = await createBien({ nom: 'Incohérent', adresse: 'X' });
    setActiveCloudUid('bob'); // le compte cloud actif n'est pas celui du moteur (alice)
    await captureLocalChanges({ scope: { enabledAt: '2000-01-01T00:00:00.000Z' }, now: new Date() });
    expect(records.find((r) => r.id === bien.id)?.cloudOwnerUid).toBeUndefined(); // jamais marqué au nom du mauvais compte
    setActiveCloudUid(null); // aucun compte cloud actif : même résultat
    await captureLocalChanges({ scope: { enabledAt: '2000-01-01T00:00:00.000Z' }, now: new Date() });
    expect(records.find((r) => r.id === bien.id)?.cloudOwnerUid).toBeUndefined();
    setActiveCloudUid('alice'); // cohérent : la marque est posée à la capture suivante pour ce qui est encore sans marque
    const other = await createBien({ nom: 'Cohérent', adresse: 'Y' });
    await captureLocalChanges({ scope: { enabledAt: '2000-01-01T00:00:00.000Z' }, now: new Date() });
    expect(records.find((r) => r.id === other.id)?.cloudOwnerUid).toBe('alice');
  });

  it('ancienne donnée (antérieure à l’activation) : jamais capturée, jamais marquée, aucune migration automatique', async () => {
    const legacy = await createBien({ nom: 'Ancien', adresse: 'X' });
    await activateSync(new Date(Date.now() + 0));
    await captureLocalChanges({ scope: { enabledAt: '2000-01-01T00:00:00.000Z' }, now: new Date() });
    expect(records.find((r) => r.id === legacy.id)?.cloudOwnerUid).toBeUndefined();
    asBob();
    expect(await coreService.getRecord(legacy.id)).not.toBeNull(); // donnée locale historique : visible comme avant
  });

  it('le pilotage retire la marque du compte précédent : un compte sans choix du moteur ne marque rien', async () => {
    expect(await activateEngine('alice', open)).toEqual({ ok: true });
    const marked = await createBien({ nom: 'Alice', adresse: 'X' });
    expect(records.find((r) => r.id === marked.id)?.cloudOwnerUid).toBe('alice');
    const lifecycle = createSyncLifecycle({ enabled: () => true, personalWorkspace: () => true, engineChosen: async (uid) => uid === 'alice', boot: async () => undefined, shutdown: () => undefined });
    await lifecycle.apply({ authStatus: 'signedIn', uid: 'alice', epoch: 1, deleting: false });
    await lifecycle.apply({ authStatus: 'signedIn', uid: 'bob', epoch: 2, deleting: false });
    setActiveCloudUid('bob');
    setSyncAccount('bob');
    const bobs = await createBien({ nom: 'Bob', adresse: 'Y' });
    expect(records.find((r) => r.id === bobs.id)?.cloudOwnerUid).toBeUndefined();
    lifecycle.dispose();
  });
});

describe('Suppression de compte : jamais poursuivie sans arrêt confirmé', () => {
  async function signedIn() {
    useCloudStore.getState().init();
    mockAuth.listener?.({ uid: 'alice', email: 'a@example.test' });
    await new Promise((resolve) => setTimeout(resolve, 20));
  }

  it('arrêt non confirmé (quiesce = false) : rien n’est lancé, ni réauthentification ni suppression cloud, échec explicite, état remis à zéro', async () => {
    await signedIn();
    mockQuiesce.result = false;
    const outcome = await useCloudStore.getState().deleteAccount('secret1');
    expect(outcome).toBeNull();
    expect(mockDeletion.reauthenticate).not.toHaveBeenCalled();
    expect(mockDeletion.deleteCloudData).not.toHaveBeenCalled();
    expect(mockDeletion.deleteAuthAccount).not.toHaveBeenCalled();
    const state = useCloudStore.getState();
    expect(state.error).toMatch(/n’a pas pu être arrêtée.*rien n’a été effacé/);
    expect(state.deleting).toBe(false);
    expect(state.busy).toBe(false);
    expect(state.deletion).toBeNull(); // on ne prétend ni échec partiel ni succès
  });

  it('arrêt confirmé : la suppression suit son cours', async () => {
    await signedIn();
    mockQuiesce.result = true;
    await useCloudStore.getState().deleteAccount('secret1');
    expect(mockDeletion.reauthenticate).toHaveBeenCalledTimes(1);
    expect(mockDeletion.deleteCloudData).toHaveBeenCalledTimes(1);
  });
});

describe('Appels directs refusés pour les modules verrouillés', () => {
  async function world() {
    const factures = await ensureFacturesTool();
    const doc = await coreService.createDocument({ toolId: factures.tool.id, kind: 'file', uri: 'file:///x.pdf', name: 'x.pdf' });
    const facture = await coreService.createRecord({ toolId: factures.tool.id, entityDefinitionId: factures.facturePartageeDefinition.id, values: {} });
    const docOfRecord = await coreService.createDocument({ recordId: facture.id, kind: 'image', uri: 'file:///y.png' });
    const roleId = roleDefinitions.find((r) => r.toolId === factures.tool.id)?.id;
    await registerDeviceAccount('alice');
    await registerDeviceAccount('bob');
    __useLockFlagForTests(true);
    return { factures, doc, docOfRecord, roleId };
  }

  it('multi-compte : deleteTool, updateTool, updateEntityDefinition, deleteEntityDefinition, createDocument refusés ; getDocument et getRoleDefinitions ne renvoient rien ; rien n’est supprimé', async () => {
    const w = await world();
    const before = JSON.stringify({ tools, entityDefinitions, records, documents, roleDefinitions });
    await expect(coreService.deleteTool(w.factures.tool.id)).rejects.toBeInstanceOf(ModuleLockedError);
    await expect(coreService.updateTool(w.factures.tool.id, { name: 'piraté' })).rejects.toBeInstanceOf(ModuleLockedError);
    await expect(coreService.updateEntityDefinition(w.factures.facturePartageeDefinition.id, { label: 'piraté' })).rejects.toBeInstanceOf(ModuleLockedError);
    await expect(coreService.deleteEntityDefinition(w.factures.facturePartageeDefinition.id)).rejects.toBeInstanceOf(ModuleLockedError);
    await expect(coreService.createDocument({ toolId: w.factures.tool.id, kind: 'file', uri: 'file:///z' })).rejects.toBeInstanceOf(ModuleLockedError);
    expect(await coreService.getDocument(w.doc.id)).toBeNull();
    expect(await coreService.getDocument(w.docOfRecord.id)).toBeNull(); // pièce jointe d'un enregistrement d'un outil verrouillé
    expect(await coreService.getRoleDefinitions(w.factures.tool.id)).toEqual([]);
    expect(JSON.stringify({ tools, entityDefinitions, records, documents, roleDefinitions })).toBe(before);
  });

  it('multi-compte : les pièces jointes et rôles d’Immobilier restent accessibles', async () => {
    await world();
    const bien = await createBien({ nom: 'Maison', adresse: 'X' });
    const doc = await coreService.createDocument({ recordId: bien.id, kind: 'image', uri: 'file:///m.png' });
    expect((await coreService.getDocument(doc.id))?.id).toBe(doc.id);
  });

  it('hors contexte multi-compte : comportement inchangé', async () => {
    const factures = await ensureFacturesTool();
    const doc = await coreService.createDocument({ toolId: factures.tool.id, kind: 'file', uri: 'file:///x.pdf' });
    expect((await coreService.getDocument(doc.id))?.id).toBe(doc.id);
    expect((await coreService.getRoleDefinitions(factures.tool.id)).length).toBeGreaterThanOrEqual(0);
    await expect(coreService.updateTool(factures.tool.id, { name: 'Factures 2' })).resolves.toBeDefined();
  });

  it('getFormStatistics : refusé en multi-compte (aucun compteur de réponses exposé) ; normal sinon', async () => {
    dbModule.submissions.push({ id: 's1', formId: 'f1', status: 'validated', createdAt: '2026-10-20T10:00:00.000Z' } as never);
    await expect(statisticsService.getFormStatistics('f1')).resolves.toMatchObject({ responses: 1 });
    await registerDeviceAccount('alice');
    await registerDeviceAccount('bob');
    __useLockFlagForTests(true);
    await expect(statisticsService.getFormStatistics('f1')).rejects.toBeInstanceOf(ModuleLockedError);
    expect(dbModule.submissions).toHaveLength(1);
  });
});
