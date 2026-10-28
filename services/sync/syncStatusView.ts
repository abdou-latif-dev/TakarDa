// États de synchronisation RÉELS (moteur) dans la forme que l'interface existante consomme déjà — P5. Lecture seule, sans réseau.
//
// L'interface actuelle (SyncBadge, SyncBanner, store du compte) lit : un état par enregistrement (`local | pending | synced | conflict | error`,
// + « synchronisation en cours »), un nombre en attente, la liste des conflits. Ce module calcule exactement ces données à partir du moteur
// (file, référence, conflits, suppressions reçues), sans rien changer à l'écran : brancher l'interface = alimenter les mêmes champs.
// Seule nouveauté : les suppressions RÉCUPÉRABLES (éléments retirés ici après une suppression ailleurs) — l'élément n'existe plus dans les
// listes, donc elles ne sont pas un état de badge mais une liste et un compteur à part (voir `conflictView.ts` pour les décisions).
//
// ISOLATION : seuls les éléments utilisables par le compte actif sont considérés (jamais ceux d'un autre compte). Sans compte : rien.

import { conflictStore } from './inboundStores';
import { createDefaultApplier } from './localApplier';
import { listRecoverableDeletions, type RecoverableDeletion } from './conflictView';
import { getSyncAccount } from './syncAccount';
import { ownerOf, ownershipStore } from './ownership';
import { baselineStore, queueStore } from './syncQueue';
import { evaluateScope } from './syncScope';
import type { CycleStatus, SyncCycleState } from './syncCycle';

/** Mêmes valeurs que `DisplaySync` du mécanisme actuel (cloudSyncService.ts), pour que les composants existants s'appliquent tels quels. */
export type EngineDisplayState = 'local' | 'pending' | 'synced' | 'conflict' | 'error';

export interface EngineStatusSummary {
  account: string | null;
  /** Un état par élément du compte (les anciens éléments sans propriétaire sont « local »). */
  states: Record<string, EngineDisplayState>;
  /** Éléments en attente d'envoi, y compris les modifications locales pas encore capturées. */
  pending: number;
  conflicts: string[];
  errors: string[];
  recoverable: RecoverableDeletion[];
}

const empty = (): EngineStatusSummary => ({ account: null, states: {}, pending: 0, conflicts: [], errors: [], recoverable: [] });

/** État réel de chaque élément du compte actif. Ne modifie rien ; sans compte, rien n'est visible. */
export async function engineStatus(): Promise<EngineStatusSummary> {
  const account = getSyncAccount();
  if (!account) return empty();
  const [items, queue, baseline, conflicts, owners] = await Promise.all([
    createDefaultApplier(account).snapshot(),
    queueStore.load(),
    baselineStore.load(),
    conflictStore.load(),
    ownershipStore.load(),
  ]);
  const states: Record<string, EngineDisplayState> = {};
  const outOfScope = new Set(evaluateScope(items).excluded.map((e) => e.id)); // hors périmètre : toujours « local », jamais en attente
  for (const item of items) {
    if (outOfScope.has(item.id) && !queue.ops[item.id] && !baseline.entries[item.id] && !conflicts.open[item.id]) {
      states[item.id] = 'local';
      continue;
    }
    const op = queue.ops[item.id];
    const known = baseline.entries[item.id];
    let state: EngineDisplayState;
    if (conflicts.open[item.id] || op?.block?.reason === 'conflict') state = 'conflict';
    else if (op?.block?.reason === 'permanent_error') state = 'error';
    else if (op) state = 'pending';
    else if (known) state = known.hash === item.hash ? 'synced' : 'pending'; // modifié mais pas encore capturé : déjà « en attente »
    else state = ownerOf(owners.owners, item.kind, item.item) === account ? 'pending' : 'local'; // créé depuis l'activation, ou ancien élément
    states[item.id] = state;
  }
  // un conflit sur un élément absent localement (supprimé ici, modifié ailleurs) compte aussi
  for (const id of Object.keys(conflicts.open)) states[id] = 'conflict';
  const ids = Object.keys(states);
  return {
    account,
    states,
    pending: ids.filter((id) => states[id] === 'pending').length,
    conflicts: ids.filter((id) => states[id] === 'conflict').sort(),
    errors: ids.filter((id) => states[id] === 'error').sort(),
    recoverable: await listRecoverableDeletions(),
  };
}

export interface BannerModel {
  /** Texte de synthèse, dans le ton de l'interface actuelle. */
  summary: string;
  tone: 'ok' | 'pending' | 'attention' | 'paused';
  pending: number;
  conflicts: number;
  errors: number;
  recoverable: number;
}

const PAUSED: Partial<Record<CycleStatus, string>> = {
  not_activated: 'Synchronisation non activée : vos données restent locales',
  offline: 'Hors ligne : la synchronisation reprendra au retour du réseau',
  backoff: 'Nouvelle tentative programmée',
  quota_paused: 'Limite quotidienne atteinte : la synchronisation reprend demain',
  paused_errors: 'Synchronisation en pause après plusieurs échecs : appuyez sur « Synchroniser maintenant »',
  suspended: 'Service temporairement suspendu : vos données restent sur cet appareil et partiront au retour du service',
};

/** Texte et ton du bandeau, à partir de l'état réel et de l'état du cycle (jamais « synchronisé » tant qu'il reste quelque chose). */
export function bannerModel(summary: EngineStatusSummary, cycle: Pick<SyncCycleState, 'status'> | null = null): BannerModel {
  const base = { pending: summary.pending, conflicts: summary.conflicts.length, errors: summary.errors.length, recoverable: summary.recoverable.length };
  const status = cycle?.status ?? 'idle';
  if (status === 'running') return { ...base, summary: 'Synchronisation…', tone: 'pending' };
  if (base.conflicts > 0) return { ...base, summary: `${base.conflicts} conflit(s) à résoudre`, tone: 'attention' };
  if (base.errors > 0) return { ...base, summary: `${base.errors} élément(s) refusé(s) par le cloud`, tone: 'attention' };
  const paused = PAUSED[status];
  if (paused) return { ...base, summary: base.pending > 0 ? `${base.pending} en attente d’envoi — ${paused}` : paused, tone: 'paused' };
  if (base.pending > 0) return { ...base, summary: `${base.pending} en attente d’envoi`, tone: 'pending' };
  if (base.recoverable > 0) return { ...base, summary: `${base.recoverable} suppression(s) reçue(s), récupérable(s)`, tone: 'attention' };
  return { ...base, summary: 'Tout est synchronisé', tone: 'ok' };
}
