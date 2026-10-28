// Suppression du compte : règles ET fonction réelle `deleteAccountCloudData`, contre l'ÉMULATEUR Firestore local (projet
// « demo-… », aucune donnée réelle). Ignoré tant que l'émulateur n'est pas lancé.
//
//   npx firebase-tools@15.33.0 emulators:exec --only firestore --project demo-takarda "npx jest -c jest.emulator.config.js"

import fs from 'fs';
import path from 'path';
const emulator = !!process.env.FIRESTORE_EMULATOR_HOST;
const describeEmulator = emulator ? describe : describe.skip;

describeEmulator('Suppression de compte — règles et fonction réelle (émulateur)', () => {
  let env: any;
  let t: any;
  let f: any;
  let deleteAccountCloudData: (db: unknown, uid: string, options?: any) => Promise<any>;
  let DELETE_PAGE_SIZE: number;
  let defaultOps: any;

  const token = (provider = 'password') => ({ firebase: { sign_in_provider: provider } });
  const as = (uid: string, provider = 'password') => env.authenticatedContext(uid, token(provider)).firestore();
  const anon = () => env.unauthenticatedContext().firestore();
  const space = (uid: string, over: Record<string, unknown> = {}) => ({ ownerUid: uid, memberUids: [uid], name: 'Espace', createdAt: 'x', schemaVersion: 1, ...over });
  const profile = (uid: string) => ({ defaultSpaceId: `personal_${uid}`, createdAt: 'x' });
  const record = (uid: string, over: Record<string, unknown> = {}) => ({
    kind: 'bien', values: { nom: 'Maison' }, statusKey: null, createdBy: uid, createdAt: '2026-10-14T10:00:00.000Z', updatedAt: '2026-10-14T10:00:00.000Z', rev: 1, deletedAt: null, ...over,
  });
  const rec = (db: unknown, spaceId: string, id: string) => f.doc(db, 'spaces', spaceId, 'records', id);

  /** Sème avec les règles désactivées : un compte complet (profil, espace, n enregistrements dont une suppression logique). */
  const seedAccount = async (uid: string, n: number, spaceOver: Record<string, unknown> = {}, spaceId = `personal_${uid}`) => {
    await env.withSecurityRulesDisabled(async (ctx: { firestore: () => unknown }) => {
      const db = ctx.firestore();
      await f.setDoc(f.doc(db, 'users', uid), profile(uid));
      await f.setDoc(f.doc(db, 'spaces', spaceId), space(uid, spaceOver));
      for (let i = 0; i < n; i += 1) await f.setDoc(rec(db, spaceId, `${uid}-r${i}`), record(uid, i === 0 ? { deletedAt: '2026-10-14T11:00:00.000Z', rev: 2 } : {}));
    });
  };
  const admin = async <T,>(fn: (db: unknown) => Promise<T>): Promise<T> => {
    let out!: T;
    await env.withSecurityRulesDisabled(async (ctx: { firestore: () => unknown }) => { out = await fn(ctx.firestore()); });
    return out;
  };
  const exists = (path_: string[]) => admin(async (db) => (await f.getDoc(f.doc(db, ...path_))).exists());
  const countRecords = (spaceId: string) => admin(async (db) => (await f.getDocs(f.collection(db, 'spaces', spaceId, 'records'))).size);

  beforeAll(async () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    t = require('@firebase/rules-unit-testing');
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    f = require('firebase/firestore');
    // chargé ici et non en tête de fichier : le SDK n'est importé que si l'émulateur est lancé
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    ({ deleteAccountCloudData, DELETE_PAGE_SIZE, defaultOps } = require('../firebase/firestoreAccountDeletion'));
    env = await t.initializeTestEnvironment({ projectId: 'demo-takarda', firestore: { rules: fs.readFileSync(path.join(__dirname, '..', '..', 'firestore.rules'), 'utf8') } });
  });
  afterAll(async () => env?.cleanup());
  beforeEach(async () => {
    await env.clearFirestore();
  });

  describe('règles : suppression physique réservée au propriétaire de son espace personnel', () => {
    it('le propriétaire supprime ses enregistrements (y compris déjà supprimés logiquement), puis son espace, puis son profil', async () => {
      await seedAccount('alice', 3);
      const db = as('alice');
      await t.assertSucceeds(f.deleteDoc(rec(db, 'personal_alice', 'alice-r0'))); // enregistrement supprimé logiquement
      await t.assertSucceeds(f.deleteDoc(rec(db, 'personal_alice', 'alice-r1')));
      await t.assertSucceeds(f.deleteDoc(rec(db, 'personal_alice', 'alice-r2')));
      await t.assertSucceeds(f.deleteDoc(f.doc(db, 'spaces', 'personal_alice')));
      await t.assertSucceeds(f.deleteDoc(f.doc(db, 'users', 'alice')));
      expect(await exists(['users', 'alice'])).toBe(false);
    });

    it('un autre compte ne supprime ni enregistrement, ni espace, ni profil d’autrui', async () => {
      await seedAccount('alice', 2);
      await seedAccount('bob', 2);
      const bob = as('bob');
      await t.assertFails(f.deleteDoc(rec(bob, 'personal_alice', 'alice-r1')));
      await t.assertFails(f.deleteDoc(f.doc(bob, 'spaces', 'personal_alice')));
      await t.assertFails(f.deleteDoc(f.doc(bob, 'users', 'alice')));
      const alice = as('alice');
      await t.assertFails(f.deleteDoc(rec(alice, 'personal_bob', 'bob-r1')));
      await t.assertFails(f.deleteDoc(f.doc(alice, 'spaces', 'personal_bob')));
      await t.assertFails(f.deleteDoc(f.doc(alice, 'users', 'bob')));
      expect(await countRecords('personal_alice')).toBe(2);
      expect(await countRecords('personal_bob')).toBe(2);
    });

    it('sans connexion, anonyme ou autre fournisseur : aucune suppression', async () => {
      await seedAccount('alice', 2);
      for (const db of [anon(), as('alice', 'anonymous'), as('alice', 'google.com'), as('alice', 'custom')]) {
        await t.assertFails(f.deleteDoc(rec(db, 'personal_alice', 'alice-r1')));
        await t.assertFails(f.deleteDoc(f.doc(db, 'spaces', 'personal_alice')));
        await t.assertFails(f.deleteDoc(f.doc(db, 'users', 'alice')));
      }
      expect(await countRecords('personal_alice')).toBe(2);
    });

    it('un espace partagé (plusieurs membres) ou non personnel n’est jamais supprimable, même par son propriétaire', async () => {
      await seedAccount('alice', 2, { memberUids: ['alice', 'bob'] }); // personal_alice devenu partagé
      await seedAccount('alice2', 2, {}, 'equipe'); // espace d'équipe : identifiant non personnel
      const alice = as('alice');
      await t.assertFails(f.deleteDoc(rec(alice, 'personal_alice', 'alice-r1')));
      await t.assertFails(f.deleteDoc(f.doc(alice, 'spaces', 'personal_alice')));
      await t.assertFails(f.deleteDoc(rec(as('bob'), 'personal_alice', 'alice-r1'))); // un membre non propriétaire non plus
      await t.assertFails(f.deleteDoc(f.doc(as('bob'), 'spaces', 'personal_alice')));
      const alice2 = as('alice2');
      await t.assertFails(f.deleteDoc(rec(alice2, 'equipe', 'alice2-r1')));
      await t.assertFails(f.deleteDoc(f.doc(alice2, 'spaces', 'equipe')));
      expect(await countRecords('personal_alice')).toBe(2);
      expect(await countRecords('equipe')).toBe(2);
    });

    it('supprimer le document « espace » ne supprime PAS ses enregistrements, et ils deviennent inaccessibles : l’ordre est obligatoire', async () => {
      await seedAccount('alice', 2);
      const alice = as('alice');
      await t.assertSucceeds(f.deleteDoc(f.doc(alice, 'spaces', 'personal_alice'))); // espace d'abord : mauvais ordre
      expect(await countRecords('personal_alice')).toBe(2); // les enregistrements existent toujours…
      await t.assertFails(f.getDocs(f.collection(alice, 'spaces', 'personal_alice', 'records'))); // …mais plus lisibles
      await t.assertFails(f.deleteDoc(rec(alice, 'personal_alice', 'alice-r1'))); // …ni supprimables par le client
    });

    it('les autres protections restent : suppression logique, modification, lecture croisée', async () => {
      await seedAccount('alice', 2);
      await seedAccount('bob', 1);
      await t.assertSucceeds(f.updateDoc(rec(as('alice'), 'personal_alice', 'alice-r1'), { deletedAt: '2026-10-14T12:00:00.000Z', rev: 2 }));
      await t.assertFails(f.updateDoc(rec(as('alice'), 'personal_alice', 'alice-r1'), { rev: 3, values: { nom: 'Après suppression' } }));
      await t.assertFails(f.getDocs(f.collection(as('bob'), 'spaces', 'personal_alice', 'records')));
      await t.assertFails(f.getDoc(f.doc(as('bob'), 'users', 'alice')));
    });
  });

  describe('fonction réelle deleteAccountCloudData', () => {
    it('supprime tous les enregistrements (plusieurs pages), l’espace et le profil, vérifie par relecture, et ne touche pas aux autres comptes', async () => {
      const n = DELETE_PAGE_SIZE * 2 + 37; // trois pages
      await seedAccount('alice', n);
      await seedAccount('bob', 4);
      const report = await deleteAccountCloudData(as('alice'), 'alice');
      expect(report).toMatchObject({ ownership: 'proven', space: 'deleted', profile: 'deleted', verified: true, error: null });
      expect(report.records).toEqual({ found: n, deleted: n, remaining: 0 });
      expect(await countRecords('personal_alice')).toBe(0);
      expect(await exists(['spaces', 'personal_alice'])).toBe(false);
      expect(await exists(['users', 'alice'])).toBe(false);
      // le compte d'un autre utilisateur est intact
      expect(await countRecords('personal_bob')).toBe(4);
      expect(await exists(['spaces', 'personal_bob'])).toBe(true);
      expect(await exists(['users', 'bob'])).toBe(true);
    });

    it('refuse de supprimer quand la propriété n’est pas démontrée (espace partagé) : rien n’est supprimé', async () => {
      await seedAccount('alice', 3, { memberUids: ['alice', 'bob'] });
      const report = await deleteAccountCloudData(as('alice'), 'alice');
      expect(report.ownership).toBe('unproven');
      expect(report.verified).toBe(false);
      expect(report.records.deleted).toBe(0);
      expect(await countRecords('personal_alice')).toBe(3);
      expect(await exists(['spaces', 'personal_alice'])).toBe(true);
      expect(await exists(['users', 'alice'])).toBe(true);
    });

    it('refuse aussi si l’espace est propriété d’un autre compte (ownerUid différent)', async () => {
      await seedAccount('alice', 2, { ownerUid: 'bob' });
      const report = await deleteAccountCloudData(as('alice'), 'alice');
      expect(report.ownership).toBe('unproven');
      expect(await countRecords('personal_alice')).toBe(2);
    });

    it('sans espace cloud : seul le profil est supprimé, et l’absence d’espace est signalée telle quelle', async () => {
      await env.withSecurityRulesDisabled((ctx: { firestore: () => unknown }) => f.setDoc(f.doc(ctx.firestore(), 'users', 'alice'), profile('alice')));
      const report = await deleteAccountCloudData(as('alice'), 'alice');
      expect(report).toMatchObject({ ownership: 'space_absent', space: 'absent', profile: 'deleted', verified: true });
      expect(await exists(['users', 'alice'])).toBe(false);
    });

    it('compte vide (aucun document) : rien à supprimer, vérifié', async () => {
      const report = await deleteAccountCloudData(as('alice'), 'alice');
      expect(report).toMatchObject({ ownership: 'space_absent', space: 'absent', profile: 'absent', verified: true });
    });

    it('échec d’accès (jeton non « password ») : erreur diagnostiquée, rien de supprimé, jamais annoncé comme réussi', async () => {
      await seedAccount('alice', 3);
      const report = await deleteAccountCloudData(as('alice', 'anonymous'), 'alice');
      expect(report.verified).toBe(false);
      expect(report.error?.code).toBe('permission-denied');
      expect(await countRecords('personal_alice')).toBe(3);
      expect(await exists(['users', 'alice'])).toBe(true);
    });

    it('reprise après un échec partiel : les documents déjà supprimés ne gênent pas, le résultat final est vérifié', async () => {
      await seedAccount('alice', 150);
      // état partiel (par ex. interruption réseau) : une partie des enregistrements et le profil sont déjà supprimés
      await admin(async (db) => {
        for (let i = 0; i < 60; i += 1) await f.deleteDoc(rec(db, 'personal_alice', `alice-r${i}`));
        await f.deleteDoc(f.doc(db, 'users', 'alice'));
      });
      const report = await deleteAccountCloudData(as('alice'), 'alice');
      expect(report).toMatchObject({ ownership: 'proven', space: 'deleted', profile: 'absent', verified: true });
      expect(report.records).toEqual({ found: 90, deleted: 90, remaining: 0 });
      expect(await countRecords('personal_alice')).toBe(0);
    });

    it('rejouer après réussite est sans effet et reste vérifié (idempotent)', async () => {
      await seedAccount('alice', 5);
      expect((await deleteAccountCloudData(as('alice'), 'alice')).verified).toBe(true);
      const again = await deleteAccountCloudData(as('alice'), 'alice');
      expect(again).toMatchObject({ ownership: 'space_absent', space: 'absent', profile: 'absent', verified: true });
    });
  });

  // ------------------------------------------------------------------------------------------------------------------
  // Phase E : lectures SERVEUR, délais, état incertain, reprise. L'émulateur reproduit le comportement du SDK (réseau coupé
  // par disableNetwork) ; il ne prouve pas le comportement exact de Firebase en production.
  // ------------------------------------------------------------------------------------------------------------------
  describe('hors ligne, délais et reprise (phase E)', () => {
    const TIMEOUT = 1500; // délai court pour les tests
    /** Remet le réseau et laisse partir les écritures encore en file, pour ne rien laisser traîner entre les tests. */
    const settle = async (db: unknown) => {
      await f.enableNetwork(db);
      await f.waitForPendingWrites(db);
    };
    const never = () => new Promise<void>(() => undefined);

    it('serveur inaccessible : aucune confirmation, rien supprimé, retour borné (pas de chargement infini)', async () => {
      await seedAccount('alice', 5);
      const db = as('alice');
      await f.disableNetwork(db);
      const t0 = Date.now();
      const report = await deleteAccountCloudData(db, 'alice', { timeoutMs: TIMEOUT });
      expect(Date.now() - t0).toBeLessThan(TIMEOUT * 4);
      expect(report.verified).toBe(false);
      expect(report.error).not.toBeNull();
      expect(report.records.deleted).toBe(0);
      expect(report.space).toBe('skipped');
      expect(report.profile).toBe('skipped');
      await settle(db);
      expect(await countRecords('personal_alice')).toBe(5);
      expect(await exists(['spaces', 'personal_alice'])).toBe(true);
      expect(await exists(['users', 'alice'])).toBe(true);
    });

    it('une réponse du cache local (vide) ne confirme jamais la suppression : la lecture serveur échoue hors ligne', async () => {
      await seedAccount('alice', 0); // espace et profil, aucun enregistrement
      const db = as('alice');
      const col = f.collection(db, 'spaces', 'personal_alice', 'records');
      expect((await f.getDoc(f.doc(db, 'spaces', 'personal_alice'))).exists()).toBe(true); // le cache connaît l'espace…
      expect((await f.getDocs(col)).size).toBe(0); // …et apprend « aucun enregistrement »
      await admin(async (adb) => {
        for (let i = 0; i < 3; i += 1) await f.setDoc(rec(adb, 'personal_alice', `late-${i}`), record('alice'));
      });
      await f.disableNetwork(db);
      expect((await f.getDocs(col)).size).toBe(0); // lecture ordinaire hors ligne : réponse du cache, FAUSSE (le serveur en a 3)
      const report = await deleteAccountCloudData(db, 'alice', { timeoutMs: TIMEOUT });
      expect(report.verified).toBe(false); // le cache n'est jamais pris pour une preuve
      expect(report.records.remaining).not.toBe(0);
      await settle(db); // une écriture mise en file hors ligne partirait ICI : l'espace parent serait supprimé, enregistrements orphelins
      expect(await countRecords('personal_alice')).toBe(3);
      expect(await exists(['spaces', 'personal_alice'])).toBe(true); // jamais supprimé sur la foi du cache
    });

    it('des documents encore présents sur le serveur empêchent la suppression de l’espace et du profil (suppression sans effet réel)', async () => {
      await seedAccount('alice', 6);
      let commits = 0;
      const ops = { ...defaultOps, commitDeletes: async () => { commits += 1; } }; // « réussit » sans rien supprimer sur le serveur
      const report = await deleteAccountCloudData(as('alice'), 'alice', { ops, timeoutMs: TIMEOUT });
      expect(commits).toBe(1);
      expect(report.verified).toBe(false);
      expect(report.error?.code).toBe('no-progress'); // pas de boucle infinie
      expect(report.records.remaining).toBeGreaterThan(0);
      expect(report.space).toBe('skipped');
      expect(report.profile).toBe('skipped');
      expect(await countRecords('personal_alice')).toBe(6);
      expect(await exists(['spaces', 'personal_alice'])).toBe(true);
      expect(await exists(['users', 'alice'])).toBe(true);
    });

    it('un enregistrement apparu juste avant la vérification serveur empêche la suppression du parent', async () => {
      await seedAccount('alice', 3);
      let sawEmpty = false;
      let injected = false;
      const ops = {
        ...defaultOps,
        getDocsFromServer: async (q: unknown) => {
          if (sawEmpty && !injected) {
            injected = true;
            await admin((adb) => f.setDoc(rec(adb, 'personal_alice', 'surprise'), record('alice'))); // un autre appareil écrit
          }
          const snap = await defaultOps.getDocsFromServer(q);
          if (snap.empty) sawEmpty = true;
          return snap;
        },
      };
      const report = await deleteAccountCloudData(as('alice'), 'alice', { ops, timeoutMs: TIMEOUT });
      expect(report.verified).toBe(false);
      expect(report.records.remaining).toBe(1);
      expect(report.space).toBe('skipped');
      expect(await exists(['spaces', 'personal_alice'])).toBe(true); // parent conservé
      expect(await countRecords('personal_alice')).toBe(1);
    });

    it('réseau perdu en cours de route : état INCERTAIN borné, aucun succès, aucune écriture lancée ensuite ; la reprise attend les écritures en file puis termine', async () => {
      const n = DELETE_PAGE_SIZE + 50; // deux pages
      await seedAccount('alice', n);
      await seedAccount('bob', 4);
      const db = as('alice');
      let commits = 0;
      const dropAfterFirstPage = {
        ...defaultOps,
        getDocsFromServer: async (q: unknown) => {
          const snap = await defaultOps.getDocsFromServer(q);
          if (!snap.empty) await f.disableNetwork(db); // le réseau tombe après la lecture de la première page
          return snap;
        },
        commitDeletes: async (d: unknown, refs: unknown[]) => { commits += 1; return defaultOps.commitDeletes(d, refs); },
      };
      const t0 = Date.now();
      const first = await deleteAccountCloudData(db, 'alice', { ops: dropAfterFirstPage, timeoutMs: TIMEOUT });
      expect(Date.now() - t0).toBeLessThan(TIMEOUT * 6); // le client cesse d'attendre : pas de blocage indéfini
      expect(first.uncertain).toBe(true);
      expect(first.verified).toBe(false);
      expect(first.error?.code).toBe('client-timeout');
      expect(first.records.deleted).toBe(0); // « supprimé » ne compte que les lots dont la réponse est arrivée
      expect(first.space).toBe('skipped');
      expect(first.profile).toBe('skipped');
      expect(commits).toBe(1);
      expect(await countRecords('personal_alice')).toBe(n); // rien n'est parti : réseau coupé

      // 2e tentative, toujours hors ligne : une écriture est encore en file → AUCUNE nouvelle écriture, aucun lot relancé
      let commits2 = 0;
      let reads2 = 0;
      const second = await deleteAccountCloudData(db, 'alice', {
        timeoutMs: TIMEOUT,
        ops: { ...defaultOps, commitDeletes: async () => { commits2 += 1; }, getDocsFromServer: async (q: unknown) => { reads2 += 1; return defaultOps.getDocsFromServer(q); } },
      });
      expect(second.uncertain).toBe(true);
      expect(second.verified).toBe(false);
      expect(commits2).toBe(0);
      expect(reads2).toBe(0);

      // le réseau revient : l'écriture en file part, puis la reprise relit le serveur et termine
      await settle(db);
      expect(await countRecords('personal_alice')).toBe(n - DELETE_PAGE_SIZE);
      const third = await deleteAccountCloudData(db, 'alice', { timeoutMs: TIMEOUT });
      expect(third).toMatchObject({ ownership: 'proven', space: 'deleted', profile: 'deleted', verified: true, uncertain: false, error: null });
      expect(third.records).toEqual({ found: 50, deleted: 50, remaining: 0 });
      // le compte d'un autre utilisateur n'a jamais été touché
      expect(await countRecords('personal_bob')).toBe(4);
      expect(await exists(['spaces', 'personal_bob'])).toBe(true);
      expect(await exists(['users', 'bob'])).toBe(true);
    });

    it('opération appliquée sur le serveur mais réponse perdue (erreur) : état incomplet, reprise sans toucher aux données d’un autre compte', async () => {
      await seedAccount('alice', DELETE_PAGE_SIZE + 20);
      await seedAccount('bob', 3);
      let first = true;
      const ops = {
        ...defaultOps,
        commitDeletes: async (d: unknown, refs: unknown[]) => {
          await defaultOps.commitDeletes(d, refs); // appliqué sur le serveur…
          if (first) { first = false; throw new Error('réponse perdue'); } // …mais le client ne le sait pas
        },
      };
      const db = as('alice');
      const lost = await deleteAccountCloudData(db, 'alice', { ops, timeoutMs: TIMEOUT });
      expect(lost.verified).toBe(false);
      expect(lost.error?.message).toBe('réponse perdue');
      expect(lost.records.deleted).toBe(0); // non confirmé côté client
      expect(await countRecords('personal_alice')).toBe(20); // mais le serveur a bien supprimé la première page
      const resumed = await deleteAccountCloudData(db, 'alice', { timeoutMs: TIMEOUT });
      expect(resumed).toMatchObject({ space: 'deleted', profile: 'deleted', verified: true });
      expect(resumed.records).toEqual({ found: 20, deleted: 20, remaining: 0 });
      expect(await countRecords('personal_bob')).toBe(3);
      expect(await exists(['users', 'bob'])).toBe(true);
    });

    it('opération appliquée mais réponse jamais reçue : délai dépassé = incertain (jamais un succès) ; la reprise termine', async () => {
      await seedAccount('alice', 12);
      await seedAccount('bob', 2);
      const ops = { ...defaultOps, commitDeletes: async (d: unknown, refs: unknown[]) => { await defaultOps.commitDeletes(d, refs); await never(); } };
      const db = as('alice');
      const t0 = Date.now();
      const stuck = await deleteAccountCloudData(db, 'alice', { ops, timeoutMs: TIMEOUT });
      expect(Date.now() - t0).toBeLessThan(TIMEOUT * 4);
      expect(stuck).toMatchObject({ uncertain: true, verified: false, space: 'skipped', profile: 'skipped' });
      expect(stuck.error?.code).toBe('client-timeout');
      expect(await countRecords('personal_alice')).toBe(0); // en réalité tout était déjà supprimé
      expect(await exists(['spaces', 'personal_alice'])).toBe(true); // mais l'espace n'a pas été touché sans confirmation
      const resumed = await deleteAccountCloudData(db, 'alice', { timeoutMs: TIMEOUT });
      expect(resumed).toMatchObject({ space: 'deleted', profile: 'deleted', verified: true, uncertain: false });
      expect(await countRecords('personal_bob')).toBe(2);
    });

    it('le profil n’est pas supprimé tant que la suppression de l’espace n’est pas confirmée par le serveur ; la reprise termine', async () => {
      await seedAccount('alice', 3);
      let spaceReads = 0;
      const spacePath = 'spaces/personal_alice';
      const ops = {
        ...defaultOps,
        getDocFromServer: async (ref: { path: string }) => {
          if (ref.path === spacePath && (spaceReads += 1) === 3) throw Object.assign(new Error('coupure'), { code: 'unavailable' }); // 3ᵉ lecture = vérification de l'espace (1ʳᵉ : propriété, 2ᵉ : verrou, N1.1)
          return defaultOps.getDocFromServer(ref);
        },
      };
      const db = as('alice');
      const partial = await deleteAccountCloudData(db, 'alice', { ops, timeoutMs: TIMEOUT });
      expect(partial.verified).toBe(false);
      expect(partial.space).toBe('unknown'); // demandé, non confirmé : jamais annoncé « supprimé »
      expect(partial.profile).toBe('skipped');
      expect(await exists(['users', 'alice'])).toBe(true); // profil intact
      const resumed = await deleteAccountCloudData(db, 'alice', { timeoutMs: TIMEOUT });
      expect(resumed).toMatchObject({ ownership: 'space_absent', space: 'absent', profile: 'deleted', verified: true });
    });

    it('si la vérification du profil échoue, il est « inconnu » (jamais « supprimé ») et la reprise confirme', async () => {
      await seedAccount('alice', 1);
      let profileReads = 0;
      const ops = {
        ...defaultOps,
        getDocFromServer: async (ref: { path: string }) => {
          if (ref.path === 'users/alice' && (profileReads += 1) === 2) throw Object.assign(new Error('coupure'), { code: 'unavailable' });
          return defaultOps.getDocFromServer(ref);
        },
      };
      const db = as('alice');
      const partial = await deleteAccountCloudData(db, 'alice', { ops, timeoutMs: TIMEOUT });
      expect(partial).toMatchObject({ space: 'deleted', profile: 'unknown', verified: false });
      const resumed = await deleteAccountCloudData(db, 'alice', { timeoutMs: TIMEOUT });
      expect(resumed).toMatchObject({ space: 'absent', profile: 'absent', verified: true });
    });

    it('durée maximale d’une tentative : arrêt propre sans rien supprimer de plus, reprise possible', async () => {
      await seedAccount('alice', 3);
      let t = 0;
      const report = await deleteAccountCloudData(as('alice'), 'alice', { deadlineMs: 0, now: () => (t += 1000), timeoutMs: TIMEOUT });
      expect(report.error?.code).toBe('deadline');
      expect(report.verified).toBe(false);
      expect(report.records.deleted).toBe(0);
      expect(await countRecords('personal_alice')).toBe(3);
    });
  });
});
