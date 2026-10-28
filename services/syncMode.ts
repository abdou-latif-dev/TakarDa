// Exclusion mutuelle entre la synchronisation V1 (collection `records`) et le nouveau moteur (`syncRecords`) — phases 6 et 7.
// Les deux flux portent sur les mêmes biens et logements : s'ils tournaient ensemble, ils enverraient et recevraient tout en double.
//
// Deux niveaux, tous deux SANS réseau :
//   1. en mémoire, ATOMIQUE : toutes les réservations sont synchrones (avant le premier `await`), donc deux démarrages « à proximité »
//      ne peuvent pas passer tous les deux ;
//   2. PERSISTANT, par compte : le marqueur « moteur choisi » survit au redémarrage. Dès qu'il existe, la V1 est refusée pour ce compte,
//      même si le moteur ne tourne pas (application relancée hors ligne). Il ne se pose que si la V1 n'est pas active pour ce compte.
//
// Règles : une opération V1 est refusée si le moteur tourne OU si le marqueur existe ; le moteur est refusé si une opération V1 est en cours,
// si la V1 est active pour le compte, ou si l'état V1 du compte n'a pas encore été lu (inconnu = refus : jamais de pari).
// Un refus ne modifie ni ne supprime rien : il est levé avant toute lecture ou écriture de données métier.

import { storage } from './storage';

export type SyncModeConflict = 'engine_active' | 'engine_chosen' | 'marker_unreadable' | 'v1_active' | 'v1_unknown';
export type EngineChoice = 'chosen' | 'not_chosen' | 'unreadable';

export class SyncModeError extends Error {
  constructor(readonly code: SyncModeConflict, message: string) {
    super(message);
    this.name = 'SyncModeError';
  }
}

const markerKey = (uid: string) => `sync_engine_mode_${uid}`;

const v1State = new Map<string, boolean>(); // compte → l'état V1 persisté existe-t-il ? (absent = pas encore lu)
const chosen = new Map<string, boolean>(); // compte → le marqueur « moteur choisi » existe-t-il ? (absent = pas encore lu)
let v1Ops = 0;
let engineUid: string | null = null;

/** Mémorise ce que l'on sait de l'état V1 persisté d'un compte (appelé à chaque lecture, écriture ou suppression de cet état). */
export function noteV1State(uid: string, active: boolean): void {
  v1State.set(uid, active);
}

export const isEngineClaimed = (): boolean => engineUid !== null;
export const isV1KnownActive = (uid: string): boolean | undefined => v1State.get(uid);

/**
 * État du marqueur pour ce compte : « choisi », « non choisi » ou « illisible ». Une lecture impossible n'est JAMAIS un choix : elle n'est pas mise en
 * cache et ne démarre pas le moteur (voir `isEngineChosen`), mais elle empêche la V1 de démarrer (voir `runV1Operation`) — jamais deux moteurs, jamais un
 * moteur démarré sans choix explicite.
 */
export async function readEngineChoice(uid: string): Promise<EngineChoice> {
  const known = chosen.get(uid);
  if (known !== undefined) return known ? 'chosen' : 'not_chosen';
  try {
    const present = (await storage.get<{ at: string }>(markerKey(uid))) !== null;
    if (chosen.get(uid) === undefined) chosen.set(uid, present);
    return chosen.get(uid) ? 'chosen' : 'not_chosen';
  } catch {
    return 'unreadable';
  }
}

/** Le moteur a-t-il été explicitement choisi pour ce compte ? (marqueur lu ET présent ; illisible = non) */
export const isEngineChosen = async (uid: string): Promise<boolean> => (await readEngineChoice(uid)) === 'chosen';

/**
 * Pose le marqueur « moteur choisi » pour ce compte. Refusé si la V1 est active (ou inconnue, ou en cours) : le moteur ne s'ajoute jamais à une V1
 * existante. La mémoire est mise à jour AVANT l'écriture : une opération V1 lancée pendant l'écriture est déjà refusée ; en cas d'échec d'écriture,
 * l'état est rétabli.
 */
export async function markEngineChosen(uid: string, now: Date = new Date()): Promise<void> {
  if (v1Ops > 0) throw new SyncModeError('v1_active', 'Une opération de la synchronisation V1 est en cours : le nouveau moteur ne peut pas être choisi maintenant.');
  const known = v1State.get(uid);
  if (known === undefined) throw new SyncModeError('v1_unknown', 'L’état de la synchronisation V1 de ce compte n’est pas connu : le nouveau moteur ne peut pas être choisi.');
  if (known) throw new SyncModeError('v1_active', 'La synchronisation V1 est active pour ce compte : le nouveau moteur n’est pas disponible. Aucune donnée n’a été modifiée.');
  const previous = chosen.get(uid);
  chosen.set(uid, true);
  try {
    await storage.set(markerKey(uid), { at: now.toISOString() });
  } catch (error) {
    if (previous === undefined) chosen.delete(uid);
    else chosen.set(uid, previous);
    throw error;
  }
}

/** Retire le marqueur (compte supprimé, état technique oublié). N'efface aucune donnée métier. */
export async function clearEngineChosen(uid: string): Promise<void> {
  chosen.set(uid, false);
  try {
    await storage.remove(markerKey(uid));
  } catch {
    chosen.delete(uid); // inconnu : la prochaine lecture tranchera
  }
}

/** Exécute une opération V1 sous réservation ; refus explicite si le moteur tourne ou si le moteur a été choisi pour ce compte. */
export async function runV1Operation<T>(uid: string, operation: () => Promise<T>): Promise<T> {
  if (engineUid !== null) throw new SyncModeError('engine_active', 'La synchronisation V1 est suspendue : le nouveau moteur de synchronisation est actif. Aucune donnée n’a été modifiée.');
  v1Ops += 1; // réservation synchrone : le moteur ne peut plus démarrer pendant cette opération
  try {
    const choice = await readEngineChoice(uid);
    if (choice === 'chosen') throw new SyncModeError('engine_chosen', 'La synchronisation V1 est désactivée pour ce compte : le nouveau moteur a été choisi. Aucune donnée n’a été modifiée.');
    if (choice === 'unreadable') throw new SyncModeError('marker_unreadable', 'Le choix de synchronisation de ce compte est illisible : la synchronisation V1 est suspendue par prudence. Aucune donnée n’a été modifiée.');
    if (engineUid !== null) throw new SyncModeError('engine_active', 'La synchronisation V1 est suspendue : le nouveau moteur de synchronisation est actif. Aucune donnée n’a été modifiée.');
    return await operation();
  } finally {
    v1Ops -= 1;
  }
}

/** Réserve le moteur pour un compte ; retourne la fonction de libération. Lève `SyncModeError` si la V1 est (ou peut être) active. */
export function claimEngine(uid: string): () => void {
  if (engineUid !== null) throw new SyncModeError('engine_active', 'Le moteur de synchronisation est déjà actif.');
  if (v1Ops > 0) throw new SyncModeError('v1_active', 'Une opération de la synchronisation V1 est en cours : le nouveau moteur ne démarre pas.');
  const known = v1State.get(uid);
  if (known === undefined) throw new SyncModeError('v1_unknown', 'L’état de la synchronisation V1 de ce compte n’est pas connu : le nouveau moteur ne démarre pas.');
  if (known) throw new SyncModeError('v1_active', 'La synchronisation V1 est active pour ce compte : le nouveau moteur ne démarre pas. Aucune donnée n’a été modifiée.');
  engineUid = uid;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    if (engineUid === uid) engineUid = null;
  };
}

/** RÉSERVÉ AUX TESTS : remet les réservations à zéro (et simule un redémarrage de l'application : la mémoire est oubliée, le stockage reste). */
export function __resetSyncModeForTests(): void {
  v1State.clear();
  chosen.clear();
  v1Ops = 0;
  engineUid = null;
}
