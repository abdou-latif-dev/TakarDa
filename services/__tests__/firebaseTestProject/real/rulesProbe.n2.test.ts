// N2-SONDE — caractérise le comportement des règles Firestore ACTUELLEMENT publiées sur le projet de TEST « takarda-n2-test », par
// des écritures et lectures contrôlées de comptes jetables sur leurs PROPRES chemins. Rien n'est publié ni modifié côté règles. Ce
// n'est pas un test qui « doit passer » : il CONSIGNE le résultat de chaque sonde (N2-OBS) et n'échoue que si le nettoyage est incomplet.
// Ignoré sans variables d'environnement : la suite habituelle ne contacte jamais Firebase.
//
// Sondes (A et B sont deux comptes jetables ; U est un client non connecté) :
//   R0  U lit l'espace de A                       → refus attendu (sinon : règles OUVERTES)
//   R1  A crée son profil et son espace           → règles de base (V1)
//   R2  A crée un enregistrement dans son espace  → règles de base (V1)
//   R3a B lit un enregistrement de A              → refus attendu (sinon : fuite entre comptes)
//   R3b B écrit dans l'espace de A                → refus attendu (sinon : écriture entre comptes)
//   R3c U lit un enregistrement de A              → refus attendu (sinon : règles OUVERTES)
//   R5  A pousse un document de synchronisation   → accepté seulement avec les règles de synchronisation (P4 ou plus)
//   R6  A crée un espace partagé (modules/{id})   → accepté seulement avec les règles des espaces partagés (P5)
//   R6b B lit l'espace partagé de A               → refus attendu (B n'est pas membre)
// Nettoyage : uniquement ce que CETTE exécution a créé (espace partagé s'il existe, documents de synchronisation, puis le nettoyage
// habituel du harnais). Un reste est listé avec l'identifiant du compte pour une purge manuelle dans la console du projet de TEST.

import type * as H from './harnessReal';

const enabled = !!process.env.TAKARDA_TEST_PROJECT_ID && !!process.env.TAKARDA_CONFIRM_TEST_PROJECT && !!process.env.TAKARDA_TEST_FIREBASE_CONFIG_FILE;
const suite = enabled ? describe : describe.skip;

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

suite('N2-SONDE · règles Firestore actuelles du projet de test (caractérisation)', () => {
  let h: typeof H;
  let f: any;
  let transports: typeof import('../../../firebase/firestoreSyncTransport');
  let backend: typeof import('../../../firebase/firestoreSyncBackend');
  let kinds: typeof import('../../../sync/kindRegistry');
  let erasure: typeof import('../../../firebase/syncAccountErasure');
  let deletion: typeof import('../../../firebase/firestoreAccountDeletion');
  let modulesBackend: typeof import('../../../firebase/firestoreModulesBackend');
  let moduleErasure: typeof import('../../../firebase/moduleErasure');
  let moduleModel: typeof import('../../../sharedModules/model');
  const created: H.TestUser[] = [];
  const outcome: Record<string, string> = {};
  let moduleId: string | null = null;

  beforeAll(() => {
    /* eslint-disable @typescript-eslint/no-require-imports */
    require('./networkGuardReal');
    h = require('./harnessReal'); // échoue (RealGuardError) si l'environnement n'est pas exactement celui du projet de test
    f = require('firebase/firestore');
    transports = require('../../../firebase/firestoreSyncTransport');
    backend = require('../../../firebase/firestoreSyncBackend');
    kinds = require('../../../sync/kindRegistry');
    erasure = require('../../../firebase/syncAccountErasure');
    deletion = require('../../../firebase/firestoreAccountDeletion');
    modulesBackend = require('../../../firebase/firestoreModulesBackend');
    moduleErasure = require('../../../firebase/moduleErasure');
    moduleModel = require('../../../sharedModules/model');
    /* eslint-enable @typescript-eslint/no-require-imports */
  });

  afterEach(() => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    require('../../../sync/syncAccount').setSyncAccount(null);
  });

  afterAll(async () => {
    const problems: string[] = [];
    const owner = created[0];
    if (owner) {
      if (outcome.R6 === 'ok' && moduleId) {
        try {
          const report = await moduleErasure.eraseOwnedModules({ backend: modulesBackend.createFirestoreModuleErasureBackend(owner.client.db, owner.uid), uid: owner.uid, only: [moduleId] });
          h.observe('sonde.nettoyage.espacePartage', { status: report.status, deleted: report.deleted, docsDeleted: report.docsDeleted });
          if (report.status !== 'purged') problems.push(`${owner.email} (${owner.uid}) : espace partagé ${moduleId} non supprimé (${report.status})`);
        } catch (error) {
          problems.push(`${owner.email} (${owner.uid}) : espace partagé ${moduleId} (${(error as { code?: string }).code ?? 'erreur'})`);
        }
      }
      if (outcome.R5 === 'ok') {
        try {
          const report = await erasure.eraseAccountCloudData({
            backend: backend.createFirestoreErasureBackend(owner.client.db, owner.uid),
            uid: owner.uid,
            deleteRest: () => deletion.deleteAccountCloudData(owner.client.db, owner.uid, { timeoutMs: 20000 }),
          });
          h.observe('sonde.nettoyage.synchronisation', { status: report.syncRecords.status, verified: report.verified });
          if (!report.verified) problems.push(`${owner.email} (${owner.uid}) : effacement non vérifié (${report.error?.code ?? report.syncRecords.status})`);
        } catch (error) {
          problems.push(`${owner.email} (${owner.uid}) : effacement en erreur (${(error as { code?: string }).code ?? 'erreur'})`);
        }
      }
    }
    const report = await h.cleanupAll();
    h.observe('sonde.nettoyage.harnais', report);
    problems.push(...report.failures);
    if (problems.length > 0) throw new Error(`NETTOYAGE INCOMPLET — ressources de CETTE exécution à purger dans la console du projet de test :\n${problems.join('\n')}`);
  });

  const code = (promise: Promise<unknown>) => promise.then(() => 'ok', (e: { code?: string }) => e.code ?? 'erreur');

  it('sondes R0 à R6b : consignées une à une (aucune règle publiée, aucune règle modifiée)', async () => {
    const a = await h.makeUser('sonde-a');
    created.push(a);
    const b = await h.makeUser('sonde-b');
    created.push(b);
    const anonymous = h.newClient('sonde-anonyme');
    const spaceOfA = ['spaces', h.personalSpace(a.uid)] as const;
    h.spend(40, 'sondes');

    outcome.R0 = await code(f.getDocFromServer(f.doc(anonymous.db, ...spaceOfA)));
    outcome.R1 = await code(h.seedAccount(a, 0));
    outcome.R2 = outcome.R1 === 'ok' ? await code(h.createRecords(a, 1, 'r')) : 'non tentée (R1 refusée)';
    outcome.R3a = await code(f.getDocFromServer(f.doc(b.client.db, ...spaceOfA, 'records', 'r0')));
    outcome.R3b = await code(f.setDoc(f.doc(b.client.db, ...spaceOfA, 'records', 'intrus'), h.recordDoc(b.uid)));
    outcome.R3c = await code(f.getDocFromServer(f.doc(anonymous.db, ...spaceOfA, 'records', 'r0')));

    if (outcome.R1 === 'ok') {
      const wire = {
        id: 'sonde',
        kind: kinds.KIND.IMMOBILIER_BIEN,
        schemaVersion: 1,
        ownerUid: a.uid,
        statusKey: null,
        createdAt: '2026-10-22T09:00:00.000Z',
        updatedAt: '2026-10-22T09:00:00.000Z',
        body: { nom: 'Sonde' },
        refs: {},
      };
      const transport = transports.createFirestoreSyncTransport({ backend: backend.createFirestoreSyncBackend(a.client.db, a.uid), uid: a.uid, overlapMs: 0 });
      outcome.R5 = await code(
        transport.push({ opId: `n2-${h.runId}-sonde`, recordId: 'sonde', kind: wire.kind, op: 'create', expectedRev: null, deletedAt: null, wire } as never),
      );
    } else {
      outcome.R5 = 'non tentée (R1 refusée)';
    }

    moduleId = moduleModel.generateModuleId();
    const moduleDoc = { ownerUid: a.uid, type: 'immobilier' as const, name: 'Sonde', createdAt: '2026-10-22T09:00:00.000Z', schemaVersion: 1 as const };
    outcome.R6 = await code(modulesBackend.createFirestoreModulesBackend(a.client.db, a.uid).createModule(moduleId, moduleDoc as never));
    outcome.R6b = outcome.R6 === 'ok' ? await code(modulesBackend.createFirestoreModulesBackend(b.client.db, b.uid).getModule(moduleId)) : 'non tentée (R6 refusée)';

    for (const [name, value] of Object.entries(outcome)) h.observe(`sonde.${name}`, value);

    const open = outcome.R0 === 'ok' || outcome.R3a === 'ok' || outcome.R3b === 'ok' || outcome.R3c === 'ok';
    h.observe('sonde.verdict', {
      reglesOuvertes: open,
      reglesDeBase: outcome.R1 === 'ok' && outcome.R2 === 'ok',
      synchronisation: outcome.R5 === 'ok',
      espacesPartages: outcome.R6 === 'ok',
    });
  }, 120000);
});
