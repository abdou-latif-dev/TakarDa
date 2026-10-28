// Comptes cloud connus sur CET appareil — phase 7. Registre local (identifiants seulement, aucune donnée, aucun e-mail) alimenté à chaque
// connexion ET amorcé depuis les données techniques existantes (marques de propriétaire des enregistrements, contacts et activités, registre
// de propriété de la synchronisation) : un appareil qui a déjà servi à plusieurs comptes avant cette version est reconnu comme tel dès la première
// connexion. Il sert à reconnaître le contexte MULTI-COMPTE (voir moduleLock.ts) ; tant qu'un seul compte a été utilisé, rien ne change.
//
// Il est RESTRICTIF : si le registre ne peut pas être lu, ou si une écriture a échoué, il n'est plus « fiable » et le contexte multi-compte est
// présumé (jamais l'inverse). Jamais envoyé, jamais effacé automatiquement (un compte supprimé reste « connu » : prudence).

import { activityEvents, externalContacts, records } from './db';
import { storage } from './storage';
import { ownershipStore } from './sync/ownership';

const KEY = 'device_accounts';

let known = new Set<string>();
let hydrated = false;
let writeFailed = false;
let seedFailed = false;
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((l) => l());

/** Le registre est-il fiable ? Lu, jamais en échec d'écriture, et amorçage complet. Sinon le contexte multi-compte est présumé. */
export const isDeviceAccountsReliable = (): boolean => hydrated && !writeFailed && !seedFailed;
export const isDeviceAccountsHydrated = (): boolean => hydrated;
export const knownDeviceAccounts = (): string[] => [...known];

export function subscribeDeviceAccounts(listener: () => void): () => void {
  listeners.add(listener);
  return () => void listeners.delete(listener);
}

/** Comptes qui ont laissé une marque de propriétaire sur les données de l'appareil (lecture en mémoire, sans réseau). */
export function ownersMarkedOnData(): Set<string> {
  const found = new Set<string>();
  for (const item of [...records, ...externalContacts, ...activityEvents]) if (typeof item.cloudOwnerUid === 'string' && item.cloudOwnerUid) found.add(item.cloudOwnerUid);
  return found;
}

/** Lit le registre. En cas d'échec de lecture il reste « non lu » : le contexte multi-compte est alors présumé (prudence). */
export async function hydrateDeviceAccounts(): Promise<void> {
  if (hydrated) return;
  try {
    const stored = await storage.get<string[]>(KEY);
    known = new Set([...known, ...(Array.isArray(stored) ? stored.filter((u) => typeof u === 'string') : [])]);
    hydrated = true;
    notify();
  } catch {
    // illisible : on ne conclut pas à un seul compte
  }
}

/** Ajoute au registre les comptes révélés par les données techniques existantes. Une lecture impossible rend le registre non fiable. */
export async function seedDeviceAccountsFromData(): Promise<void> {
  await hydrateDeviceAccounts();
  if (!hydrated) return;
  const found = ownersMarkedOnData();
  try {
    for (const uid of Object.values((await ownershipStore.load()).owners)) if (typeof uid === 'string' && uid) found.add(uid);
    seedFailed = false;
  } catch {
    seedFailed = true; // registre de propriété illisible : on ne peut pas exclure d'autres comptes
  }
  const missing = [...found].filter((uid) => !known.has(uid));
  if (missing.length === 0) return;
  const next = new Set([...known, ...missing]);
  known = next; // en mémoire d'abord : le verrou est effectif même si l'écriture échoue
  notify();
  try {
    await storage.set(KEY, [...next]);
  } catch (error) {
    writeFailed = true;
    throw error;
  }
}

/** Enregistre un compte qui vient de se connecter sur cet appareil. Une écriture en échec garde le compte en mémoire et rend le registre non fiable. */
export async function registerDeviceAccount(uid: string): Promise<void> {
  await hydrateDeviceAccounts();
  if (!hydrated) return;
  const added = !known.has(uid);
  if (added) {
    known = new Set(known).add(uid); // en mémoire d'abord
    notify();
  }
  let failure: unknown = null;
  try {
    await seedDeviceAccountsFromData();
  } catch (error) {
    failure = error;
  }
  if (added) {
    try {
      await storage.set(KEY, [...known]);
      if (!failure) writeFailed = false;
    } catch (error) {
      writeFailed = true;
      failure = failure ?? error;
    }
  }
  if (failure) throw failure;
}

/** RÉSERVÉ AUX TESTS (simule un redémarrage : la mémoire est oubliée, le stockage reste). */
export function __resetDeviceAccountsForTests(): void {
  known = new Set();
  hydrated = false;
  writeFailed = false;
  seedFailed = false;
  listeners.clear();
}
