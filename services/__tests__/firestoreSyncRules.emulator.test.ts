// P4 — règles de synchronisation (candidat firestore.p4.rules) et transports exécutés dans l'ÉMULATEUR Firestore LOCAL.
// IGNORÉ tant que l'émulateur n'est pas lancé. Le projet « demo-… » garantit qu'aucune ressource réelle n'est touchée.
//
//   npx firebase-tools@15.33.0 emulators:exec --only firestore --project demo-takarda "npx jest -c jest.emulator.sync.config.js"
//
// Aucune règle n'est publiée : le candidat est lu dans le fichier et chargé dans l'émulateur par la bibliothèque de test.

import fs from 'fs';
import path from 'path';

const emulator = !!process.env.FIRESTORE_EMULATOR_HOST;
const describeEmulator = emulator ? describe : describe.skip;

describeEmulator('Règles de synchronisation — émulateur', () => {
  let env: any;
  let t: any;
  let f: any;
  let model: typeof import('../firebase/syncDocModel');
  let transports: typeof import('../firebase/firestoreSyncTransport');
  let backend: typeof import('../firebase/firestoreSyncBackend');
  let kinds: typeof import('../sync/kindRegistry');

  const passwordToken = { firebase: { sign_in_provider: 'password' } };
  const asAlice = () => env.authenticatedContext('alice', passwordToken).firestore();
  const asBob = () => env.authenticatedContext('bob', passwordToken).firestore();
  const asProvider = (uid: string, provider: string) => env.authenticatedContext(uid, { firebase: { sign_in_provider: provider } }).firestore();
  const anon = () => env.unauthenticatedContext().firestore();
  const col = (db: unknown, uid = 'alice') => f.collection(db, 'spaces', `personal_${uid}`, 'syncRecords');
  const ref = (db: unknown, id: string, uid = 'alice') => f.doc(db, 'spaces', `personal_${uid}`, 'syncRecords', id);

  /** Document brut valide ; `serverUpdatedAt` = heure du serveur (seule valeur admise par les règles). */
  const raw = (over: Record<string, unknown> = {}) => ({
    kind: 'immobilier.bien',
    schemaVersion: 1,
    ownerUid: 'alice',
    statusKey: null,
    createdAt: '2026-10-19T09:00:00.000Z',
    updatedAt: '2026-10-19T09:00:00.000Z',
    body: { nom: 'Maison' },
    refs: {},
    rev: 1,
    deleted: false,
    deletedAt: null,
    restoredAt: null,
    lastOpId: 'op-1',
    serverUpdatedAt: f.serverTimestamp(),
    ...over,
  });

  const transportFor = (db: unknown, uid = 'alice') => transports.createFirestoreSyncTransport({ backend: backend.createFirestoreSyncBackend(db as never, uid), uid, overlapMs: 0 });
  let n = 0;
  const wire = (id: string, over: Record<string, unknown> = {}) => ({
    id,
    kind: kinds.KIND.IMMOBILIER_BIEN,
    schemaVersion: 1,
    ownerUid: 'alice',
    statusKey: null,
    createdAt: '2026-10-19T09:00:00.000Z',
    updatedAt: '2026-10-19T09:00:00.000Z',
    body: { nom: 'Maison' },
    refs: {},
    ...over,
  });
  const req = (op: 'create' | 'update' | 'delete', w: any, over: Record<string, unknown> = {}) => ({ opId: `emu-${(n += 1)}`, recordId: w.id, kind: w.kind, op, expectedRev: op === 'create' ? null : 1, deletedAt: op === 'delete' ? '2026-10-19T10:00:00.000Z' : null, wire: op === 'delete' ? null : w, ...over });

  beforeAll(async () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    t = require('@firebase/rules-unit-testing');
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    f = require('firebase/firestore');
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    model = require('../firebase/syncDocModel');
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    transports = require('../firebase/firestoreSyncTransport');
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    backend = require('../firebase/firestoreSyncBackend');
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    kinds = require('../sync/kindRegistry');
    env = await t.initializeTestEnvironment({
      projectId: 'demo-takarda',
      firestore: { rules: fs.readFileSync(path.join(__dirname, '..', '..', 'firestore.p4.rules'), 'utf8') },
    });
  });
  afterAll(async () => env?.cleanup());
  beforeEach(async () => {
    await env.clearFirestore();
    await env.withSecurityRulesDisabled(async (ctx: { firestore: () => unknown }) => {
      const db = ctx.firestore();
      await f.setDoc(f.doc(db, 'spaces', 'personal_alice'), { ownerUid: 'alice', memberUids: ['alice'], name: 'A', createdAt: 'x', schemaVersion: 1 });
      await f.setDoc(f.doc(db, 'spaces', 'personal_bob'), { ownerUid: 'bob', memberUids: ['bob'], name: 'B', createdAt: 'x', schemaVersion: 1 });
    });
  });

  // ---- Le transport réel contre les vraies règles ---------------------------------------------------------------------------
  it('transport : création, modification, suppression logique, restauration, lecture par pages, idempotence', async () => {
    const tr = transportFor(asAlice());
    const w = wire('b1');
    const create = req('create', w);
    expect(await tr.push(create as never)).toEqual({ rev: 1 });
    expect(await tr.push(create as never)).toEqual({ rev: 1 }); // même opId rejoué : aucune nouvelle écriture
    expect(await tr.push(req('update', wire('b1', { body: { nom: 'Villa' } })) as never)).toEqual({ rev: 2 });
    await expect(tr.push(req('update', wire('b1'), { expectedRev: 1 }) as never)).rejects.toMatchObject({ code: 'conflict' });
    expect(await tr.push(req('delete', w, { expectedRev: 2 }) as never)).toEqual({ rev: 3 });
    expect(await tr.read(kinds.KIND.IMMOBILIER_BIEN, 'b1')).toMatchObject({ rev: 3, deleted: true });
    expect(await tr.restore({ opId: 'emu-r', recordId: 'b1', kind: kinds.KIND.IMMOBILIER_BIEN, expectedRev: 3 })).toEqual({ rev: 4 });
    expect(await tr.read(kinds.KIND.IMMOBILIER_BIEN, 'b1')).toMatchObject({ rev: 4, deleted: false });
    await tr.push(req('create', wire('b2')) as never);
    const page = await transportFor(asAlice()).pull({ cursor: null, limit: 10 });
    expect(page.changes.map((c) => c.id).sort()).toEqual(['b1', 'b2']);
    expect(page.hasMore).toBe(false);
    const again = await transportFor(asAlice()).pull({ cursor: page.nextCursor, limit: 10 });
    expect(again.changes.length).toBeLessThanOrEqual(2); // recouvrement nul ici : strictement après le dernier
  });

  it('transport : deux écritures simultanées à la même révision → une réussit, l’autre est un conflit (pas d’écrasement)', async () => {
    const tr = transportFor(asAlice());
    await tr.push(req('create', wire('b1')) as never);
    const results = await Promise.allSettled([
      transportFor(asAlice()).push(req('update', wire('b1', { body: { nom: 'A' } })) as never),
      transportFor(asAlice()).push(req('update', wire('b1', { body: { nom: 'B' } })) as never),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const lost = results.find((r) => r.status === 'rejected') as PromiseRejectedResult;
    expect(lost.reason).toMatchObject({ code: 'conflict' });
    expect((await tr.read(kinds.KIND.IMMOBILIER_BIEN, 'b1'))?.rev).toBe(2);
  });

  it('transport : faits financiers — création permise ; modification et suppression refusées (transport ET règles)', async () => {
    const tr = transportFor(asAlice());
    const p = wire('p1', { kind: kinds.KIND.IMMOBILIER_PAIEMENT, body: { montant: 25000 } });
    expect(await tr.push(req('create', p) as never)).toEqual({ rev: 1 });
    await expect(tr.push(req('update', p) as never)).rejects.toMatchObject({ code: 'invalid' });
    await expect(tr.push(req('delete', p) as never)).rejects.toMatchObject({ code: 'invalid' });
    // en contournant le transport : refusé par les règles
    await t.assertFails(f.setDoc(ref(asAlice(), 'p1'), raw({ kind: 'immobilier.paiement', rev: 2, body: { montant: 1 }, lastOpId: 'x' })));
    await t.assertFails(f.setDoc(ref(asAlice(), 'p1'), raw({ kind: 'immobilier.paiement', rev: 2, deleted: true, deletedAt: '2026-10-19T10:00:00.000Z', body: { montant: 25000 }, lastOpId: 'x' })));
    await t.assertFails(f.setDoc(ref(asAlice(), 'p1'), raw({ kind: 'immobilier.bien', rev: 2, body: { montant: 25000 }, lastOpId: 'x' }))); // changer de type pour échapper à la règle
    for (const kind of ['immobilier.correction_paiement']) {
      await t.assertSucceeds(f.setDoc(ref(asAlice(), `f-${kind}`), raw({ kind })));
      await t.assertFails(f.setDoc(ref(asAlice(), `f-${kind}`), raw({ kind, rev: 2, lastOpId: 'x' })));
    }
    // périmètre V1 (Immobilier seul) : tout autre type est REFUSÉ par les règles, même pour son propriétaire (tontines, CEET/TDE, formulaires…)
    for (const kind of ['tontine.cotisation', 'tontine.correction_cotisation', 'tontine.groupe', 'utility.facture', 'utility.releve', 'forms.formulaire', 'forms.reponse', 'core.outil']) {
      await t.assertFails(f.setDoc(ref(asAlice(), `x-${kind}`), raw({ kind })));
    }
  });

  // ---- Isolation ---------------------------------------------------------------------------------------------------------------
  it('isolation : un autre compte ne lit ni n’écrit ; sans connexion ou avec un autre fournisseur : refus', async () => {
    await t.assertSucceeds(f.setDoc(ref(asAlice(), 'b1'), raw()));
    await t.assertFails(f.getDoc(ref(asBob(), 'b1')));
    await t.assertFails(f.getDocs(col(asBob())));
    await t.assertFails(f.setDoc(ref(asBob(), 'b2'), raw({ ownerUid: 'bob' })));
    await t.assertFails(f.setDoc(ref(asBob(), 'b2'), raw()));
    await t.assertFails(f.setDoc(ref(asBob(), 'b1'), raw({ rev: 2, lastOpId: 'x' })));
    await t.assertFails(f.deleteDoc(ref(asBob(), 'b1')));
    await t.assertFails(f.getDoc(ref(anon(), 'b1')));
    await t.assertFails(f.setDoc(ref(anon(), 'b3'), raw()));
    await t.assertFails(f.getDoc(ref(asProvider('alice', 'google.com'), 'b1')));
    await t.assertFails(f.setDoc(ref(asProvider('alice', 'anonymous'), 'b3'), raw()));
    // Bob écrit dans son propre espace sans voir celui d'Alice
    await t.assertSucceeds(f.setDoc(ref(asBob(), 'b1', 'bob'), raw({ ownerUid: 'bob' })));
    expect((await f.getDocs(col(asBob(), 'bob'))).size).toBe(1);
    // le transport de Bob (même identifiant d'espace demandé = le sien) ne voit rien d'Alice
    expect((await transportFor(asBob(), 'bob').pull({ cursor: null, limit: 10 })).changes.map((c) => c.id)).toEqual(['b1']);
    // le transport « d'Alice » branché sur la session de Bob est refusé
    await expect(transportFor(asBob(), 'alice').pull({ cursor: null, limit: 10 })).rejects.toMatchObject({ code: 'permission' });
    await expect(transportFor(asBob(), 'alice').push(req('create', wire('b9')) as never)).rejects.toMatchObject({ code: 'permission' });
  });

  it('isolation : espace d’un autre compte, espace partagé ou espace inexistant — jamais accessibles', async () => {
    await env.withSecurityRulesDisabled(async (ctx: { firestore: () => unknown }) => {
      await f.setDoc(f.doc(ctx.firestore(), 'spaces', 'shared_1'), { ownerUid: 'alice', memberUids: ['alice', 'bob'], name: 'Partagé', createdAt: 'x', schemaVersion: 1 });
    });
    await t.assertFails(f.setDoc(f.doc(asAlice(), 'spaces', 'shared_1', 'syncRecords', 'x'), raw()));
    await t.assertFails(f.setDoc(f.doc(asBob(), 'spaces', 'shared_1', 'syncRecords', 'x'), raw({ ownerUid: 'bob' })));
    await t.assertFails(f.setDoc(f.doc(asAlice(), 'spaces', 'personal_carol', 'syncRecords', 'x'), raw()));
    await t.assertFails(f.getDocs(f.collection(asAlice(), 'spaces', 'shared_1', 'syncRecords')));
  });

  // ---- Forme et transitions ----------------------------------------------------------------------------------------------------
  it('création : forme stricte (champs, type, révision, propriétaire, horodatage serveur, clés réservées)', async () => {
    const bad: [string, Record<string, unknown>][] = [
      ['révision 2', { rev: 2 }],
      ['déjà supprimé', { deleted: true, deletedAt: '2026-10-19T10:00:00.000Z' }],
      ['restauré à la création', { restoredAt: '2026-10-19T10:00:00.000Z' }],
      ['type inconnu', { kind: 'core.outil' }],
      ['autre propriétaire', { ownerUid: 'bob' }],
      ['horodatage client', { serverUpdatedAt: new Date() }],
      ['champ en trop', { extra: 1 }],
      ['corps non carte', { body: 'texte' }],
      ['corps trop large', { body: Object.fromEntries(Array.from({ length: 101 }, (_, i) => [`k${i}`, i])) }],
      ['clé réservée toolId', { body: { toolId: 'x' } }],
      ['clé réservée statusKey', { body: { statusKey: 'x' } }],
      ['révision non entière', { rev: 1.5 }],
      ['jeton vide', { lastOpId: '' }],
      ['date trop longue', { createdAt: 'x'.repeat(41) }],
      ['schéma 0', { schemaVersion: 0 }],
    ];
    for (const [label, over] of bad) {
      await t.assertFails(f.setDoc(ref(asAlice(), `bad-${label}`), raw(over)));
    }
    const missing = raw();
    delete (missing as Record<string, unknown>).lastOpId;
    await t.assertFails(f.setDoc(ref(asAlice(), 'bad-manquant'), missing));
    await t.assertSucceeds(f.setDoc(ref(asAlice(), 'ok'), raw()));
    for (const kind of model.cloudKinds()) await t.assertSucceeds(f.setDoc(ref(asAlice(), `k-${kind}`), raw({ kind })));
  });

  it('modification : révision +1, type et date de création inchangés ; suppression logique et restauration limitées à leurs champs', async () => {
    await t.assertSucceeds(f.setDoc(ref(asAlice(), 'b1'), raw()));
    await t.assertFails(f.setDoc(ref(asAlice(), 'b1'), raw({ rev: 1, lastOpId: 'x' })));
    await t.assertFails(f.setDoc(ref(asAlice(), 'b1'), raw({ rev: 3, lastOpId: 'x' })));
    await t.assertFails(f.setDoc(ref(asAlice(), 'b1'), raw({ rev: 2, kind: 'immobilier.logement', lastOpId: 'x' })));
    await t.assertFails(f.setDoc(ref(asAlice(), 'b1'), raw({ rev: 2, createdAt: '2027-01-01T00:00:00.000Z', lastOpId: 'x' })));
    await t.assertFails(f.setDoc(ref(asAlice(), 'b1'), raw({ rev: 2, ownerUid: 'bob', lastOpId: 'x' })));
    await t.assertFails(f.setDoc(ref(asAlice(), 'b1'), raw({ rev: 2, restoredAt: '2026-10-19T10:00:00.000Z', lastOpId: 'x' })));
    await t.assertSucceeds(f.setDoc(ref(asAlice(), 'b1'), raw({ rev: 2, body: { nom: 'Villa' }, lastOpId: 'x' })));
    // suppression logique : le contenu ne peut pas être réécrit en même temps
    await t.assertFails(f.setDoc(ref(asAlice(), 'b1'), raw({ rev: 3, deleted: true, deletedAt: '2026-10-19T10:00:00.000Z', body: { nom: 'Réécrit' }, lastOpId: 'y' })));
    await t.assertFails(f.setDoc(ref(asAlice(), 'b1'), raw({ rev: 3, deleted: true, deletedAt: null, body: { nom: 'Villa' }, lastOpId: 'y' })));
    await t.assertSucceeds(f.setDoc(ref(asAlice(), 'b1'), raw({ rev: 3, deleted: true, deletedAt: '2026-10-19T10:00:00.000Z', body: { nom: 'Villa' }, lastOpId: 'y' })));
    // document supprimé : plus de modification
    await t.assertFails(f.setDoc(ref(asAlice(), 'b1'), raw({ rev: 4, deleted: true, deletedAt: '2026-10-19T10:00:00.000Z', body: { nom: 'Autre' }, lastOpId: 'z' })));
    await t.assertFails(f.setDoc(ref(asAlice(), 'b1'), raw({ rev: 4, body: { nom: 'Autre' }, lastOpId: 'z' })));
    // restauration : contenu inchangé, trace posée
    await t.assertFails(f.setDoc(ref(asAlice(), 'b1'), raw({ rev: 4, body: { nom: 'Autre' }, restoredAt: '2026-10-19T11:00:00.000Z', lastOpId: 'z' })));
    await t.assertFails(f.setDoc(ref(asAlice(), 'b1'), raw({ rev: 4, body: { nom: 'Villa' }, restoredAt: null, lastOpId: 'z' })));
    await t.assertSucceeds(f.setDoc(ref(asAlice(), 'b1'), raw({ rev: 4, body: { nom: 'Villa' }, restoredAt: '2026-10-19T11:00:00.000Z', lastOpId: 'z' })));
  });

  // ---- Verrou de suppression de compte, suppression physique et procédure d'effacement --------------------------------------------
  it('suppression physique : refusée tant que l’espace n’est pas verrouillé (même au propriétaire, même pour un fait financier) ; permise sous verrou au propriétaire seul', async () => {
    await t.assertSucceeds(f.setDoc(ref(asAlice(), 'b1'), raw()));
    await t.assertSucceeds(f.setDoc(ref(asAlice(), 'p1'), raw({ kind: 'immobilier.paiement' })));
    await t.assertFails(f.deleteDoc(ref(asAlice(), 'b1')));
    await t.assertFails(f.deleteDoc(ref(asAlice(), 'p1')));
    await t.assertFails(f.deleteDoc(ref(asBob(), 'b1')));
    await t.assertSucceeds(f.updateDoc(f.doc(asAlice(), 'spaces', 'personal_alice'), { deletionLockedAt: '2026-10-19T12:00:00.000Z' }));
    // verrouillé : plus aucune écriture de synchronisation, lecture possible
    await t.assertFails(f.setDoc(ref(asAlice(), 'b2'), raw()));
    await t.assertFails(f.setDoc(ref(asAlice(), 'b1'), raw({ rev: 2, lastOpId: 'x' })));
    await t.assertSucceeds(f.getDocs(col(asAlice())));
    // suppression physique : le propriétaire seulement
    await t.assertFails(f.deleteDoc(ref(asBob(), 'b1')));
    await t.assertFails(f.deleteDoc(ref(anon(), 'b1')));
    await t.assertSucceeds(f.deleteDoc(ref(asAlice(), 'b1')));
    await t.assertSucceeds(f.deleteDoc(ref(asAlice(), 'p1')));
  });

  it('procédure d’effacement du compte avec les vraies règles : verrou, purge de syncRecords, puis records, espace et profil ; un autre compte reste intact', async () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const erasure = require('../firebase/syncAccountErasure') as typeof import('../firebase/syncAccountErasure');
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const deletion = require('../firebase/firestoreAccountDeletion') as typeof import('../firebase/firestoreAccountDeletion');
    await env.withSecurityRulesDisabled(async (ctx: { firestore: () => unknown }) => {
      const db = ctx.firestore();
      await f.setDoc(f.doc(db, 'users', 'alice'), { defaultSpaceId: 'personal_alice', createdAt: 'x' });
      await f.setDoc(f.doc(db, 'spaces', 'personal_alice', 'records', 'v1-1'), { kind: 'bien', values: { nom: 'V1' }, statusKey: null, createdBy: 'alice', createdAt: 'x', updatedAt: 'x', rev: 1, deletedAt: null });
    });
    const tr = transportFor(asAlice());
    for (const id of ['a', 'b', 'c', 'd', 'e']) await tr.push(req('create', wire(id)) as never);
    await tr.push(req('create', wire('p1', { kind: kinds.KIND.IMMOBILIER_PAIEMENT })) as never);
    await transportFor(asBob(), 'bob').push(req('create', wire('z', { ownerUid: 'bob' })) as never);

    // première tentative interrompue pendant le reste : syncRecords est déjà purgé, rien d'inconnu n'est présumé
    let first = true;
    const run = () =>
      erasure.eraseAccountCloudData({
        backend: backend.createFirestoreErasureBackend(asAlice(), 'alice'),
        uid: 'alice',
        pageSize: 2,
        deleteRest: async () => {
          if (first) {
            first = false;
            return { ownership: 'proven', records: { found: 0, deleted: 0, remaining: null }, space: 'skipped', profile: 'skipped', verified: false, uncertain: false, error: { code: 'unavailable', message: 'coupure simulée' } };
          }
          return deletion.deleteAccountCloudData(asAlice(), 'alice');
        },
      });
    const interrupted = await run();
    expect(interrupted.syncRecords).toEqual({ status: 'purged', found: 6, deleted: 6, remaining: 0 });
    expect(interrupted.verified).toBe(false);
    const done = await run(); // reprise
    expect(done.syncRecords.status).toBe('purged');
    expect(done.rest?.verified).toBe(true);
    expect(done.verified).toBe(true);
    await env.withSecurityRulesDisabled(async (ctx: { firestore: () => unknown }) => {
      const db = ctx.firestore();
      expect((await f.getDoc(f.doc(db, 'spaces', 'personal_alice'))).exists()).toBe(false);
      expect((await f.getDoc(f.doc(db, 'users', 'alice'))).exists()).toBe(false);
      expect((await f.getDocs(f.collection(db, 'spaces', 'personal_alice', 'syncRecords'))).size).toBe(0);
      expect((await f.getDocs(f.collection(db, 'spaces', 'personal_alice', 'records'))).size).toBe(0);
      expect((await f.getDocs(f.collection(db, 'spaces', 'personal_bob', 'syncRecords'))).size).toBe(1); // l'autre compte est intact
    });
  });

  it('procédure d’effacement : un autre compte ne peut rien supprimer ; sans verrou, rien n’est supprimé', async () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const erasure = require('../firebase/syncAccountErasure') as typeof import('../firebase/syncAccountErasure');
    await transportFor(asAlice()).push(req('create', wire('a')) as never);
    const asBobOnAlice = await erasure.eraseAccountCloudData({ backend: backend.createFirestoreErasureBackend(asBob(), 'alice'), uid: 'alice', deleteRest: async () => { throw new Error('ne doit pas être appelé'); } });
    expect(asBobOnAlice.verified).toBe(false);
    expect(asBobOnAlice.error).not.toBeNull();
    expect((await f.getDocs(col(asAlice()))).size).toBe(1);
  });

  it('les règles V1 (records) restent inchangées dans le candidat', async () => {
    const record = { kind: 'bien', values: { nom: 'M' }, statusKey: null, createdBy: 'alice', createdAt: 'x', updatedAt: 'x', rev: 1, deletedAt: null };
    await t.assertSucceeds(f.setDoc(f.doc(asAlice(), 'spaces', 'personal_alice', 'records', 'r1'), record));
    await t.assertFails(f.setDoc(f.doc(asBob(), 'spaces', 'personal_alice', 'records', 'r2'), { ...record, createdBy: 'bob' }));
    await t.assertFails(f.setDoc(f.doc(asAlice(), 'spaces', 'personal_alice', 'autre', 'x'), { a: 1 }));
  });
});
