// Local persistence for the in-memory mock "database" (db.ts).
//
// db.ts's collections are plain arrays imported by reference across every
// service module — hydrateDb() and the autosave loop below mutate those same
// arrays in place (never reassign them), so every existing service function
// keeps working untouched. Templates are app-provided content and are
// intentionally excluded — they're re-seeded fresh from db.ts on every launch.
//
// LEGACY vs CORE, on purpose:
// The 9 legacy collections (Tontine + Forms) keep going through the exact same
// single-key `db_snapshot` blob as before — untouched, same shape, same
// behaviour, zero migration risk for installs that already have data there.
// The new Core collections (Tool/EntityDefinition/Record/...) are new data
// with nothing to migrate FROM, so they get their own per-collection keys
// from day one, plus a small schemaVersion + migrations mechanism reserved
// for future Core schema changes. See "TakarDa — Étape 1" report, §11/§12.

import { AppState, type AppStateStatus } from 'react-native';
import { storage } from './storage';
import { migrateLegacyTontines } from './tontineMigration';
import {
  activityEvents,
  contributions,
  defaultLocalUser,
  documents,
  entityDefinitions,
  events,
  externalContacts,
  forms,
  groups,
  memberships,
  notifications,
  records,
  roleDefinitions,
  submissions,
  tontineCycles,
  tools,
  toolMembers,
  tours,
  users,
  workflowRules,
} from './db';

const AUTOSAVE_INTERVAL_MS = 3000;

// ---- Espaces de travail : « personnel » (clés d'origine, JAMAIS modifiées) et « démonstration » (clés préfixées) ----
//
// L'espace de démonstration vit dans d'autres clés de stockage ('demo/db_snapshot', 'demo/core_*') : tant qu'il est actif, rien
// n'est écrit dans les clés personnelles. Le changement d'espace sauvegarde d'abord l'espace courant, SUSPEND l'enregistrement
// automatique, vide les collections en mémoire, charge l'autre espace, puis reprend. Si le chargement échoue, l'enregistrement
// reste suspendu : ainsi des collections vides ne peuvent jamais écraser des données réelles (un redémarrage recharge tout).

const DEMO_NAMESPACE = 'demo/';
/** Marqueur persistant « l'espace de démonstration est actif » : relu au démarrage, dans l'espace personnel (jamais préfixé). */
const DEMO_FLAG_KEY = 'demo_mode';

let namespace = '';
let persistPaused = false;
const nsKey = (base: string) => namespace + base;

export const isDemoWorkspace = (): boolean => namespace === DEMO_NAMESPACE;
export const isPersistencePaused = (): boolean => persistPaused;

// ---- Legacy: unchanged single-blob persistence ------------------------------

const LEGACY_SNAPSHOT_KEY = 'db_snapshot';

const legacyCollections = {
  users,
  groups,
  memberships,
  tontineCycles,
  tours,
  contributions,
  forms,
  submissions,
  activityEvents,
  notifications,
};

type LegacySnapshot = { [K in keyof typeof legacyCollections]: (typeof legacyCollections)[K] };

function replaceInPlace<T>(target: T[], next: T[] | undefined) {
  target.length = 0;
  if (next) target.push(...next);
}

async function hydrateLegacy(): Promise<void> {
  const snapshot = await storage.get<Partial<LegacySnapshot>>(nsKey(LEGACY_SNAPSHOT_KEY));
  if (!snapshot) return;
  for (const key of Object.keys(legacyCollections) as (keyof typeof legacyCollections)[]) {
    replaceInPlace(legacyCollections[key] as unknown[], snapshot[key] as unknown[] | undefined);
  }
}

async function persistLegacy(): Promise<void> {
  await storage.set(nsKey(LEGACY_SNAPSHOT_KEY), legacyCollections);
}

// ---- Core: versioned, per-collection persistence ----------------------------

const CORE_META_KEY = 'core_meta';
const CORE_KEY_PREFIX = 'core_';
const CURRENT_CORE_SCHEMA_VERSION = 1;

interface CoreMeta {
  schemaVersion: number;
}

/** Reserved for future Core schema changes — e.g. `2: (meta) => {...; return {...meta, schemaVersion: 2};}`.
 * Nothing needs migrating yet: schema version 1 is the first Core schema. */
const coreMigrations: Record<number, (meta: CoreMeta) => CoreMeta> = {};

const coreCollections = {
  tools,
  entity_definitions: entityDefinitions,
  records,
  tool_members: toolMembers,
  external_contacts: externalContacts,
  role_definitions: roleDefinitions,
  events,
  documents,
  workflow_rules: workflowRules,
};

async function hydrateCore(): Promise<void> {
  let meta = (await storage.get<CoreMeta>(nsKey(CORE_META_KEY))) ?? { schemaVersion: CURRENT_CORE_SCHEMA_VERSION };
  while (coreMigrations[meta.schemaVersion]) {
    meta = coreMigrations[meta.schemaVersion](meta);
  }
  await storage.set(nsKey(CORE_META_KEY), meta);

  const keys = Object.keys(coreCollections) as (keyof typeof coreCollections)[];
  const stored = await Promise.all(keys.map((key) => storage.get<unknown[]>(nsKey(CORE_KEY_PREFIX + key))));
  keys.forEach((key, i) => replaceInPlace(coreCollections[key] as unknown[], stored[i] ?? undefined));
}

async function persistCore(): Promise<void> {
  const keys = Object.keys(coreCollections) as (keyof typeof coreCollections)[];
  await Promise.all(keys.map((key) => storage.set(nsKey(CORE_KEY_PREFIX + key), coreCollections[key])));
}

// ---- Public API (unchanged names — app/_layout.tsx needs no changes) --------

/** Reads the last saved snapshot (if any) and repopulates every db.ts collection — legacy and Core. Call once, before any store fetches. */
export async function hydrateDb(): Promise<void> {
  await restoreWorkspace();
  await Promise.all([
    // migrateLegacyTontines() must run AFTER legacy data is loaded, and
    // before any screen reads groups/tours — it backfills Tour records for
    // any tontine that only has the old single TontineCycle (see
    // tontineMigration.ts for exactly what it does and does not invent).
    hydrateLegacy().then(migrateLegacyTontines),
    hydrateCore(),
  ]);
}

async function persistNow(): Promise<void> {
  if (persistPaused) return; // changement d'espace de travail en cours (ou échoué) : aucune écriture automatique
  await Promise.all([persistLegacy(), persistCore()]);
  notifyDataChanged();
}

// ---- Notification des changements enregistrés (déclenchement automatique de la synchronisation) -------------------------------------
//
// Les services modifient les collections EN PLACE : il n'existe pas de point unique « donnée modifiée ». L'enregistrement automatique, lui, est
// ce point unique. Quand quelqu'un écoute (le moteur de synchronisation, uniquement quand il tourne), on compare une empreinte des collections à la
// précédente et on prévient SEULEMENT s'il y a eu un changement. Sans écouteur, aucun calcul : le comportement actuel est inchangé.

const dataListeners = new Set<() => void>();
let lastSignature: string | null = null;

/** Empreinte rapide (FNV-1a 32 bits + longueur) du contenu de toutes les collections ; un changement la modifie avec une probabilité écrasante. */
function collectionsSignature(): string {
  const text = JSON.stringify(namedCollections);
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return `${text.length}:${(hash >>> 0).toString(16)}`;
}

function notifyDataChanged(): void {
  if (dataListeners.size === 0 || persistPaused) return;
  let signature: string;
  try {
    signature = collectionsSignature();
  } catch {
    return; // empreinte impossible : on ne prévient pas (le minuteur de réception du moteur reste le filet de sécurité)
  }
  const first = lastSignature === null;
  const changed = signature !== lastSignature;
  lastSignature = signature;
  if (first || !changed) return; // la première empreinte sert de référence : le démarrage du moteur fait déjà un cycle complet
  for (const listener of [...dataListeners]) {
    try {
      listener();
    } catch {
      // un écouteur défaillant ne doit jamais empêcher l'enregistrement ni les autres écouteurs
    }
  }
}

/**
 * Signale explicitement un changement local qui ne passe pas par les collections (ex. une correction financière, rangée dans le magasin propre au
 * moteur). Sans écouteur (moteur arrêté, drapeau fermé) : sans effet.
 */
export function signalLocalDataChange(): void {
  for (const listener of [...dataListeners]) {
    try {
      listener();
    } catch {
      // idem notifyDataChanged
    }
  }
}

/**
 * Appelle `listener` après un enregistrement automatique qui a CHANGÉ le contenu des collections (jamais pendant une suspension, par exemple
 * un changement d'espace). Retourne la fonction de désabonnement ; sans plus aucun écouteur, l'empreinte est oubliée et rien n'est calculé.
 */
export function subscribeDataChanges(listener: () => void): () => void {
  dataListeners.add(listener);
  return () => {
    dataListeners.delete(listener);
    if (dataListeners.size === 0) lastSignature = null;
  };
}

/** Enregistre maintenant l'espace courant (sans attendre le prochain cycle). Sans effet si l'enregistrement est suspendu. */
export const flushDb = (): Promise<void> => persistNow();

// ---- Identité de l'espace actif, instantané et remplacement des collections (sauvegarde / restauration) ----------------

/** Toutes les collections persistées, sous les noms utilisés par les sauvegardes (formTemplates est fourni par l'application : exclu). */
const namedCollections: Record<string, unknown[]> = {
  users,
  groups,
  memberships,
  tontineCycles,
  tours,
  contributions,
  forms,
  submissions,
  activityEvents,
  notifications,
  tools,
  entityDefinitions,
  records,
  toolMembers,
  externalContacts,
  roleDefinitions,
  events,
  documents,
  workflowRules,
};
export const COLLECTION_NAMES: readonly string[] = Object.keys(namedCollections);
export type CollectionsSnapshot = Record<string, unknown[]>;

/** Espace de travail actif : « personal » (données personnelles) ou « demo » (exemples, isolés). */
export const workspaceId = (): 'personal' | 'demo' => (namespace === DEMO_NAMESPACE ? 'demo' : 'personal');

/** Clé de stockage propre à l'espace actif : à utiliser pour toute donnée locale qui ne doit jamais se mélanger entre espaces. */
export const workspaceKey = (base: string): string => nsKey(base);

const cloneJson = <T,>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

/** Copie profonde de toutes les collections de l'espace actif. Lecture seule : ne modifie rien. */
export function snapshotCollections(): CollectionsSnapshot {
  return Object.fromEntries(COLLECTION_NAMES.map((name) => [name, cloneJson(namedCollections[name])]));
}

/**
 * Remplace, dans l'espace ACTIF, les seules collections fournies (les autres ne sont pas touchées), puis enregistre.
 * L'enregistrement automatique est suspendu pendant l'opération ; en cas d'échec, l'état précédent est rétabli en mémoire.
 * À n'appeler qu'après validation et sauvegarde de sécurité (voir services/backupService.ts).
 */
export async function replaceCollections(next: Partial<CollectionsSnapshot>): Promise<void> {
  if (persistPaused) throw new Error('L’enregistrement est suspendu : redémarrez l’application avant de remplacer des données.');
  const names = Object.keys(next);
  for (const name of names) {
    if (!(name in namedCollections)) throw new Error(`Collection inconnue : ${name}`);
    if (!Array.isArray(next[name])) throw new Error(`La collection « ${name} » doit être une liste.`);
  }
  const previous = snapshotCollections();
  persistPaused = true;
  try {
    for (const name of names) replaceInPlace(namedCollections[name], cloneJson(next[name]));
    if (users.length === 0) users.push(defaultLocalUser());
    await Promise.all([persistLegacy(), persistCore()]);
  } catch (error) {
    for (const name of COLLECTION_NAMES) replaceInPlace(namedCollections[name], previous[name]);
    try {
      await Promise.all([persistLegacy(), persistCore()]);
    } catch {
      // au mieux : la mémoire est rétablie ; le prochain enregistrement automatique réécrira l'état précédent
    }
    persistPaused = false;
    throw error;
  }
  persistPaused = false;
  notifyDataChanged(); // un remplacement (restauration, import) est un changement local comme un autre
}

/**
 * L'espace PERSONNEL contient-il déjà du travail (enregistrements, outils, tontines, formulaires, réponses, contacts) ? Sert à ne
 * JAMAIS considérer comme vide un espace qui contient des données : lecture impossible = « oui » (dans le doute, on protège).
 * Dans l'espace personnel, regarde la mémoire ; dans l'espace de démonstration, relit le stockage personnel sans y toucher.
 */
export async function personalWorkspaceHasData(): Promise<boolean> {
  const filled = (list: unknown): boolean => Array.isArray(list) && list.length > 0;
  if (namespace === '') return [records, tools, externalContacts, groups, forms, submissions].some(filled);
  try {
    const [storedRecords, storedTools, storedContacts] = await Promise.all(['records', 'tools', 'external_contacts'].map((key) => storage.get<unknown[]>(CORE_KEY_PREFIX + key)));
    const legacy = await storage.get<Partial<LegacySnapshot>>(LEGACY_SNAPSHOT_KEY);
    return [storedRecords, storedTools, storedContacts, legacy?.groups, legacy?.forms, legacy?.submissions].some(filled);
  } catch {
    return true;
  }
}

/** Au démarrage : l'espace de démonstration était-il actif ? Une lecture impossible = espace personnel (jamais l'inverse). */
async function restoreWorkspace(): Promise<void> {
  try {
    namespace = (await storage.get<boolean>(DEMO_FLAG_KEY)) === true ? DEMO_NAMESPACE : '';
  } catch {
    namespace = '';
  }
}

function clearCollections(): void {
  for (const collection of Object.values(legacyCollections)) replaceInPlace(collection as unknown[], undefined);
  replaceInPlace(users as unknown[], [defaultLocalUser()]);
  for (const collection of Object.values(coreCollections)) replaceInPlace(collection as unknown[], undefined);
}

/**
 * Passe de l'espace personnel à l'espace de démonstration (ou l'inverse). L'espace quitté est d'abord enregistré dans SES clés ;
 * l'autre espace est chargé depuis les siennes. Les données personnelles ne sont ni supprimées, ni migrées, ni écrasées.
 * En cas d'échec avant la bascule, rien n'a changé. Après la bascule, l'enregistrement reste suspendu (voir l'en-tête).
 */
export async function switchWorkspace(target: 'demo' | 'personal'): Promise<void> {
  const targetNamespace = target === 'demo' ? DEMO_NAMESPACE : '';
  if (namespace === targetNamespace) return;
  persistPaused = true;
  try {
    await Promise.all([persistLegacy(), persistCore()]); // l'espace courant est enregistré dans ses propres clés
  } catch (error) {
    persistPaused = false; // rien n'a changé : on reste dans l'espace courant
    throw error;
  }
  namespace = targetNamespace;
  lastSignature = null; // autre espace : la prochaine empreinte est une nouvelle référence (aucune fausse notification)
  clearCollections();
  await Promise.all([hydrateLegacy().then(migrateLegacyTontines), hydrateCore()]); // un échec laisse l'enregistrement suspendu
  if (target === 'demo') await storage.set(DEMO_FLAG_KEY, true);
  else await storage.remove(DEMO_FLAG_KEY);
  persistPaused = false;
}

/** Starts periodic + background-triggered autosave. Returns a cleanup function. */
export function startAutoPersist(): () => void {
  const interval = setInterval(() => {
    persistNow().catch(() => {});
  }, AUTOSAVE_INTERVAL_MS);

  const onAppStateChange = (state: AppStateStatus) => {
    if (state === 'background' || state === 'inactive') {
      persistNow().catch(() => {});
    }
  };
  const subscription = AppState.addEventListener('change', onAppStateChange);

  return () => {
    clearInterval(interval);
    subscription.remove();
  };
}
