// F3b — flux des modules partagés (créer, rejoindre, approuver, refuser, révoquer, partir, fin d'accès) joués par DEUX comptes contre un cloud en mémoire
// qui applique la politique de référence. Aucun SDK, aucun réseau. Ces tests prouvent la logique des flux ; ils ne prouvent pas les vraies règles
// (candidat non exécuté) ni l'interface.

import {
  ACCESS_STATUS_LABEL,
  INVALID_MODULE_ID_MESSAGE,
  MAX_ACTIVE_MEMBERS,
  approveRequest,
  cancelMyRequest,
  checkMyAccess,
  clearRequest,
  createOwnedModule,
  deriveAccessStatus,
  leaveModule,
  loadOwnerView,
  normalizeModuleId,
  reactivateMember,
  reconcileAccessEnds,
  refuseRequest,
  renameOwnedModule,
  requestAccess,
  revokeMember,
  setMemberContract,
  type AccessStatus,
  type FlowDeps,
} from '../sharedModules/moduleFlows';
import type { MemberDoc } from '../sharedModules/model';
import { createMemoryModulesCloud, type MemoryModulesCloud } from './helpers/modulesMemoryBackend';

jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: { getItem: async () => null, setItem: async () => undefined, removeItem: async () => undefined, clear: async () => undefined, getAllKeys: async () => [] },
}));

let clock: number;
let cloud: MemoryModulesCloud;
const now = () => new Date(clock);
const deps = (uid: string): FlowDeps => ({ backend: cloud.as(uid), uid, now, newModuleId: () => 'mod_aaaaaaaaaaaaaaaaaaaaaaaa' });
const MODULE = 'mod_aaaaaaaaaaaaaaaaaaaaaaaa';

beforeEach(() => {
  clock = Date.parse('2026-10-21T10:00:00.000Z');
  cloud = createMemoryModulesCloud(now);
});

const unwrap = <T,>(result: { ok: true; value: T } | { ok: false; message: string }): T => {
  if (!result.ok) throw new Error(`échec inattendu : ${result.message}`);
  return result.value;
};
const status = async (uid: string) => unwrap(await checkMyAccess(deps(uid), MODULE)).status;

async function ownerWithModule() {
  unwrap(await createOwnedModule(deps('alice'), 'Immeuble Tokoin'));
}

/** Koffi demande, Alice approuve (contrat c1). */
async function koffiJoins(contractEndDay?: string | null) {
  unwrap(await requestAccess(deps('koffi'), MODULE, 'Koffi Mensah'));
  return unwrap(await approveRequest(deps('alice'), { moduleId: MODULE, requesterUid: 'koffi', contractId: 'c1', contractEndDay }));
}

describe('Créer un espace partagé', () => {
  it('le créateur est propriétaire ; le nom est borné ; l’identifiant respecte le format ; un autre compte ne le lit pas', async () => {
    expect(await createOwnedModule(deps('alice'), '   ')).toEqual({ ok: false, message: 'Donnez un nom à l’espace partagé.' });
    expect((await createOwnedModule(deps('alice'), 'x'.repeat(101))).ok).toBe(false);
    const created = unwrap(await createOwnedModule(deps('alice'), '  Immeuble Tokoin  '));
    expect(created).toEqual({ moduleId: MODULE, name: 'Immeuble Tokoin' });
    expect(cloud.modules[MODULE]).toMatchObject({ ownerUid: 'alice', type: 'immobilier', name: 'Immeuble Tokoin', schemaVersion: 1 });
    expect((await deps('mallory').backend.getModule(MODULE).catch((e) => e)).code).toBe('permission');
    expect(unwrap(await renameOwnedModule(deps('alice'), MODULE, 'Résidence A')) ).toBeNull();
    expect(cloud.modules[MODULE].name).toBe('Résidence A');
    expect((await renameOwnedModule(deps('mallory'), MODULE, 'Piraté')).ok).toBe(false);
    expect(cloud.modules[MODULE].name).toBe('Résidence A');
  });

  it('refus du cloud (compte non connecté par mot de passe) : message clair, rien n’est créé', async () => {
    const result = await createOwnedModule({ ...deps('alice'), backend: cloud.as('alice', 'google.com') }, 'Immeuble');
    expect(result.ok).toBe(false);
    expect(Object.keys(cloud.modules)).toEqual([]);
  });
});

describe('« Rejoindre » : une demande, jamais un accès', () => {
  it('l’identifiant est contrôlé avant tout envoi ; espaces et majuscules tolérés', async () => {
    await ownerWithModule();
    for (const bad of ['', 'abc', 'mod_court', `mod_${'a'.repeat(25)}`, 'https://x.test/mod']) expect(await requestAccess(deps('koffi'), bad, '')).toEqual({ ok: false, message: INVALID_MODULE_ID_MESSAGE });
    expect(normalizeModuleId(`  ${MODULE.toUpperCase()} `)).toBe(MODULE);
    expect((await requestAccess(deps('koffi'), `  ${MODULE.toUpperCase()}  `, 'Koffi')).ok).toBe(true);
    expect((await requestAccess(deps('koffi2'), MODULE, 'x'.repeat(61))).ok).toBe(false);
    expect(cloud.writes.filter((w) => w === 'createRequest')).toHaveLength(1);
  });

  it('la demande est en attente et ne donne AUCUN accès : ni au module, ni aux membres, ni aux demandes des autres', async () => {
    await ownerWithModule();
    unwrap(await requestAccess(deps('koffi'), MODULE, 'Koffi Mensah'));
    expect(cloud.requests[`${MODULE}/koffi`]).toMatchObject({ uid: 'koffi', state: 'pending', decidedBy: null, label: 'Koffi Mensah' });
    expect(await status('koffi')).toBe('pending');
    for (const read of [
      () => deps('koffi').backend.getModule(MODULE),
      () => deps('koffi').backend.listMembers(MODULE),
      () => deps('koffi').backend.listRequests(MODULE),
      () => deps('koffi').backend.getMember(MODULE, 'alice'),
      () => deps('koffi').backend.getRequest(MODULE, 'alice'),
    ]) await expect(read()).rejects.toMatchObject({ code: 'permission' });
  });

  it('le message de refus ne révèle rien : module inexistant, demande déjà faite et ancien refus donnent le MÊME message', async () => {
    await ownerWithModule();
    unwrap(await requestAccess(deps('koffi'), MODULE, ''));
    const missing = await requestAccess(deps('koffi'), 'mod_zzzzzzzzzzzzzzzzzzzzzzzz', '');
    const duplicate = await requestAccess(deps('koffi'), MODULE, '');
    await refuseRequest(deps('alice'), MODULE, 'koffi');
    const afterRefusal = await requestAccess(deps('koffi'), MODULE, '');
    expect(missing.ok).toBe(false);
    expect(missing).toEqual(duplicate);
    expect(missing).toEqual(afterRefusal);
  });

  it('le propriétaire ne demande pas l’accès à son propre espace', async () => {
    await ownerWithModule();
    expect((await requestAccess(deps('alice'), MODULE, '')).ok).toBe(false);
  });

  it('une demande en attente s’annule ; une demande approuvée s’efface aussi (le nom saisi) sans retirer l’accès ; une demande refusée ne s’efface pas par son auteur', async () => {
    await ownerWithModule();
    unwrap(await requestAccess(deps('koffi'), MODULE, ''));
    expect(unwrap(await cancelMyRequest(deps('koffi'), MODULE))).toBeNull();
    expect(await status('koffi')).toBe('none');
    unwrap(await requestAccess(deps('koffi'), MODULE, ''));
    unwrap(await approveRequest(deps('alice'), { moduleId: MODULE, requesterUid: 'koffi', contractId: 'c1' }));
    expect((await cancelMyRequest(deps('koffi'), MODULE)).ok).toBe(true); // le nom saisi est retiré…
    expect(await status('koffi')).toBe('active'); // …mais l'accès (la fiche du membre) demeure
    unwrap(await requestAccess(deps('ama'), MODULE, 'Ama'));
    unwrap(await refuseRequest(deps('alice'), MODULE, 'ama'));
    expect((await cancelMyRequest(deps('ama'), MODULE)).ok).toBe(false); // une demande refusée reste : elle bloque
  });
});

describe('Approuver et refuser', () => {
  it('l’approbation crée la fiche du membre ET approuve la demande en une opération ; le locataire voit alors le nom de l’espace', async () => {
    await ownerWithModule();
    const member = await koffiJoins();
    expect(member).toMatchObject({ uid: 'koffi', role: 'locataire', state: 'active', contractId: 'c1', accessUntil: null, addedBy: 'alice' });
    expect(cloud.requests[`${MODULE}/koffi`]).toMatchObject({ state: 'approved', decidedBy: 'alice' });
    const access = unwrap(await checkMyAccess(deps('koffi'), MODULE));
    expect(access).toEqual({ status: 'active', moduleName: 'Immeuble Tokoin', contractId: 'c1', accessUntil: null });
  });

  it('le propriétaire voit les demandes (en attente d’abord) et ses membres ; un locataire ne voit rien de tout cela', async () => {
    await ownerWithModule();
    await koffiJoins();
    clock += 1000;
    unwrap(await requestAccess(deps('ama'), MODULE, 'Ama'));
    const view = unwrap(await loadOwnerView(deps('alice'), MODULE));
    expect(view.requests.map((r) => r.uid)).toEqual(['ama', 'koffi']); // en attente d'abord
    expect(view.members.map((m) => m.uid)).toEqual(['koffi']);
    expect((await loadOwnerView(deps('koffi'), MODULE)).ok).toBe(false);
  });

  it('le contrat est obligatoire ; on n’approuve pas sa propre demande ; un demandeur ne s’approuve pas lui-même', async () => {
    await ownerWithModule();
    unwrap(await requestAccess(deps('koffi'), MODULE, ''));
    expect(await approveRequest(deps('alice'), { moduleId: MODULE, requesterUid: 'koffi', contractId: '  ' })).toEqual({ ok: false, message: 'Choisissez le contrat du locataire : l’accès lui est lié.' });
    expect((await approveRequest(deps('alice'), { moduleId: MODULE, requesterUid: 'alice', contractId: 'c1' })).ok).toBe(false);
    // le demandeur essaie de s'approuver : par le flux, puis directement par le port
    expect((await approveRequest(deps('koffi'), { moduleId: MODULE, requesterUid: 'koffi', contractId: 'c1' })).ok).toBe(false);
    const member: MemberDoc = { uid: 'koffi', role: 'locataire', state: 'active', contractId: 'c1', accessUntil: null, addedBy: 'koffi', createdAt: 'x', updatedAt: 'x' };
    await expect(deps('koffi').backend.decideRequest(MODULE, 'koffi', { state: 'approved', decidedBy: 'koffi', at: 'x' }, member)).rejects.toMatchObject({ code: 'permission' });
    await expect(deps('koffi').backend.updateMember(MODULE, 'koffi', { state: 'active' })).rejects.toMatchObject({ code: 'permission' });
    expect(await status('koffi')).toBe('pending');
    expect(cloud.members[`${MODULE}/koffi`]).toBeUndefined();
  });

  it('opération atomique : si la fiche du membre ne peut pas être créée, la demande reste en attente', async () => {
    await ownerWithModule();
    unwrap(await requestAccess(deps('koffi'), MODULE, ''));
    cloud.members[`${MODULE}/koffi`] = { uid: 'koffi', role: 'locataire', state: 'revoked', contractId: 'c0', accessUntil: null, addedBy: 'alice', createdAt: 'x', updatedAt: 'x' };
    expect((await approveRequest(deps('alice'), { moduleId: MODULE, requesterUid: 'koffi', contractId: 'c1' })).ok).toBe(false);
    expect(cloud.requests[`${MODULE}/koffi`].state).toBe('pending'); // rien n'a été à moitié écrit
    expect(cloud.writes).not.toContain('approve');
  });

  it('refus : le demandeur le voit, ne peut pas redemander, jusqu’à ce que le propriétaire efface la demande', async () => {
    await ownerWithModule();
    unwrap(await requestAccess(deps('koffi'), MODULE, ''));
    unwrap(await refuseRequest(deps('alice'), MODULE, 'koffi'));
    expect(await status('koffi')).toBe('refused');
    expect(ACCESS_STATUS_LABEL.refused).toBe('Demande refusée');
    expect((await requestAccess(deps('koffi'), MODULE, '')).ok).toBe(false);
    expect((await cancelMyRequest(deps('koffi'), MODULE)).ok).toBe(false); // il n'efface pas son propre refus
    expect((await refuseRequest(deps('alice'), MODULE, 'koffi')).ok).toBe(false); // une demande tranchée ne change plus
    expect((await approveRequest(deps('alice'), { moduleId: MODULE, requesterUid: 'koffi', contractId: 'c1' })).ok).toBe(false);
    unwrap(await clearRequest(deps('alice'), MODULE, 'koffi'));
    expect(await status('koffi')).toBe('none');
    expect((await requestAccess(deps('koffi'), MODULE, '')).ok).toBe(true);
  });

  it('un autre propriétaire ne traite pas les demandes de mon espace', async () => {
    await ownerWithModule();
    unwrap(await requestAccess(deps('koffi'), MODULE, ''));
    unwrap(await createOwnedModule({ ...deps('bob'), newModuleId: () => 'mod_bbbbbbbbbbbbbbbbbbbbbbbb' }, 'Autre'));
    expect((await approveRequest(deps('bob'), { moduleId: MODULE, requesterUid: 'koffi', contractId: 'c1' })).ok).toBe(false);
    expect((await refuseRequest(deps('bob'), MODULE, 'koffi')).ok).toBe(false);
    expect((await loadOwnerView(deps('bob'), MODULE)).ok).toBe(false);
    expect(cloud.requests[`${MODULE}/koffi`].state).toBe('pending');
  });

  it('plafond : pas plus de 50 membres actifs (approbation et rétablissement)', async () => {
    await ownerWithModule();
    const base: MemberDoc = { uid: '', role: 'locataire', state: 'active', contractId: 'c', accessUntil: null, addedBy: 'alice', createdAt: 'x', updatedAt: 'x' };
    for (let i = 0; i < MAX_ACTIVE_MEMBERS; i += 1) cloud.members[`${MODULE}/u${i}`] = { ...base, uid: `u${i}` };
    unwrap(await requestAccess(deps('koffi'), MODULE, ''));
    const full = await approveRequest(deps('alice'), { moduleId: MODULE, requesterUid: 'koffi', contractId: 'c1' });
    expect(full).toEqual({ ok: false, message: `Cet espace compte déjà ${MAX_ACTIVE_MEMBERS} membres actifs : retirez-en un avant d’en ajouter.` });
    unwrap(await revokeMember(deps('alice'), MODULE, 'u0'));
    expect((await approveRequest(deps('alice'), { moduleId: MODULE, requesterUid: 'koffi', contractId: 'c1' })).ok).toBe(true);
    expect((await reactivateMember(deps('alice'), MODULE, 'u0')).ok).toBe(false); // l'espace est de nouveau plein
    expect(cloud.members[`${MODULE}/u0`].state).toBe('revoked');
  });
});

describe('Révoquer, partir, rétablir : l’accès change immédiatement', () => {
  it('révocation : le locataire voit « retiré », perd la lecture, et ne se rétablit pas lui-même', async () => {
    await ownerWithModule();
    await koffiJoins();
    unwrap(await revokeMember(deps('alice'), MODULE, 'koffi'));
    expect(await status('koffi')).toBe('revoked');
    await expect(deps('koffi').backend.getModule(MODULE)).rejects.toMatchObject({ code: 'permission' });
    await expect(deps('koffi').backend.updateMember(MODULE, 'koffi', { state: 'active' })).rejects.toMatchObject({ code: 'permission' });
    expect((await leaveModule(deps('koffi'), MODULE)).ok).toBe(false); // on ne quitte que ce qu'on a
    expect((await requestAccess(deps('koffi'), MODULE, '')).ok).toBe(false); // un ancien membre passe par le propriétaire
    expect((await revokeMember(deps('alice'), MODULE, 'koffi')).ok).toBe(false); // déjà révoqué
    unwrap(await reactivateMember(deps('alice'), MODULE, 'koffi'));
    expect(await status('koffi')).toBe('active');
  });

  it('départ : le membre quitte, l’accès est coupé, le propriétaire garde la fiche et peut rétablir', async () => {
    await ownerWithModule();
    await koffiJoins();
    unwrap(await leaveModule(deps('koffi'), MODULE));
    expect(await status('koffi')).toBe('left');
    expect(cloud.members[`${MODULE}/koffi`]).toBeDefined();
    await expect(deps('koffi').backend.getModule(MODULE)).rejects.toMatchObject({ code: 'permission' });
    unwrap(await reactivateMember(deps('alice'), MODULE, 'koffi'));
    expect(await status('koffi')).toBe('active');
  });

  it('un membre n’en révoque pas un autre ; un étranger ne révoque ni ne rétablit personne', async () => {
    await ownerWithModule();
    await koffiJoins();
    unwrap(await requestAccess(deps('ama'), MODULE, ''));
    unwrap(await approveRequest(deps('alice'), { moduleId: MODULE, requesterUid: 'ama', contractId: 'c2' }));
    for (const intruder of ['koffi', 'mallory']) {
      expect((await revokeMember(deps(intruder), MODULE, 'ama')).ok).toBe(false);
      expect((await reactivateMember(deps(intruder), MODULE, 'ama')).ok).toBe(false);
      expect((await setMemberContract(deps(intruder), MODULE, 'ama', 'c9')).ok).toBe(false);
    }
    expect(await status('ama')).toBe('active');
    expect(cloud.members[`${MODULE}/ama`].contractId).toBe('c2');
  });

  it('changer le contrat lié d’un membre actif recalcule sa fin d’accès ; un membre ne change pas son propre contrat', async () => {
    await ownerWithModule();
    await koffiJoins();
    unwrap(await setMemberContract(deps('alice'), MODULE, 'koffi', 'c2', '2026-01-10'));
    expect(cloud.members[`${MODULE}/koffi`]).toMatchObject({ contractId: 'c2', accessUntil: '2026-04-11T00:00:00.000Z' });
    expect((await setMemberContract(deps('koffi'), MODULE, 'koffi', 'c-voisin')).ok).toBe(false);
    expect((await setMemberContract(deps('alice'), MODULE, 'koffi', '  ')).ok).toBe(false);
  });
});

describe('Fin d’accès : 90 jours après la fin du contrat', () => {
  it('à l’approbation d’un contrat déjà terminé, la fin d’accès est posée ; l’accès s’arrête à l’instant exact', async () => {
    await ownerWithModule();
    await koffiJoins('2026-10-10'); // fin de journée du 10 octobre + 90 jours = 9 janvier 2027 00:00 UTC
    expect(cloud.members[`${MODULE}/koffi`].accessUntil).toBe('2027-01-09T00:00:00.000Z');
    clock = Date.parse('2027-01-08T23:59:59.999Z');
    expect(await status('koffi')).toBe('active');
    clock = Date.parse('2027-01-09T00:00:00.000Z');
    expect(await status('koffi')).toBe('expired');
    await expect(deps('koffi').backend.getModule(MODULE)).rejects.toMatchObject({ code: 'permission' });
  });

  it('le propriétaire pose la fin d’accès quand un contrat se termine, sans jamais en remplacer une déjà posée ; une seconde passe ne change rien', async () => {
    await ownerWithModule();
    await koffiJoins();
    unwrap(await requestAccess(deps('ama'), MODULE, ''));
    unwrap(await approveRequest(deps('alice'), { moduleId: MODULE, requesterUid: 'ama', contractId: 'c2', contractEndDay: '2026-09-01' }));
    const ended: Record<string, string | null> = { c1: '2026-10-15', c2: '2026-10-20' };
    expect(unwrap(await reconcileAccessEnds(deps('alice'), MODULE, (c) => ended[c] ?? null))).toBe(1); // koffi seulement : ama a déjà une date
    expect(cloud.members[`${MODULE}/koffi`].accessUntil).toBe('2027-01-14T00:00:00.000Z');
    expect(cloud.members[`${MODULE}/ama`].accessUntil).toBe('2026-12-01T00:00:00.000Z'); // inchangée
    expect(unwrap(await reconcileAccessEnds(deps('alice'), MODULE, (c) => ended[c] ?? null))).toBe(0);
    // contrat toujours en cours : rien n'est posé
    unwrap(await requestAccess(deps('lea'), MODULE, ''));
    unwrap(await approveRequest(deps('alice'), { moduleId: MODULE, requesterUid: 'lea', contractId: 'c3' }));
    expect(unwrap(await reconcileAccessEnds(deps('alice'), MODULE, () => null))).toBe(0);
    expect(cloud.members[`${MODULE}/lea`].accessUntil).toBeNull();
    // un locataire ne pose jamais sa propre fin d'accès
    expect((await reconcileAccessEnds(deps('koffi'), MODULE, () => '2020-01-01')).ok).toBe(false);
  });
});

describe('Coupure réseau et états affichés', () => {
  it('hors ligne : message clair, aucune écriture, aucun état modifié', async () => {
    await ownerWithModule();
    const writes = cloud.writes.length;
    cloud.offline = true;
    const offline = { ok: false, message: 'Pas de connexion à Internet : réessayez.' };
    expect(await requestAccess(deps('koffi'), MODULE, '')).toEqual(offline);
    expect(await checkMyAccess(deps('koffi'), MODULE)).toEqual(offline);
    expect(await approveRequest(deps('alice'), { moduleId: MODULE, requesterUid: 'koffi', contractId: 'c1' })).toEqual(offline);
    expect(await createOwnedModule(deps('bob'), 'Autre')).toEqual(offline);
    cloud.offline = false;
    expect(cloud.writes.length).toBe(writes);
    expect((await requestAccess(deps('koffi'), MODULE, '')).ok).toBe(true); // la reprise fonctionne
  });

  it('chaque état a un libellé ; l’état se déduit de la demande et de la fiche (la fiche prévaut)', () => {
    const t = new Date('2026-10-21T10:00:00.000Z');
    const m = (state: 'active' | 'revoked' | 'left', accessUntil: string | null = null) => ({ role: 'locataire' as const, state, accessUntil });
    const table: [AccessStatus, ReturnType<typeof deriveAccessStatus>][] = [
      ['none', deriveAccessStatus(null, null, t)],
      ['pending', deriveAccessStatus({ state: 'pending' }, null, t)],
      ['refused', deriveAccessStatus({ state: 'refused' }, null, t)],
      ['approved_waiting', deriveAccessStatus({ state: 'approved' }, null, t)],
      ['active', deriveAccessStatus({ state: 'approved' }, m('active'), t)],
      ['expired', deriveAccessStatus({ state: 'approved' }, m('active', '2026-10-21T10:00:00.000Z'), t)],
      ['revoked', deriveAccessStatus({ state: 'approved' }, m('revoked'), t)],
      ['left', deriveAccessStatus({ state: 'approved' }, m('left'), t)],
    ];
    for (const [expected, actual] of table) expect(actual).toBe(expected);
    expect(Object.keys(ACCESS_STATUS_LABEL).sort()).toEqual(table.map(([s]) => s).sort());
    for (const label of Object.values(ACCESS_STATUS_LABEL)) expect(label).not.toMatch(/Firebase|Firestore|règle|permission/i);
  });
});
