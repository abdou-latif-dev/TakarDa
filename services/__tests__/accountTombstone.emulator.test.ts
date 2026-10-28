// Compte supprimé — un ancien jeton ne recrée RIEN (constat du test A6 sur le projet de test réel). Joué contre les VRAIES règles candidates
// (firestore.p5.rules : `accountLive()` et `deletedAccounts/{uid}`) dans l'ÉMULATEUR Firestore LOCAL, avec la composition de suppression réelle de l'application
// (`createCloudDeletion`). IGNORÉ tant que l'émulateur n'est pas lancé. Projet « demo-… » : aucune ressource réelle.
//
//   npx firebase-tools@15.33.0 emulators:exec --config firebase.modules.json --only firestore --project demo-takarda "npx jest -c jest.emulator.modules.config.js --testPathPattern accountTombstone"
//
// Limites : Authentication est SIMULÉE (jeton `sign_in_provider: 'password'` fourni par la bibliothèque de test) : un second « appareil » est un second contexte du MÊME
// identifiant, dont le jeton reste valide après la suppression, exactement comme sur le service réel (constaté le 22 octobre 2026 : écritures acceptées à 0 minute).

import fs from 'fs';
import path from 'path';

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

describeEmulator('Compte supprimé : un ancien jeton ne recrée rien (règles réelles, émulateur)', () => {
  let env: any;
  let t: any;
  let f: any;
  let composition: typeof import('../firebase/cloudDeletionComposition');
  let syncBackend: typeof import('../firebase/firestoreSyncBackend');
  let transports: typeof import('../firebase/firestoreSyncTransport');
  let modulesBackend: typeof import('../firebase/firestoreModulesBackend');
  let moduleModel: typeof import('../sharedModules/model');
  let kinds: typeof import('../sync/kindRegistry');
  const token = { firebase: { sign_in_provider: 'password' } };
  const STAMP = '2026-10-22T09:00:00.000Z';
  let counter = 0;

  /** Un « appareil » : un contexte neuf pour l'identifiant (son jeton reste valide tant que le test dure, comme un jeton non expiré). */
  const device = (uid: string) => env.authenticatedContext(uid, token).firestore();

  const profile = (uid: string) => ({ defaultSpaceId: `personal_${uid}`, createdAt: STAMP });
  const space = (uid: string) => ({ ownerUid: uid, memberUids: [uid], name: 'Espace', createdAt: STAMP, schemaVersion: 1 });
  const record = (uid: string) => ({ kind: 'bien', values: { nom: 'Maison' }, statusKey: null, createdBy: uid, createdAt: STAMP, updatedAt: STAMP, rev: 1, deletedAt: null });
  const wire = (uid: string, id: string) => ({ id, kind: kinds.KIND.IMMOBILIER_BIEN, schemaVersion: 1, ownerUid: uid, statusKey: null, createdAt: STAMP, updatedAt: STAMP, body: { nom: id }, refs: {} });
  const push = (db: unknown, uid: string, id: string) =>
    transports
      .createFirestoreSyncTransport({ backend: syncBackend.createFirestoreSyncBackend(db as never, uid), uid, overlapMs: 0 })
      .push({ opId: `tomb-${(counter += 1)}`, recordId: id, kind: kinds.KIND.IMMOBILIER_BIEN, op: 'create', expectedRev: null, deletedAt: null, wire: wire(uid, id) } as never);
  const createModule = (db: unknown, uid: string) =>
    modulesBackend.createFirestoreModulesBackend(db as never, uid).createModule(moduleModel.generateModuleId(), { ownerUid: uid, type: 'immobilier', name: 'Immeuble', createdAt: STAMP, schemaVersion: 1 });

  /** Profil, espace, `records` (par lots de 20), documents de synchronisation et un espace partagé : tout ce qu'un compte actif possède. */
  async function populate(uid: string, db: unknown, records = 3) {
    await t.assertSucceeds(f.setDoc(f.doc(db, 'users', uid), profile(uid)));
    await t.assertSucceeds(f.setDoc(f.doc(db, 'spaces', `personal_${uid}`), space(uid)));
    for (let from = 0; from < records; from += 20) {
      const batch = f.writeBatch(db);
      for (let i = from; i < Math.min(records, from + 20); i += 1) batch.set(f.doc(db, 'spaces', `personal_${uid}`, 'records', `r${i}`), record(uid));
      await t.assertSucceeds(batch.commit()); // un lot de 20 : la vérification du marqueur ne dépasse pas les limites d'accès des règles
    }
    await push(db, uid, 's1');
    await push(db, uid, 's2');
    await createModule(db, uid);
  }

  /** Ce qui reste sur le serveur pour ce compte (lecture SANS règles : le test regarde derrière elles). */
  const leftovers = async (uid: string) => {
    let out = { profile: false, space: false, records: 0, sync: 0, modules: 0 };
    await env.withSecurityRulesDisabled(async (ctx: { firestore: () => unknown }) => {
      const db = ctx.firestore();
      out = {
        profile: (await f.getDoc(f.doc(db, 'users', uid))).exists(),
        space: (await f.getDoc(f.doc(db, 'spaces', `personal_${uid}`))).exists(),
        records: (await f.getDocs(f.collection(db, 'spaces', `personal_${uid}`, 'records'))).size,
        sync: (await f.getDocs(f.collection(db, 'spaces', `personal_${uid}`, 'syncRecords'))).size,
        modules: (await f.getDocs(f.query(f.collection(db, 'modules'), f.where('ownerUid', '==', uid)))).size,
      };
    });
    return out;
  };
  const NOTHING = { profile: false, space: false, records: 0, sync: 0, modules: 0 };

  beforeAll(async () => {
    /* eslint-disable @typescript-eslint/no-require-imports */
    t = require('@firebase/rules-unit-testing');
    f = require('firebase/firestore');
    composition = require('../firebase/cloudDeletionComposition');
    syncBackend = require('../firebase/firestoreSyncBackend');
    transports = require('../firebase/firestoreSyncTransport');
    modulesBackend = require('../firebase/firestoreModulesBackend');
    moduleModel = require('../sharedModules/model');
    kinds = require('../sync/kindRegistry');
    /* eslint-enable @typescript-eslint/no-require-imports */
    env = await t.initializeTestEnvironment({
      projectId: 'demo-takarda-tombstone',
      // TOMBSTONE_RULES_FILE : règles alternatives, réservées aux CONTRÔLES NÉGATIFS (règles volontairement privées de la protection : le test doit alors échouer)
      firestore: { rules: fs.readFileSync(process.env.TOMBSTONE_RULES_FILE ?? path.join(__dirname, '..', '..', 'firestore.p5.rules'), 'utf8') },
    });
  });
  afterAll(async () => env?.cleanup());
  beforeEach(async () => {
    await env.clearFirestore();
  });

  it('compte vivant : tout est permis (témoin : la protection ne gêne pas l’usage normal, lots de 20 compris)', async () => {
    await populate('alice', device('alice'), 45);
    expect(await leftovers('alice')).toMatchObject({ profile: true, space: true, records: 45, sync: 2, modules: 1 });
  });

  it('A6 : après une suppression COMPLÈTE et vérifiée, l’ancien jeton du même compte ne recrée ni profil, ni espace, ni enregistrement, ni synchronisation, ni espace partagé', async () => {
    const first = device('alice');
    const second = device('alice'); // second appareil : son jeton reste valide après la suppression
    await populate('alice', first, 25);

    const report = await composition.createCloudDeletion(first as never)('alice');
    expect(report).toMatchObject({ verified: true, tombstone: 'created' });
    expect(await leftovers('alice')).toEqual(NOTHING);

    await t.assertFails(f.setDoc(f.doc(second, 'users', 'alice'), profile('alice')));
    await t.assertFails(f.setDoc(f.doc(second, 'spaces', 'personal_alice'), space('alice')));
    await t.assertFails(f.setDoc(f.doc(second, 'spaces', 'personal_alice', 'records', 'zombie'), record('alice')));
    await expect(push(second, 'alice', 'zombie')).rejects.toBeTruthy();
    await expect(createModule(second, 'alice')).rejects.toBeTruthy();
    expect(await leftovers('alice')).toEqual(NOTHING); // rien n'a été recréé
  });

  it('CONTRÔLE NÉGATIF : sans le marqueur (ancien comportement), le même scénario RECRÉE profil et espace — le test détecte bien le défaut', async () => {
    const first = device('alice');
    const second = device('alice');
    await populate('alice', first, 3);
    const report = await composition.createCloudDeletion(first as never, { accountTombstone: false })('alice');
    expect(report.tombstone).toBeUndefined();
    await t.assertSucceeds(f.setDoc(f.doc(second, 'users', 'alice'), profile('alice'))); // la fenêtre constatée sur le service réel
    await t.assertSucceeds(f.setDoc(f.doc(second, 'spaces', 'personal_alice'), space('alice')));
    expect(await leftovers('alice')).toMatchObject({ profile: true, space: true });
  });

  it('le marqueur est définitif : ni modifié, ni supprimé, ni recréé, même par le compte lui-même avec un ancien jeton', async () => {
    const first = device('alice');
    await populate('alice', first, 1);
    await composition.createCloudDeletion(first as never)('alice');
    const second = device('alice');
    await t.assertFails(f.deleteDoc(f.doc(second, 'deletedAccounts', 'alice')));
    await t.assertFails(f.setDoc(f.doc(second, 'deletedAccounts', 'alice'), { deletedAt: f.serverTimestamp() }));
    await t.assertFails(f.updateDoc(f.doc(second, 'deletedAccounts', 'alice'), { deletedAt: f.serverTimestamp() }));
    await t.assertSucceeds(f.getDoc(f.doc(second, 'deletedAccounts', 'alice'))); // lisible par son titulaire seul (reprise)
  });

  it('reprise : la suppression se relance, le marqueur existant est constaté (« exists »), et le compte reste entièrement supprimé', async () => {
    const first = device('alice');
    await populate('alice', first, 60); // 3 lots de 20
    const one = await composition.createCloudDeletion(first as never)('alice');
    expect(one).toMatchObject({ verified: true, tombstone: 'created' });
    const again = await composition.createCloudDeletion(device('alice') as never)('alice');
    expect(again.tombstone).toBe('exists');
    expect(await leftovers('alice')).toEqual(NOTHING);
  });

  it('un autre compte n’est pas affecté par la suppression de celui-ci, et ne peut ni lire, ni poser, ni lister le marqueur d’autrui', async () => {
    const alice = device('alice');
    await populate('alice', alice, 2);
    await composition.createCloudDeletion(alice as never)('alice');
    const bob = device('bob');
    await populate('bob', bob, 2); // bob est vivant
    expect(await leftovers('bob')).toMatchObject({ profile: true, space: true, records: 2 });
    await t.assertFails(f.getDoc(f.doc(bob, 'deletedAccounts', 'alice'))); // pas de lecture du marqueur d'autrui
    await t.assertFails(f.setDoc(f.doc(bob, 'deletedAccounts', 'carol'), { deletedAt: f.serverTimestamp() })); // pas de marqueur au nom d'un autre
    await t.assertFails(f.getDocs(f.collection(bob, 'deletedAccounts'))); // aucune liste
  });

  it('forme du marqueur : seulement `deletedAt` à l’heure du serveur ; ni champ en plus, ni date choisie par le client', async () => {
    const bob = device('bob');
    await t.assertFails(f.setDoc(f.doc(bob, 'deletedAccounts', 'bob'), { deletedAt: f.serverTimestamp(), note: 'x' }));
    await t.assertFails(f.setDoc(f.doc(bob, 'deletedAccounts', 'bob'), { deletedAt: new Date('2020-01-01T00:00:00.000Z') }));
    await t.assertFails(f.setDoc(f.doc(bob, 'deletedAccounts', 'bob'), { deletedAt: 'hier' }));
    await t.assertSucceeds(f.setDoc(f.doc(bob, 'deletedAccounts', 'bob'), { deletedAt: f.serverTimestamp() }));
    await t.assertFails(f.setDoc(f.doc(device('anon-sans-compte-password'), 'deletedAccounts', 'x'), { deletedAt: f.serverTimestamp() })); // uid différent du chemin
  });

  it('une suppression interrompue après la pose du marqueur : plus aucune création (le marqueur est irréversible), mais la reprise va à son terme', async () => {
    const first = device('alice');
    await populate('alice', first, 5);
    // le marqueur est posé puis la suite est interrompue (panne simulée avant tout effacement)
    await composition.createCloudDeletion(first as never, {
      wrapErasureBackend: (backend) => ({ ...backend, lockSpace: async () => { throw Object.assign(new Error('coupure'), { code: 'unavailable' }); } }),
    })('alice').catch(() => undefined);
    await t.assertFails(f.setDoc(f.doc(device('alice'), 'spaces', 'personal_alice', 'records', 'apres'), record('alice'))); // plus de création
    const resumed = await composition.createCloudDeletion(device('alice') as never)('alice');
    expect(resumed).toMatchObject({ verified: true });
    expect(await leftovers('alice')).toEqual(NOTHING);
  });
});
