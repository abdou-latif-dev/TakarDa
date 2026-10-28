// Harnais N2 : clients Firebase (Authentication + Firestore) branchés EXCLUSIVEMENT sur le projet de TEST « takarda-n2-test ».
// Aucun import de la configuration de production ni du client applicatif. Aucun compte de service, aucun accès « administrateur » :
// tout passe par des comptes jetables et les vraies règles. L'import de ce module échoue (RealGuardError) si l'environnement n'est
// pas exactement celui du projet de test. NON EXÉCUTÉ tant que N2 n'est pas autorisé.

import fs from 'fs';
import { deleteApp, initializeApp, type FirebaseApp } from 'firebase/app';
import {
  createUserWithEmailAndPassword,
  deleteUser,
  EmailAuthProvider,
  getAuth,
  reauthenticateWithCredential,
  signInWithEmailAndPassword,
  type Auth,
} from 'firebase/auth';
import { collection, doc, getDocFromServer, getDocsFromServer, getFirestore, setDoc, writeBatch, type Firestore } from 'firebase/firestore';
import { deleteAccount, type AccountDeletionApi, type DeletionOutcome, type DeletionTimeouts, type LocalCleanup } from '../../../accountDeletionService';
import { deleteAccountCloudData, type DeletionOptions } from '../../../firebase/firestoreAccountDeletion';
import {
  assertRealTestEnvironment,
  assertTokenBelongsToTestProject,
  DEFAULT_OPERATION_BUDGET,
  MAX_TEST_ACCOUNTS,
  parseWebConfig,
  RealGuardError,
  type WebConfig,
} from './guardsReal';
import { readProductionApiKeys } from './productionKeys';

function loadConfig(): WebConfig {
  const file = process.env.TAKARDA_TEST_FIREBASE_CONFIG_FILE;
  if (!file) throw new RealGuardError('TAKARDA_TEST_FIREBASE_CONFIG_FILE absent (fichier JSON des six valeurs publiques du projet de TEST, hors dépôt).');
  return parseWebConfig(JSON.parse(fs.readFileSync(file, 'utf8')));
}

export const N2 = assertRealTestEnvironment(process.env, loadConfig(), readProductionApiKeys());
export const runId = Math.random().toString(36).slice(2, 8);

/** Observation chiffrée à reporter dans docs/validation-firebase-test-RESULTATS.md (lue dans la sortie des tests). */
export const observe = (key: string, value: unknown): void => {
  console.log(`N2-OBS ${key} = ${JSON.stringify(value)}`);
};

// ---- Budget d'opérations (quotas du plan Spark) --------------------------------------------------------------------------
const budgetLimit = Math.min(Number(process.env.TAKARDA_N2_OPERATION_BUDGET) || DEFAULT_OPERATION_BUDGET, 20000);
let spent = 0;
/** Compte des opérations Firestore ESTIMÉES ; arrête l'exécution au-delà du budget (règle : jamais plus de 50 % d'un quota quotidien). */
export function spend(operations: number, label: string): void {
  spent += operations;
  if (spent > budgetLimit) throw new RealGuardError(`budget d'opérations dépassé (${spent} > ${budgetLimit}) à « ${label} » : ARRÊT.`);
}
export const operationsSpent = (): number => spent;

// ---- Clients et comptes --------------------------------------------------------------------------------------------------
export interface Client {
  label: string;
  app: FirebaseApp;
  auth: Auth;
  db: Firestore;
}
export interface TestUser {
  client: Client;
  uid: string;
  email: string;
  password: string;
}

const apps: FirebaseApp[] = [];
const users: TestUser[] = [];
let clientCounter = 0;
let userCounter = 0;

export function newClient(label: string): Client {
  clientCounter += 1;
  const app = initializeApp({ ...N2.config }, `n2-${runId}-${label}-${clientCounter}`);
  apps.push(app);
  return { label, app, auth: getAuth(app), db: getFirestore(app) };
}

export function claimsOf(idToken: string): Record<string, unknown> {
  return JSON.parse(Buffer.from(idToken.split('.')[1], 'base64url').toString('utf8'));
}

/** Compte jetable. Le jeton est contrôlé IMMÉDIATEMENT : audience et émetteur doivent être ceux du projet de test, sinon ARRÊT. */
export async function makeUser(label: string): Promise<TestUser> {
  if (users.length >= MAX_TEST_ACCOUNTS) throw new RealGuardError(`plafond de ${MAX_TEST_ACCOUNTS} comptes jetables atteint : ARRÊT.`);
  userCounter += 1;
  const email = `takarda-e2e-${runId}-${userCounter}@example.test`;
  const password = `Pw-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`; // jetable, gardé en mémoire, jamais affiché
  const client = newClient(label);
  const credential = await createUserWithEmailAndPassword(client.auth, email, password);
  const user: TestUser = { client, uid: credential.user.uid, email, password };
  users.push(user);
  try {
    assertTokenBelongsToTestProject(claimsOf(await credential.user.getIdToken()));
  } catch (error) {
    await deleteUser(credential.user).catch(() => undefined); // le compte vient d'être créé par nous : on le retire, puis on s'arrête
    throw error;
  }
  return user;
}

/** Second « appareil » du même compte. */
export async function secondDevice(user: TestUser, label: string): Promise<Client> {
  const client = newClient(label);
  await signInWithEmailAndPassword(client.auth, user.email, user.password);
  return client;
}

export async function accountStatus(user: Pick<TestUser, 'email' | 'password'>): Promise<{ exists: boolean; code: string | null }> {
  const probe = newClient('sonde');
  try {
    await signInWithEmailAndPassword(probe.auth, user.email, user.password);
    return { exists: true, code: null };
  } catch (error) {
    return { exists: false, code: (error as { code?: string }).code ?? 'inconnu' };
  }
}

// ---- Données de test (vraies règles, aucun accès administrateur) -----------------------------------------------------------
export const personalSpace = (uid: string) => `personal_${uid}`;
export const recordDoc = (uid: string, over: Record<string, unknown> = {}) => ({
  kind: 'bien', values: { nom: 'Maison' }, statusKey: null, createdBy: uid, createdAt: '2026-10-16T10:00:00.000Z', updatedAt: '2026-10-16T10:00:00.000Z', rev: 1, deletedAt: null, ...over,
});
export const spaceDoc = (uid: string, over: Record<string, unknown> = {}) => ({ ownerUid: uid, memberUids: [uid], name: 'Espace', createdAt: 'x', schemaVersion: 1, ...over });
const SEED_BATCH = 20;

export async function createRecords(user: TestUser, n: number, prefix = 'r', client: Client = user.client): Promise<string[]> {
  spend(n, 'création d’enregistrements');
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

/** Profil, espace personnel et n enregistrements (vraies règles, jeton du compte). */
export async function seedAccount(user: TestUser, n: number, prefix = 'r'): Promise<void> {
  spend(2, 'profil et espace');
  await setDoc(doc(user.client.db, 'users', user.uid), { defaultSpaceId: personalSpace(user.uid), createdAt: '2026-10-16T10:00:00.000Z' });
  await setDoc(doc(user.client.db, 'spaces', personalSpace(user.uid)), spaceDoc(user.uid));
  await createRecords(user, n, prefix);
}

/** Enregistrements lisibles par le PROPRIÉTAIRE (lecture serveur) ; impossible une fois l'espace supprimé : voir resurrectionCount. */
export async function ownerCount(user: TestUser, client: Client = user.client): Promise<number> {
  const size = (await getDocsFromServer(collection(client.db, 'spaces', personalSpace(user.uid), 'records'))).size;
  spend(size + 1, 'lecture');
  return size;
}

export async function spaceExists(user: TestUser, client: Client = user.client): Promise<boolean> {
  spend(1, 'lecture');
  return (await getDocFromServer(doc(client.db, 'spaces', personalSpace(user.uid)))).exists();
}

export async function profileExists(user: TestUser): Promise<boolean> {
  spend(1, 'lecture');
  return (await getDocFromServer(doc(user.client.db, 'users', user.uid))).exists();
}

/**
 * Détection d'orphelins SANS accès administrateur : recrée l'espace du compte puis liste ses enregistrements. Un enregistrement
 * resté sous le chemin d'un espace supprimé réapparaît alors (c'est la « résurrection »). Laisse l'espace recréé : l'appelant
 * doit relancer deleteAccountCloudData pour nettoyer.
 */
export async function resurrectionCount(user: TestUser): Promise<number> {
  await setDoc(doc(user.client.db, 'spaces', personalSpace(user.uid)), spaceDoc(user.uid));
  return ownerCount(user);
}

// ---- Suppression de bout en bout ---------------------------------------------------------------------------------------------
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

/** Supprime les données cloud d'un compte (réutilisable : le compte reste actif). Compte quelques opérations pour le budget. */
export async function wipeCloudData(user: TestUser, options: DeletionOptions = {}) {
  const report = await deleteAccountCloudData(user.client.db, user.uid, { timeoutMs: 20000, ...options });
  spend(report.records.found * 2 + 8, 'suppression');
  return report;
}

// ---- Nettoyage borné ----------------------------------------------------------------------------------------------------------
/**
 * Supprime UNIQUEMENT les comptes créés par cette exécution (données cloud puis compte), puis libère les clients.
 * Chaque étape est tentée indépendamment : l'échec de la suppression des données Firestore n'empêche PAS la tentative de
 * suppression du compte Authentication (sinon un compte resterait dans le projet de test). Toutes les erreurs sont conservées et
 * rapportées, avec l'identifiant du compte pour une purge manuelle éventuelle dans la console du projet de TEST.
 */
export async function cleanupAll(): Promise<{ accounts: number; failures: string[]; alreadyGone: string[] }> {
  const failures: string[] = [];
  // Comptes créés par CETTE exécution dont la connexion est refusée avec leurs propres identifiants (jetables, gardés en mémoire) : le
  // compte n'existe plus (supprimé par le scénario lui-même). Rapportés à part, pas comme un échec de nettoyage.
  const alreadyGone: string[] = [];
  const codeOf = (error: unknown) => (error as { code?: string } | null)?.code ?? 'erreur';
  for (const user of users.splice(0)) {
    const who = `${user.email} (${user.uid})`;
    try {
      if (!user.client.auth.currentUser) await signInWithEmailAndPassword(user.client.auth, user.email, user.password);
    } catch (error) {
      if (['auth/invalid-credential', 'auth/user-not-found'].includes(codeOf(error))) alreadyGone.push(`${who}: compte absent (supprimé par le scénario)`);
      else failures.push(`${who}: connexion impossible (${codeOf(error)}) — données et compte non nettoyés`);
      continue; // sans session, ni les données ni le compte ne peuvent être supprimés par le client
    }
    try {
      const report = await deleteAccountCloudData(user.client.db, user.uid, { timeoutMs: 20000 });
      if (!report.verified) failures.push(`${who}: données cloud non vérifiées (${report.error?.code ?? 'sans erreur'})`);
    } catch (error) {
      failures.push(`${who}: données cloud (${codeOf(error)})`);
    }
    try {
      if (user.client.auth.currentUser) await deleteUser(user.client.auth.currentUser); // tentée même si l'étape précédente a échoué
    } catch (error) {
      failures.push(`${who}: compte Authentication (${codeOf(error)})`);
    }
  }
  await Promise.all(apps.splice(0).map((app) => deleteApp(app).catch(() => undefined)));
  return { accounts: userCounter, failures, alreadyGone };
}
