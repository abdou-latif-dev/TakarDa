// F3b/F3c — flux des espaces partagés joués par DEUX comptes à travers l'adaptateur Firestore RÉEL (firestoreModulesBackend) contre les VRAIES règles candidates
// (firestore.p5.rules) dans l'ÉMULATEUR Firestore LOCAL. IGNORÉ tant que l'émulateur n'est pas lancé. Projet « demo-… » : aucune ressource réelle.
//
//   npx firebase-tools@15.33.0 emulators:exec --config firebase.modules.json --only firestore --project demo-takarda "npx jest -c jest.emulator.modules.config.js"
//
// Limites : Authentication est SIMULÉE (jeton avec `sign_in_provider: 'password'` fourni par la bibliothèque de test) ; l'heure est celle de l'émulateur ;
// les écrans, la copie locale sur téléphone et le service Firebase réel ne sont pas exercés ici.

import fs from 'fs';
import path from 'path';
import { setEmailVerified } from '../accountVerification';
import { switchWorkspace } from '../persistence';
import { setSyncAccount } from '../sync/syncAccount';
import type { ContractChoice } from '../sharedModulesService';

const emulator = !!process.env.FIRESTORE_EMULATOR_HOST;
const describeEmulator = emulator ? describe : describe.skip;

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

describeEmulator('Espaces partagés : deux comptes, adaptateur réel, règles réelles (émulateur)', () => {
  let env: any;
  let t: any;
  let f: any;
  let backendModule: typeof import('../firebase/firestoreModulesBackend');
  let serviceModule: typeof import('../sharedModulesService');
  let erasureModule: typeof import('../firebase/moduleErasure');
  let departureModule: typeof import('../sharedModules/departure');
  let compositionModule: typeof import('../firebase/cloudDeletionComposition');
  const token = { firebase: { sign_in_provider: 'password' } };
  const dbs = new Map<string, unknown>();
  const dbFor = (uid: string) => {
    if (!dbs.has(uid)) dbs.set(uid, env.authenticatedContext(uid, token).firestore());
    return dbs.get(uid);
  };
  const as = (uid: string) => {
    setSyncAccount(uid);
    setEmailVerified(uid, true);
  };
  let contracts: ContractChoice[];
  const service = () =>
    serviceModule.createSharedModulesService({
      enabled: () => true,
      backend: (uid: string) => backendModule.createFirestoreModulesBackend(dbFor(uid) as never, uid),
      contracts: async () => contracts,
      // projection de test : l'adaptateur et les règles sont ce qui est éprouvé ici, pas la projection (testée ailleurs)
      buildView: async (contractId: string) => [
        { id: 'contrat', kind: 'contrat', body: { statut: 'actif', locataireNom: `Locataire ${contractId}`, loyerMensuel: 30000 } },
        { id: 'logement', kind: 'logement', body: { nom: 'Chambre 1', adresse: '12 rue du Marché', nomBien: 'Immeuble A' } },
        { id: 'paiement_p1', kind: 'paiement', body: { mois: '2026-08', montant: 30000, statut: 'paye', modePaiement: 'Mobile money', reference: 'TKD-AB12CD34' } },
      ],
    });
  const unwrap = <T,>(r: { ok: true; value: T } | { ok: false; message: string }): T => {
    if (!r.ok) throw new Error(r.message);
    return r.value;
  };
  const adminGet = async (...segments: string[]) => {
    let snapshot: any;
    await env.withSecurityRulesDisabled(async (ctx: { firestore: () => unknown }) => {
      snapshot = await f.getDoc(f.doc(ctx.firestore() as never, segments[0], ...segments.slice(1)));
    });
    return snapshot;
  };

  beforeAll(async () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    t = require('@firebase/rules-unit-testing');
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    f = require('firebase/firestore');
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    backendModule = require('../firebase/firestoreModulesBackend');
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    serviceModule = require('../sharedModulesService');
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    erasureModule = require('../firebase/moduleErasure');
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    departureModule = require('../sharedModules/departure');
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    compositionModule = require('../firebase/cloudDeletionComposition');
    env = await t.initializeTestEnvironment({ projectId: 'demo-takarda-flows', firestore: { rules: fs.readFileSync(path.join(__dirname, '..', '..', 'firestore.p5.rules'), 'utf8') } });
  });
  afterAll(async () => env?.cleanup());
  beforeEach(async () => {
    await env.clearFirestore();
    dbs.clear();
    mockMemory.clear();
    await switchWorkspace('personal');
    contracts = [{ id: 'c1', label: 'Koffi', statusKey: 'actif', endDay: null }, { id: 'c2', label: 'Ama', statusKey: 'actif', endDay: null }];
    as('alice');
  });
  afterEach(() => setSyncAccount(null));

  it('parcours complet : créer, demander, approuver (lot atomique), publier la vue, la lire, révoquer, rétablir, quitter', async () => {
    const { moduleId } = unwrap(await service().createModule('alice', 'Immeuble Tokoin'));
    expect(moduleId).toMatch(/^mod_[a-z0-9]{24}$/);

    as('koffi');
    unwrap(await service().requestAccess('koffi', moduleId, 'Koffi'));
    expect(unwrap(await serviceModule.createSharedModulesService({ enabled: () => true, backend: (uid: string) => backendModule.createFirestoreModulesBackend(dbFor(uid) as never, uid) }).refreshJoined('koffi')).checked).toBe(1);
    expect((await service().listLocal()).joined[0].status).toBe('pending');
    // rien n'est lisible avant l'approbation
    await expect(backendModule.createFirestoreModulesBackend(dbFor('koffi') as never, 'koffi').getModule(moduleId)).rejects.toMatchObject({ code: 'permission' });

    as('alice');
    expect(unwrap(await service().ownerView('alice', moduleId)).requests).toMatchObject([{ uid: 'koffi', state: 'pending', label: 'Koffi' }]);
    unwrap(await service().approve('alice', moduleId, 'koffi', 'c1'));
    expect((await adminGet('modules', moduleId, 'members', 'koffi')).data()).toMatchObject({ uid: 'koffi', state: 'active', contractId: 'c1', addedBy: 'alice' });
    expect((await adminGet('modules', moduleId, 'requests', 'koffi')).data()).toMatchObject({ state: 'approved', decidedBy: 'alice' });
    expect((await adminGet('modules', moduleId, 'tenantViews', 'koffi', 'items', 'contrat')).exists()).toBe(true); // vue publiée à l'approbation

    as('koffi');
    const view = unwrap(await service().refreshMyView('koffi', moduleId));
    expect(view.state).toBe('ok');
    if (view.state === 'ok') {
      expect(view.model.contrat?.locataireNom).toBe('Locataire c1');
      expect(view.model.logement?.nomBien).toBe('Immeuble A');
      expect(view.model.paiements[0]).toMatchObject({ statut: 'paye', modePaiement: 'Mobile money' });
    }

    as('alice');
    unwrap(await service().revoke('alice', moduleId, 'koffi'));
    expect((await adminGet('modules', moduleId, 'tenantViews', 'koffi', 'items', 'contrat')).exists()).toBe(false); // vue retirée
    as('koffi');
    expect(unwrap(await service().refreshMyView('koffi', moduleId))).toEqual({ state: 'unavailable', status: 'revoked' });
    await expect(backendModule.createFirestoreModulesBackend(dbFor('koffi') as never, 'koffi').listTenantItems(moduleId, 'koffi')).rejects.toMatchObject({ code: 'permission' });

    as('alice');
    unwrap(await service().reactivate('alice', moduleId, { uid: 'koffi', contractId: 'c1' }));
    as('koffi');
    expect(unwrap(await service().refreshMyView('koffi', moduleId)).state).toBe('ok');
    unwrap(await service().leave('koffi', moduleId));
    expect(unwrap(await service().refreshMyView('koffi', moduleId))).toEqual({ state: 'unavailable', status: 'left' });
  });

  it('étanchéité : un locataire ne lit pas la vue d’un autre, n’écrit rien, ne liste ni membres ni demandes ; un tiers ne voit rien', async () => {
    const { moduleId } = unwrap(await service().createModule('alice', 'Immeuble'));
    for (const uid of ['koffi', 'ama']) {
      as(uid);
      unwrap(await service().requestAccess(uid, moduleId, uid));
    }
    as('alice');
    unwrap(await service().approve('alice', moduleId, 'koffi', 'c1'));
    unwrap(await service().approve('alice', moduleId, 'ama', 'c2'));
    const koffi = backendModule.createFirestoreModulesBackend(dbFor('koffi') as never, 'koffi');
    await expect(koffi.listTenantItems(moduleId, 'ama')).rejects.toMatchObject({ code: 'permission' });
    await expect(koffi.putTenantItems(moduleId, 'koffi', [{ id: 'contrat', doc: { kind: 'contrat', body: { loyerMensuel: 1 }, rev: 9, updatedAt: 'x' } }])).rejects.toMatchObject({ code: 'permission' });
    await expect(koffi.deleteTenantItems(moduleId, 'koffi', ['contrat'])).rejects.toMatchObject({ code: 'permission' });
    await expect(koffi.listMembers(moduleId)).rejects.toMatchObject({ code: 'permission' });
    await expect(koffi.listRequests(moduleId)).rejects.toMatchObject({ code: 'permission' });
    await expect(koffi.getMember(moduleId, 'ama')).rejects.toMatchObject({ code: 'permission' });
    expect(JSON.stringify(await koffi.listTenantItems(moduleId, 'koffi'))).not.toContain('Locataire c2');
    const mallory = backendModule.createFirestoreModulesBackend(dbFor('mallory') as never, 'mallory');
    await expect(mallory.listTenantItems(moduleId, 'koffi')).rejects.toMatchObject({ code: 'permission' });
    await expect(mallory.getModule(moduleId)).rejects.toMatchObject({ code: 'permission' });
  });

  it('demandes : pas d’auto-approbation, refus qui bloque jusqu’à effacement, message identique pour module inexistant et demande dupliquée, annulation en attente', async () => {
    const { moduleId } = unwrap(await service().createModule('alice', 'Immeuble'));
    as('koffi');
    unwrap(await service().requestAccess('koffi', moduleId, ''));
    const koffiBackend = backendModule.createFirestoreModulesBackend(dbFor('koffi') as never, 'koffi');
    const member = { uid: 'koffi', role: 'locataire', state: 'active', contractId: 'c1', accessUntil: null, addedBy: 'koffi', createdAt: 'x', updatedAt: 'x' } as const;
    await expect(koffiBackend.decideRequest(moduleId, 'koffi', { state: 'approved', decidedBy: 'koffi', at: 'x' }, member)).rejects.toMatchObject({ code: 'permission' });
    await expect(koffiBackend.updateMember(moduleId, 'koffi', { state: 'active' })).rejects.toMatchObject({ code: 'permission' });
    const missing = await service().requestAccess('koffi', 'mod_zzzzzzzzzzzzzzzzzzzzzzzz', '');
    const duplicate = await service().requestAccess('koffi', moduleId, '');
    expect(missing.ok).toBe(false);
    expect(missing).toEqual(duplicate);
    unwrap(await service().cancelRequest('koffi', moduleId));
    unwrap(await service().requestAccess('koffi', moduleId, ''));
    as('alice');
    unwrap(await service().refuse('alice', moduleId, 'koffi'));
    as('koffi');
    expect((await service().requestAccess('koffi', moduleId, '')).ok).toBe(false);
    expect((await service().cancelRequest('koffi', moduleId)).ok).toBe(false);
    as('alice');
    unwrap(await service().clearRequest('alice', moduleId, 'koffi'));
    as('koffi');
    expect((await service().requestAccess('koffi', moduleId, '')).ok).toBe(true);
  });

  it('approbation atomique : si la fiche du membre est refusée, l’approbation de la demande est annulée avec elle (la demande reste en attente)', async () => {
    const { moduleId } = unwrap(await service().createModule('alice', 'Immeuble'));
    as('ama');
    unwrap(await service().requestAccess('ama', moduleId, ''));
    // une fiche de membre PRÉEXISTANTE (révoquée, autre contrat) : l'écriture du lot sur cette fiche est refusée par les règles, alors que la mise à jour de la demande, seule, serait acceptée
    await env.withSecurityRulesDisabled(async (ctx: { firestore: () => unknown }) => {
      await f.setDoc(f.doc(ctx.firestore() as never, 'modules', moduleId, 'members', 'ama'), { uid: 'ama', role: 'locataire', state: 'revoked', contractId: 'c0', accessUntil: null, addedBy: 'alice', createdAt: 'x', updatedAt: 'x' });
    });
    as('alice');
    expect((await service().approve('alice', moduleId, 'ama', 'c2')).ok).toBe(false);
    expect((await adminGet('modules', moduleId, 'requests', 'ama')).data()).toMatchObject({ state: 'pending', decidedBy: null }); // tout ou rien
    expect((await adminGet('modules', moduleId, 'members', 'ama')).data()).toMatchObject({ contractId: 'c0', state: 'revoked' });
  });

  it('fin d’accès : un accès dont la fin est dépassée est refusé par le cloud ; la vue est retirée par le propriétaire ; l’approbation avec un contrat terminé pose les 90 jours', async () => {
    contracts = [{ id: 'c1', label: 'Koffi', statusKey: 'termine', endDay: '2026-01-01' }];
    const { moduleId } = unwrap(await service().createModule('alice', 'Immeuble'));
    as('koffi');
    unwrap(await service().requestAccess('koffi', moduleId, ''));
    as('alice');
    unwrap(await service().approve('alice', moduleId, 'koffi', 'c1'));
    const member = (await adminGet('modules', moduleId, 'members', 'koffi')).data();
    expect(member.accessUntil.toDate().toISOString()).toBe('2026-04-02T00:00:00.000Z'); // 1er janvier + 91 jours, passé
    as('koffi');
    expect(unwrap(await service().refreshMyView('koffi', moduleId))).toEqual({ state: 'unavailable', status: 'expired' });
    await expect(backendModule.createFirestoreModulesBackend(dbFor('koffi') as never, 'koffi').listTenantItems(moduleId, 'koffi')).rejects.toMatchObject({ code: 'permission' });
    as('alice');
    expect(unwrap(await service().publishViews('alice', moduleId)).failed).toBe(0);
    expect((await adminGet('modules', moduleId, 'tenantViews', 'koffi', 'items', 'contrat')).exists()).toBe(false);
  });

  it('effacement du compte propriétaire : verrou, vidage dans l’ordre, vérification serveur, suppression ; l’espace d’un autre compte est intact ; reprise après une panne', async () => {
    const { moduleId } = unwrap(await service().createModule('alice', 'Immeuble'));
    as('bob');
    const other = unwrap(await service().createModule('bob', 'Autre espace'));
    as('alice');
    for (const uid of ['koffi', 'ama']) {
      as(uid);
      unwrap(await service().requestAccess(uid, moduleId, uid));
    }
    as('alice');
    unwrap(await service().approve('alice', moduleId, 'koffi', 'c1'));
    unwrap(await service().approve('alice', moduleId, 'ama', 'c2'));
    await env.withSecurityRulesDisabled(async (ctx: { firestore: () => unknown }) => {
      const raw = { kind: 'immobilier.bien', schemaVersion: 1, ownerUid: 'alice', statusKey: null, createdAt: 'x', updatedAt: 'x', body: { nom: 'M' }, refs: {}, rev: 1, deleted: false, deletedAt: null, restoredAt: null, lastOpId: 'op', serverUpdatedAt: f.serverTimestamp() };
      for (const id of ['r1', 'r2', 'r3']) await f.setDoc(f.doc(ctx.firestore() as never, 'modules', moduleId, 'syncRecords', id), raw);
    });
    const real = backendModule.createFirestoreModuleErasureBackend(dbFor('alice') as never, 'alice');
    expect(await real.listOwnedModuleIds()).toEqual([moduleId]); // la requête limitée à son identifiant fonctionne et ne révèle pas l’espace de Bob
    // panne au 2e lot : l’état reste sûr (verrouillé, jamais supprimé à moitié)
    let batches = 0;
    const flaky = { ...real, removeModuleDocs: async (id: string, paths: string[][]) => { batches += 1; if (batches === 2) throw Object.assign(new Error('coupure'), { code: 'unavailable' }); return real.removeModuleDocs(id, paths); } };
    const first = await erasureModule.eraseOwnedModules({ backend: flaky, uid: 'alice', pageSize: 2 });
    expect(first).toMatchObject({ status: 'incomplete', pending: [moduleId] });
    expect((await adminGet('modules', moduleId)).data().deletionLockedAt).toEqual(expect.any(String));
    as('koffi');
    const locked = await service().refreshMyView('koffi', moduleId);
    expect(locked.ok).toBe(false); // le locataire a déjà perdu sa lecture (le cloud refuse) : message clair, pas de données
    if (!locked.ok) expect(locked.message).toMatch(/accès a peut-être changé/);
    as('alice');
    await expect(backendModule.createFirestoreModulesBackend(dbFor('alice') as never, 'alice').renameModule(moduleId, 'Autre')).rejects.toMatchObject({ code: 'permission' }); // plus aucune écriture
    const second = await erasureModule.eraseOwnedModules({ backend: real, uid: 'alice', pageSize: 2 });
    expect(second).toMatchObject({ status: 'purged', pending: [], error: null });
    expect((await adminGet('modules', moduleId)).exists()).toBe(false);
    for (const [collection, ids] of [['members', ['koffi', 'ama']], ['requests', ['koffi', 'ama']], ['syncRecords', ['r1', 'r2', 'r3']]] as const) for (const id of ids) expect((await adminGet('modules', moduleId, collection, id)).exists()).toBe(false);
    expect((await adminGet('modules', moduleId, 'tenantViews', 'koffi', 'items', 'contrat')).exists()).toBe(false);
    expect((await adminGet('modules', other.moduleId)).exists()).toBe(true); // l’espace de Bob est intact
    as('koffi');
    expect(unwrap(await service().refreshMyView('koffi', moduleId))).toEqual({ state: 'unavailable', status: 'none' }); // une fois l’espace supprimé : plus d’accès, copie locale retirée
  });

  it('suppression complète du compte (composition réelle) : les espaces sont effacés AVANT le reste, rapport vérifié', async () => {
    const { moduleId } = unwrap(await service().createModule('alice', 'Immeuble'));
    as('koffi');
    unwrap(await service().requestAccess('koffi', moduleId, ''));
    as('alice');
    unwrap(await service().approve('alice', moduleId, 'koffi', 'c1'));
    const report = await compositionModule.createCloudDeletion(dbFor('alice') as never)('alice');
    expect(report.modules).toMatchObject({ status: 'purged', modules: 1, deleted: 1 });
    expect(report.verified).toBe(true);
    expect((await adminGet('modules', moduleId)).exists()).toBe(false);
  });

  it('quitter un espace efface le nom saisi (vraies règles) ; la demande refusée reste ; le départ des espaces rejoints à la suppression du compte', async () => {
    const { moduleId } = unwrap(await service().createModule('alice', 'Immeuble'));
    for (const uid of ['koffi', 'ama', 'lea']) {
      as(uid);
      unwrap(await service().requestAccess(uid, moduleId, uid));
    }
    as('alice');
    unwrap(await service().approve('alice', moduleId, 'koffi', 'c1'));
    unwrap(await service().approve('alice', moduleId, 'lea', 'c2'));
    unwrap(await service().refuse('alice', moduleId, 'ama'));
    as('koffi');
    unwrap(await service().leave('koffi', moduleId));
    expect((await adminGet('modules', moduleId, 'requests', 'koffi')).exists()).toBe(false); // le nom saisi n’est plus conservé
    expect((await adminGet('modules', moduleId, 'members', 'koffi')).data()).toMatchObject({ state: 'left', contractId: 'c1' }); // l’historique reste chez le propriétaire
    as('ama');
    expect((await service().cancelRequest('ama', moduleId)).ok).toBe(false); // une demande refusée reste : elle bloque
    expect((await adminGet('modules', moduleId, 'requests', 'ama')).exists()).toBe(true);
    // départ au moment de la suppression du compte de Léa (accès actif + demande approuvée)
    const departure = await departureModule.leaveJoinedModules(backendModule.createFirestoreModulesBackend(dbFor('lea') as never, 'lea'), 'lea', [moduleId]);
    expect(departure).toEqual({ left: 1, erased: 1, failed: 0 });
    expect((await adminGet('modules', moduleId, 'members', 'lea')).data()).toMatchObject({ state: 'left' });
    expect((await adminGet('modules', moduleId, 'requests', 'lea')).exists()).toBe(false);
  });

  it('publication par différences sur le vrai cloud : une seconde publication n’écrit rien', async () => {
    const { moduleId } = unwrap(await service().createModule('alice', 'Immeuble'));
    as('koffi');
    unwrap(await service().requestAccess('koffi', moduleId, ''));
    as('alice');
    unwrap(await service().approve('alice', moduleId, 'koffi', 'c1'));
    expect(unwrap(await service().publishViews('alice', moduleId))).toMatchObject({ members: 1, written: 0, deleted: 0, failed: 0 });
  });
});
