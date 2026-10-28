// Phase 4 — Catalogue (modèles) → Mes Outils (Tool du Core) → données.
// Chaque test repart d'une base vide (jest.resetModules) : les services mémorisent
// leurs outils, on ne peut donc pas simplement vider les tableaux entre deux tests.

jest.mock('../db', () => ({ ...jest.requireActual('../db'), delay: () => Promise.resolve() }));
jest.mock('@react-native-async-storage/async-storage', () => require('@react-native-async-storage/async-storage/jest/async-storage-mock'));

import { getCatalogModel, getCatalogModels, isInstallableModel, type ToolModelKey } from '../toolCatalogService';
import { selectOwnedTools, selectSharedTools } from '../toolRegistryService';
import type { Tool, ToolMember } from '@/types/entities';

/* eslint-disable @typescript-eslint/no-require-imports */
function fresh() {
  jest.resetModules();
  return {
    db: require('../db') as typeof import('../db'),
    core: require('../coreService') as typeof import('../coreService'),
    registry: require('../toolRegistryService') as typeof import('../toolRegistryService'),
    identity: require('../identityService') as typeof import('../identityService'),
    groupService: require('../groupService').groupService as typeof import('../groupService').groupService,
    immo: require('../immobilierService') as typeof import('../immobilierService'),
    parts: require('../utilityParticipantsService') as typeof import('../utilityParticipantsService'),
    billing: require('../utilityBillingService') as typeof import('../utilityBillingService'),
    factures: require('../facturesService') as typeof import('../facturesService'),
    persistence: require('../persistence') as typeof import('../persistence'),
    storage: require('@react-native-async-storage/async-storage') as typeof import('@react-native-async-storage/async-storage').default,
  };
}
/* eslint-enable @typescript-eslint/no-require-imports */

type World = ReturnType<typeof fresh>;
const KEYS: ToolModelKey[] = ['immobilier', 'tontine', 'ceet', 'tde'];
const ofKind = (w: World, kind: string) => w.db.tools.filter((t) => t.kind === kind);
const newTontine = (w: World, name = 'Famille') =>
  w.groupService.createTontine({ name, contributionAmount: 5000, frequency: 'monthly', startDate: new Date().toISOString(), orderMethod: 'join_order' } as Parameters<typeof w.groupService.createTontine>[0]);

describe('Catalogue V1', () => {
  it('Immobilier, Tontine, CEET et TDE sont installables ; Commerce est visible mais « Bientôt »', () => {
    expect(getCatalogModels().map((m) => m.key)).toEqual(['immobilier', 'tontine', 'ceet', 'tde', 'commerce']);
    for (const key of KEYS) {
      expect(getCatalogModel(key)).toMatchObject({ installable: true, available: true, status: 'available' });
      expect(isInstallableModel(key)).toBe(true);
      expect(getCatalogModel(key)!.route).toBeTruthy();
    }
    expect(getCatalogModel('commerce')).toMatchObject({ title: 'Commerce', installable: false, available: false, status: 'coming_soon', route: null });
    expect(isInstallableModel('commerce')).toBe(false);
  });

  it('Formulaires, Scanner, Dossiers et Factures & Reçus sont absents du catalogue', () => {
    // Titres et identifiants seulement : les descriptions de CEET/TDE parlent légitimement de « factures ».
    const names = getCatalogModels().map((m) => `${m.key} ${m.title}`.toLowerCase()).join(' ');
    for (const absent of ['formulaire', 'form', 'scanner', 'scan', 'dossier', 'facture', 'reçu']) expect(names).not.toContain(absent);
    for (const key of ['formulaires', 'forms', 'scanner', 'dossiers', 'factures', 'facture', 'factures-recus']) {
      expect(getCatalogModel(key)).toBeUndefined();
      expect(isInstallableModel(key)).toBe(false);
    }
  });
});

describe('Installation', () => {
  it.each(KEYS)('installTool(%s) crée un seul Tool, même si on l’ajoute deux fois', async (key) => {
    const w = fresh();
    const first = await w.registry.installTool(key);
    const second = await w.registry.installTool(key);
    expect(second.id).toBe(first.id);
    expect(ofKind(w, key)).toHaveLength(1);
    expect(first.kind).toBe(key);
    expect((await w.registry.getMyTools()).owned.map((t) => t.model.key)).toEqual([key]);
  });

  it('deux ajouts simultanés (double appui) ne créent qu’un outil', async () => {
    const w = fresh();
    const [a, b] = await Promise.all([w.registry.installTool('ceet'), w.registry.installTool('ceet')]);
    expect(a.id).toBe(b.id);
    expect(ofKind(w, 'ceet')).toHaveLength(1);
  });

  it('Commerce n’est pas installable : aucun outil, aucune donnée', async () => {
    const w = fresh();
    const before = { tools: w.db.tools.length, records: w.db.records.length, members: w.db.toolMembers.length };
    await expect(w.registry.installTool('commerce')).rejects.toThrow();
    expect({ tools: w.db.tools.length, records: w.db.records.length, members: w.db.toolMembers.length }).toEqual(before);
  });

  it('le propriétaire est getCurrentUserId() et son ToolMember (avec les rôles admin et member) n’existe qu’une fois', async () => {
    const w = fresh();
    for (const key of KEYS) {
      const tool = await w.registry.installTool(key);
      await w.registry.installTool(key);
      expect(tool.ownerId).toBe(w.identity.getCurrentUserId());
      const members = w.db.toolMembers.filter((m) => m.toolId === tool.id);
      const roles = w.db.roleDefinitions.filter((r) => r.toolId === tool.id);
      expect(members).toHaveLength(1);
      expect(members[0]).toMatchObject({ accountType: 'user', userId: w.identity.getCurrentUserId(), status: 'active' });
      expect(roles.filter((r) => r.key === 'admin')).toHaveLength(1);
      expect(roles.filter((r) => r.key === 'member')).toHaveLength(1);
      expect(roles.filter((r) => r.isDefault)).toHaveLength(1); // un seul rôle par défaut (Immobilier a déjà « locataire »)
      expect(members[0].roleId).toBe(roles.find((r) => r.key === 'admin')!.id);
    }
    expect(w.db.users.some((u) => 'role' in u)).toBe(false); // aucun rôle global sur l’utilisateur
  });

  it('Immobilier réutilise l’outil existant et ses données', async () => {
    const w = fresh();
    const bien = await w.immo.createBien({ nom: 'Résidence A', adresse: 'Lomé' });
    const existing = ofKind(w, 'immobilier')[0];
    const installed = await w.registry.installTool('immobilier');
    expect(installed.id).toBe(existing.id);
    expect(ofKind(w, 'immobilier')).toHaveLength(1);
    expect(await w.core.coreService.getRecord(bien.id)).toBeTruthy();
  });

  it('les enveloppes CEET/TDE/Tontine ne perturbent pas le moteur Factures ni Immobilier', async () => {
    const w = fresh();
    for (const key of KEYS) await w.registry.installTool(key);
    const ents = await w.factures.ensureFacturesToolCached();
    expect(ents.tool.kind).toBe('facture');
    expect(ofKind(w, 'facture')).toHaveLength(1);
    expect(ofKind(w, 'immobilier')).toHaveLength(1);
    const participant = await w.parts.addParticipant('ceet', { name: 'Awa' });
    expect(participant.fournisseur).toBe('ceet');
    expect((await w.registry.getMyTools()).owned.map((t) => t.model.key)).toEqual(KEYS); // l’outil interne Factures n’y figure pas
  });
});

describe('Retirer, réafficher', () => {
  it('retirer masque l’outil sans toucher à ses données (Tontine)', async () => {
    const w = fresh();
    const tool = await w.registry.installTool('tontine');
    const tontine = await newTontine(w);
    await w.groupService.addGuestMember(tontine.id, { firstName: 'Moussa', lastName: 'Diallo' });
    const counts = () => ({ groups: w.db.groups.length, memberships: w.db.memberships.length, tools: w.db.tools.length, toolMembers: w.db.toolMembers.length, activities: w.db.activityEvents.filter((e) => e.type === 'group_created').length });
    const before = counts();
    const spy = jest.spyOn(w.core.coreService, 'deleteTool');

    await w.registry.hideTool(tool.id);

    expect(spy).not.toHaveBeenCalled(); // jamais de suppression en cascade
    expect(counts()).toEqual(before);
    expect(w.db.tools.find((t) => t.id === tool.id)).toBeTruthy();
    expect(w.db.groups.find((g) => g.id === tontine.id)).toBeTruthy();
    const mine = await w.registry.getMyTools();
    expect(mine.owned).toHaveLength(0);
    expect(mine.hidden.map((t) => t.tool.id)).toEqual([tool.id]);
    expect(await w.registry.isModelInstalled('tontine')).toBe(false);
  });

  it('retirer Immobilier conserve biens et enregistrements', async () => {
    const w = fresh();
    const tool = await w.registry.installTool('immobilier');
    const bien = await w.immo.createBien({ nom: 'Résidence B', adresse: 'Kara' });
    const records = w.db.records.length;
    await w.registry.hideTool(tool.id);
    expect(w.db.records).toHaveLength(records);
    expect(await w.core.coreService.getRecord(bien.id)).toBeTruthy();
    expect((await w.registry.getMyTools()).owned).toHaveLength(0);
  });

  it('réafficher retrouve le même Tool, sans doublon ni donnée recréée', async () => {
    const w = fresh();
    const tool = await w.registry.installTool('ceet');
    await w.registry.hideTool(tool.id);
    const toolsBefore = w.db.tools.length;
    const membersBefore = w.db.toolMembers.length;

    const restored = await w.registry.restoreTool(tool.id);
    expect(restored.id).toBe(tool.id);
    expect(w.db.tools).toHaveLength(toolsBefore);
    expect(w.db.toolMembers).toHaveLength(membersBefore);
    expect((await w.registry.getMyTools()).owned.map((t) => t.tool.id)).toEqual([tool.id]);
    expect((await w.registry.getMyTools()).hidden).toHaveLength(0);
  });

  it('ajouter de nouveau un outil retiré le réaffiche (même Tool)', async () => {
    const w = fresh();
    const tool = await w.registry.installTool('tde');
    await w.registry.hideTool(tool.id);
    const again = await w.registry.installTool('tde');
    expect(again.id).toBe(tool.id);
    expect(ofKind(w, 'tde')).toHaveLength(1);
    expect((await w.registry.getMyTools()).owned).toHaveLength(1);
  });

  it('retirer ou réafficher deux fois est sans effet, et seuls les outils du catalogue peuvent l’être', async () => {
    const w = fresh();
    const tool = await w.registry.installTool('tontine');
    await w.registry.hideTool(tool.id);
    await w.registry.hideTool(tool.id);
    await w.registry.restoreTool(tool.id);
    await w.registry.restoreTool(tool.id);
    expect(ofKind(w, 'tontine')).toHaveLength(1);
    await expect(w.registry.hideTool('inconnu')).rejects.toThrow();
    const ents = await w.factures.ensureFacturesToolCached(); // outil interne : hors catalogue
    await expect(w.registry.hideTool(ents.tool.id)).rejects.toThrow();
  });

  it('l’état masqué survit à un redémarrage, avec les données', async () => {
    jest.useFakeTimers();
    try {
      const w = fresh();
      const tool = await w.registry.installTool('tontine');
      const tontine = await newTontine(w, 'Association');
      await w.registry.hideTool(tool.id);

      const stop = w.persistence.startAutoPersist();
      await jest.advanceTimersByTimeAsync(3100);
      stop();

      w.db.tools.length = 0; // redémarrage : mémoire vide, puis relecture du stockage
      w.db.groups.length = 0;
      await w.persistence.hydrateDb();
      const reloaded = w.db.tools.find((t) => t.id === tool.id)!;
      expect(reloaded.settings).toMatchObject({ hidden: true });
      expect(typeof reloaded.settings?.installedAt).toBe('string');
      expect(w.db.groups.find((g) => g.id === tontine.id)).toBeTruthy();
      const mine = await w.registry.getMyTools();
      expect(mine.owned).toHaveLength(0);
      expect(mine.hidden).toHaveLength(1);
    } finally {
      jest.useRealTimers();
    }
  });
});

describe('Installations existantes (avant Mes Outils)', () => {
  it('un module qui a déjà des données est installé sans rien perdre', async () => {
    const w = fresh();
    const tontine = await newTontine(w);
    const bien = await w.immo.createBien({ nom: 'Résidence C', adresse: 'Lomé' });
    await w.parts.addParticipant('ceet', { name: 'Kossi' });
    const snapshot = () => ({ groups: w.db.groups.length, records: w.db.records.length, contacts: w.db.externalContacts.length });
    const before = snapshot();

    const added = await w.registry.ensureInstalledTools();

    expect(added.sort()).toEqual(['ceet', 'immobilier', 'tontine']); // TDE n'a aucune donnée : non ajouté
    expect(snapshot()).toEqual(before);
    expect(w.db.groups.find((g) => g.id === tontine.id)).toBeTruthy();
    expect(await w.core.coreService.getRecord(bien.id)).toBeTruthy();
    expect((await w.registry.getMyTools()).owned.map((t) => t.model.key)).toEqual(['immobilier', 'tontine', 'ceet']);
    expect(ofKind(w, 'immobilier')).toHaveLength(1);
    expect(ofKind(w, 'tde')).toHaveLength(0);
    for (const tool of w.db.tools.filter((t) => t.kind !== 'facture')) {
      expect(w.db.toolMembers.filter((m) => m.toolId === tool.id)).toHaveLength(1); // membre propriétaire créé
    }
  });

  it('idempotent : un second passage n’ajoute, ne duplique et ne modifie rien', async () => {
    const w = fresh();
    await newTontine(w);
    await w.registry.ensureInstalledTools();
    const tools = JSON.stringify(w.db.tools);
    const counts = { tools: w.db.tools.length, members: w.db.toolMembers.length, roles: w.db.roleDefinitions.length };
    expect(await w.registry.ensureInstalledTools()).toEqual([]);
    expect({ tools: w.db.tools.length, members: w.db.toolMembers.length, roles: w.db.roleDefinitions.length }).toEqual(counts);
    expect(JSON.stringify(w.db.tools)).toBe(tools);
  });

  it('ne crée rien quand il n’y a aucune donnée (pas même l’outil Factures)', async () => {
    const w = fresh();
    expect(await w.registry.ensureInstalledTools()).toEqual([]);
    expect(w.db.tools).toHaveLength(0);
    expect(w.db.toolMembers).toHaveLength(0);
  });

  it('un outil retiré le reste : le rattrapage ne le réaffiche pas', async () => {
    const w = fresh();
    await newTontine(w);
    await w.registry.ensureInstalledTools();
    const tool = ofKind(w, 'tontine')[0];
    await w.registry.hideTool(tool.id);
    expect(await w.registry.ensureInstalledTools()).toEqual([]);
    expect((await w.registry.getMyTools()).owned).toHaveLength(0);
    expect((await w.registry.getMyTools()).hidden).toHaveLength(1);
  });

  it('un outil Immobilier créé par un écran mais sans donnée n’est pas ajouté à Mes outils', async () => {
    const w = fresh();
    await w.immo.ensureImmobilierTool();
    expect(await w.registry.ensureInstalledTools()).toEqual([]);
    expect((await w.registry.getMyTools()).owned).toHaveLength(0);
  });
});

describe('Outils possédés / partagés', () => {
  const tool = (id: string, ownerId: string): Tool => ({ id, name: id, icon: 'x', kind: 'ceet', ownerId, entityDefinitionIds: [], createdAt: '', updatedAt: '' });
  const member = (toolId: string, userId: string, status: ToolMember['status'] = 'active'): ToolMember =>
    ({ id: `m-${toolId}-${userId}`, toolId, roleId: 'r', accountType: 'user', userId, displayName: userId, status, joinedAt: '' });

  it('sépare les outils que je possède de ceux dont je suis seulement membre', () => {
    const all = [tool('mine', 'me'), tool('theirs', 'other'), tool('pending', 'other'), tool('unrelated', 'other')];
    const members = [member('mine', 'me'), member('theirs', 'me'), member('pending', 'me', 'invited'), member('unrelated', 'someone')];
    expect(selectOwnedTools(all, 'me').map((t) => t.id)).toEqual(['mine']);
    expect(selectSharedTools(all, members, 'me').map((t) => t.id)).toEqual(['theirs']);
  });

  it('en V1 « partagés avec moi » est vide, et apparaît dès qu’un outil m’est partagé', async () => {
    const w = fresh();
    await w.registry.installTool('ceet');
    expect((await w.registry.getMyTools()).shared).toEqual([]);

    const foreign = { ...tool('tool-foreign', 'u-autre'), kind: 'tontine' as const };
    w.db.tools.push(foreign);
    w.db.toolMembers.push(member(foreign.id, w.identity.getCurrentUserId()));
    const mine = await w.registry.getMyTools();
    expect(mine.shared.map((t) => t.tool.id)).toEqual(['tool-foreign']);
    expect(mine.owned.map((t) => t.tool.id)).not.toContain('tool-foreign');
  });
});

describe('Activités et toolId', () => {
  it('les activités créées après l’installation portent le toolId de leur outil', async () => {
    const w = fresh();
    const act = (type: string) => w.db.activityEvents.filter((e) => e.type === type);

    await newTontine(w, 'Avant');
    expect(act('group_created')[0].toolId).toBeUndefined(); // pas d'outil Tontine encore : rien d'inventé, rien de réécrit

    const tontineTool = await w.registry.installTool('tontine');
    await newTontine(w, 'Après');
    expect(act('group_created').find((e) => e.description.includes('Après'))!.toolId).toBe(tontineTool.id);
    expect(act('group_created').find((e) => e.description.includes('Avant'))!.toolId).toBeUndefined();

    const immoTool = await w.registry.installTool('immobilier');
    const bien = await w.immo.createBien({ nom: 'Résidence D', adresse: 'Lomé' });
    expect(act('immobilier.bien_created')[0]).toMatchObject({ toolId: immoTool.id, entityId: bien.id });
    await w.immo.deleteBienCascade(bien.id);
    expect(act('immobilier.bien_deleted')[0].toolId).toBe(immoTool.id);

    const ceetTool = await w.registry.installTool('ceet');
    await w.parts.addParticipant('ceet', { name: 'Awa' });
    expect(act('utility.participant_added')[0]).toMatchObject({ module: 'ceet', toolId: ceetTool.id });
    await w.parts.addParticipant('tde', { name: 'Awa' });
    expect(act('utility.participant_added')[0].toolId).toBeUndefined(); // TDE non installé
  });

  it('ajouter, retirer et réafficher un outil sont journalisés avec son toolId ; le rattrapage automatique non', async () => {
    const w = fresh();
    const tool = await w.registry.installTool('tde');
    await w.registry.hideTool(tool.id);
    await w.registry.restoreTool(tool.id);
    const types = w.db.activityEvents.map((e) => e.type).reverse();
    expect(types).toEqual(['tool.installed', 'tool.hidden', 'tool.restored']);
    expect(w.db.activityEvents.every((e) => e.toolId === tool.id)).toBe(true);

    w.db.activityEvents.length = 0;
    await w.parts.addParticipant('ceet', { name: 'Kossi' });
    w.db.activityEvents.length = 0;
    await w.registry.ensureInstalledTools();
    expect(w.db.activityEvents).toHaveLength(0);
  });
});
