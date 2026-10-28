// Façade d'AFFICHAGE de la synchronisation — phase 6, étapes 4 et 6. Seul point par lequel les écrans et les stores de l'application lisent le
// moteur de synchronisation : états réels, bandeau, conflits (consultation et résolution). Elle ne démarre rien, n'envoie rien et n'importe
// ni le cycle, ni les transports, ni l'activation.
//
// Les états reprennent EXACTEMENT ceux de l'interface existante (`DisplaySync` / `BadgeState`, voir cloudSyncService.ts) : « synchronisé » n'est
// jamais produit sans confirmation du cloud (le moteur ne le dit qu'une fois la référence égale au contenu local).

import type { BadgeState } from './cloudSyncService';
import { resolveConflict, restoreTombstone, type InboundEnv, type Resolution } from './sync/inbound';
import { createDefaultApplier } from './sync/localApplier';
import { requireSyncAccount } from './sync/syncAccount';
import type { CycleStatus } from './sync/syncCycle';
import { listOpenConflicts } from './sync/conflictView';
import { bannerModel, engineStatus, type BannerModel, type EngineDisplayState, type EngineStatusSummary } from './sync/syncStatusView';

export { availableResolutions, listOpenConflicts, listRecoverableDeletions, listResolvedConflicts, viewConflict } from './sync/conflictView';
export type { ConflictView, RecoverableDeletion, ResolutionName, ResolutionOption, ResolutionOptions } from './sync/conflictView';
export { adoptLegacyData, previewLegacyAdoption } from './sync/legacyAdoption';
export type { AdoptionPreview, AdoptionResult } from './sync/legacyAdoption';
export { bannerModel, engineStatus };
export type { BannerModel, EngineDisplayState, EngineStatusSummary };
export type { CycleStatus };

/**
 * Pastille d'un élément. « En cours » seulement quand le cycle tourne ET que l'élément attend l'envoi ; « synchronisé » seulement si le moteur
 * l'a établi. Un élément inconnu du moteur est « local » (jamais « synchronisé » par défaut).
 */
export function badgeStateFor(state: EngineDisplayState | undefined, cycle: CycleStatus | null): BadgeState {
  const s: EngineDisplayState = state ?? 'local';
  if (s === 'pending' && cycle === 'running') return 'syncing';
  return s;
}

/** Pause globale (hors ligne, limite quotidienne, pause après échecs, non activée…) : l'état par élément ne change pas, le bandeau l'explique. */
export const isPausedCycle = (cycle: CycleStatus | null): boolean => cycle === 'offline' || cycle === 'quota_paused' || cycle === 'paused_errors' || cycle === 'backoff' || cycle === 'suspended' || cycle === 'not_activated';

// ---- Décisions (étape 6) ------------------------------------------------------------------------------------------------------------
// Seules les décisions que le moteur accepte sont transmises ; un refus est expliqué, jamais contourné. Le moteur conserve l'historique
// (version écartée comprise). Rien n'est envoyé au cloud ici : la décision est appliquée localement, puis le cycle l'enverra s'il y a lieu.

export type DecisionOutcome = { ok: true } | { ok: false; message: string };
export type ConflictDecision = Resolution;

const engineEnv = (): InboundEnv => {
  const ownerUid = requireSyncAccount();
  return { ownerUid, applier: createDefaultApplier(ownerUid), now: new Date() };
};

const messageOf = (error: unknown): string => (error instanceof Error ? error.message : 'Décision impossible.');

export async function decideConflict(recordId: string, decision: ConflictDecision): Promise<DecisionOutcome> {
  try {
    const open = (await listOpenConflicts()).find((c) => c.recordId === recordId);
    if (!open) return { ok: false, message: 'Ce conflit n’est plus ouvert.' };
    const option = open.options[decision.type];
    if (!option.allowed) return { ok: false, message: option.reason ?? 'Cette décision n’est pas permise.' };
    await resolveConflict(recordId, decision, engineEnv());
    return { ok: true };
  } catch (error) {
    return { ok: false, message: messageOf(error) };
  }
}

export async function restoreDeletion(recordId: string): Promise<DecisionOutcome> {
  try {
    await restoreTombstone(recordId, engineEnv());
    return { ok: true };
  } catch (error) {
    return { ok: false, message: messageOf(error) };
  }
}
