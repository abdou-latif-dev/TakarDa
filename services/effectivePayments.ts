// Façade des paiements EFFECTIFS — phase 6, étape 5. Les totaux d'Immobilier (rapport, statistiques, loyers dus, impayés, avances, accueil)
// lisent les paiements par cette façade : sans compte de synchronisation actif ou sans correction enregistrée, ce sont EXACTEMENT les mêmes
// enregistrements (même tableau, aucun accès au stockage sans compte) ; avec corrections, des copies en mémoire (annulé → `rejete`, corrigé →
// montant remplacé). Les formules des totaux ne changent pas. Les suppressions en cascade lisent les enregistrements réels, jamais cette vue.

import type { RecordItem } from '@/types/entities';
import { correctionStore } from './sync/financialCorrection';
import { adviseFinancialMutation, effectivePaiements, financialBlockers, isAnnulledPayment, type FinancialAction, type FinancialMutationAdvice } from './sync/financialView';
import { getSyncAccount } from './sync/syncAccount';

/** Ce paiement (issu de `effectivePaiementsFor`) est-il annulé par une annulation explicite ? */
export { isAnnulledPayment };

export async function effectivePaiementsFor(paiements: RecordItem[]): Promise<RecordItem[]> {
  if (!getSyncAccount()) return paiements;
  const corrections = Object.values((await correctionStore.load()).items);
  return corrections.length === 0 ? paiements : effectivePaiements(paiements, corrections);
}

export const adviseMutation = (record: Pick<RecordItem, 'id' | 'toolId' | 'entityDefinitionId'>, action: FinancialAction): Promise<FinancialMutationAdvice> => adviseFinancialMutation(record, action);

/** Message d'interdiction si l'un des faits financiers s'oppose à la suppression ; null sinon. */
export async function deletionBlockedReason(records: readonly Pick<RecordItem, 'id' | 'toolId' | 'entityDefinitionId'>[]): Promise<string | null> {
  const blocked = await financialBlockers(records);
  return blocked.length === 0 ? null : 'Des paiements déjà confirmés dans le cloud empêchent cette suppression : annulez-les par une annulation explicite.';
}
