// Activation de la synchronisation SANS envoi rétroactif — phase 6, étape 2. Local, sans réseau.
//
// Règle unique : ce qui existe sur l'appareil AVANT l'activation reste LOCAL. L'activation enregistre, PAR COMPTE et UNE SEULE FOIS :
//   - `enabledAt`  : l'instant d'activation ; jamais réinitialisé (reconnexion, redémarrage, changement de compte, réactivation) ;
//   - `legacyIds`  : la photographie des identifiants de TOUS les éléments présents à cet instant (robuste à une date de création fausse ou
//                    antidatée : un élément ancien reste ancien, même modifié après l'activation) ;
//   - `adoptedIds` : ADOPTION VOLONTAIRE (F2, voir legacyAdoption.ts : aperçu, confirmation explicite, sauvegarde vérifiée). Vide à l'activation ;
//                    seule cette action le remplit, jamais le moteur ni ce module.
// Sont exclus de la capture, de la planification et de l'envoi : les éléments de `legacyIds` (sauf adoptés ou déjà confirmés par le cloud) ET
// ceux qui en DÉPENDENT (un nouveau paiement d'un ancien contrat, un nouveau contrat d'un ancien locataire…) : une dépendance historique n'est
// donc jamais envoyée indirectement, et ses dépendants restent locaux (pas « en attente » pour toujours).
// Rien n'est jamais écrit dans les données métier.

import { snapshotCollections, workspaceId } from '../persistence';
import { collectSyncableItems, type LocalItem } from './changeScanner';
import { correctionStore } from './financialCorrection';
import { getKindDefinition } from './kindRegistry';
import { createPersistentStore } from './localStore';
import { ownerOf, ownershipStore, usableBy } from './ownership';
import { extractReferences } from './relationManifest';
import { requireSyncAccount } from './syncAccount';
import { tryAcquireSyncLock } from './syncLock';
import type { BaselineStore } from './syncQueue';

export type ActivationErrorCode = 'not_activated' | 'demo_workspace' | 'busy';

export class SyncActivationError extends Error {
  constructor(readonly code: ActivationErrorCode, message: string) {
    super(message);
    this.name = 'SyncActivationError';
  }
}

export interface ActivationData {
  schemaVersion: 1;
  /** null = jamais activée pour ce compte. */
  enabledAt: string | null;
  /** Identifiants présents sur l'appareil à l'activation (hors éléments d'un autre compte) : ANCIENS pour toujours. */
  legacyIds: string[];
  /** Anciennes données explicitement adoptées par l'utilisateur (legacyAdoption.ts) : vide à l'activation. */
  adoptedIds: string[];
}

export function validateActivation(value: unknown): string[] {
  if (!value || typeof value !== 'object') return ['activation illisible'];
  const a = value as Record<string, unknown>;
  if (a.schemaVersion !== 1) return ['version inconnue'];
  if (a.enabledAt !== null && (typeof a.enabledAt !== 'string' || Number.isNaN(Date.parse(a.enabledAt)))) return ['instant d’activation invalide'];
  for (const key of ['legacyIds', 'adoptedIds'] as const) if (!Array.isArray(a[key]) || (a[key] as unknown[]).some((x) => typeof x !== 'string')) return [`${key} invalide`];
  if (a.enabledAt === null && ((a.legacyIds as string[]).length > 0 || (a.adoptedIds as string[]).length > 0)) return ['données sans instant d’activation'];
  return [];
}

/** Propre au compte actif (clé `sync_activation@<uid>`) : un compte n'hérite jamais de l'activation d'un autre. Illisible = jamais réinitialisé. */
export const activationStore = createPersistentStore<ActivationData>({
  baseKey: 'sync_activation',
  name: 'activation de la synchronisation',
  empty: () => ({ schemaVersion: 1, enabledAt: null, legacyIds: [], adoptedIds: [] }),
  validate: validateActivation,
});

let required = true;

/** Activation obligatoire pour capturer, envoyer et recevoir (toujours, en production). */
export const activationRequired = (): boolean => required;

/**
 * RÉSERVÉ AUX TESTS du moteur générique (file, fusion, conflits, transports…) qui n'ont pas à rejouer l'activation : `false` suspend
 * l'obligation. Aucun code de production ne l'appelle (un test statique le vérifie) ; `syncActivation.test.ts` tourne en mode strict.
 */
export function __useActivationForTests(requireActivation: boolean): void {
  required = requireActivation;
}

export async function getActivation(): Promise<ActivationData> {
  return activationStore.load();
}

export async function isActivated(): Promise<boolean> {
  return (await activationStore.load()).enabledAt !== null;
}

/** Activation du compte actif : lève `not_activated` sinon. Sans obligation (tests), ne fait rien. */
export async function requireActivation(): Promise<ActivationData | null> {
  if (!required) return null;
  const data = await activationStore.load();
  if (data.enabledAt === null) throw new SyncActivationError('not_activated', 'La synchronisation n’est pas activée pour ce compte : rien n’est capturé, envoyé ni reçu.');
  return data;
}

export interface ActivationResult {
  /** Vrai seulement à la PREMIÈRE activation de ce compte ; une reconnexion ou un redémarrage retrouve l'activation existante. */
  created: boolean;
  data: ActivationData;
}

/**
 * Active la synchronisation du compte actif. IDEMPOTENTE : si le compte a déjà une activation, elle est retournée telle quelle (l'instant et la
 * liste d'anciens éléments ne changent jamais). Sinon, photographie les éléments présents (visibles pour ce compte) et enregistre l'instant.
 * N'envoie rien, ne marque rien, n'écrit pas dans les données métier. Refusée dans l'espace de démonstration.
 */
export async function activateSync(now: Date = new Date()): Promise<ActivationResult> {
  if (workspaceId() !== 'personal') throw new SyncActivationError('demo_workspace', 'La démonstration n’active jamais la synchronisation.');
  const account = requireSyncAccount();
  const release = tryAcquireSyncLock(); // aucune capture en même temps, et un changement de compte attend la fin
  if (!release) throw new SyncActivationError('busy', 'Une synchronisation est en cours : réessayez dans un instant.');
  try {
    const existing = await activationStore.load();
    if (existing.enabledAt !== null) return { created: false, data: existing };
    const corrections = Object.values((await correctionStore.load()).items) as unknown as Record<string, unknown>[];
    const { items } = collectSyncableItems(snapshotCollections(), corrections);
    const owners = (await ownershipStore.load()).owners;
    const present = items.filter((i) => getKindDefinition(i.kind).source.type === 'store' || usableBy(ownerOf(owners, i.kind, i.item), account)).map((i) => i.id);
    const next: ActivationData = { schemaVersion: 1, enabledAt: now.toISOString(), legacyIds: [...new Set(present)].sort(), adoptedIds: [] };
    // une seule écriture ; si une activation est apparue entre-temps (jamais, sous le verrou), elle prévaut : l'instant n'est jamais écrasé
    const written = await activationStore.update((current) => (current.enabledAt !== null ? current : next));
    return { created: written === next, data: written };
  } finally {
    release();
  }
}

export interface LegacyFilterResult {
  allowed: LocalItem[];
  /** id → motif : « legacy » (antérieur à l'activation) ou « depends_on_legacy » (dépend d'un ancien élément non confirmé). */
  excluded: Map<string, 'legacy' | 'depends_on_legacy'>;
}

/**
 * Retire les éléments antérieurs à l'activation (sauf adoptés ou déjà confirmés par le cloud) et, de proche en proche, ceux qui en dépendent.
 * Pur : ne modifie rien.
 */
export function applyLegacyFilter(items: readonly LocalItem[], activation: ActivationData, baseline: BaselineStore): LegacyFilterResult {
  const legacy = new Set(activation.legacyIds);
  for (const id of activation.adoptedIds) legacy.delete(id);
  const excluded = new Map<string, 'legacy' | 'depends_on_legacy'>();
  for (const item of items) if (legacy.has(item.id) && !baseline.entries[item.id]) excluded.set(item.id, 'legacy');
  let changed = true;
  while (changed) {
    changed = false;
    for (const item of items) {
      if (excluded.has(item.id) || baseline.entries[item.id]) continue;
      const dependsOnExcluded = extractReferences(item.kind, item.item).some((ref) => ref.targetKind !== null && excluded.has(ref.id) && !baseline.entries[ref.id]);
      if (dependsOnExcluded) {
        excluded.set(item.id, 'depends_on_legacy');
        changed = true;
      }
    }
  }
  return { allowed: items.filter((i) => !excluded.has(i.id)), excluded };
}
