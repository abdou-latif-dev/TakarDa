// Exécution réelle des règles Firestore dans l’ÉMULATEUR. Ignoré tant que l’émulateur n’est pas lancé.
//
// Pour l’exécuter (Java et Firebase CLI requis) :
//   npx firebase emulators:exec --only firestore --project demo-takarda "npx jest services/__tests__/firestoreRules.emulator.test.ts"
// Le projet « demo-… » garantit qu’aucune ressource réelle n’est touchée.

import fs from 'fs';
import path from 'path';

const emulator = !!process.env.FIRESTORE_EMULATOR_HOST;
const describeEmulator = emulator ? describe : describe.skip;

describeEmulator('Règles Firestore — émulateur', () => {
  let env: any;
  let t: any;
  let fs2: any;

  const record = (over: Record<string, unknown> = {}) => ({
    kind: 'bien',
    values: { nom: 'Maison' },
    statusKey: null,
    createdBy: 'alice',
    createdAt: '2026-10-12T10:00:00.000Z',
    updatedAt: '2026-10-12T10:00:00.000Z',
    rev: 1,
    deletedAt: null,
    ...over,
  });

  beforeAll(async () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    t = require('@firebase/rules-unit-testing');
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    fs2 = require('firebase/firestore');
    env = await t.initializeTestEnvironment({
      projectId: 'demo-takarda',
      firestore: { rules: fs.readFileSync(path.join(__dirname, '..', '..', 'firestore.rules'), 'utf8') },
    });
  });
  afterAll(async () => env?.cleanup());
  beforeEach(async () => {
    await env.clearFirestore();
    await env.withSecurityRulesDisabled(async (ctx: { firestore: () => unknown }) => {
      const db = ctx.firestore();
      await fs2.setDoc(fs2.doc(db, 'spaces', 'personal_alice'), { ownerUid: 'alice', memberUids: ['alice'], name: 'A', createdAt: 'x', schemaVersion: 1 });
      await fs2.setDoc(fs2.doc(db, 'spaces', 'personal_bob'), { ownerUid: 'bob', memberUids: ['bob'], name: 'B', createdAt: 'x', schemaVersion: 1 });
      await fs2.setDoc(fs2.doc(db, 'spaces', 'personal_alice', 'records', 'rec-1'), record());
    });
  });

  // Jeton simulé d'un compte e-mail / mot de passe : les règles exigent firebase.sign_in_provider == 'password'.
  // (Les jetons réels de Firebase Authentication portent la même revendication ; ici elle est simulée par l'émulateur.)
  const passwordToken = { firebase: { sign_in_provider: 'password' } };
  const asAlice = () => env.authenticatedContext('alice', passwordToken).firestore();
  const asBob = () => env.authenticatedContext('bob', passwordToken).firestore();
  const asProvider = (uid: string, provider: string) => env.authenticatedContext(uid, { firebase: { sign_in_provider: provider } }).firestore();
  const anon = () => env.unauthenticatedContext().firestore();

  it('refuse tout accès sans connexion', async () => {
    await t.assertFails(fs2.getDoc(fs2.doc(anon(), 'spaces', 'personal_alice')));
    await t.assertFails(fs2.getDocs(fs2.collection(anon(), 'spaces', 'personal_alice', 'records')));
    await t.assertFails(fs2.setDoc(fs2.doc(anon(), 'spaces', 'personal_alice', 'records', 'x'), record()));
  });

  it('un compte lit et écrit dans son espace', async () => {
    await t.assertSucceeds(fs2.getDocs(fs2.collection(asAlice(), 'spaces', 'personal_alice', 'records')));
    await t.assertSucceeds(fs2.setDoc(fs2.doc(asAlice(), 'spaces', 'personal_alice', 'records', 'rec-2'), record()));
    await t.assertSucceeds(fs2.setDoc(fs2.doc(asAlice(), 'spaces', 'personal_alice', 'records', 'rec-1'), record({ rev: 2, values: { nom: 'Nouveau' } })));
  });

  it('un autre compte ne peut ni lire ni écrire dans l’espace d’un autre', async () => {
    await t.assertFails(fs2.getDoc(fs2.doc(asBob(), 'spaces', 'personal_alice')));
    await t.assertFails(fs2.getDocs(fs2.collection(asBob(), 'spaces', 'personal_alice', 'records')));
    await t.assertFails(fs2.setDoc(fs2.doc(asBob(), 'spaces', 'personal_alice', 'records', 'rec-3'), record({ createdBy: 'bob' })));
    await t.assertFails(fs2.setDoc(fs2.doc(asBob(), 'spaces', 'personal_alice', 'records', 'rec-1'), record({ rev: 2, createdBy: 'bob' })));
  });

  it('la création d’un espace est limitée au sien, propriétaire unique', async () => {
    await env.clearFirestore();
    await t.assertSucceeds(fs2.setDoc(fs2.doc(asAlice(), 'spaces', 'personal_alice'), { ownerUid: 'alice', memberUids: ['alice'], name: 'A', createdAt: 'x', schemaVersion: 1 }));
    await t.assertFails(fs2.setDoc(fs2.doc(asBob(), 'spaces', 'personal_alice'), { ownerUid: 'bob', memberUids: ['bob'], name: 'A', createdAt: 'x', schemaVersion: 1 }));
    await t.assertFails(fs2.setDoc(fs2.doc(asAlice(), 'spaces', 'personal_alice'), { ownerUid: 'alice', memberUids: ['alice', 'bob'], name: 'A', createdAt: 'x', schemaVersion: 1 }));
    await t.assertFails(fs2.setDoc(fs2.doc(asAlice(), 'spaces', 'autre'), { ownerUid: 'alice', memberUids: ['alice'], name: 'A', createdAt: 'x', schemaVersion: 1 }));
  });

  it('valide les enregistrements : révision, auteur, type, champs autorisés, pas de suppression physique', async () => {
    const col = (id: string) => fs2.doc(asAlice(), 'spaces', 'personal_alice', 'records', id);
    await t.assertFails(fs2.setDoc(col('r-a'), record({ rev: 5 }))); // création : rev 1 obligatoire
    await t.assertFails(fs2.setDoc(col('r-b'), record({ createdBy: 'bob' }))); // auteur = compte connecté
    await t.assertFails(fs2.setDoc(col('r-c'), record({ kind: 'paiement' }))); // seuls bien et logement
    await t.assertFails(fs2.setDoc(col('r-d'), record({ extra: 1 }))); // champ inconnu
    await t.assertFails(fs2.setDoc(col('rec-1'), record({ rev: 1 }))); // la révision doit augmenter
    await t.assertFails(fs2.deleteDoc(fs2.doc(asBob(), 'spaces', 'personal_alice', 'records', 'rec-1'))); // un autre compte ne supprime pas (le propriétaire le peut seulement pour effacer son compte : accountDeletion.emulator.test.ts)
    await t.assertSucceeds(fs2.updateDoc(col('rec-1'), { deletedAt: '2026-10-12T11:00:00.000Z', rev: 2 })); // suppression logique
    await t.assertFails(fs2.setDoc(col('rec-1'), record({ rev: 3 }))); // plus de modification après suppression
  });

  it('le parcours réel du client (transactions) : création de l’espace et du profil, écriture, modification, suppression logique', async () => {
    await env.clearFirestore(); // compte neuf : ni espace ni profil
    const db = asAlice();
    const space = fs2.doc(db, 'spaces', 'personal_alice');
    const user = fs2.doc(db, 'users', 'alice');
    // identique à firestoreRecordsApi.ensureSpace : lecture d'un espace inexistant (le sien), puis création
    await t.assertSucceeds(
      fs2.runTransaction(db, async (tx: any) => {
        const snap = await tx.get(space);
        const userSnap = await tx.get(user); // toutes les lectures avant les écritures (exigence de Firestore)
        if (!snap.exists()) tx.set(space, { ownerUid: 'alice', memberUids: ['alice'], name: 'Espace personnel', createdAt: 'x', schemaVersion: 1 });
        if (!userSnap.exists()) tx.set(user, { defaultSpaceId: 'personal_alice', createdAt: 'x' });
      }),
    );
    // identique à writeRecord : lecture dans la transaction, puis écriture rev 1, puis rev 2, puis suppression logique rev 3
    const ref = fs2.doc(db, 'spaces', 'personal_alice', 'records', 'rec-tx');
    await t.assertSucceeds(fs2.runTransaction(db, async (tx: any) => { await tx.get(ref); tx.set(ref, record({ rev: 1, createdBy: 'alice' })); }));
    await t.assertSucceeds(fs2.runTransaction(db, async (tx: any) => { await tx.get(ref); tx.set(ref, record({ rev: 2, createdBy: 'alice', values: { nom: 'Modifié' } })); }));
    await t.assertSucceeds(fs2.runTransaction(db, async (tx: any) => { await tx.get(ref); tx.update(ref, { deletedAt: '2026-10-13T00:00:00.000Z', rev: 3 }); }));
    // un autre compte ne peut pas « garantir » l'espace de ce compte ni lire un espace inexistant qui n'est pas le sien
    await t.assertFails(fs2.getDoc(fs2.doc(asBob(), 'spaces', 'personal_carol')));
    await t.assertFails(fs2.getDoc(fs2.doc(asBob(), 'users', 'alice')));
    await t.assertFails(fs2.setDoc(fs2.doc(asBob(), 'users', 'alice'), { defaultSpaceId: 'personal_alice', createdAt: 'x' }));
  });

  it('refuse toute autre collection', async () => {
    await t.assertFails(fs2.setDoc(fs2.doc(asAlice(), 'paiements', 'p1'), { montant: 1 }));
    await t.assertFails(fs2.getDoc(fs2.doc(asAlice(), 'autre', 'x')));
  });

  describe('spaces : lecture d’un espace inexistant, création neuve et renommage seulement', () => {
    const space = (over: Record<string, unknown> = {}) => ({ ownerUid: 'alice', memberUids: ['alice'], name: 'Espace personnel', createdAt: 'x', schemaVersion: 1, ...over });
    const spaceRef = (db: unknown, id = 'personal_alice') => fs2.doc(db, 'spaces', id);
    const seedAlice = () => env.withSecurityRulesDisabled((ctx: { firestore: () => unknown }) => fs2.setDoc(spaceRef(ctx.firestore()), space()));

    beforeEach(async () => {
      await env.clearFirestore(); // base vide : aucun espace (le beforeEach parent a rempli des données)
    });

    describe('resource == null : lecture d’un document inexistant', () => {
      it('un compte peut lire (et constater l’absence de) SON espace personnel inexistant', async () => {
        const snap = await t.assertSucceeds(fs2.getDoc(spaceRef(asAlice())));
        expect(snap.exists()).toBe(false);
      });

      it('un compte ne peut pas lire l’espace personnel inexistant d’un autre, ni un espace inexistant quelconque', async () => {
        await t.assertFails(fs2.getDoc(spaceRef(asBob(), 'personal_alice')));
        await t.assertFails(fs2.getDoc(spaceRef(asAlice(), 'personal_bob')));
        await t.assertFails(fs2.getDoc(spaceRef(asAlice(), 'espace-libre')));
        await t.assertFails(fs2.getDoc(spaceRef(anon(), 'personal_alice')));
      });

      it('une fois l’espace créé, seul un membre le lit (le second compte est refusé)', async () => {
        await seedAlice();
        await t.assertSucceeds(fs2.getDoc(spaceRef(asAlice())));
        await t.assertFails(fs2.getDoc(spaceRef(asBob())));
      });
    });

    describe('création d’un espace personnel neuf', () => {
      it('réussit pour son propre espace, avec exactement les champs attendus', async () => {
        await t.assertSucceeds(fs2.setDoc(spaceRef(asAlice()), space()));
      });

      it('est refusée pour l’espace d’un autre, un autre identifiant, des membres supplémentaires ou un champ en trop', async () => {
        await t.assertFails(fs2.setDoc(spaceRef(asBob(), 'personal_alice'), space({ ownerUid: 'bob', memberUids: ['bob'] })));
        await t.assertFails(fs2.setDoc(spaceRef(asAlice(), 'autre'), space()));
        await t.assertFails(fs2.setDoc(spaceRef(asAlice()), space({ memberUids: ['alice', 'bob'] })));
        await t.assertFails(fs2.setDoc(spaceRef(asAlice()), space({ extra: 1 })));
      });
    });

    describe('mise à jour : renommage seulement', () => {
      beforeEach(async () => {
        await seedAlice();
      });

      it('le propriétaire peut renommer son espace (name reste une chaîne)', async () => {
        await t.assertSucceeds(fs2.updateDoc(spaceRef(asAlice()), { name: 'Mes biens' }));
        await t.assertSucceeds(fs2.setDoc(spaceRef(asAlice()), space({ name: 'Autre nom' }))); // réécriture complète, seul name change
      });

      it('refuse un name qui n’est pas une chaîne', async () => {
        await t.assertFails(fs2.updateDoc(spaceRef(asAlice()), { name: 42 }));
        await t.assertFails(fs2.updateDoc(spaceRef(asAlice()), { name: null }));
        await t.assertFails(fs2.updateDoc(spaceRef(asAlice()), { name: ['a'] }));
      });

      it('refuse de retirer name', async () => {
        await t.assertFails(fs2.setDoc(spaceRef(asAlice()), { ownerUid: 'alice', memberUids: ['alice'], createdAt: 'x', schemaVersion: 1 }));
      });

      it('refuse de modifier ownerUid', async () => {
        await t.assertFails(fs2.updateDoc(spaceRef(asAlice()), { ownerUid: 'bob' }));
        await t.assertFails(fs2.updateDoc(spaceRef(asAlice()), { ownerUid: 'bob', name: 'Volé' })); // renommage + prise de propriété
      });

      it('refuse de modifier memberUids (ajout, retrait, remplacement)', async () => {
        await t.assertFails(fs2.updateDoc(spaceRef(asAlice()), { memberUids: ['alice', 'bob'] }));
        await t.assertFails(fs2.updateDoc(spaceRef(asAlice()), { memberUids: [] }));
        await t.assertFails(fs2.updateDoc(spaceRef(asAlice()), { memberUids: ['bob'] }));
        await t.assertFails(fs2.updateDoc(spaceRef(asAlice()), { memberUids: ['alice', 'bob'], name: 'Partagé' }));
      });

      it('refuse de modifier createdAt ou schemaVersion, et d’ajouter un champ inconnu', async () => {
        await t.assertFails(fs2.updateDoc(spaceRef(asAlice()), { createdAt: 'y' }));
        await t.assertFails(fs2.updateDoc(spaceRef(asAlice()), { schemaVersion: 2 }));
        await t.assertFails(fs2.updateDoc(spaceRef(asAlice()), { extra: 'x' }));
        await t.assertFails(fs2.updateDoc(spaceRef(asAlice()), { name: 'ok', extra: 'x' }));
      });

      it('un second compte ne peut ni renommer ni modifier l’espace du premier, ni se l’attribuer', async () => {
        await t.assertFails(fs2.updateDoc(spaceRef(asBob()), { name: 'Piraté' }));
        await t.assertFails(fs2.updateDoc(spaceRef(asBob()), { ownerUid: 'bob', memberUids: ['bob'] }));
        await t.assertFails(fs2.setDoc(spaceRef(asBob()), space({ ownerUid: 'bob', memberUids: ['bob'] })));
      });

      it('un utilisateur sans connexion ne peut rien modifier ni supprimer ; un autre compte ne supprime pas l’espace (le propriétaire le peut seulement pour effacer son compte)', async () => {
        await t.assertFails(fs2.updateDoc(spaceRef(anon()), { name: 'x' }));
        await t.assertFails(fs2.deleteDoc(spaceRef(anon())));
        await t.assertFails(fs2.deleteDoc(spaceRef(asBob())));
      });
    });
  });

  describe('records : deletedAt, immutabilité, révisions, types et espaces croisés', () => {
    const spaceDoc = (uid: string) => ({ ownerUid: uid, memberUids: [uid], name: 'Espace', createdAt: 'x', schemaVersion: 1 });
    const recRef = (db: unknown, spaceId: string, id: string) => fs2.doc(db, 'spaces', spaceId, 'records', id);
    const recA = (id: string) => recRef(asAlice(), 'personal_alice', id);
    const withoutDeletedAt = (over: Record<string, unknown> = {}) => {
      const r: Record<string, unknown> = record(over);
      delete r.deletedAt; // document créé sans le champ facultatif `deletedAt`
      return r;
    };

    beforeEach(async () => {
      await env.clearFirestore(); // base vide, puis deux espaces personnels et quelques enregistrements
      await env.withSecurityRulesDisabled(async (ctx: { firestore: () => unknown }) => {
        const db = ctx.firestore();
        await fs2.setDoc(fs2.doc(db, 'spaces', 'personal_alice'), spaceDoc('alice'));
        await fs2.setDoc(fs2.doc(db, 'spaces', 'personal_bob'), spaceDoc('bob'));
        await fs2.setDoc(recRef(db, 'personal_alice', 'rec-a'), record());
        await fs2.setDoc(recRef(db, 'personal_alice', 'rec-nodel'), withoutDeletedAt());
        await fs2.setDoc(recRef(db, 'personal_alice', 'rec-nodel-2'), withoutDeletedAt());
        await fs2.setDoc(recRef(db, 'personal_bob', 'rec-b'), record({ createdBy: 'bob' }));
      });
    });

    describe('deletedAt à la création', () => {
      it('accepte deletedAt: null et un deletedAt absent (conformément au schéma)', async () => {
        await t.assertSucceeds(fs2.setDoc(recA('c-null'), record({ deletedAt: null })));
        await t.assertSucceeds(fs2.setDoc(recA('c-absent'), withoutDeletedAt()));
      });

      it('refuse tout enregistrement créé avec un deletedAt non nul', async () => {
        await t.assertFails(fs2.setDoc(recA('c-del'), record({ deletedAt: '2026-10-13T00:00:00.000Z' })));
        await t.assertFails(fs2.setDoc(recA('c-del-empty'), record({ deletedAt: '' })));
        await t.assertFails(fs2.setDoc(recA('c-del-num'), record({ deletedAt: 1 })));
      });
    });

    describe('document sans champ deletedAt', () => {
      it('reste modifiable, puis peut être supprimé logiquement, puis n’est plus modifiable', async () => {
        await t.assertSucceeds(fs2.setDoc(recA('rec-nodel'), withoutDeletedAt({ rev: 2, values: { nom: 'Modifié' } })));
        await t.assertSucceeds(fs2.updateDoc(recA('rec-nodel-2'), { deletedAt: '2026-10-13T00:00:00.000Z', rev: 2 }));
        await t.assertFails(fs2.updateDoc(recA('rec-nodel-2'), { rev: 3, values: { nom: 'Après suppression' } }));
        await t.assertFails(fs2.updateDoc(recA('rec-nodel-2'), { deletedAt: null, rev: 3 })); // pas de restauration
      });

      it('un autre compte ne peut toujours pas le modifier ni le supprimer', async () => {
        await t.assertFails(fs2.setDoc(recRef(asBob(), 'personal_alice', 'rec-nodel'), withoutDeletedAt({ rev: 2 })));
        await t.assertFails(fs2.updateDoc(recRef(asBob(), 'personal_alice', 'rec-nodel'), { deletedAt: '2026-10-13T00:00:00.000Z', rev: 2 }));
      });
    });

    describe('champs immuables', () => {
      it('createdBy, createdAt et kind ne peuvent pas changer, même avec un rev correct', async () => {
        await t.assertFails(fs2.setDoc(recA('rec-a'), record({ rev: 2, createdBy: 'bob' })));
        await t.assertFails(fs2.setDoc(recA('rec-a'), record({ rev: 2, createdBy: 'alice-bis' })));
        await t.assertFails(fs2.setDoc(recA('rec-a'), record({ rev: 2, createdAt: '2020-01-01T00:00:00.000Z' })));
        await t.assertFails(fs2.setDoc(recA('rec-a'), record({ rev: 2, kind: 'logement' })));
        await t.assertFails(fs2.updateDoc(recA('rec-a'), { rev: 2, createdBy: 'bob' }));
        await t.assertFails(fs2.updateDoc(recA('rec-a'), { rev: 2, kind: 'logement' }));
      });

      it('témoin : la même modification, sans toucher aux champs immuables, réussit', async () => {
        await t.assertSucceeds(fs2.setDoc(recA('rec-a'), record({ rev: 2, values: { nom: 'Témoin' } })));
      });
    });

    describe('révisions', () => {
      it('refuse rev + 2, rev identique, rev en arrière, et un rev qui n’est pas un entier', async () => {
        await t.assertFails(fs2.updateDoc(recA('rec-a'), { rev: 3 })); // 1 -> 3
        await t.assertFails(fs2.updateDoc(recA('rec-a'), { rev: 1 })); // identique
        await t.assertFails(fs2.updateDoc(recA('rec-a'), { rev: 0 }));
        await t.assertFails(fs2.updateDoc(recA('rec-a'), { rev: '2' }));
        await t.assertFails(fs2.updateDoc(recA('rec-a'), { rev: 2.5 }));
        await t.assertFails(fs2.updateDoc(recA('rec-a'), { rev: null }));
      });

      it('refuse de revenir en arrière depuis une révision plus élevée', async () => {
        await t.assertSucceeds(fs2.updateDoc(recA('rec-a'), { rev: 2 }));
        await t.assertSucceeds(fs2.updateDoc(recA('rec-a'), { rev: 3 }));
        await t.assertFails(fs2.updateDoc(recA('rec-a'), { rev: 2 }));
        await t.assertFails(fs2.updateDoc(recA('rec-a'), { rev: 5 }));
      });

      it('à la création, seul rev 1 est accepté', async () => {
        await t.assertFails(fs2.setDoc(recA('r-0'), record({ rev: 0 })));
        await t.assertFails(fs2.setDoc(recA('r-2'), record({ rev: 2 })));
        await t.assertFails(fs2.setDoc(recA('r-s'), record({ rev: '1' })));
        await t.assertFails(fs2.setDoc(recA('r-f'), record({ rev: 1.5 })));
        await t.assertSucceeds(fs2.setDoc(recA('r-1'), record({ rev: 1 })));
      });
    });

    describe('types et champs invalides', () => {
      it('refuse à la création : values, statusKey, dates, kind ou auteur de mauvais type, champ obligatoire manquant', async () => {
        const bad: Record<string, unknown>[] = [
          { values: 'texte' },
          { values: ['a'] },
          { values: null },
          { statusKey: 5 },
          { statusKey: ['x'] },
          { createdAt: 5 },
          { updatedAt: 5 },
          { createdBy: 5 },
          { kind: 5 },
        ];
        let i = 0;
        for (const over of bad) await t.assertFails(fs2.setDoc(recA(`bad-${i++}`), record(over)));
        const noValues: Record<string, unknown> = record();
        delete noValues.values;
        await t.assertFails(fs2.setDoc(recA('bad-novalues'), noValues));
        const noUpdated: Record<string, unknown> = record();
        delete noUpdated.updatedAt;
        await t.assertFails(fs2.setDoc(recA('bad-noupdated'), noUpdated));
        await t.assertSucceeds(fs2.setDoc(recA('ok-types'), record({ statusKey: 'actif', values: { nom: 'A', loyer: 10000, ok: true, liste: ['a'], vide: null } })));
      });

      it('refuse à la modification : values, statusKey, updatedAt, deletedAt de mauvais type', async () => {
        await t.assertFails(fs2.updateDoc(recA('rec-a'), { rev: 2, values: 'texte' }));
        await t.assertFails(fs2.updateDoc(recA('rec-a'), { rev: 2, statusKey: 5 }));
        await t.assertFails(fs2.updateDoc(recA('rec-a'), { rev: 2, updatedAt: 5 }));
        await t.assertFails(fs2.updateDoc(recA('rec-a'), { rev: 2, deletedAt: 5 }));
        await t.assertFails(fs2.updateDoc(recA('rec-a'), { rev: 2, extra: 'x' }));
      });
    });

    describe('écritures croisées entre deux espaces personnels', () => {
      it('Alice ne peut ni lire, ni créer, ni modifier, ni supprimer logiquement dans l’espace de Bob', async () => {
        await t.assertFails(fs2.getDoc(recRef(asAlice(), 'personal_bob', 'rec-b')));
        await t.assertFails(fs2.getDocs(fs2.collection(asAlice(), 'spaces', 'personal_bob', 'records')));
        await t.assertFails(fs2.setDoc(recRef(asAlice(), 'personal_bob', 'x1'), record({ createdBy: 'alice' })));
        await t.assertFails(fs2.setDoc(recRef(asAlice(), 'personal_bob', 'x2'), record({ createdBy: 'bob' })));
        await t.assertFails(fs2.setDoc(recRef(asAlice(), 'personal_bob', 'rec-b'), record({ rev: 2, createdBy: 'bob' })));
        await t.assertFails(fs2.updateDoc(recRef(asAlice(), 'personal_bob', 'rec-b'), { deletedAt: '2026-10-13T00:00:00.000Z', rev: 2 }));
        await t.assertFails(fs2.deleteDoc(recRef(asAlice(), 'personal_bob', 'rec-b')));
      });

      it('Bob ne peut rien faire dans l’espace d’Alice, y compris sur ses enregistrements existants', async () => {
        await t.assertFails(fs2.getDoc(recRef(asBob(), 'personal_alice', 'rec-a')));
        await t.assertFails(fs2.setDoc(recRef(asBob(), 'personal_alice', 'y1'), record({ createdBy: 'bob' })));
        await t.assertFails(fs2.updateDoc(recRef(asBob(), 'personal_alice', 'rec-a'), { deletedAt: '2026-10-13T00:00:00.000Z', rev: 2 }));
        await t.assertFails(fs2.deleteDoc(recRef(asBob(), 'personal_alice', 'rec-a')));
      });

      it('on ne peut pas créer d’enregistrement dans un espace inexistant, même le sien ou celui d’un tiers', async () => {
        await t.assertFails(fs2.setDoc(recRef(asAlice(), 'personal_carol', 'z1'), record()));
        await env.withSecurityRulesDisabled((ctx: { firestore: () => unknown }) => fs2.deleteDoc(fs2.doc(ctx.firestore(), 'spaces', 'personal_alice')));
        await t.assertFails(fs2.setDoc(recA('z2'), record())); // son propre espace, mais pas encore créé
      });

      it('témoin : chacun écrit normalement dans son propre espace', async () => {
        await t.assertSucceeds(fs2.setDoc(recA('own-a'), record()));
        await t.assertSucceeds(fs2.setDoc(recRef(asBob(), 'personal_bob', 'own-b'), record({ createdBy: 'bob' })));
      });
    });
  });

  describe('B.1 — fournisseur d’authentification (seul « password » est accepté)', () => {
    const spaceDoc = { ownerUid: 'alice', memberUids: ['alice'], name: 'Espace', createdAt: 'x', schemaVersion: 1 };
    beforeEach(async () => {
      await env.clearFirestore();
      await env.withSecurityRulesDisabled(async (ctx: { firestore: () => unknown }) => {
        const db = ctx.firestore();
        await fs2.setDoc(fs2.doc(db, 'spaces', 'personal_alice'), spaceDoc);
        await fs2.setDoc(fs2.doc(db, 'spaces', 'personal_alice', 'records', 'rec-a'), record());
        await fs2.setDoc(fs2.doc(db, 'users', 'alice'), { defaultSpaceId: 'personal_alice', createdAt: 'x' });
      });
    });

    it('fournisseur « password » : le propriétaire lit et écrit normalement (contrôles d’identité et d’appartenance conservés)', async () => {
      const db = asProvider('alice', 'password');
      await t.assertSucceeds(fs2.getDoc(fs2.doc(db, 'spaces', 'personal_alice')));
      await t.assertSucceeds(fs2.getDocs(fs2.collection(db, 'spaces', 'personal_alice', 'records')));
      await t.assertSucceeds(fs2.getDoc(fs2.doc(db, 'users', 'alice')));
      await t.assertSucceeds(fs2.setDoc(fs2.doc(db, 'spaces', 'personal_alice', 'records', 'rec-new'), record()));
      await t.assertSucceeds(fs2.updateDoc(fs2.doc(db, 'spaces', 'personal_alice'), { name: 'Renommé' }));
    });

    it('fournisseur « password » : l’isolation reste en place (un autre compte « password » est refusé)', async () => {
      const db = asProvider('bob', 'password');
      await t.assertFails(fs2.getDoc(fs2.doc(db, 'spaces', 'personal_alice')));
      await t.assertFails(fs2.setDoc(fs2.doc(db, 'spaces', 'personal_alice', 'records', 'rec-x'), record({ createdBy: 'bob' })));
      await t.assertFails(fs2.getDoc(fs2.doc(db, 'users', 'alice')));
    });

    it('fournisseur « anonymous » : même propriétaire, même uid, tout est refusé (lecture, liste, création, modification, profil)', async () => {
      const db = asProvider('alice', 'anonymous');
      await t.assertFails(fs2.getDoc(fs2.doc(db, 'spaces', 'personal_alice')));
      await t.assertFails(fs2.getDocs(fs2.collection(db, 'spaces', 'personal_alice', 'records')));
      await t.assertFails(fs2.getDoc(fs2.doc(db, 'users', 'alice')));
      await t.assertFails(fs2.setDoc(fs2.doc(db, 'spaces', 'personal_alice', 'records', 'rec-new'), record()));
      await t.assertFails(fs2.updateDoc(fs2.doc(db, 'spaces', 'personal_alice'), { name: 'Renommé' }));
      await t.assertFails(fs2.updateDoc(fs2.doc(db, 'spaces', 'personal_alice', 'records', 'rec-a'), { rev: 2 }));
    });

    it('fournisseur « anonymous » : un compte anonyme neuf ne peut ni créer son espace personnel ni lire un espace inexistant', async () => {
      const db = asProvider('anon1', 'anonymous');
      await t.assertFails(fs2.getDoc(fs2.doc(db, 'spaces', 'personal_anon1')));
      await t.assertFails(fs2.setDoc(fs2.doc(db, 'spaces', 'personal_anon1'), { ...spaceDoc, ownerUid: 'anon1', memberUids: ['anon1'] }));
      await t.assertFails(fs2.setDoc(fs2.doc(db, 'users', 'anon1'), { defaultSpaceId: 'personal_anon1', createdAt: 'x' }));
    });

    it('autres fournisseurs (google.com, custom, phone, github.com) : tout est refusé', async () => {
      for (const provider of ['google.com', 'custom', 'phone', 'github.com']) {
        const db = asProvider('alice', provider);
        await t.assertFails(fs2.getDoc(fs2.doc(db, 'spaces', 'personal_alice')));
        await t.assertFails(fs2.getDocs(fs2.collection(db, 'spaces', 'personal_alice', 'records')));
        await t.assertFails(fs2.setDoc(fs2.doc(db, 'spaces', 'personal_alice', 'records', `rec-${provider}`), record()));
      }
    });

    it('jeton sans revendication de fournisseur, ou jeton sans option : refusé', async () => {
      await t.assertFails(fs2.getDoc(fs2.doc(env.authenticatedContext('alice', { firebase: {} }).firestore(), 'spaces', 'personal_alice')));
      await t.assertFails(fs2.getDoc(fs2.doc(env.authenticatedContext('alice').firestore(), 'spaces', 'personal_alice')));
    });

    it('sans connexion : toujours refusé', async () => {
      await t.assertFails(fs2.getDoc(fs2.doc(anon(), 'spaces', 'personal_alice')));
    });
  });

  describe('B.2 — suppression logique encadrée', () => {
    const recRef = (db: unknown, id: string) => fs2.doc(db, 'spaces', 'personal_alice', 'records', id);
    const DELETED_AT = '2026-10-13T00:00:00.000Z';
    beforeEach(async () => {
      await env.clearFirestore();
      await env.withSecurityRulesDisabled(async (ctx: { firestore: () => unknown }) => {
        const db = ctx.firestore();
        await fs2.setDoc(fs2.doc(db, 'spaces', 'personal_alice'), { ownerUid: 'alice', memberUids: ['alice'], name: 'Espace', createdAt: 'x', schemaVersion: 1 });
        for (const id of ['d1', 'd2', 'd3', 'd4', 'd5', 'd6', 'd7', 'n1']) await fs2.setDoc(recRef(db, id), record());
      });
    });

    it('suppression normale (flux markDeleted : seuls deletedAt et rev changent) : acceptée', async () => {
      const db = asAlice(); // une seule instance Firestore pour la transaction et ses références
      await t.assertSucceeds(fs2.runTransaction(db, async (tx: any) => { await tx.get(recRef(db, 'd1')); tx.update(recRef(db, 'd1'), { deletedAt: DELETED_AT, rev: 2 }); }));
      // même résultat avec une réécriture complète à l'identique (seuls deletedAt et rev diffèrent)
      await t.assertSucceeds(fs2.setDoc(recRef(asAlice(), 'd2'), record({ rev: 2, deletedAt: DELETED_AT })));
    });

    it('suppression combinée à une modification de values, statusKey, updatedAt ou autre champ : refusée', async () => {
      await t.assertFails(fs2.updateDoc(recRef(asAlice(), 'd3'), { deletedAt: DELETED_AT, rev: 2, values: { nom: 'Réécrit' } }));
      await t.assertFails(fs2.setDoc(recRef(asAlice(), 'd3'), record({ rev: 2, deletedAt: DELETED_AT, values: { nom: 'Réécrit' } })));
      await t.assertFails(fs2.updateDoc(recRef(asAlice(), 'd4'), { deletedAt: DELETED_AT, rev: 2, statusKey: 'actif' }));
      await t.assertFails(fs2.updateDoc(recRef(asAlice(), 'd5'), { deletedAt: DELETED_AT, rev: 2, updatedAt: '2026-10-14T00:00:00.000Z' }));
      await t.assertFails(fs2.updateDoc(recRef(asAlice(), 'd6'), { deletedAt: DELETED_AT, rev: 2, extra: 1 }));
      // aucun de ces documents n'a été modifié : une suppression normale reste possible ensuite
      await t.assertSucceeds(fs2.updateDoc(recRef(asAlice(), 'd3'), { deletedAt: DELETED_AT, rev: 2 }));
    });

    it('modification normale (deletedAt nul ou absent) : acceptée, contenu libre dans les limites prévues', async () => {
      await t.assertSucceeds(fs2.setDoc(recRef(asAlice(), 'n1'), record({ rev: 2, values: { nom: 'Modifié', loyer: 25000 }, updatedAt: '2026-10-14T00:00:00.000Z', statusKey: 'actif' })));
      await t.assertSucceeds(fs2.updateDoc(recRef(asAlice(), 'n1'), { rev: 3, values: { nom: 'Encore' }, deletedAt: null }));
    });

    it('un document supprimé n’est plus modifiable ni restaurable ; un autre compte ne peut pas le supprimer', async () => {
      await t.assertSucceeds(fs2.updateDoc(recRef(asAlice(), 'd7'), { deletedAt: DELETED_AT, rev: 2 }));
      await t.assertFails(fs2.updateDoc(recRef(asAlice(), 'd7'), { rev: 3, values: { nom: 'Après' } }));
      await t.assertFails(fs2.updateDoc(recRef(asAlice(), 'd7'), { deletedAt: null, rev: 3 }));
      await t.assertFails(fs2.updateDoc(recRef(asBob(), 'd1'), { deletedAt: DELETED_AT, rev: 2 }));
    });
  });

  describe('B.3 — limites (nom d’espace, nombre de clés de values, longueur des dates)', () => {
    const spaceDoc = (over: Record<string, unknown> = {}) => ({ ownerUid: 'alice', memberUids: ['alice'], name: 'Espace personnel', createdAt: 'x', schemaVersion: 1, ...over });
    const spaceRef = (db: unknown) => fs2.doc(db, 'spaces', 'personal_alice');
    const recRef = (id: string) => fs2.doc(asAlice(), 'spaces', 'personal_alice', 'records', id);
    const keys = (n: number) => Object.fromEntries(Array.from({ length: n }, (_, i) => [`k${i}`, i]));
    const ISO = '2026-10-13T08:30:15.123Z';
    beforeEach(async () => {
      await env.clearFirestore();
      await env.withSecurityRulesDisabled(async (ctx: { firestore: () => unknown }) => {
        const db = ctx.firestore();
        await fs2.setDoc(spaceRef(db), spaceDoc());
        await fs2.setDoc(fs2.doc(db, 'spaces', 'personal_alice', 'records', 'rec-a'), record());
      });
    });

    it('nom d’espace : 1 à 100 caractères à la création', async () => {
      await env.withSecurityRulesDisabled((ctx: { firestore: () => unknown }) => fs2.deleteDoc(spaceRef(ctx.firestore())));
      await t.assertFails(fs2.setDoc(spaceRef(asAlice()), spaceDoc({ name: '' })));
      await t.assertFails(fs2.setDoc(spaceRef(asAlice()), spaceDoc({ name: 'a'.repeat(101) })));
      await t.assertFails(fs2.setDoc(spaceRef(asAlice()), spaceDoc({ name: 5 })));
      await t.assertSucceeds(fs2.setDoc(spaceRef(asAlice()), spaceDoc({ name: 'a'.repeat(100) })));
    });

    it('nom d’espace : 1 à 100 caractères au renommage, et le nom par défaut du client reste valide', async () => {
      await t.assertFails(fs2.updateDoc(spaceRef(asAlice()), { name: '' }));
      await t.assertFails(fs2.updateDoc(spaceRef(asAlice()), { name: 'a'.repeat(101) }));
      await t.assertSucceeds(fs2.updateDoc(spaceRef(asAlice()), { name: 'a' }));
      await t.assertSucceeds(fs2.updateDoc(spaceRef(asAlice()), { name: 'a'.repeat(100) }));
      await t.assertSucceeds(fs2.updateDoc(spaceRef(asAlice()), { name: 'Espace personnel' })); // valeur écrite par ensureSpace
    });

    it('values : 20 clés maximum à la création et à la modification', async () => {
      await t.assertSucceeds(fs2.setDoc(recRef('v0'), record({ values: {} })));
      await t.assertSucceeds(fs2.setDoc(recRef('v20'), record({ values: keys(20) })));
      await t.assertFails(fs2.setDoc(recRef('v21'), record({ values: keys(21) })));
      await t.assertFails(fs2.setDoc(recRef('v50'), record({ values: keys(50) })));
      await t.assertSucceeds(fs2.setDoc(recRef('rec-a'), record({ rev: 2, values: keys(20) })));
      await t.assertFails(fs2.setDoc(recRef('rec-a'), record({ rev: 3, values: keys(21) })));
    });

    it('createdAt et updatedAt : 40 caractères maximum à la création et à la modification', async () => {
      await t.assertSucceeds(fs2.setDoc(recRef('d40'), record({ createdAt: 'c'.repeat(40), updatedAt: 'u'.repeat(40) })));
      await t.assertFails(fs2.setDoc(recRef('c41'), record({ createdAt: 'c'.repeat(41) })));
      await t.assertFails(fs2.setDoc(recRef('u41'), record({ updatedAt: 'u'.repeat(41) })));
      await t.assertSucceeds(fs2.setDoc(recRef('rec-a'), record({ rev: 2, updatedAt: 'u'.repeat(40) })));
      await t.assertFails(fs2.setDoc(recRef('rec-a'), record({ rev: 3, updatedAt: 'u'.repeat(41) })));
    });

    it('enregistrements normaux valides : un bien et un logement complets, dates ISO, valeurs réelles du code', async () => {
      const bien = { nom: 'Maison Agoè', adresse: 'Rue 12, Lomé', type: 'Maison' };
      const logement = { bien: 'rec-bien-1', nom: 'Chambre 1', type: 'Chambre simple', cuisine: 'Cuisine interne', wc: null, loyer_reference: 25000 };
      await t.assertSucceeds(fs2.setDoc(recRef('rec-bien-1'), record({ kind: 'bien', values: bien, createdAt: ISO, updatedAt: ISO })));
      await t.assertSucceeds(fs2.setDoc(recRef('rec-log-1'), record({ kind: 'logement', values: logement, createdAt: ISO, updatedAt: ISO })));
      await t.assertSucceeds(fs2.setDoc(recRef('rec-log-1'), record({ kind: 'logement', values: { ...logement, loyer_reference: 30000 }, createdAt: ISO, updatedAt: '2026-10-14T09:00:00.000Z', rev: 2 })));
    });
  });

  describe('users/{uid} — profil minimal du compte', () => {
    const profile = (uid: string, over: Record<string, unknown> = {}) => ({ defaultSpaceId: `personal_${uid}`, createdAt: '2026-10-13T08:30:15.123Z', ...over });
    const userRef = (db: unknown, uid: string) => fs2.doc(db, 'users', uid);
    const seedProfiles = () =>
      env.withSecurityRulesDisabled(async (ctx: { firestore: () => unknown }) => {
        const db = ctx.firestore();
        await fs2.setDoc(userRef(db, 'alice'), profile('alice'));
        await fs2.setDoc(userRef(db, 'bob'), profile('bob'));
      });

    beforeEach(async () => {
      await env.clearFirestore(); // aucun profil : chaque test part d'une base vide (le beforeEach parent a rempli des données)
    });

    describe('création', () => {
      it('1. un utilisateur crée son propre profil, avec les champs autorisés et defaultSpaceId == personal_<uid>', async () => {
        await t.assertSucceeds(fs2.setDoc(userRef(asAlice(), 'alice'), profile('alice')));
        // le profil créé est bien relisible par son titulaire
        const snap = await t.assertSucceeds(fs2.getDoc(userRef(asAlice(), 'alice')));
        expect(snap.data()).toEqual(profile('alice'));
      });

      it('2. refusée si defaultSpaceId désigne l’espace d’un autre utilisateur (ou un identifiant quelconque)', async () => {
        await t.assertFails(fs2.setDoc(userRef(asAlice(), 'alice'), profile('alice', { defaultSpaceId: 'personal_bob' })));
        await t.assertFails(fs2.setDoc(userRef(asAlice(), 'alice'), profile('alice', { defaultSpaceId: 'autre-espace' })));
        await t.assertFails(fs2.setDoc(userRef(asAlice(), 'alice'), profile('alice', { defaultSpaceId: '' })));
        await t.assertFails(fs2.setDoc(userRef(asAlice(), 'alice'), profile('alice', { defaultSpaceId: 5 })));
      });

      it('3. refusée si un champ supplémentaire est ajouté', async () => {
        await t.assertFails(fs2.setDoc(userRef(asAlice(), 'alice'), profile('alice', { role: 'admin' })));
        await t.assertFails(fs2.setDoc(userRef(asAlice(), 'alice'), profile('alice', { ownerUid: 'alice' })));
        await t.assertFails(fs2.setDoc(userRef(asAlice(), 'alice'), profile('alice', { extra: null })));
      });

      it('4. refusée si un champ obligatoire manque ou n’a pas le bon type', async () => {
        await t.assertFails(fs2.setDoc(userRef(asAlice(), 'alice'), { defaultSpaceId: 'personal_alice' })); // createdAt manquant
        await t.assertFails(fs2.setDoc(userRef(asAlice(), 'alice'), { createdAt: '2026-10-13T08:30:15.123Z' })); // defaultSpaceId manquant
        await t.assertFails(fs2.setDoc(userRef(asAlice(), 'alice'), {}));
        await t.assertFails(fs2.setDoc(userRef(asAlice(), 'alice'), profile('alice', { createdAt: 12345 })));
        await t.assertFails(fs2.setDoc(userRef(asAlice(), 'alice'), profile('alice', { createdAt: null })));
      });

      it('5. la création du profil d’un autre utilisateur est refusée (même avec des données valides pour lui)', async () => {
        await t.assertFails(fs2.setDoc(userRef(asAlice(), 'bob'), profile('bob')));
        await t.assertFails(fs2.setDoc(userRef(asBob(), 'alice'), profile('alice')));
        await t.assertFails(fs2.setDoc(userRef(asAlice(), 'bob'), profile('alice'))); // en se désignant comme espace par défaut
      });

      it('sans connexion, anonyme ou autre fournisseur : la création est refusée même pour son propre uid', async () => {
        await t.assertFails(fs2.setDoc(userRef(anon(), 'alice'), profile('alice')));
        await t.assertFails(fs2.setDoc(userRef(asProvider('alice', 'anonymous'), 'alice'), profile('alice')));
        await t.assertFails(fs2.setDoc(userRef(asProvider('alice', 'google.com'), 'alice'), profile('alice')));
      });
    });

    describe('profil existant', () => {
      beforeEach(async () => {
        await seedProfiles();
      });

      it('6. la mise à jour est refusée, même si elle ne modifie que defaultSpaceId', async () => {
        await t.assertFails(fs2.updateDoc(userRef(asAlice(), 'alice'), { defaultSpaceId: 'personal_bob' }));
        await t.assertFails(fs2.updateDoc(userRef(asAlice(), 'alice'), { defaultSpaceId: 'personal_alice' })); // même valeur : refusée aussi
        await t.assertFails(fs2.updateDoc(userRef(asAlice(), 'alice'), { createdAt: '2027-01-01T00:00:00.000Z' }));
        await t.assertFails(fs2.updateDoc(userRef(asAlice(), 'alice'), { extra: 1 }));
        await t.assertFails(fs2.setDoc(userRef(asAlice(), 'alice'), profile('alice', { createdAt: '2027-01-01T00:00:00.000Z' }))); // réécriture complète
        await t.assertFails(fs2.updateDoc(userRef(asBob(), 'alice'), { defaultSpaceId: 'personal_bob' })); // et par un autre compte
        // le profil n'a pas changé
        await env.withSecurityRulesDisabled(async (ctx: { firestore: () => unknown }) => {
          const snap = await fs2.getDoc(userRef(ctx.firestore(), 'alice'));
          expect(snap.data()).toEqual(profile('alice'));
        });
      });

      it('7. la suppression d’un profil est refusée à un autre compte et aux comptes non « password » ; le titulaire peut supprimer le sien (effacement du compte)', async () => {
        await t.assertFails(fs2.deleteDoc(userRef(asBob(), 'alice')));
        await t.assertFails(fs2.deleteDoc(userRef(anon(), 'alice')));
        await t.assertFails(fs2.deleteDoc(userRef(asProvider('alice', 'anonymous'), 'alice')));
        await env.withSecurityRulesDisabled(async (ctx: { firestore: () => unknown }) => {
          expect((await fs2.getDoc(userRef(ctx.firestore(), 'alice'))).exists()).toBe(true); // refus : toujours présent
        });
        await t.assertSucceeds(fs2.deleteDoc(userRef(asAlice(), 'alice'))); // son propre profil
        await env.withSecurityRulesDisabled(async (ctx: { firestore: () => unknown }) => {
          expect((await fs2.getDoc(userRef(ctx.firestore(), 'alice'))).exists()).toBe(false);
          expect((await fs2.getDoc(userRef(ctx.firestore(), 'bob'))).exists()).toBe(true); // celui d'un autre n'est pas touché
        });
      });

      it('8. un utilisateur ne lit pas le profil d’un autre ; il lit le sien ; la liste des profils est refusée', async () => {
        await t.assertFails(fs2.getDoc(userRef(asBob(), 'alice')));
        await t.assertFails(fs2.getDoc(userRef(asAlice(), 'bob')));
        await t.assertFails(fs2.getDoc(userRef(anon(), 'alice')));
        await t.assertFails(fs2.getDoc(userRef(asProvider('alice', 'anonymous'), 'alice')));
        await t.assertFails(fs2.getDocs(fs2.collection(asAlice(), 'users')));
        const own = await t.assertSucceeds(fs2.getDoc(userRef(asAlice(), 'alice'))); // témoin
        expect(own.data()).toEqual(profile('alice'));
      });
    });
  });
});

describe('Règles Firestore — émulateur', () => {
  it('est ignoré tant que l’émulateur n’est pas lancé (FIRESTORE_EMULATOR_HOST absent)', () => {
    expect(typeof emulator).toBe('boolean');
  });
});
