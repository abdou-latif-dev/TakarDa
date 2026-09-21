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
import {
  activityEvents,
  contributions,
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
  toolMembers,
  tools,
  users,
  workflowRules,
} from './db';

const AUTOSAVE_INTERVAL_MS = 3000;

// ---- Legacy: unchanged single-blob persistence ------------------------------

const LEGACY_SNAPSHOT_KEY = 'db_snapshot';

const legacyCollections = {
  users,
  groups,
  memberships,
  tontineCycles,
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
  const snapshot = await storage.get<Partial<LegacySnapshot>>(LEGACY_SNAPSHOT_KEY);
  if (!snapshot) return;
  for (const key of Object.keys(legacyCollections) as (keyof typeof legacyCollections)[]) {
    replaceInPlace(legacyCollections[key] as unknown[], snapshot[key] as unknown[] | undefined);
  }
}

async function persistLegacy(): Promise<void> {
  await storage.set(LEGACY_SNAPSHOT_KEY, legacyCollections);
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
  let meta = (await storage.get<CoreMeta>(CORE_META_KEY)) ?? { schemaVersion: CURRENT_CORE_SCHEMA_VERSION };
  while (coreMigrations[meta.schemaVersion]) {
    meta = coreMigrations[meta.schemaVersion](meta);
  }
  await storage.set(CORE_META_KEY, meta);

  const keys = Object.keys(coreCollections) as (keyof typeof coreCollections)[];
  const stored = await Promise.all(keys.map((key) => storage.get<unknown[]>(CORE_KEY_PREFIX + key)));
  keys.forEach((key, i) => replaceInPlace(coreCollections[key] as unknown[], stored[i] ?? undefined));
}

async function persistCore(): Promise<void> {
  const keys = Object.keys(coreCollections) as (keyof typeof coreCollections)[];
  await Promise.all(keys.map((key) => storage.set(CORE_KEY_PREFIX + key, coreCollections[key])));
}

// ---- Public API (unchanged names — app/_layout.tsx needs no changes) --------

/** Reads the last saved snapshot (if any) and repopulates every db.ts collection — legacy and Core. Call once, before any store fetches. */
export async function hydrateDb(): Promise<void> {
  await Promise.all([hydrateLegacy(), hydrateCore()]);
}

async function persistNow(): Promise<void> {
  await Promise.all([persistLegacy(), persistCore()]);
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
