// Phase 7 — protections multi-compte au niveau des SERVICES et de la couche de données (pas seulement des écrans) : sauvegarde/restauration, notifications,
// compteurs de stockage, coreService (outils, enregistrements, membres, événements, contacts), services historiques protégés. Dans chaque cas : aucune donnée
// d'un autre compte n'est chargée, exposée, modifiée ni supprimée ; les données restent intactes ; hors contexte multi-compte, comportement inchangé.

import * as dbModule from '../db';
import { activityEvents, externalContacts, forms, notifications, records, tools } from '../db';
import { coreService } from '../coreService';
import { setActiveCloudUid } from '../cloudVisibility';
import { __resetDeviceAccountsForTests, registerDeviceAccount } from '../deviceAccounts';
import { __useLockFlagForTests, ModuleLockedError } from '../moduleLock';
import { applyRestore, createBackup, planRestore } from '../backupService';
import { notificationService } from '../notificationService';
import { storageUsageService } from '../storageUsageService';
import { groupService } from '../groupService';
import { tontineService } from '../tontineService';
import { formService } from '../formService';
import { submissionService } from '../submissionService';
import { formTemplateService } from '../formTemplateService';
import { ensureFacturesTool } from '../facturesService';
import { createBien, createLocataireEtContrat, deleteBienCascade, resetImmobilierToolCache } from '../immobilierService';
import { getMyTools, installTool, ensureInstalledTools } from '../toolRegistryService';
import { activityService } from '../activityService';
import { loadTontineOverview } from '../tontineOverviewService';
import { getToursForGroup } from '../tontineTours';
import { switchWorkspace } from '../persistence';

jest.mock('../db', () => ({ ...jest.requireActual('../db'), delay: () => Promise.resolve() }));

const mockMemory = new Map<string, string>();
jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: {
    getItem: async (key: string) => (mockMemory.has(key) ? (mockMemory.get(key) as string) : null),
    setItem: async (key: string, value: string) => void mockMemory.set(key, value),
    removeItem: async (key: string) => void mockMemory.delete(key),
    clear: async () => mockMemory.clear(),
    getAllKeys: async () => [...mockMemory.keys()],
  },
}));

interface World {
  bienAlice: string;
  bienBob: string;
  tenantContactId: string;
  unlinkedContactId: string;
  factureRecordId: string;
  factureToolId: string;
}

/** Données réalistes, créées AVANT d'activer le verrou : Immobilier d'Alice (avec locataire), un bien de Bob, un contact sans lien, un outil Factures avec un enregistrement. */
async function seedWorld(): Promise<World> {
  const bienAlice = await createBien({ nom: 'Maison Alice', adresse: 'Lomé' });
  const { contrat } = await createLocataireEtContrat({ bienId: bienAlice.id, nouveauLogement: { nom: 'Chambre' }, nom: 'Koffi', telephone: '90123456', loyerMensuel: 25000, dateEntree: new Date(2026, 0, 5), dernierLoyerPaye: '2026-09' });
  const bienBob = await createBien({ nom: 'Maison Bob', adresse: 'Kara' });
  bienBob.cloudOwnerUid = 'bob'; // bien d'un autre compte (masqué par le masquage existant)
  const unlinked = await coreService.createExternalContact({ name: 'Participant CEET', phone: '90000000' });
  const factures = await ensureFacturesTool();
  const facture = await coreService.createRecord({ toolId: factures.tool.id, entityDefinitionId: factures.facturePartageeDefinition.id, values: {} });
  notifications.push({ id: 'n1', type: 'info', title: 'Cotisation', description: 'Tontine de Bob', read: false, at: '2026-10-20T10:00:00.000Z' } as never);
  forms.push({ id: 'f1', title: 'Formulaire de Bob', fields: [{ id: 'x', type: 'file' }] } as never);
  return {
    bienAlice: bienAlice.id,
    bienBob: bienBob.id,
    tenantContactId: String(contrat.values.locataire_id),
    unlinkedContactId: unlinked.id,
    factureRecordId: facture.id,
    factureToolId: factures.tool.id,
  };
}

const dataSnapshot = () => JSON.stringify({ records, externalContacts, tools, forms, notifications, activityEvents });

async function lockOn() {
  await registerDeviceAccount('alice');
  await registerDeviceAccount('bob');
  setActiveCloudUid('alice');
  __useLockFlagForTests(true);
}

let world: World;
beforeEach(async () => {
  mockMemory.clear();
  await switchWorkspace('personal');
  for (const [name, value] of Object.entries(dbModule)) if (Array.isArray(value) && name !== 'formTemplates') value.length = 0;
  dbModule.users.push(dbModule.defaultLocalUser());
  resetImmobilierToolCache();
  __resetDeviceAccountsForTests();
  __useLockFlagForTests(null);
  setActiveCloudUid(null);
  world = await seedWorld();
});
afterEach(() => {
  __useLockFlagForTests(null);
  setActiveCloudUid(null);
});

describe('Sauvegarde et restauration', () => {
  it('multi-compte : export, plan et restauration refusés AVANT toute lecture ; aucune donnée modifiée', async () => {
    const backup = createBackup(); // hors verrou : sauvegarde valide à restaurer
    await lockOn();
    const before = dataSnapshot();
    expect(() => createBackup()).toThrow(ModuleLockedError);
    expect(() => planRestore(backup, 'merge')).toThrow(ModuleLockedError);
    await expect(applyRestore(backup, { confirmed: true, mode: 'replace', allowShrink: true })).rejects.toBeInstanceOf(ModuleLockedError);
    await expect(applyRestore({}, { confirmed: false })).rejects.toBeInstanceOf(ModuleLockedError); // même une demande invalide : refus de verrou d'abord
    expect(dataSnapshot()).toBe(before); // ni exposé, ni remplacé, ni supprimé
  });

  it('drapeau fermé, puis un seul compte connu sans marque d’un autre compte (drapeau ouvert) : la sauvegarde reste possible et complète ; une marque d’un autre compte la refuse', async () => {
    expect(createBackup().data.records.length).toBe(records.length); // drapeau fermé
    const bob = records.find((r) => r.id === world.bienBob)!;
    bob.cloudOwnerUid = undefined; // plus aucune marque d'un autre compte
    await registerDeviceAccount('alice');
    setActiveCloudUid('alice');
    __useLockFlagForTests(true);
    expect(createBackup().data.records.length).toBe(records.length); // un seul compte connu : comportement inchangé
    bob.cloudOwnerUid = 'bob'; // une donnée d'un autre compte apparaît (reçue, restaurée…) : le contexte devient multi-compte
    expect(() => createBackup()).toThrow(ModuleLockedError);
  });
});

describe('Notifications et compteurs de stockage', () => {
  it('multi-compte : notifications vides, marquage sans effet ; compteurs nuls ; données conservées', async () => {
    await lockOn();
    expect(await notificationService.list()).toEqual([]);
    await notificationService.markAsRead('n1');
    await notificationService.markAllAsRead();
    expect(notifications[0].read).toBe(false); // rien n'a été modifié
    expect(await storageUsageService.getUsage()).toEqual({ formsCount: 0, submissionsCount: 0, attachmentFieldsCount: 0 });
    expect(notifications).toHaveLength(1);
    expect(forms).toHaveLength(1);
  });

  it('hors contexte multi-compte : comportement inchangé', async () => {
    expect((await notificationService.list()).map((n) => n.id)).toEqual(['n1']);
    await notificationService.markAllAsRead();
    expect(notifications[0].read).toBe(true);
    expect(await storageUsageService.getUsage()).toMatchObject({ formsCount: 1, attachmentFieldsCount: 1 });
  });
});

describe('coreService : outils, enregistrements, membres, événements', () => {
  it('multi-compte : l’outil Factures et ses enregistrements sont introuvables ; toute écriture est refusée ; rien n’est supprimé', async () => {
    await lockOn();
    const before = dataSnapshot();
    expect(await coreService.getTool(world.factureToolId)).toBeNull();
    expect((await coreService.getTools()).map((t) => t.kind)).toEqual(['immobilier']);
    expect(await coreService.getRecords({ toolId: world.factureToolId })).toEqual([]);
    expect(await coreService.getRecords({})).not.toContainEqual(expect.objectContaining({ id: world.factureRecordId }));
    expect(await coreService.getRecord(world.factureRecordId)).toBeNull();
    expect(await coreService.getToolMembers(world.factureToolId)).toEqual([]);
    expect(await coreService.getEvents({ toolId: world.factureToolId })).toEqual([]);
    await expect(coreService.updateRecord(world.factureRecordId, { statusKey: 'payee' })).rejects.toBeInstanceOf(ModuleLockedError);
    await expect(coreService.deleteRecord(world.factureRecordId)).rejects.toBeInstanceOf(ModuleLockedError);
    await expect(coreService.createRecord({ toolId: world.factureToolId, entityDefinitionId: 'x', values: {} })).rejects.toBeInstanceOf(ModuleLockedError);
    await expect(coreService.addToolMember({ toolId: world.factureToolId, roleId: 'r', accountType: 'external', displayName: 'X' })).rejects.toBeInstanceOf(ModuleLockedError);
    await expect(coreService.createTool({ name: 'Autre', icon: 'x', kind: 'custom' })).rejects.toBeInstanceOf(ModuleLockedError);
    expect(dataSnapshot()).toBe(before);
  });

  it('multi-compte : les données Immobilier du compte actif restent pleinement utilisables ; celles d’un autre compte restent masquées et intactes', async () => {
    await lockOn();
    expect((await coreService.getRecord(world.bienAlice))?.values.nom).toBe('Maison Alice');
    await coreService.updateRecord(world.bienAlice, { values: { nom: 'Maison Alice 2' } });
    expect((await coreService.getRecord(world.bienAlice))?.values.nom).toBe('Maison Alice 2');
    // le bien de Bob : introuvable, non modifiable, non supprimable
    expect(await coreService.getRecord(world.bienBob)).toBeNull();
    await expect(coreService.updateRecord(world.bienBob, { values: { nom: 'piraté' } })).rejects.toThrow(/introuvable/);
    await coreService.deleteRecord(world.bienBob);
    expect(records.find((r) => r.id === world.bienBob)?.values.nom).toBe('Maison Bob');
    // un nouveau bien (créé sous Alice) ; la suppression en cascade d'un bien fonctionne malgré le module CEET/TDE verrouillé, sans toucher aux factures
    const created = await createBien({ nom: 'Nouveau', adresse: 'X' });
    await deleteBienCascade(created.id);
    expect(records.some((r) => r.id === world.factureRecordId)).toBe(true);
  });

  it('hors contexte multi-compte : l’outil Factures et ses enregistrements sont accessibles', async () => {
    expect(await coreService.getTool(world.factureToolId)).not.toBeNull();
    expect((await coreService.getRecords({ toolId: world.factureToolId })).map((r) => r.id)).toContain(world.factureRecordId);
  });
});

describe('Contacts', () => {
  it('multi-compte : le contact non lié est masqué (lecture, modification, suppression) ; le locataire d’un contrat reste visible ; un contact créé par le compte actif est visible pour lui', async () => {
    await lockOn();
    const before = JSON.stringify(externalContacts);
    expect(await coreService.getExternalContact(world.unlinkedContactId)).toBeNull();
    expect((await coreService.getExternalContacts()).map((c) => c.id)).not.toContain(world.unlinkedContactId);
    await expect(coreService.updateExternalContact(world.unlinkedContactId, { name: 'piraté' })).rejects.toThrow(/introuvable/);
    await coreService.deleteExternalContact(world.unlinkedContactId);
    expect(JSON.stringify(externalContacts)).toBe(before); // ni modifié ni supprimé
    expect((await coreService.getExternalContact(world.tenantContactId))?.name).toBe('Koffi');
    const mine = await coreService.createExternalContact({ name: 'Nouveau locataire' });
    expect(mine.cloudOwnerUid).toBe('alice');
    expect((await coreService.getExternalContact(mine.id))?.id).toBe(mine.id);
  });

  it('un contact marqué d’un autre compte reste masqué', async () => {
    await lockOn();
    externalContacts.find((c) => c.id === world.unlinkedContactId)!.cloudOwnerUid = 'bob';
    expect(await coreService.getExternalContact(world.unlinkedContactId)).toBeNull();
  });

  it('hors contexte multi-compte : le contact non lié est visible', async () => {
    expect((await coreService.getExternalContact(world.unlinkedContactId))?.name).toBe('Participant CEET');
  });
});

describe('Services historiques protégés', () => {
  it('multi-compte : chaque méthode des services de tontines, formulaires, réponses et modèles est refusée avant toute lecture ou écriture', async () => {
    await lockOn();
    const before = dataSnapshot();
    for (const [name, service] of Object.entries({ groupService, tontineService, formService, submissionService, formTemplateService })) {
      const methods = Object.entries(service as Record<string, unknown>).filter(([, v]) => typeof v === 'function');
      expect([name, methods.length > 0]).toEqual([name, true]);
      for (const [method, fn] of methods) {
        expect([name, method, (() => { try { (fn as (...a: unknown[]) => unknown)('x', 'y'); return 'no_throw'; } catch (e) { return e instanceof ModuleLockedError ? 'locked' : 'other'; } })()]).toEqual([name, method, 'locked']);
      }
    }
    await expect(loadTontineOverview()).rejects.toBeInstanceOf(ModuleLockedError);
    expect(() => getToursForGroup('g')).toThrow(ModuleLockedError);
    await expect(activityService.createEvent({ groupId: 'g', title: 't', description: 'd' })).rejects.toBeInstanceOf(ModuleLockedError);
    expect(dataSnapshot()).toBe(before);
  });

  it('hors contexte multi-compte : les mêmes services répondent normalement', async () => {
    await expect(groupService.listMyGroups()).resolves.toBeDefined();
    await expect(formService.listMyForms()).resolves.toBeDefined();
    await expect(submissionService.listAll()).resolves.toBeDefined();
    await expect(loadTontineOverview()).resolves.toBeDefined();
  });
});

describe('Outils installés', () => {
  it('multi-compte : seuls les outils Immobilier sont listés ; aucune installation ni création automatique', async () => {
    await lockOn();
    const mine = await getMyTools();
    expect([...mine.owned, ...mine.hidden, ...mine.shared].every((t) => t.tool.kind === 'immobilier')).toBe(true);
    await expect(installTool('tontine')).rejects.toBeInstanceOf(ModuleLockedError);
    const toolCount = tools.length;
    expect(await ensureInstalledTools()).toEqual([]);
    expect(tools).toHaveLength(toolCount);
  });
});
