// Correction ou annulation d'un paiement de loyer DÉJÀ CONFIRMÉ dans le cloud — F2. Fine couche entre l'écran et le moteur (financialCorrection.ts) :
// vérifie la saisie en français, enregistre un NOUVEAU fait (le paiement initial n'est jamais modifié), puis demande l'envoi.
// Aucun réseau ici : l'envoi est fait par le moteur, après l'accalmie, comme pour toute modification locale.

import type { RecordItem } from '@/types/entities';
import { signalLocalDataChange } from './persistence';
import { adviseMutation } from './effectivePayments';
import { CorrectionError, correctionsOf, recordCorrection, type CorrectionType, type FinancialCorrection } from './sync/financialCorrection';
import { KIND } from './sync/kindRegistry';
import { getSyncAccount } from './sync/syncAccount';

export type { CorrectionType, FinancialCorrection };

export const REASON_MAX_LENGTH = 500;

/** Faut-il passer par une correction pour ce paiement ? Vrai seulement si un compte est actif ET que le paiement est déjà confirmé dans le cloud. */
export async function mustCorrectPayment(paiement: Pick<RecordItem, 'id' | 'toolId' | 'entityDefinitionId'>): Promise<boolean> {
  if (!getSyncAccount()) return false;
  const advice = await adviseMutation(paiement, 'edit');
  return !advice.allowed && advice.instead === 'correction';
}

/** Corrections et annulations déjà enregistrées pour ce paiement (chronologique). Sans compte actif : aucune. */
export async function paymentCorrectionHistory(paymentId: string): Promise<FinancialCorrection[]> {
  if (!getSyncAccount()) return [];
  return correctionsOf(paymentId);
}

export interface PaymentCorrectionInput {
  paymentId: string;
  type: CorrectionType;
  reason: string;
  /** Texte saisi du nouveau montant (type « correction »). */
  amountText?: string;
  /** Montant actuellement effectif : une correction identique est refusée. */
  currentAmount?: number | null;
}

export type PaymentCorrectionResult = { ok: true; correction: FinancialCorrection } | { ok: false; message: string };

/** Montant saisi : chiffres seulement (les espaces et « FCFA » sont tolérés) ; strictement positif. */
export function parseCorrectedAmount(text: string): number | null {
  const digits = text.replace(/[\s ]/g, '').replace(/fcfa$/i, '');
  if (!/^\d+$/.test(digits)) return null;
  const value = Number(digits);
  return Number.isSafeInteger(value) && value > 0 ? value : null;
}

/** Vérifie la saisie. Retourne le message à afficher, ou null si tout est correct. */
export function paymentCorrectionProblem(input: Pick<PaymentCorrectionInput, 'type' | 'reason' | 'amountText' | 'currentAmount'>): string | null {
  const reason = input.reason.trim();
  if (reason === '') return 'Indiquez le motif : il reste dans l’historique.';
  if (reason.length > REASON_MAX_LENGTH) return `Le motif est trop long (${REASON_MAX_LENGTH} caractères au plus).`;
  if (input.type === 'correction') {
    const amount = parseCorrectedAmount(input.amountText ?? '');
    if (amount === null) return 'Indiquez le nouveau montant en chiffres, supérieur à zéro. Pour annuler le paiement, choisissez « Annuler le paiement ».';
    if (input.currentAmount !== undefined && input.currentAmount !== null && amount === input.currentAmount) return 'Ce montant est déjà celui du paiement.';
  }
  return null;
}

/** Enregistre la correction ou l'annulation, puis demande l'envoi. Ne lève jamais : le résultat porte le message en français. */
export async function submitPaymentCorrection(input: PaymentCorrectionInput): Promise<PaymentCorrectionResult> {
  const problem = paymentCorrectionProblem(input);
  if (problem) return { ok: false, message: problem };
  try {
    const correction = await recordCorrection({
      kind: KIND.IMMOBILIER_CORRECTION_PAIEMENT,
      targetId: input.paymentId,
      type: input.type,
      reason: input.reason.trim(),
      correctedAmount: input.type === 'correction' ? (parseCorrectedAmount(input.amountText ?? '') ?? undefined) : undefined,
    });
    signalLocalDataChange(); // la correction vit dans le magasin du moteur : il n'y a pas de collection modifiée à détecter
    return { ok: true, correction };
  } catch (error) {
    if (error instanceof CorrectionError) {
      if (error.code === 'already_annulled') return { ok: false, message: 'Ce paiement est déjà annulé : une annulation est définitive.' };
      if (error.code === 'target_missing') return { ok: false, message: 'Ce paiement est introuvable.' };
      return { ok: false, message: error.message };
    }
    return { ok: false, message: 'Enregistrement impossible. Vos données n’ont pas été modifiées.' };
  }
}

/** Phrase d'historique d'une correction, pour l'affichage. */
export function describeCorrection(correction: FinancialCorrection, formatAmount: (value: number) => string): string {
  return correction.type === 'annulation'
    ? `Paiement annulé — motif : ${correction.reason}`
    : `Montant corrigé à ${correction.correctedAmount !== null ? formatAmount(correction.correctedAmount) : '—'} — motif : ${correction.reason}`;
}
