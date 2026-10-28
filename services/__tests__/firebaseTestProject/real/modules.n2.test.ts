// N2-MODULES — espaces partagés propriétaire / locataire sur le VRAI service (projet de TEST « takarda-n2-test »), avec trois comptes jetables : « alice » (propriétaire), « koffi » (locataire),
// « mallory » (tiers). Même scénario que l'émulateur (modulesFlows.emulator.test.ts), SANS accès administrateur : tout passe par les comptes et les vraies règles.
//
// PRÉREQUIS : le candidat P5 (espaces partagés + marqueur « compte supprimé », empreinte dans firestore.rules.manifest.json) est PUBLIÉ sur le projet de TEST (autorisation séparée). Ces tests ne
// démarrent donc QUE si TAKARDA_N2_MODULES_RULES=1 est posé en plus des variables habituelles : contre les règles actuelles (P4), ils échoueraient et pourraient laisser des restes.
// NON EXÉCUTÉ à ce jour (le candidat n'est pas publié). Nettoyage : suppression complète du compte propriétaire par la composition de l'application (espaces partagés, marqueur, synchronisation,
// reste), puis nettoyage habituel du harnais ; tout reste est listé avec l'identifiant du compte pour une purge manuelle dans la console du projet de TEST.

import type * as H from './harnessReal';

const ready =
  !!process.env.TAKARDA_TEST_PROJECT_ID &&
  !!process.env.TAKARDA_CONFIRM_TEST_PROJECT &&
  !!process.env.TAKARDA_TEST_FIREBASE_CONFIG_FILE &&
  process.env.TAKARDA_N2_MODULES_RULES === '1';
const suite = ready ? describe : describe.skip;

jest.mock('@react-native-async-storage/async-storage', () => {
  const memory = new Map<string, string>();
  return {
    __esModule: true,
    default: {
      getItem: async (key: string) => (memory.has(key) ? (memory.get(key) as string) : null),
      setItem: async (key: string, value: string) => void memory.set(key, value),
      removeItem: async (key: string) => void memory.delete(key),
      clear: async () => memory.clear(),
      getAllKeys: async () => [...memory.keys()],
    },
  };
});

suite('N2-MODULES · espaces partagés propriétaire / locataire (projet de test réel, P5 publié)', () => {
  let h: typeof H;
  let serviceModule: typeof import('../../../sharedModulesService');
  let backendModule: typeof import('../../../firebase/firestoreModulesBackend');
  let compositionModule: typeof import('../../../firebase/cloudDeletionComposition');
  let verification: typeof import('../../../accountVerification');
  let syncAccount: typeof import('../../../sync/syncAccount');
  const users: Record<'alice' | 'koffi' | 'mallory', H.TestUser> = {} as never;
  const contracts = [{ id: 'c1', label: 'Koffi', statusKey: 'actif', endDay: null }];
  let moduleId = '';

  beforeAll(async () => {
    /* eslint-disable @typescript-eslint/no-require-imports */
    require('./networkGuardReal');
    h = require('./harnessReal');
    serviceModule = require('../../../sharedModulesService');
    backendModule = require('../../../firebase/firestoreModulesBackend');
    compositionModule = require('../../../firebase/cloudDeletionComposition');
    verification = require('../../../accountVerification');
    syncAccount = require('../../../sync/syncAccount');
    const persistence = require('../../../persistence') as typeof import('../../../persistence');
    /* eslint-enable @typescript-eslint/no-require-imports */
    await persistence.switchWorkspace('personal');
    for (const key of ['alice', 'koffi', 'mallory'] as const) users[key] = await h.makeUser(`modules-${key}`);
    h.spend(120, 'espaces partagés');
  });

  afterAll(async () => {
    const problems: string[] = [];
    try {
      const report = await compositionModule.createCloudDeletion(users.alice.client.db)(users.alice.uid);
      h.observe('modules.cleanup.alice', { verified: report.verified, modules: report.modules, tombstone: report.tombstone });
      if (!report.verified) problems.push(`${users.alice.email} (${users.alice.uid}) : suppression non vérifiée (${report.error?.code ?? 'sans erreur'})`);
    } catch (error) {
      problems.push(`${users.alice.email} (${users.alice.uid}) : suppression en erreur (${(error as { code?: string }).code ?? 'erreur'})`);
    }
    const cleanup = await h.cleanupAll();
    h.observe('modules.cleanup', cleanup);
    problems.push(...cleanup.failures);
    syncAccount.setSyncAccount(null);
    if (problems.length > 0) throw new Error(`NETTOYAGE INCOMPLET — ressources de CETTE exécution à purger dans la console du projet de test :\n${problems.join('\n')}`);
  });

  const dbOf = (uid: string) => Object.values(users).find((u) => u.uid === uid)!.client.db;
  const as = (key: keyof typeof users) => {
    syncAccount.setSyncAccount(users[key].uid);
    verification.setEmailVerified(users[key].uid, true);
  };
  const backendOf = (key: keyof typeof users) => backendModule.createFirestoreModulesBackend(users[key].client.db, users[key].uid);
  const service = () =>
    serviceModule.createSharedModulesService({
      enabled: () => true,
      backend: (uid: string) => backendModule.createFirestoreModulesBackend(dbOf(uid), uid),
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
  const denied = (promise: Promise<unknown>) => promise.then(() => 'accepté', (e: { code?: string }) => e.code ?? 'erreur');

  it('M1 · parcours complet : créer, demander, approuver (lot atomique), publier la vue, la lire, révoquer, rétablir', async () => {
    as('alice');
    moduleId = unwrap(await service().createModule(users.alice.uid, 'Immeuble N2')).moduleId;
    expect(moduleId).toMatch(/^mod_[a-z0-9]{24}$/);

    as('koffi');
    unwrap(await service().requestAccess(users.koffi.uid, moduleId, 'Koffi'));
    expect(await denied(backendOf('koffi').getModule(moduleId))).toBe('permission'); // rien n'est lisible avant l'approbation

    as('alice');
    expect(unwrap(await service().ownerView(users.alice.uid, moduleId)).requests).toMatchObject([{ uid: users.koffi.uid, state: 'pending', label: 'Koffi' }]);
    unwrap(await service().approve(users.alice.uid, moduleId, users.koffi.uid, 'c1'));

    as('koffi');
    const view = unwrap(await service().refreshMyView(users.koffi.uid, moduleId));
    expect(view.state).toBe('ok');
    if (view.state === 'ok') {
      expect(view.model.contrat?.locataireNom).toBe('Locataire c1');
      expect(view.model.paiements[0]).toMatchObject({ statut: 'paye', modePaiement: 'Mobile money' });
    }

    as('alice');
    unwrap(await service().revoke(users.alice.uid, moduleId, users.koffi.uid));
    as('koffi');
    expect(unwrap(await service().refreshMyView(users.koffi.uid, moduleId))).toEqual({ state: 'unavailable', status: 'revoked' });
    expect(await denied(backendOf('koffi').listTenantItems(moduleId, users.koffi.uid))).toBe('permission');

    as('alice');
    unwrap(await service().reactivate(users.alice.uid, moduleId, { uid: users.koffi.uid, contractId: 'c1' }));
    as('koffi');
    expect(unwrap(await service().refreshMyView(users.koffi.uid, moduleId)).state).toBe('ok');
  });

  it('M2 · étanchéité : un locataire ne lit pas la vue d’un autre, n’écrit rien, ne liste ni membres ni demandes ; un tiers ne voit rien ; le propriétaire seul lit ses données', async () => {
    const koffi = backendOf('koffi');
    expect(await denied(koffi.listTenantItems(moduleId, users.mallory.uid))).toBe('permission');
    expect(await denied(koffi.putTenantItems(moduleId, users.koffi.uid, [{ id: 'contrat', doc: { kind: 'contrat', body: { loyerMensuel: 1 }, rev: 9, updatedAt: 'x' } }]))).toBe('permission');
    expect(await denied(koffi.deleteTenantItems(moduleId, users.koffi.uid, ['contrat']))).toBe('permission');
    expect(await denied(koffi.listMembers(moduleId))).toBe('permission');
    expect(await denied(koffi.listRequests(moduleId))).toBe('permission');
    const mallory = backendOf('mallory');
    expect(await denied(mallory.getModule(moduleId))).toBe('permission');
    expect(await denied(mallory.listTenantItems(moduleId, users.koffi.uid))).toBe('permission');
    expect(await denied(mallory.createRequest(moduleId, { uid: users.koffi.uid, state: 'approved', label: null, decidedBy: users.mallory.uid, createdAt: 'x', updatedAt: 'x' } as never))).toBe('permission'); // pas de demande au nom d'un autre, ni auto-approbation
    expect(JSON.stringify(await backendOf('alice').listTenantItems(moduleId, users.koffi.uid))).toContain('Locataire c1'); // le propriétaire relit ce qu'il publie
  });

  it('M3 · suppression complète du compte propriétaire (composition de l’application) : espaces partagés effacés, marqueur posé, vérifié ; l’ancien jeton ne recrée RIEN ; le locataire perd l’accès', async () => {
    const zombie = await h.secondDevice(users.alice, 'modules-zombie');
    as('alice');
    const report = await compositionModule.createCloudDeletion(users.alice.client.db)(users.alice.uid);
    h.observe('modules.M3.report', { verified: report.verified, modules: report.modules, tombstone: report.tombstone });
    expect(report.modules).toMatchObject({ status: 'purged', modules: 1, deleted: 1 });
    expect(report).toMatchObject({ verified: true, tombstone: 'created' });

    // A6 sur les espaces partagés : le second appareil du même compte garde son jeton, mais le marqueur interdit toute création
    const moduleBackend = backendModule.createFirestoreModulesBackend(zombie.db, users.alice.uid);
    const attempt = await denied(moduleBackend.createModule('mod_zzzzzzzzzzzzzzzzzzzzzzzz', { ownerUid: users.alice.uid, type: 'immobilier', name: 'Zombie', createdAt: '2026-10-22T09:00:00.000Z', schemaVersion: 1 }));
    h.observe('modules.M3.zombieCreateModule', attempt);
    expect(attempt).toBe('permission');

    as('koffi');
    expect(unwrap(await service().refreshMyView(users.koffi.uid, moduleId))).toEqual({ state: 'unavailable', status: 'none' }); // l'espace n'existe plus : plus d'accès, copie locale retirée
  });
});
