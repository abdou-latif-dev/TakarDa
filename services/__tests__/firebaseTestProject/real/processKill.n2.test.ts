// N2-5 — processus TUÉ pendant la suppression (~500 documents), puis relancé : contre le projet de TEST réel. NON EXÉCUTÉ tant que
// N2 n'est pas autorisé. Ce fichier n'a de sens que lancé PAR scripts/firebase-test/kill-test-worker.js, qui fixe
// TAKARDA_N2_KILL_MODE (« worker » : sème, démarre la suppression et se fige au point choisi ; « verify » : reprend et contrôle),
// TAKARDA_N2_KILL_PHASE et TAKARDA_N2_STATE_FILE. Sans ces variables, tout est ignoré.
// Le fichier d'état contient l'e-mail et le mot de passe JETABLES du compte de test (projet de test, e-mail example.test) ; il doit
// être hors du dépôt et le script le supprime en fin de parcours.

import fs from 'fs';
import type * as H from './harnessReal';

const mode = process.env.TAKARDA_N2_KILL_MODE;
const stateFile = process.env.TAKARDA_N2_STATE_FILE;
const phase = process.env.TAKARDA_N2_KILL_PHASE ?? '';
const enabled =
  !!process.env.TAKARDA_TEST_PROJECT_ID && !!process.env.TAKARDA_CONFIRM_TEST_PROJECT && !!process.env.TAKARDA_TEST_FIREBASE_CONFIG_FILE && !!stateFile && (mode === 'worker' || mode === 'verify');
const suite = enabled ? describe : describe.skip;
const PHASES = ['after-lock', 'mid-batches', 'before-space-delete', 'before-profile-delete'] as const;
const never = () => new Promise<void>(() => undefined);

suite(`N2-5 · processus tué (${mode}, ${phase})`, () => {
  let h: typeof H;
  let del: any;
  let a: any;

  beforeAll(() => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    h = require('./harnessReal');
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    del = require('../../../firebase/firestoreAccountDeletion');
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    a = require('firebase/auth');
  });

  const readState = () => JSON.parse(fs.readFileSync(stateFile as string, 'utf8')) as { email: string; password: string; uid: string; phase: string; ready?: boolean };
  const writeState = (state: object) => fs.writeFileSync(stateFile as string, JSON.stringify(state));

  (mode === 'worker' ? it : it.skip)('worker : sème 500 enregistrements puis fige la suppression au point choisi (le script tue ce processus)', async () => {
    if (!PHASES.includes(phase as (typeof PHASES)[number])) throw new Error(`phase inconnue : ${phase}`);
    const user = await h.makeUser('n25-worker');
    await h.seedAccount(user, 500);
    writeState({ email: user.email, password: user.password, uid: user.uid, phase });
    const freeze = async () => {
      writeState({ email: user.email, password: user.password, uid: user.uid, phase, ready: true }); // le script peut tuer
      await never();
    };
    let commits = 0;
    const space = `spaces/${h.personalSpace(user.uid)}`;
    const ops = {
      ...del.defaultOps,
      commitDeletes: async (db: unknown, refs: unknown[]) => {
        commits += 1;
        if (phase === 'after-lock' && commits === 1) await freeze();
        const result = await del.defaultOps.commitDeletes(db, refs);
        if (phase === 'mid-batches' && commits === 2) await freeze();
        return result;
      },
      deleteDocument: async (ref: { path: string }) => {
        if (phase === 'before-space-delete' && ref.path === space) await freeze();
        const result = await del.defaultOps.deleteDocument(ref);
        if (phase === 'before-profile-delete' && ref.path === space) await freeze();
        return result;
      },
    };
    await del.deleteAccountCloudData(user.client.db, user.uid, { ops, timeoutMs: 600000, deadlineMs: 3600000 });
  }, 900000);

  (mode === 'verify' ? it : it.skip)('verify : après le processus tué, la reprise termine ; verrou non reposé si déjà posé ; aucun orphelin ; compte supprimé ensuite', async () => {
    const state = readState();
    const client = h.newClient('n25-verify');
    await a.signInWithEmailAndPassword(client.auth, state.email, state.password);
    const user = { client, uid: state.uid, email: state.email, password: state.password } as H.TestUser;
    const before = await del.readDeletionLockState(client.db, state.uid);
    h.observe('N2-5.stateAfterKill', { phase: state.phase, lockState: before });
    expect(['locked', 'absent', 'unlocked']).toContain(before); // « unknown » serait un défaut de la mesure
    let locks = 0;
    const counting = { ...del.defaultOps, lockSpace: (...args: unknown[]) => (locks += 1, del.defaultOps.lockSpace(...args)) };
    const resumed = await del.deleteAccountCloudData(client.db, state.uid, { ops: counting, timeoutMs: 20000 });
    h.observe('N2-5.resume', { phase: state.phase, verified: resumed.verified, ownership: resumed.ownership, locksPosedOnResume: locks, found: resumed.records.found });
    expect(resumed.verified).toBe(true);
    if (before === 'locked') expect(locks).toBe(0);
    expect(await h.resurrectionCount(user)).toBe(0); // aucun orphelin
    await h.wipeCloudData(user);
    await a.deleteUser(client.auth.currentUser);
    expect((await h.accountStatus(user)).exists).toBe(false);
  }, 300000);
});
