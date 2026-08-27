// Local persistence for the in-memory mock "database" (db.ts).
//
// db.ts's collections are plain arrays imported by reference across every
// service module — hydrateDb() and the autosave loop below mutate those same
// arrays in place (never reassign them), so every existing service function
// keeps working untouched. Templates are app-provided content and are
// intentionally excluded — they're re-seeded fresh from db.ts on every launch.

import { AppState, type AppStateStatus } from 'react-native';
import { storage } from './storage';
import {
  activityEvents,
  contributions,
  forms,
  groups,
  memberships,
  notifications,
  submissions,
  tontineCycles,
  users,
} from './db';

const SNAPSHOT_KEY = 'db_snapshot';
const AUTOSAVE_INTERVAL_MS = 3000;

const collections = {
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

type DbSnapshot = { [K in keyof typeof collections]: (typeof collections)[K] };

function replaceInPlace<T>(target: T[], next: T[] | undefined) {
  target.length = 0;
  if (next) target.push(...next);
}

/** Reads the last saved snapshot (if any) and repopulates every db.ts collection. Call once, before any store fetches. */
export async function hydrateDb(): Promise<void> {
  const snapshot = await storage.get<Partial<DbSnapshot>>(SNAPSHOT_KEY);
  if (!snapshot) return;
  for (const key of Object.keys(collections) as (keyof typeof collections)[]) {
    replaceInPlace(collections[key] as unknown[], snapshot[key] as unknown[] | undefined);
  }
}

async function persistNow(): Promise<void> {
  await storage.set(SNAPSHOT_KEY, collections);
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
