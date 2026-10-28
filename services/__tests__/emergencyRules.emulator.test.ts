// F4 — règles d'URGENCE (variante 1 « écritures refusées », variante 2 « tout refusé ») exécutées dans l'ÉMULATEUR Firestore LOCAL. IGNORÉ tant que l'émulateur n'est
// pas lancé. Projets « demo-… » : aucune ressource réelle. La répétition de la procédure sur un projet de TEST réel (publier, relire, vérifier, revenir) reste à faire.
//
//   npx firebase-tools@15.33.0 emulators:exec --config firebase.modules.json --only firestore --project demo-takarda "npx jest -c jest.emulator.modules.config.js emergencyRules"

import fs from 'fs';
import path from 'path';

const emulator = !!process.env.FIRESTORE_EMULATOR_HOST;
const describeEmulator = emulator ? describe : describe.skip;

const M = 'mod_aaaaaaaaaaaaaaaaaaaaaaaa';
const token = { firebase: { sign_in_provider: 'password' } };
const STAMP = '2026-10-01T09:00:00.000Z';

describeEmulator('Règles d’urgence — émulateur', () => {
  let t: any;
  let f: any;
  const rules = (file: string) => fs.readFileSync(path.join(__dirname, '..', '..', file), 'utf8');

  /** Un monde réaliste : un module avec un locataire actif et sa vue ; un espace personnel avec une donnée de synchronisation ; un profil. */
  async function seed(env: any) {
    await env.withSecurityRulesDisabled(async (ctx: { firestore: () => unknown }) => {
      const db = ctx.firestore();
      await f.setDoc(f.doc(db, 'modules', M), { ownerUid: 'alice', type: 'immobilier', name: 'Immeuble', createdAt: STAMP, schemaVersion: 1 });
      await f.setDoc(f.doc(db, 'modules', M, 'members', 'koffi'), { uid: 'koffi', role: 'locataire', state: 'active', contractId: 'c1', accessUntil: null, addedBy: 'alice', createdAt: STAMP, updatedAt: STAMP });
      await f.setDoc(f.doc(db, 'modules', M, 'requests', 'koffi'), { uid: 'koffi', state: 'approved', label: null, decidedBy: 'alice', createdAt: STAMP, updatedAt: STAMP });
      await f.setDoc(f.doc(db, 'modules', M, 'tenantViews', 'koffi', 'items', 'contrat'), { kind: 'contrat', body: { loyerMensuel: 30000 }, rev: 1, updatedAt: STAMP });
      await f.setDoc(f.doc(db, 'spaces', 'personal_alice'), { ownerUid: 'alice', memberUids: ['alice'], name: 'A', createdAt: STAMP, schemaVersion: 1 });
      await f.setDoc(f.doc(db, 'spaces', 'personal_alice', 'syncRecords', 'b1'), { kind: 'immobilier.bien', schemaVersion: 1, ownerUid: 'alice', statusKey: null, createdAt: STAMP, updatedAt: STAMP, body: { nom: 'M' }, refs: {}, rev: 1, deleted: false, deletedAt: null, restoredAt: null, lastOpId: 'op', serverUpdatedAt: f.serverTimestamp() });
      await f.setDoc(f.doc(db, 'users', 'alice'), { defaultSpaceId: 'personal_alice', createdAt: STAMP });
    });
  }

  /** Toutes les écritures que l'application sait faire : aucune ne doit passer sous une règle d'urgence. */
  const writes = (db: any, actor: 'alice' | 'koffi' | 'carol') => {
    const d = (...s: string[]) => f.doc(db, ...s);
    const newSync = { kind: 'immobilier.bien', schemaVersion: 1, ownerUid: actor, statusKey: null, createdAt: STAMP, updatedAt: STAMP, body: { nom: 'N' }, refs: {}, rev: 1, deleted: false, deletedAt: null, restoredAt: null, lastOpId: 'op2', serverUpdatedAt: f.serverTimestamp() };
    return {
      'créer son espace personnel': () => f.setDoc(d('spaces', `personal_${actor}`), { ownerUid: actor, memberUids: [actor], name: 'X', createdAt: STAMP, schemaVersion: 1 }),
      'créer son profil': () => f.setDoc(d('users', actor), { defaultSpaceId: `personal_${actor}`, createdAt: STAMP }),
      'créer un document de synchronisation': () => f.setDoc(d('spaces', `personal_${actor}`, 'syncRecords', 'n1'), newSync),
      'modifier un document de synchronisation': () => f.setDoc(d('spaces', 'personal_alice', 'syncRecords', 'b1'), { ...newSync, ownerUid: 'alice', rev: 2 }),
      'créer un espace partagé': () => f.setDoc(d('modules', 'mod_zzzzzzzzzzzzzzzzzzzzzzzz'), { ownerUid: actor, type: 'immobilier', name: 'N', createdAt: STAMP, schemaVersion: 1 }),
      'renommer un espace partagé': () => f.updateDoc(d('modules', M), { name: 'Autre' }),
      'poser le verrou d’un espace partagé': () => f.updateDoc(d('modules', M), { deletionLockedAt: STAMP }),
      'demander l’accès': () => f.setDoc(d('modules', M, 'requests', actor), { uid: actor, state: 'pending', label: null, decidedBy: null, createdAt: STAMP, updatedAt: STAMP }),
      'révoquer un membre': () => f.updateDoc(d('modules', M, 'members', 'koffi'), { state: 'revoked', updatedAt: STAMP }),
      'quitter un espace': () => f.updateDoc(d('modules', M, 'members', 'koffi'), { state: 'left', updatedAt: STAMP }),
      'publier la vue d’un locataire': () => f.setDoc(d('modules', M, 'tenantViews', 'koffi', 'items', 'contrat'), { kind: 'contrat', body: { loyerMensuel: 31000 }, rev: 2, updatedAt: STAMP }),
      'retirer un élément de vue': () => f.deleteDoc(d('modules', M, 'tenantViews', 'koffi', 'items', 'contrat')),
      'annuler sa demande': () => f.deleteDoc(d('modules', M, 'requests', 'koffi')),
    } as Record<string, () => Promise<unknown>>;
  };

  beforeAll(() => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    t = require('@firebase/rules-unit-testing');
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    f = require('firebase/firestore');
  });

  describe('Variante 1 — écritures refusées', () => {
    let env: any;
    beforeAll(async () => {
      env = await t.initializeTestEnvironment({ projectId: 'demo-takarda-emergency1', firestore: { rules: rules('firestore.emergency-writes-off.rules') } });
    });
    afterAll(async () => env?.cleanup());
    beforeEach(async () => {
      await env.clearFirestore();
      await seed(env);
    });
    const ctx = (uid: string) => env.authenticatedContext(uid, token).firestore();

    it('les lectures légitimes continuent : le propriétaire lit son espace partagé et ses données, le locataire lit sa vue', async () => {
      await t.assertSucceeds(f.getDoc(f.doc(ctx('alice'), 'modules', M)));
      await t.assertSucceeds(f.getDocs(f.collection(ctx('alice'), 'modules', M, 'members')));
      await t.assertSucceeds(f.getDoc(f.doc(ctx('alice'), 'spaces', 'personal_alice', 'syncRecords', 'b1')));
      await t.assertSucceeds(f.getDoc(f.doc(ctx('koffi'), 'modules', M, 'tenantViews', 'koffi', 'items', 'contrat')));
      await t.assertSucceeds(f.getDoc(f.doc(ctx('alice'), 'users', 'alice')));
    });

    it('les lectures illégitimes restent refusées (l’urgence n’ouvre rien)', async () => {
      await t.assertFails(f.getDoc(f.doc(ctx('carol'), 'modules', M)));
      await t.assertFails(f.getDoc(f.doc(ctx('carol'), 'modules', M, 'tenantViews', 'koffi', 'items', 'contrat')));
      await t.assertFails(f.getDoc(f.doc(ctx('koffi'), 'spaces', 'personal_alice', 'syncRecords', 'b1')));
      await t.assertFails(f.getDoc(f.doc(env.unauthenticatedContext().firestore(), 'modules', M)));
    });

    it('AUCUNE écriture ne passe, pour aucun compte, quelle que soit l’opération', async () => {
      for (const actor of ['alice', 'koffi', 'carol'] as const) {
        for (const [name, run] of Object.entries(writes(ctx(actor), actor))) {
          await t.assertFails(run().then(() => undefined), `${actor} : ${name}`);
        }
      }
    });
  });

  describe('Variante 2 — tout refusé', () => {
    let env: any;
    beforeAll(async () => {
      env = await t.initializeTestEnvironment({ projectId: 'demo-takarda-emergency2', firestore: { rules: rules('firestore.emergency-all-off.rules') } });
    });
    afterAll(async () => env?.cleanup());
    beforeEach(async () => {
      await env.clearFirestore();
      await seed(env);
    });
    const ctx = (uid: string) => env.authenticatedContext(uid, token).firestore();

    it('plus aucune lecture : ni le propriétaire, ni le locataire, ni l’espace personnel, ni le profil', async () => {
      await t.assertFails(f.getDoc(f.doc(ctx('alice'), 'modules', M)));
      await t.assertFails(f.getDocs(f.collection(ctx('alice'), 'modules', M, 'members')));
      await t.assertFails(f.getDoc(f.doc(ctx('alice'), 'spaces', 'personal_alice', 'syncRecords', 'b1')));
      await t.assertFails(f.getDoc(f.doc(ctx('koffi'), 'modules', M, 'tenantViews', 'koffi', 'items', 'contrat')));
      await t.assertFails(f.getDoc(f.doc(ctx('alice'), 'users', 'alice')));
    });

    it('plus aucune écriture, pour aucun compte', async () => {
      for (const actor of ['alice', 'koffi', 'carol'] as const) {
        for (const [name, run] of Object.entries(writes(ctx(actor), actor))) {
          await t.assertFails(run().then(() => undefined), `${actor} : ${name}`);
        }
      }
    });
  });
});
