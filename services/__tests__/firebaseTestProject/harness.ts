// Harnais N1 : clients Firebase (Authentication + Firestore) branchés EXCLUSIVEMENT sur les émulateurs locaux, projet fictif
// « demo-takarda ». Aucun import de la configuration de production, aucun projet réel, aucune clé réelle.
//
// L'import de ce module échoue (GuardError) si l'environnement n'est pas un environnement d'émulateurs locaux : voir guards.ts.
// Le garde réseau (networkGuard.ts) bloque en plus toute connexion non locale.

import { deleteApp, initializeApp, type FirebaseApp } from 'firebase/app';
import {
  connectAuthEmulator,
  createUserWithEmailAndPassword,
  deleteUser,
  EmailAuthProvider,
  getAuth,
  reauthenticateWithCredential,
  signInAnonymously,
  signInWithEmailAndPassword,
  type Auth,
} from 'firebase/auth';
import { collection, connectFirestoreEmulator, doc, getDoc, getDocs, getFirestore, setDoc, writeBatch, type Firestore } from 'firebase/firestore';
import { deleteAccount, type AccountDeletionApi, type DeletionOutcome, type DeletionTimeouts, type LocalCleanup } from '../../accountDeletionService';
import { deleteAccountCloudData, type DeletionOptions } from '../../firebase/firestoreAccountDeletion';
import { assertEmulatorOnlyEnvironment, GuardError, isLoopbackHost } from './guards';

export const N1 = assertEmulatorOnlyEnvironment(process.env);
export const runId = Math.random().toString(36).slice(2, 8);

const apps: FirebaseApp[] = [];
let counter = 0;

/** Observation chiffrée à reporter dans docs/validation-firebase-test-RESULTATS.md (lue dans la sortie des tests). */
export const observe = (key: string, value: unknown): void => {
  console.log(`N1-OBS ${key} = ${JSON.stringify(value)}`);
};

export interface Client {
  label: string;
  app: FirebaseApp;
  auth: Auth;
  db: Firestore;
}

/** Nouveau client (équivalent d'un « appareil »), branché sur les émulateurs, avec vérification que c'est bien le cas. */
export function newClient(label: string): Client {
  counter += 1;
  const app = initializeApp(
    { apiKey: 'fake-api-key-n1-emulateur', authDomain: `${N1.projectId}.firebaseapp.com`, projectId: N1.projectId, appId: '1:0:web:n1emulateur' },
    `n1-${runId}-${label}-${counter}`,
  );
  apps.push(app);
  const auth = getAuth(app);
  connectAuthEmulator(auth, `http://${N1.auth.host}:${N1.auth.port}`, { disableWarnings: true });
  const db = getFirestore(app);
  connectFirestoreEmulator(db, N1.firestore.host, N1.firestore.port);
  const emulator = auth.emulatorConfig;
  if (!emulator || !isLoopbackHost(emulator.host)) throw new GuardError('le client Authentication n\'est pas branché sur un émulateur local.');
  return { label, app, auth, db };
}

export async function disposeClients(): Promise<void> {
  await Promise.all(apps.splice(0).map((app) => deleteApp(app).catch(() => undefined)));
}

// ---- Émulateurs : remise à zéro (points d'accès propres aux émulateurs, locaux) -----------------------------------

export async function clearEmulators(): Promise<void> {
  const auth = await fetch(`http://${N1.auth.host}:${N1.auth.port}/emulator/v1/projects/${N1.projectId}/accounts`, { method: 'DELETE' });
  const fs = await fetch(`http://${N1.firestore.host}:${N1.firestore.port}/emulator/v1/projects/${N1.projectId}/databases/(default)/documents`, { method: 'DELETE' });
  if (!auth.ok || !fs.ok) throw new Error(`remise à zéro des émulateurs impossible (${auth.status}/${fs.status})`);
}

// ---- Accès « administrateur » aux émulateurs (règles désactivées, pour compter et semer des cas particuliers) --------

let adminEnv: { withSecurityRulesDisabled(fn: (ctx: { firestore(): Firestore }) => Promise<void>): Promise<void>; cleanup(): Promise<void> } | null = null;

async function admin() {
  if (!adminEnv) {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const t = require('@firebase/rules-unit-testing');
    // Sans option `rules` : ce sont les règles chargées par l'émulateur (celles du dépôt) qui s'appliquent aux clients.
    adminEnv = await t.initializeTestEnvironment({ projectId: N1.projectId, firestore: { host: N1.firestore.host, port: N1.firestore.port } });
  }
  return adminEnv!;
}

export async function adminRun<T>(fn: (db: Firestore) => Promise<T>): Promise<T> {
  let out!: T;
  await (await admin()).withSecurityRulesDisabled(async (ctx) => {
    out = await fn(ctx.firestore());
  });
  return out;
}
export const adminCount = (spaceId: string) => adminRun(async (db) => (await getDocs(collection(db, 'spaces', spaceId, 'records'))).size);
export const adminExists = (...segments: [string, ...string[]]) =>
  adminRun(async (db) => (await getDoc(doc(db, ...segments))).exists());
export async function disposeAdmin(): Promise<void> {
  await adminEnv?.cleanup();
  adminEnv = null;
}

// ---- Comptes de test ---------------------------------------------------------------------------------------------------

export interface TestUser {
  client: Client;
  uid: string;
  email: string;
  password: string;
}

let userCounter = 0;
export async function makeUser(label: string): Promise<TestUser> {
  userCounter += 1;
  const email = `takarda-e2e-${runId}-${userCounter}@example.test`;
  const password = `Pw-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`; // jetable, jamais affiché
  const client = newClient(label);
  const credential = await createUserWithEmailAndPassword(client.auth, email, password);
  return { client, uid: credential.user.uid, email, password };
}

/** Second « appareil » du même compte. */
export async function secondDevice(user: TestUser, label: string): Promise<Client> {
  const client = newClient(label);
  await signInWithEmailAndPassword(client.auth, user.email, user.password);
  return client;
}

/** Le compte existe-t-il encore ? (connexion depuis un client neuf) ; renvoie le code d'erreur sinon. */
export async function accountStatus(user: Pick<TestUser, 'email' | 'password'>): Promise<{ exists: boolean; code: string | null }> {
  const probe = newClient('sonde');
  try {
    await signInWithEmailAndPassword(probe.auth, user.email, user.password);
    return { exists: true, code: null };
  } catch (error) {
    return { exists: false, code: (error as { code?: string }).code ?? 'inconnu' };
  }
}

export const signInAnonymouslyOn = (client: Client) => signInAnonymously(client.auth);

export function claimsOf(idToken: string): Record<string, any> {
  return JSON.parse(Buffer.from(idToken.split('.')[1], 'base64url').toString('utf8'));
}

// ---- Données de test ---------------------------------------------------------------------------------------------------

export const personalSpace = (uid: string) => `personal_${uid}`;
export const recordDoc = (uid: string, over: Record<string, unknown> = {}) => ({
  kind: 'bien', values: { nom: 'Maison' }, statusKey: null, createdBy: uid, createdAt: '2026-10-14T10:00:00.000Z', updatedAt: '2026-10-14T10:00:00.000Z', rev: 1, deletedAt: null, ...over,
});
const SEED_BATCH = 20;

/** Crée, AVEC LES VRAIES RÈGLES et le vrai jeton du compte : profil, espace personnel et n enregistrements. */
export async function seedAccount(user: TestUser, n: number, prefix = 'r'): Promise<void> {
  const { db } = user.client;
  const now = '2026-10-14T10:00:00.000Z';
  await setDoc(doc(db, 'users', user.uid), { defaultSpaceId: personalSpace(user.uid), createdAt: now });
  await setDoc(doc(db, 'spaces', personalSpace(user.uid)), { ownerUid: user.uid, memberUids: [user.uid], name: 'Espace', createdAt: now, schemaVersion: 1 });
  await createRecords(user, n, prefix);
}

export async function createRecords(user: TestUser, n: number, prefix = 'r', client: Client = user.client): Promise<string[]> {
  const ids: string[] = [];
  for (let i = 0; i < n; i += SEED_BATCH) {
    const batch = writeBatch(client.db);
    for (let j = i; j < Math.min(n, i + SEED_BATCH); j += 1) {
      const id = `${prefix}${j}`;
      ids.push(id);
      batch.set(doc(client.db, 'spaces', personalSpace(user.uid), 'records', id), recordDoc(user.uid));
    }
    await batch.commit();
  }
  return ids;
}

// ---- Branchement de l'orchestration de suppression sur les clients réels (émulateurs) -------------------------------

/** Même enchaînement que services/firebase/accountDeletionApi.ts, sans le client applicatif (React Native / AsyncStorage). */
export function apiFor(user: TestUser, options: DeletionOptions = {}): AccountDeletionApi {
  const { auth, db } = user.client;
  return {
    reauthenticate: async (password) => {
      const current = auth.currentUser;
      if (!current || !current.email) throw Object.assign(new Error('aucune session'), { code: 'app/no-session' });
      await reauthenticateWithCredential(current, EmailAuthProvider.credential(current.email, password));
    },
    deleteCloudData: (uid) => deleteAccountCloudData(db, uid, options),
    deleteAuthAccount: async () => {
      if (!auth.currentUser) throw Object.assign(new Error('aucune session'), { code: 'app/no-session' });
      await deleteUser(auth.currentUser);
    },
  };
}

export function fakeLocal() {
  const released: string[] = [];
  const local: LocalCleanup = { release: async (uid) => (released.push(uid), { released: 1 }) };
  return { local, released };
}

export function runDeletion(user: TestUser, password: string, local: LocalCleanup, options: DeletionOptions = {}, timeouts?: DeletionTimeouts): Promise<DeletionOutcome> {
  return deleteAccount(apiFor(user, options), user.uid, password, local, timeouts);
}
