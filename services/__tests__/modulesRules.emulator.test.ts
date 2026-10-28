// F3a — règles des modules partagés (candidat firestore.p5.rules) jouées dans l'ÉMULATEUR Firestore LOCAL, avec LA MÊME matrice de cas que la
// politique de référence (helpers/modulesMatrix.ts). IGNORÉ tant que l'émulateur n'est pas lancé. Le projet « demo-… » garantit qu'aucune
// ressource réelle n'est touchée. NON EXÉCUTÉ à ce jour (l'émulateur demande Java, absent) : tant qu'il n'a pas tourné, les règles ne sont pas prouvées.
//
//   npx firebase-tools@15.33.0 emulators:exec --config firebase.modules.json --only firestore --project demo-takarda "npx jest -c jest.emulator.modules.config.js"
//
// Aucune règle n'est publiée : le candidat est lu dans le fichier et chargé dans l'émulateur par la bibliothèque de test.
// Approximation connue : l'heure des règles est celle de l'émulateur, pas celle de la matrice. Les instants de la matrice sont donc rapportés à l'heure
// réelle (passé = -30 j, futur = +60 j, « instant exact de fin » = une seconde déjà dépassée) ; l'égalité stricte n'est prouvée que par la politique de référence.

import fs from 'fs';
import path from 'path';
import { ACTORS, FUTURE, MATRIX, NOW, PAST, baseWorld, type MatrixCase } from './helpers/modulesMatrix';
import type { Operation, Patch } from '../sharedModules/accessPolicy';

const emulator = !!process.env.FIRESTORE_EMULATOR_HOST;
const describeEmulator = emulator ? describe : describe.skip;

// L'utilitaire de la matrice importe le modèle de synchronisation, qui touche le stockage natif : sans ce simulacre, l'exécution ORDINAIRE de Jest (sans émulateur) échouait au
// chargement de ce fichier au lieu de l'ignorer. Aucun effet sur les cas joués dans l'émulateur.
jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: { getItem: async () => null, setItem: async () => undefined, removeItem: async () => undefined, clear: async () => undefined, getAllKeys: async () => [] },
}));

describeEmulator('Règles des modules partagés — émulateur (même matrice que la politique de référence)', () => {
  let env: any;
  let t: any;
  let f: any;
  const realNow = () => Date.now();

  /** Rapporte un instant de la matrice à l'heure réelle de l'émulateur. */
  const instant = (iso: string): Date => {
    if (iso === NOW.toISOString()) return new Date(realNow() - 1000);
    if (iso === PAST) return new Date(realNow() - 30 * 86_400_000);
    if (iso === FUTURE) return new Date(realNow() + 60 * 86_400_000);
    return new Date(iso);
  };
  /** `accessUntil` est un Timestamp dans le cloud (seul comparable à l'heure du serveur par les règles). */
  const cloud = (doc: Patch): Patch => (typeof doc.accessUntil === 'string' ? { ...doc, accessUntil: f.Timestamp.fromDate(instant(doc.accessUntil)) } : { ...doc });

  const syncDoc = (lite: { kind: string; ownerUid: string; rev: number; deleted: boolean }): Patch => ({
    kind: lite.kind,
    schemaVersion: 1,
    ownerUid: lite.ownerUid,
    statusKey: null,
    createdAt: '2026-10-01T09:00:00.000Z',
    updatedAt: '2026-10-01T09:00:00.000Z',
    body: { nom: 'Maison' },
    refs: {},
    rev: lite.rev,
    deleted: lite.deleted,
    deletedAt: lite.deleted ? '2026-10-02T09:00:00.000Z' : null,
    restoredAt: null,
    lastOpId: 'op-seed',
    serverUpdatedAt: f.serverTimestamp(),
  });

  const seed = async () => {
    const world = baseWorld();
    await env.withSecurityRulesDisabled(async (ctx: { firestore: () => unknown }) => {
      const db = ctx.firestore();
      // marqueurs « compte supprimé » (un jeton encore valide ne peut plus rien créer : test A6)
      for (const uid of world.deletedUids ?? []) await f.setDoc(f.doc(db, 'deletedAccounts', uid), { deletedAt: f.serverTimestamp() });
      for (const [id, doc] of Object.entries(world.modules)) await f.setDoc(f.doc(db, 'modules', id), doc);
      for (const [key, doc] of Object.entries(world.members)) {
        const [moduleId, uid] = key.split('/');
        await f.setDoc(f.doc(db, 'modules', moduleId, 'members', uid), cloud(doc as unknown as Patch));
      }
      for (const [key, doc] of Object.entries(world.requests)) {
        const [moduleId, uid] = key.split('/');
        await f.setDoc(f.doc(db, 'modules', moduleId, 'requests', uid), doc);
      }
      for (const [key, lite] of Object.entries(world.records)) {
        const [moduleId, id] = key.split('/');
        await f.setDoc(f.doc(db, 'modules', moduleId, 'syncRecords', id), syncDoc(lite));
      }
      // une vue publiée pour chaque locataire du module M1
      await f.setDoc(f.doc(db, 'modules', 'mod_eeeeeeeeeeeeeeeeeeeeeeee', 'tenantViews', 't1', 'items', 'item1'), { kind: 'contrat', body: { loyerMensuel: 30000 }, rev: 1, updatedAt: '2026-10-01T09:00:00.000Z' });
      for (const uid of ['t1', 'tFuture', 'tBoundary', 'tExpired', 'tRevoked', 'tLeft']) {
        await f.setDoc(f.doc(db, 'modules', 'mod_aaaaaaaaaaaaaaaaaaaaaaaa', 'tenantViews', uid, 'items', 'item1'), { kind: 'contrat', body: { loyerMensuel: 30000 }, rev: 1, updatedAt: '2026-10-01T09:00:00.000Z' });
      }
    });
  };

  const contextFor = (actorKey: MatrixCase['actor']) => {
    const actor = ACTORS[actorKey];
    if (!actor) return env.unauthenticatedContext().firestore();
    return env.authenticatedContext(actor.uid, { firebase: { sign_in_provider: actor.provider } }).firestore();
  };

  /** Exécute l'opération de la matrice avec le SDK, contre les règles. */
  const perform = async (db: unknown, op: Operation, actorUid: string): Promise<unknown> => {
    const d = (...segments: string[]) => f.doc(db, ...segments);
    const c = (...segments: string[]) => f.collection(db, ...segments);
    switch (op.type) {
      case 'getModule': return f.getDoc(d('modules', op.moduleId));
      case 'listModules': return f.getDocs(c('modules'));
      case 'listOwnModules': return f.getDocs(f.query(c('modules'), f.where('ownerUid', '==', actorUid)));
      case 'createModule': return f.setDoc(d('modules', op.moduleId), op.doc);
      case 'updateModule': return f.updateDoc(d('modules', op.moduleId), op.patch);
      case 'deleteModule': return f.deleteDoc(d('modules', op.moduleId));
      case 'getMember': return f.getDoc(d('modules', op.moduleId, 'members', op.uid));
      case 'listMembers': return f.getDocs(c('modules', op.moduleId, 'members'));
      case 'createMember': {
        const member = d('modules', op.moduleId, 'members', op.uid);
        if (!op.withApprovedRequest) return f.setDoc(member, cloud(op.doc));
        const batch = f.writeBatch(db);
        batch.update(d('modules', op.moduleId, 'requests', op.uid), { state: 'approved', decidedBy: actorUid, updatedAt: '2026-10-21T12:00:00.000Z' });
        batch.set(member, cloud(op.doc));
        return batch.commit();
      }
      case 'updateMember': return f.updateDoc(d('modules', op.moduleId, 'members', op.uid), cloud(op.patch));
      case 'deleteMember': return f.deleteDoc(d('modules', op.moduleId, 'members', op.uid));
      case 'getRequest': return f.getDoc(d('modules', op.moduleId, 'requests', op.uid));
      case 'listRequests': return f.getDocs(c('modules', op.moduleId, 'requests'));
      case 'createRequest': return f.setDoc(d('modules', op.moduleId, 'requests', op.uid), op.doc);
      case 'updateRequest': return f.updateDoc(d('modules', op.moduleId, 'requests', op.uid), op.patch);
      case 'deleteRequest': return f.deleteDoc(d('modules', op.moduleId, 'requests', op.uid));
      case 'getRecord': return f.getDoc(d('modules', op.moduleId, 'syncRecords', op.id));
      case 'listRecords': return f.getDocs(c('modules', op.moduleId, 'syncRecords'));
      case 'writeRecord': return f.setDoc(d('modules', op.moduleId, 'syncRecords', op.id), syncDoc({ kind: String(op.doc.kind), ownerUid: String(op.doc.ownerUid), rev: Number(op.doc.rev), deleted: op.doc.deleted === true }));
      case 'deleteRecord': return f.deleteDoc(d('modules', op.moduleId, 'syncRecords', op.id));
      case 'getTenantItem': return f.getDoc(d('modules', op.moduleId, 'tenantViews', op.uid, 'items', op.id));
      case 'listTenantItems': return f.getDocs(c('modules', op.moduleId, 'tenantViews', op.uid, 'items'));
      case 'writeTenantItem': return f.setDoc(d('modules', op.moduleId, 'tenantViews', op.uid, 'items', op.id), op.doc);
      case 'deleteTenantItem': return f.deleteDoc(d('modules', op.moduleId, 'tenantViews', op.uid, 'items', op.id));
    }
  };

  beforeAll(async () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    t = require('@firebase/rules-unit-testing');
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    f = require('firebase/firestore');
    env = await t.initializeTestEnvironment({
      projectId: 'demo-takarda',
      // MODULES_RULES_FILE : fichier de règles alternatif, réservé aux CONTRÔLES NÉGATIFS (règles volontairement cassées dont le test doit détecter l'altération) ; par défaut, le candidat.
      firestore: { rules: fs.readFileSync(process.env.MODULES_RULES_FILE ?? path.join(__dirname, '..', '..', 'firestore.p5.rules'), 'utf8') },
    });
  });
  afterAll(async () => env?.cleanup());
  beforeEach(async () => {
    await env.clearFirestore();
    await seed();
  });

  it.each(MATRIX.map((m) => [m.name, m] as const))('%s', async (_name, c) => {
    const db = contextFor(c.actor);
    const actorUid = ACTORS[c.actor]?.uid ?? '';
    const attempt = perform(db, c.op, actorUid);
    if (c.expect === 'allow') await t.assertSucceeds(attempt);
    else await t.assertFails(attempt);
  });
});
