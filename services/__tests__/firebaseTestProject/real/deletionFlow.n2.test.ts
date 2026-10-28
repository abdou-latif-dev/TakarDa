// N2-DELETION-FLOW (P5) — le parcours RÉEL de suppression de compte (`deleteAccount` + la composition `createCloudDeletion` que l'application
// utilise, avec le vrai SDK) contre le projet de TEST « takarda-n2-test » (jamais la production). NON EXÉCUTÉ tant qu'il n'est pas autorisé.
// Valide : purge de `syncRecords` vérifiée AVANT les enregistrements, l'espace et le profil ; interruption et reprise ; aucune suppression
// partielle présentée comme réussie ; verrou ; isolation d'un autre compte ; nettoyage vérifiable. Aucun accès administrateur, aucune donnée
// personnelle : comptes jetables, données fictives. PRÉREQUIS : le candidat de règles (firestore.p4.rules) est publié sur le projet de TEST.

import type * as H from './harnessReal';

const enabled = !!process.env.TAKARDA_TEST_PROJECT_ID && !!process.env.TAKARDA_CONFIRM_TEST_PROJECT && !!process.env.TAKARDA_TEST_FIREBASE_CONFIG_FILE;
const suite = enabled ? describe : describe.skip;
// Le parcours de suppression inclut l'effacement des espaces partagés (règles P5 : collection `modules`). Tant que ces règles ne sont pas publiées sur le projet de
// TEST, il est écarté ici (sinon la suppression est, à juste titre, « incomplète » : la liste des espaces est refusée), ainsi que le marqueur « compte supprimé » (même candidat de règles).
// TAKARDA_N2_MODULES_RULES=1 rétablit le parcours complet une fois le candidat publié sur le projet de TEST (avec l’accord du propriétaire).
const SHARED_MODULES = process.env.TAKARDA_N2_MODULES_RULES === '1';

suite('N2-DELETION-FLOW · suppression de compte réelle (projet de test)', () => {
  let h: typeof H;
  let f: any;
  let composition: typeof import('../../../firebase/cloudDeletionComposition');
  let service: typeof import('../../../accountDeletionService');
  let deletion: typeof import('../../../firebase/firestoreAccountDeletion');
  let transports: typeof import('../../../firebase/firestoreSyncTransport');
  let backend: typeof import('../../../firebase/firestoreSyncBackend');
  let kinds: typeof import('../../../sync/kindRegistry');
  const created: H.TestUser[] = [];

  beforeAll(() => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    require('./networkGuardReal');
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    h = require('./harnessReal');
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    f = require('firebase/firestore');
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    composition = require('../../../firebase/cloudDeletionComposition');
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    service = require('../../../accountDeletionService');
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    deletion = require('../../../firebase/firestoreAccountDeletion');
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    transports = require('../../../firebase/firestoreSyncTransport');
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    backend = require('../../../firebase/firestoreSyncBackend');
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    kinds = require('../../../sync/kindRegistry');
  });

  afterAll(async () => {
    // nettoyage borné aux comptes créés par CETTE exécution : la composition réelle d'abord (comptes restants), puis le harnais
    const problems: string[] = [];
    const gone = new Set<string>(); // comptes supprimés PAR le scénario testé (vérifié : la connexion échoue)
    for (const user of created) {
      try {
        const status = await h.accountStatus(user);
        if (!status.exists) {
          // « supprimé » n'est retenu que pour un refus d'identifiants EXPLICITE ; toute autre erreur (réseau, limitation…) laisse l'état INCONNU
          if (status.code === 'auth/invalid-credential' || status.code === 'auth/user-not-found') {
            gone.add(user.email);
            continue; // supprimé par le scénario testé
          }
          problems.push(`${user.email} (${user.uid}) : état du compte indéterminé (${status.code ?? 'inconnu'})`);
          continue;
        }
        const db = user.client.db;
        const report = await composition.createCloudDeletion(db, { deletion: { timeoutMs: 20000 }, sharedModules: SHARED_MODULES, accountTombstone: SHARED_MODULES })(user.uid);
        h.spend((report.syncRecords?.found ?? 0) * 2 + 12, 'nettoyage');
        if (!report.verified) problems.push(`${user.email} (${user.uid}) : suppression non vérifiée (${report.error?.code ?? 'sans erreur'})`);
        // vérification des documents Firestore SANS accès administrateur : on recrée l'espace pour LISTER d'éventuels orphelins, puis on le supprime à nouveau
        await f.setDoc(f.doc(db, 'spaces', h.personalSpace(user.uid)), h.spaceDoc(user.uid));
        const orphans = (await f.getDocs(syncCol(user))).size + (await h.ownerCount(user));
        h.spend(6, 'vérification des orphelins');
        h.observe('deletionFlow.cleanup.orphans', { uid: user.uid.slice(0, 4), orphans });
        if (orphans > 0) problems.push(`${user.email} (${user.uid}) : ${orphans} document(s) orphelin(s) après suppression`);
        const again = await composition.createCloudDeletion(db, { deletion: { timeoutMs: 20000 }, sharedModules: SHARED_MODULES, accountTombstone: SHARED_MODULES })(user.uid);
        if (!again.verified) problems.push(`${user.email} (${user.uid}) : espace recréé non supprimé (${again.error?.code ?? 'sans erreur'})`);
      } catch (error) {
        problems.push(`${user.email} (${user.uid}) : nettoyage en erreur (${(error as { code?: string }).code ?? 'erreur'})`);
      }
    }
    const report = await h.cleanupAll();
    h.observe('deletionFlow.cleanup', report);
    // le harnais ne peut pas se reconnecter à un compte que le scénario a SUPPRIMÉ (c'est le résultat attendu) : seuls ces cas, vérifiés plus haut, sont écartés
    problems.push(...report.failures.filter((line) => ![...gone].some((email) => line.startsWith(email) && line.includes('auth/invalid-credential'))));
    // un échec de nettoyage n'est JAMAIS silencieux : la suite échoue et liste les comptes jetables de CETTE exécution à purger à la main
    if (problems.length > 0) throw new Error(`NETTOYAGE INCOMPLET — comptes et données de CETTE exécution à purger dans la console du projet de test :\n${problems.join('\n')}`);
  });

  const code = (promise: Promise<unknown>) => promise.then(() => 'ok', (e: { code?: string }) => e.code ?? 'erreur');
  const syncCol = (user: H.TestUser) => f.collection(user.client.db, 'spaces', h.personalSpace(user.uid), 'syncRecords');
  const transportOf = (user: H.TestUser) => transports.createFirestoreSyncTransport({ backend: backend.createFirestoreSyncBackend(user.client.db, user.uid), uid: user.uid, overlapMs: 0 });
  let n = 0;
  const wire = (uid: string, id: string) => ({ id, kind: kinds.KIND.IMMOBILIER_BIEN, schemaVersion: 1, ownerUid: uid, statusKey: null, createdAt: '2026-10-21T09:00:00.000Z', updatedAt: '2026-10-21T09:00:00.000Z', body: { nom: 'Maison' }, refs: {} });

  /** Compte jetable avec profil, espace, `records` (V1) et `syncRecords`. */
  async function account(label: string, syncDocs: number, records: number): Promise<H.TestUser> {
    const user = await h.makeUser(label);
    created.push(user);
    await h.seedAccount(user, records);
    h.spend(syncDocs * 3 + 2, 'données de synchronisation');
    const t = transportOf(user);
    for (let i = 0; i < syncDocs; i += 1) {
      const id = `s${i}`;
      await t.push({ opId: `n2del-${h.runId}-${(n += 1)}`, recordId: id, kind: kinds.KIND.IMMOBILIER_BIEN, op: 'create', expectedRev: null, deletedAt: null, wire: wire(user.uid, id) });
    }
    return user;
  }

  /** Le MÊME `deleteAccount` que l'application, avec la MÊME composition ; seule la réauthentification et la suppression du compte passent par le harnais. */
  const runDeletion = (user: H.TestUser, hooks: Parameters<typeof composition.createCloudDeletion>[1] = {}) => {
    const base = h.apiFor(user);
    const api = { reauthenticate: base.reauthenticate, deleteCloudData: composition.createCloudDeletion(user.client.db, { deletion: { timeoutMs: 20000 }, sharedModules: SHARED_MODULES, accountTombstone: SHARED_MODULES, ...hooks }), deleteAuthAccount: base.deleteAuthAccount };
    const local = h.fakeLocal();
    return service.deleteAccount(api, user.uid, user.password, local.local).then((outcome) => ({ outcome, released: local.released }));
  };
  const lockOf = async (user: H.TestUser) => (await f.getDocFromServer(f.doc(user.client.db, 'spaces', h.personalSpace(user.uid)))).data()?.deletionLockedAt ?? null;

  it('F1 · parcours complet : syncRecords purgé et vérifié, puis records, espace, profil, compte ; l’état final est confirmé', async () => {
    const a = await account('f1-a', 5, 4);
    h.spend(40, 'F1');
    const { outcome, released } = await runDeletion(a);
    h.observe('deletionFlow.F1', { status: outcome.status, sync: outcome.report?.syncRecords, verified: outcome.report?.verified });
    expect(outcome.status).toBe('completed');
    expect(outcome.report?.syncRecords).toMatchObject({ status: 'purged', found: 5, deleted: 5, remaining: 0 });
    expect(outcome.report).toMatchObject({ verified: true, space: 'deleted', profile: 'deleted', ownership: 'proven' });
    expect(outcome.report?.records).toMatchObject({ found: 4, deleted: 4, remaining: 0 });
    expect(outcome.authDeleted).toBe(true);
    expect(released).toEqual([a.uid]);
    expect((await h.accountStatus(a)).exists).toBe(false);
  });

  it('F2 · interruption pendant la purge de syncRecords : « incomplète », rien d’autre n’est touché, le verrou bloque les écritures, un autre compte est intact ; la reprise termine', async () => {
    const a = await account('f2-a', 5, 3);
    const b = await account('f2-b', 2, 2);
    h.spend(60, 'F2');
    let batches = 0;
    const faulty = (inner: any) => ({
      ...inner,
      removeSyncDocs: async (ids: string[]) => {
        batches += 1;
        if (batches === 2) throw Object.assign(new Error('coupure simulée'), { code: 'unavailable' });
        return inner.removeSyncDocs(ids);
      },
    });
    const first = await runDeletion(a, { wrapErasureBackend: faulty, pageSize: 2 });
    h.observe('deletionFlow.F2.first', { status: first.outcome.status, sync: first.outcome.report?.syncRecords });
    expect(first.outcome.status).toBe('cloud_incomplete');
    expect(first.outcome.report?.verified).toBe(false);
    expect(first.outcome.report?.syncRecords).toMatchObject({ status: 'incomplete', deleted: 2 });
    expect(first.outcome.authDeleted).toBe(false);
    expect(first.released).toEqual([]); // les données locales ne sont pas libérées tant que le cloud n'est pas vérifié
    expect((await h.accountStatus(a)).exists).toBe(true); // le compte est conservé
    expect(await h.ownerCount(a)).toBe(3); // records intacts : « le reste » n'a pas été lancé
    expect((await f.getDocs(syncCol(a))).size).toBe(3); // restent : 5 - 2
    expect(await lockOf(a)).toEqual(expect.any(String)); // verrou posé
    expect(await code(transportOf(a).push({ opId: `n2del-${h.runId}-late`, recordId: 'tardif', kind: kinds.KIND.IMMOBILIER_BIEN, op: 'create', expectedRev: null, deletedAt: null, wire: wire(a.uid, 'tardif') }))).toBe('permission');
    // l'autre compte n'est pas touché
    expect((await f.getDocs(syncCol(b))).size).toBe(2);
    expect(await h.ownerCount(b)).toBe(2);
    // reprise : sans panne
    const second = await runDeletion(a, { pageSize: 2 });
    h.observe('deletionFlow.F2.second', { status: second.outcome.status, sync: second.outcome.report?.syncRecords });
    expect(second.outcome.status).toBe('completed');
    expect(second.outcome.report?.syncRecords).toMatchObject({ status: 'purged', found: 3, remaining: 0 });
    expect((await h.accountStatus(a)).exists).toBe(false);
    expect((await f.getDocs(syncCol(b))).size).toBe(2); // toujours intact
  });

  it('F3 · interruption pendant « le reste » (syncRecords déjà purgé et vérifié) : « incomplète », jamais un succès ; la reprise ne refait rien d’inutile et termine', async () => {
    const a = await account('f3-a', 3, 4);
    h.spend(50, 'F3');
    let failed = false;
    const ops = {
      ...deletion.defaultOps,
      commitDeletes: async (db: unknown, refs: unknown[]) => {
        if (!failed) {
          failed = true;
          throw Object.assign(new Error('coupure simulée'), { code: 'unavailable' });
        }
        return deletion.defaultOps.commitDeletes(db as never, refs as never);
      },
    };
    const first = await runDeletion(a, { deletion: { timeoutMs: 20000, ops } });
    h.observe('deletionFlow.F3.first', { status: first.outcome.status, sync: first.outcome.report?.syncRecords, error: first.outcome.report?.error?.code });
    expect(first.outcome.status).toBe('cloud_incomplete');
    expect(first.outcome.report?.verified).toBe(false);
    expect(first.outcome.report?.syncRecords).toMatchObject({ status: 'purged', remaining: 0 });
    expect(first.outcome.authDeleted).toBe(false);
    expect((await f.getDocs(syncCol(a))).size).toBe(0); // la purge de synchronisation était déjà faite et vérifiée
    expect(await h.ownerCount(a)).toBe(4); // les enregistrements restent : rien de partiel n'est annoncé comme supprimé
    expect((await h.accountStatus(a)).exists).toBe(true);
    const second = await runDeletion(a);
    expect(second.outcome.status).toBe('completed');
    expect(second.outcome.report?.syncRecords).toMatchObject({ status: 'purged', found: 0, deleted: 0, remaining: 0 });
    expect((await h.accountStatus(a)).exists).toBe(false);
  });

  it('F4 · mauvais mot de passe : réauthentification refusée, RIEN n’est supprimé (ni synchronisation, ni enregistrements, ni compte)', async () => {
    const a = await account('f4-a', 2, 2);
    h.spend(20, 'F4');
    const base = h.apiFor(a);
    const api = { reauthenticate: base.reauthenticate, deleteCloudData: composition.createCloudDeletion(a.client.db, { sharedModules: SHARED_MODULES, accountTombstone: SHARED_MODULES }), deleteAuthAccount: base.deleteAuthAccount };
    const outcome = await service.deleteAccount(api, a.uid, 'mot-de-passe-faux', h.fakeLocal().local);
    expect(outcome.status).toBe('reauth_required');
    expect((await f.getDocs(syncCol(a))).size).toBe(2);
    expect(await h.ownerCount(a)).toBe(2);
    expect(await lockOf(a)).toBeNull(); // pas même le verrou
    expect((await h.accountStatus(a)).exists).toBe(true);
  });
});
