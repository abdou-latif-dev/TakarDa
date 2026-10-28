// Verrou unique partagé par l'envoi (syncEngine) et la réception (inbound) : jamais deux passes qui modifient en même temps la file,
// la référence et les données locales. Local, en mémoire, sans réseau.

import { beginEngineRun, endEngineRun } from './syncAccount';

let held = false;

/** Prend le verrou si libre ; retourne la fonction qui le libère, ou null s'il est déjà pris. */
export function tryAcquireSyncLock(): (() => void) | null {
  if (held) return null;
  held = true;
  beginEngineRun(); // un changement de compte attend la fin de cette exécution (voir syncAccount.ts)
  let released = false;
  return () => {
    if (released) return;
    released = true;
    held = false;
    endEngineRun();
  };
}

export const isSyncLockHeld = (): boolean => held;

/** Prend le verrou en attendant au plus `timeoutMs` (une exécution en cours se termine à sa prochaine opération) ; null si toujours pris. */
export async function acquireSyncLockWithin(timeoutMs: number, pollMs = 25): Promise<(() => void) | null> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const release = tryAcquireSyncLock();
    if (release) return release;
    if (Date.now() >= deadline) return null;
    await new Promise((resolve) => setTimeout(resolve, pollMs));
  }
}
