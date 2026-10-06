import { UtilityBillingError, type UtilityBillingErrorCode } from '@/services/utilityBillingService';

const MESSAGES: Partial<Record<UtilityBillingErrorCode, string>> = {
  INDEX_INVALIDE: 'L’index doit être un nombre positif (chiffres uniquement).',
  PERIODE_INVALIDE: 'La période choisie n’est pas valide.',
  FOURNISSEUR_INVALIDE: 'Ce module n’est pas reconnu.',
  RELEVE_UTILISE: 'Ce relevé a déjà été utilisé dans une facture validée et ne peut plus être modifié.',
  RELEVE_INTROUVABLE: 'Ce relevé n’existe plus. Actualisez l’écran.',
  INDEX_ACTUEL_INFERIEUR: 'Cet index est inférieur au précédent. Corrigez-le avant de poursuivre.',
  PART_DEJA_PAYEE: 'Cette part est déjà payée.',
  PAIEMENT_EN_COURS: 'Un paiement est déjà en cours d’enregistrement. Patientez un instant.',
  PAIEMENT_IMMUTABLE: 'Un paiement enregistré ne peut pas être annulé.',
  PART_INTROUVABLE: 'Cette part n’existe plus. Actualisez l’écran.',
  FACTURE_DEJA_REPARTIE: 'Cette facture est déjà répartie.',
};

/** Message compréhensible pour un utilisateur non technique. Les erreurs métier
 * du moteur portent déjà un texte en français (nom du participant, etc.) ; toute
 * autre erreur devient un message générique — jamais une erreur technique brute. */
export function friendlyMessage(error: unknown): string {
  if (error instanceof UtilityBillingError) {
    if (Array.isArray(error.details) && error.details.length > 0) {
      const lines = (error.details as { message?: string }[]).map((d) => d.message).filter((m): m is string => !!m);
      if (lines.length > 0) return lines.join('\n');
    }
    if (error.code === 'RELEVE_DEJA_ENREGISTRE' || error.code === 'PARTICIPANT_INVALIDE' || error.code === 'PARTICIPANT_DEJA_PRESENT') return error.message;
    return MESSAGES[error.code] ?? error.message;
  }
  return 'Une erreur est survenue. Réessayez dans un instant.';
}

/** Valide la saisie d'un index tapé par l'utilisateur. Rien n'est transformé :
 * « -90 » ou « abc175 » sont refusés avec un message, jamais corrigés en silence. */
export function parseIndexInput(text: string | undefined): { empty: true } | { empty: false; value: number } | { empty: false; error: string } {
  const raw = (text ?? '').trim();
  if (!raw) return { empty: true };
  if (!/^\d+([.,]\d+)?$/.test(raw)) return { empty: false, error: 'Saisissez uniquement des chiffres (un index ne peut pas être négatif).' };
  return { empty: false, value: Number(raw.replace(',', '.')) };
}
