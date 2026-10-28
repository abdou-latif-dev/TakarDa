// N2-SYNC (P4) — transports de synchronisation et de réception contre le projet de TEST réel « takarda-n2-test » (jamais la production).
// NON EXÉCUTÉ tant que N2 n'est pas autorisé. PRÉREQUIS : le CANDIDAT de règles (firestore.p4.rules) doit avoir été publié sur le projet de
// TEST (autorisation séparée) ; avec les règles actuelles (V1), tous les accès à `syncRecords` sont refusés et ces tests échouent.
// Aucun accès administrateur : comptes jetables, vraies règles. Nettoyage : purge de `syncRecords`, puis nettoyage habituel du harnais.

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
      __memory: memory,
    },
  };
});

suite('N2-SYNC · transports de synchronisation (projet de test réel)', () => {
  let h: typeof H;
  let f: any;
  let model: typeof import('../../../firebase/syncDocModel');
  let transports: typeof import('../../../firebase/firestoreSyncTransport');
  let backend: typeof import('../../../firebase/firestoreSyncBackend');
  let kinds: typeof import('../../../sync/kindRegistry');
  let erasure: typeof import('../../../firebase/syncAccountErasure');
  let deletion: typeof import('../../../firebase/firestoreAccountDeletion');
  const created: H.TestUser[] = [];

  beforeAll(() => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    require('./networkGuardReal');
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    h = require('./harnessReal');
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    f = require('firebase/firestore');
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    model = require('../../../firebase/syncDocModel');
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    transports = require('../../../firebase/firestoreSyncTransport');
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    backend = require('../../../firebase/firestoreSyncBackend');
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    kinds = require('../../../sync/kindRegistry');
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    erasure = require('../../../firebase/syncAccountErasure');
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    deletion = require('../../../firebase/firestoreAccountDeletion');
  });

  afterAll(async () => {
    // les documents de synchronisation ne sont PAS supprimés par la suppression de compte actuelle : procédure d'effacement d'abord
    // (verrou, purge de syncRecords, puis la suppression existante), pour chaque compte créé par CETTE exécution uniquement
    const problems: string[] = [];
    for (const user of created) {
      try {
        const report = await eraseOf(user);
        h.spend(report.syncRecords.found * 2 + 12, 'effacement');
        h.observe('sync.cleanup.erasure', { uid: user.uid.slice(0, 4), status: report.syncRecords.status, verified: report.verified });
        if (!report.verified) problems.push(`${user.email} (${user.uid}) : effacement non vérifié (${report.error?.code ?? report.syncRecords.status})`);
      } catch (error) {
        problems.push(`${user.email} (${user.uid}) : effacement en erreur (${(error as { code?: string }).code ?? 'erreur'})`);
      }
    }
    const report = await h.cleanupAll();
    h.observe('sync.cleanup', report);
    problems.push(...report.failures);
    // un échec de nettoyage n'est JAMAIS silencieux : la suite échoue et liste les comptes jetables à purger à la main (projet de TEST)
    if (problems.length > 0) throw new Error(`NETTOYAGE INCOMPLET — comptes et données de CETTE exécution à purger dans la console du projet de test :\n${problems.join('\n')}`);
  });

  // le compte de synchronisation actif ne survit jamais à un scénario, même en échec : le moteur n'agit que pour un compte activé explicitement
  afterEach(() => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    require('../../../sync/syncAccount').setSyncAccount(null);
  });

  const code = (promise: Promise<unknown>) => promise.then(() => 'ok', (e: { code?: string }) => e.code ?? 'erreur');
  const colOf = (user: H.TestUser, uid = user.uid) => f.collection(user.client.db, 'spaces', h.personalSpace(uid), 'syncRecords');
  const eraseOf = (user: H.TestUser) =>
    erasure.eraseAccountCloudData({
      backend: backend.createFirestoreErasureBackend(user.client.db, user.uid),
      uid: user.uid,
      deleteRest: () => deletion.deleteAccountCloudData(user.client.db, user.uid, { timeoutMs: 20000 }),
    });
  const transportOf = (user: H.TestUser, client = user.client, uid = user.uid) =>
    transports.createFirestoreSyncTransport({ backend: backend.createFirestoreSyncBackend(client.db, uid), uid, overlapMs: 0 });

  async function account(label: string): Promise<H.TestUser> {
    const user = await h.makeUser(label);
    created.push(user);
    await h.seedAccount(user, 0); // profil et espace personnel (règles V1 inchangées)
    return user;
  }
  let n = 0;
  const wire = (uid: string, id: string, over: Record<string, unknown> = {}) => ({
    id,
    kind: kinds.KIND.IMMOBILIER_BIEN,
    schemaVersion: 1,
    ownerUid: uid,
    statusKey: null,
    createdAt: '2026-10-19T09:00:00.000Z',
    updatedAt: '2026-10-19T09:00:00.000Z',
    body: { nom: 'Maison' },
    refs: {},
    ...over,
  });
  const req = (op: 'create' | 'update' | 'delete', w: any, over: Record<string, unknown> = {}) => ({
    opId: `n2-${h.runId}-${(n += 1)}`,
    recordId: w.id,
    kind: w.kind,
    op,
    expectedRev: op === 'create' ? null : 1,
    deletedAt: op === 'delete' ? new Date().toISOString() : null,
    wire: op === 'delete' ? null : w,
    ...over,
  });

  it('S1 · cycle complet : création, idempotence, modification, conflit, suppression logique, restauration, lecture par pages', async () => {
    const a = await account('s1-a');
    const t = transportOf(a);
    h.spend(30, 'S1');
    const first = req('create', wire(a.uid, 'b1'));
    expect(await t.push(first as never)).toEqual({ rev: 1 });
    expect(await t.push(first as never)).toEqual({ rev: 1 }); // même opId : aucune nouvelle écriture
    expect(await t.push(req('update', wire(a.uid, 'b1', { body: { nom: 'Villa' } })) as never)).toEqual({ rev: 2 });
    expect(await code(t.push(req('update', wire(a.uid, 'b1'), { expectedRev: 1 }) as never))).toBe('conflict');
    expect(await t.push(req('delete', wire(a.uid, 'b1'), { expectedRev: 2 }) as never)).toEqual({ rev: 3 });
    expect(await t.read(kinds.KIND.IMMOBILIER_BIEN, 'b1')).toMatchObject({ rev: 3, deleted: true });
    expect(await code(t.push(req('update', wire(a.uid, 'b1'), { expectedRev: 3 }) as never))).toBe('conflict'); // supprimé : restauration explicite requise
    expect(await t.restore({ opId: `n2-${h.runId}-restore`, recordId: 'b1', kind: kinds.KIND.IMMOBILIER_BIEN, expectedRev: 3 })).toEqual({ rev: 4 });
    for (const id of ['b2', 'b3', 'b4']) await t.push(req('create', wire(a.uid, id)) as never);
    const reader = transportOf(a);
    const seen: string[] = [];
    let cursor: string | null = null;
    for (let i = 0; i < 6; i += 1) {
      const page = await reader.pull({ cursor, limit: 2 });
      seen.push(...page.changes.map((c) => c.id));
      cursor = page.nextCursor;
      if (!page.hasMore) break;
    }
    h.spend(20, 'S1 lectures');
    expect([...seen].sort()).toEqual(['b1', 'b2', 'b3', 'b4']);
    h.observe('sync.S1.pull', { pages: seen.length, order: seen });
  });

  it('S2 · isolation : un autre compte, une session sans compte, un identifiant d’espace étranger — aucun accès', async () => {
    const a = await account('s2-a');
    const b = await account('s2-b');
    h.spend(30, 'S2');
    await transportOf(a).push(req('create', wire(a.uid, 'secret')) as never);
    // B vers l'espace d'A : lecture, liste, écriture, suppression refusées (règles)
    expect(await code(f.getDoc(f.doc(b.client.db, 'spaces', h.personalSpace(a.uid), 'syncRecords', 'secret')))).toBe('permission-denied');
    expect(await code(f.getDocs(colOf(b, a.uid)))).toBe('permission-denied');
    expect(await code(transportOf(b, b.client, a.uid).pull({ cursor: null, limit: 5 }))).toBe('permission');
    expect(await code(transportOf(b, b.client, a.uid).push(req('create', wire(a.uid, 'intrus')) as never))).toBe('permission');
    expect(await code(f.deleteDoc(f.doc(b.client.db, 'spaces', h.personalSpace(a.uid), 'syncRecords', 'secret')))).toBe('permission-denied');
    // A vers l'espace de B
    expect(await code(f.getDocs(colOf(a, b.uid)))).toBe('permission-denied');
    // session sans compte
    const anon = h.newClient('s2-anon');
    expect(await code(f.getDocs(f.collection(anon.db, 'spaces', h.personalSpace(a.uid), 'syncRecords')))).toBe('permission-denied');
    expect(await code(f.setDoc(f.doc(anon.db, 'spaces', h.personalSpace(a.uid), 'syncRecords', 'x'), { a: 1 }))).toBe('permission-denied');
    // contenu signé par un autre compte : refusé par le transport avant tout envoi, et par les règles si on le contourne
    expect(await code(transportOf(b).push(req('create', wire(a.uid, 'faux')) as never))).toBe('invalid');
    expect(await code(f.setDoc(f.doc(b.client.db, 'spaces', h.personalSpace(b.uid), 'syncRecords', 'faux'), { ...wire(a.uid, 'faux'), rev: 1, deleted: false, deletedAt: null, restoredAt: null, lastOpId: 'x', serverUpdatedAt: f.serverTimestamp() }))).toBe('permission-denied');
    // chacun ne voit que ses propres documents
    expect((await f.getDocs(colOf(a))).size).toBe(1);
    expect((await f.getDocs(colOf(b))).size).toBe(0);
  });

  it('S3 · deux appareils du même compte : écritures simultanées à la même révision — une seule réussit, l’autre est un conflit', async () => {
    const a = await account('s3-a');
    const second = await h.secondDevice(a, 's3-device2');
    h.spend(25, 'S3');
    await transportOf(a).push(req('create', wire(a.uid, 'b1')) as never);
    const results = await Promise.allSettled([
      transportOf(a).push(req('update', wire(a.uid, 'b1', { body: { nom: 'Appareil 1' } })) as never),
      transportOf(a, second).push(req('update', wire(a.uid, 'b1', { body: { nom: 'Appareil 2' } })) as never),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(((results.find((r) => r.status === 'rejected') as PromiseRejectedResult).reason as { code: string }).code).toBe('conflict');
    expect((await transportOf(a).read(kinds.KIND.IMMOBILIER_BIEN, 'b1'))?.rev).toBe(2);
    // le second appareil lit le même état (lecture serveur)
    expect(await transportOf(a, second).read(kinds.KIND.IMMOBILIER_BIEN, 'b1')).toMatchObject({ rev: 2, deleted: false });
  });

  it('S4 · faits financiers : création permise ; modification, suppression logique et restauration refusées par les règles réelles', async () => {
    const a = await account('s4-a');
    h.spend(30, 'S4');
    const t = transportOf(a);
    const paiement = wire(a.uid, 'p1', { kind: kinds.KIND.IMMOBILIER_PAIEMENT, body: { montant: 25000 } });
    expect(await t.push(req('create', paiement) as never)).toEqual({ rev: 1 });
    expect(await code(t.push(req('update', paiement) as never))).toBe('invalid');
    expect(await code(t.push(req('delete', paiement) as never))).toBe('invalid');
    const { id: _unused, ...content } = paiement;
    void _unused;
    const ref = f.doc(a.client.db, 'spaces', h.personalSpace(a.uid), 'syncRecords', 'p1');
    const next = (over: Record<string, unknown>) => ({ ...content, rev: 2, deleted: false, deletedAt: null, restoredAt: null, lastOpId: 'x', serverUpdatedAt: f.serverTimestamp(), ...over });
    expect(await code(f.setDoc(ref, next({ body: { montant: 1 } })))).toBe('permission-denied');
    expect(await code(f.setDoc(ref, next({ deleted: true, deletedAt: new Date().toISOString() })))).toBe('permission-denied');
    // suppression PHYSIQUE : refusée tant que l'espace n'est pas verrouillé (réservée à la procédure d'effacement du compte)
    expect(await code(f.deleteDoc(ref))).toBe('permission-denied');
    expect(await t.read(kinds.KIND.IMMOBILIER_PAIEMENT, 'p1')).toMatchObject({ rev: 1, deleted: false });
  });

  it('S5 · limites réelles : document trop volumineux, tableau imbriqué, clé réservée — refusés avant l’envoi ; corps de 100 champs accepté', async () => {
    const a = await account('s5-a');
    h.spend(15, 'S5');
    const t = transportOf(a);
    expect(await code(t.push(req('create', wire(a.uid, 'gros', { body: { x: 'x'.repeat(model.FIRESTORE_LIMITS.softMaxDocBytes + 10) } })) as never))).toBe('invalid');
    expect(await code(t.push(req('create', wire(a.uid, 'nested', { body: { m: [[1]] } })) as never))).toBe('invalid');
    expect(await code(t.push(req('create', wire(a.uid, 'reserve', { body: { __x__: 1 } })) as never))).toBe('invalid');
    const wide = Object.fromEntries(Array.from({ length: 100 }, (_, i) => [`k${i}`, i]));
    expect(await t.push(req('create', wire(a.uid, 'large', { body: wide })) as never)).toEqual({ rev: 1 });
    h.observe('sync.S5.limits', { softMaxDocBytes: model.FIRESTORE_LIMITS.softMaxDocBytes });
  });

  it('S6 · de bout en bout avec le moteur : A envoie la chaîne Immobilier, B (appareil vide) la reçoit ; aucun écho ; démonstration jamais envoyée', async () => {
    const a = await account('s6-a');
    h.spend(120, 'S6');
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const db = require('../../../db');
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const immo = require('../../../immobilierService');
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const persistence = require('../../../persistence');
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const engine = require('../../../sync/syncEngine');
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const inbound = require('../../../sync/inbound');
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const syncAccountModule = require('../../../sync/syncAccount');
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const scanner = require('../../../sync/changeScanner');
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const storage = require('@react-native-async-storage/async-storage').default as { __memory: Map<string, string> };

    const clearApp = () => {
      for (const [name, value] of Object.entries(db)) if (Array.isArray(value) && name !== 'formTemplates') (value as unknown[]).length = 0;
      db.users.push(db.defaultLocalUser());
      immo.resetImmobilierToolCache();
    };
    storage.__memory.clear();
    clearApp();
    syncAccountModule.setSyncAccount(a.uid); // le moteur n'agit que pour le compte de synchronisation actif (isolation par compte, P5)
    // Activation OBLIGATOIRE (phase 6, étape 2) : sans elle, rien n'est capturé, envoyé ni reçu. Elle précède la création des données : un
    // élément déjà présent à l'activation est « ancien » (legacyIds) et ne part jamais automatiquement. L'instant est dans le passé (horloge réelle).
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const activation = require('../../../sync/syncActivation');
    await activation.activateSync(new Date(Date.now() - 60_000));
    const now = new Date();
    const scope = { enabledAt: '2000-01-01T00:00:00.000Z' };
    const bien = await immo.createBien({ nom: 'Maison N2', adresse: 'Lomé' });
    await immo.createLocataireEtContrat({ bienId: bien.id, nouveauLogement: { nom: 'Chambre' }, nom: 'Koffi', telephone: '90123456', loyerMensuel: 25000, dateEntree: new Date(2026, 0, 5), dernierLoyerPaye: '2026-09' });
    await engine.captureLocalChanges({ scope, now });
    const sent = await engine.runOnce({ transport: transportOf(a), ownerUid: a.uid, now: () => now });
    expect(sent.stopped).toBeNull();
    expect(sent.permanentErrors).toEqual([]);
    const sentCount = sent.confirmed.length;
    expect(sentCount).toBeGreaterThanOrEqual(4);
    const hashesA = Object.fromEntries(scanner.collectSyncableItems(persistence.snapshotCollections()).items.map((i: { id: string; hash: string }) => [i.id, i.hash]));

    // appareil B : état local vide
    storage.__memory.clear();
    clearApp();
    await activation.activateSync(new Date(Date.now() - 60_000)); // appareil B : sa propre activation (état local vide : aucun ancien élément)
    const received = await inbound.runInbound({ pull: transportOf(a), ownerUid: a.uid, now: () => now });
    expect(received.stopped).toBeNull();
    expect(received.applied.length).toBe(sentCount);
    const hashesB = Object.fromEntries(scanner.collectSyncableItems(persistence.snapshotCollections()).items.map((i: { id: string; hash: string }) => [i.id, i.hash]));
    expect(hashesB).toEqual(hashesA);
    // aucun écho
    await engine.captureLocalChanges({ scope, now });
    expect((await engine.runOnce({ transport: transportOf(a), ownerUid: a.uid, now: () => now })).confirmed).toEqual([]);
    h.observe('sync.S6', { sent: sentCount, received: received.applied.length });

    // démonstration : jamais d'envoi ni de réception
    await persistence.switchWorkspace('demo');
    await expect(engine.runOnce({ transport: transportOf(a), ownerUid: a.uid })).rejects.toMatchObject({ code: 'demo_workspace' });
    await expect(inbound.runInbound({ pull: transportOf(a), ownerUid: a.uid })).rejects.toMatchObject({ code: 'demo_workspace' });
    await persistence.switchWorkspace('personal');
    syncAccountModule.setSyncAccount(null);
  });

  it('S7 · effacement du compte : la procédure complète supprime syncRecords puis le reste, avec reprise ; le verrou bloque les écritures ; l’autre compte est intact', async () => {
    const a = await account('s7-a');
    const b = await account('s7-b');
    h.spend(90, 'S7');
    const t = transportOf(a);
    for (const id of ['d1', 'd2', 'd3']) await t.push(req('create', wire(a.uid, id)) as never);
    await transportOf(b).push(req('create', wire(b.uid, 'autre')) as never);
    // sans verrou, la suppression physique est refusée
    expect(await code(f.deleteDoc(f.doc(a.client.db, 'spaces', h.personalSpace(a.uid), 'syncRecords', 'd1')))).toBe('permission-denied');
    // procédure complète, première tentative interrompue pendant « le reste » (syncRecords déjà purgé)
    let first = true;
    const run = () =>
      erasure.eraseAccountCloudData({
        backend: backend.createFirestoreErasureBackend(a.client.db, a.uid),
        uid: a.uid,
        pageSize: 2,
        deleteRest: async () => {
          if (first) {
            first = false;
            return { ownership: 'proven', records: { found: 0, deleted: 0, remaining: null }, space: 'skipped', profile: 'skipped', verified: false, uncertain: false, error: { code: 'unavailable', message: 'coupure simulée' } };
          }
          return deletion.deleteAccountCloudData(a.client.db, a.uid, { timeoutMs: 20000 });
        },
      });
    const interrupted = await run();
    expect(interrupted.syncRecords).toMatchObject({ status: 'purged', deleted: 3, remaining: 0 });
    expect(interrupted.verified).toBe(false);
    // le verrou bloque les écritures de synchronisation
    expect(await code(t.push(req('create', wire(a.uid, 'tardif')) as never))).toBe('permission');
    const done = await run();
    h.observe('sync.S7.erasure', { sync: done.syncRecords.status, verified: done.verified, rest: done.rest?.space });
    expect(done.verified).toBe(true);
    expect(await h.spaceExists(a)).toBe(false);
    // l'autre compte est intact
    expect((await f.getDocs(colOf(b))).size).toBe(1);
  });

  it('S8 · périmètre Immobilier : les règles réelles REFUSENT (permission-denied) tontine, CEET/TDE, formulaire et autres types hors liste, pour leur propre propriétaire', async () => {
    const a = await account('s8-a');
    h.spend(40, 'S8');
    const t = transportOf(a);
    // Écriture brute dans le véritable chemin Firestore, avec le MÊME document que celui qu'écrit le transport (docFromWire + horodatage serveur) :
    // c'est le contournement du contrôle côté client qui prouve que le refus vient des règles et non du client.
    const rawWrite = (w: ReturnType<typeof wire>) => {
      const ref = f.doc(a.client.db, 'spaces', h.personalSpace(a.uid), 'syncRecords', w.id);
      return code(f.setDoc(ref, { ...model.docFromWire(w as never, { opId: `n2-${h.runId}-${(n += 1)}`, rev: 1 }, null), serverUpdatedAt: f.serverTimestamp() }));
    };
    const outOfScope = [
      kinds.KIND.TONTINE_COTISATION,
      kinds.KIND.TONTINE_GROUPE,
      kinds.KIND.UTILITY_FACTURE,
      kinds.KIND.UTILITY_RELEVE,
      kinds.KIND.UTILITY_FACTURE_PARTAGEE,
      kinds.KIND.FORMS_FORMULAIRE,
      kinds.KIND.FORMS_REPONSE,
      kinds.KIND.CORE_OUTIL,
    ];
    // témoin : le même document avec un type du périmètre est ACCEPTÉ (la forme du document n'est donc pas en cause)
    expect(await rawWrite(wire(a.uid, 's8-temoin'))).toBe('ok');
    for (const [i, kind] of outOfScope.entries()) {
      const w = wire(a.uid, `s8-hors-${i}`, { kind, body: { nom: 'Maison' } });
      expect({ kind, outcome: await rawWrite(w) }).toEqual({ kind, outcome: 'permission-denied' });
      // et par le transport réel : refusé avant l'envoi (contrôle client, en plus des règles)
      expect({ kind, outcome: await code(t.push(req('create', w) as never)) }).toEqual({ kind, outcome: 'invalid' });
    }
    // rien de hors périmètre n'a été écrit ; seul le témoin existe
    const snapshot = await f.getDocs(colOf(a));
    expect(snapshot.docs.map((d: { id: string }) => d.id)).toEqual(['s8-temoin']);
    h.observe('sync.S8.scope', { refused: outOfScope.length });
  });
});
