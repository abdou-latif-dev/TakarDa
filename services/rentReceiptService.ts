// Reçu de paiement de loyer partageable (texte pour WhatsApp / SMS, via le partage natif).
//
// Fonctions PURES : le reçu est calculé à partir de l'enregistrement du paiement et des données déjà figées ; le
// partager ne modifie rien. La référence vient de l'identifiant du paiement : elle est identique à chaque ouverture
// ou partage du même reçu. Une information absente n'est jamais inventée : la ligne correspondante est omise.
// Pas de PDF ni de tableur ici (prévus pour une version ultérieure).

import { computeUnpaidDueMonths, formatDay } from './immobilierService';
import type { FieldValue, RecordItem } from '@/types/entities';

const MOIS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];
const text = (v: FieldValue | undefined): string => (typeof v === 'string' ? v.trim() : '');

const monthLabel = (mois: string): string => {
  const m = /^(\d{4})-(\d{2})$/.exec(mois);
  return m ? `${MOIS[Number(m[2]) - 1] ?? mois} ${m[1]}` : mois;
};
const fcfa = (n: number): string => `${Math.round(n).toLocaleString('fr-FR')} FCFA`;

/** Référence stable du reçu : dérivée de l'identifiant du paiement (jamais régénérée). */
export function receiptReference(paiementId: string): string {
  const core = paiementId.replace(/[^A-Za-z0-9]/g, '').slice(-8).toUpperCase();
  return `TKD-${core || '00000000'}`;
}

export interface RentReceiptInput {
  /** Un VRAI paiement (statut `paye`). Un mois couvert par l'avance n'a pas de reçu. */
  paiement: RecordItem;
  contrat: RecordItem;
  /** Tous les enregistrements de paiement du contrat (pour la situation à la date du paiement). */
  paiementsDuContrat: readonly RecordItem[];
  locataireNom?: string | null;
  logementNom?: string | null;
  bienNom?: string | null;
  /** Nom du propriétaire (profil local). Omis s'il n'est pas renseigné. */
  bailleurNom?: string | null;
}

/** Situation des loyers à la date du paiement : mois entièrement écoulés encore impayés, en ne regardant que les
 * paiements enregistrés avant celui-ci — le reçu ne change donc pas quand d'autres paiements suivent. */
export function arrearsAtPayment(contrat: RecordItem, paiement: RecordItem, paiementsDuContrat: readonly RecordItem[]): number | null {
  const day = text(paiement.values.date_validation);
  const when = /^\d{4}-\d{2}-\d{2}/.test(day) ? new Date(`${day.slice(0, 10)}T12:00:00`) : null;
  if (!when || Number.isNaN(when.getTime())) return null;
  const before = paiementsDuContrat.filter((p) => p.id === paiement.id || p.createdAt < paiement.createdAt);
  return computeUnpaidDueMonths(contrat, before as RecordItem[], when).length;
}

export function buildRentReceiptText(input: RentReceiptInput): string {
  const { paiement, contrat } = input;
  const montant = typeof paiement.values.montant === 'number' ? paiement.values.montant : null;
  const mois = text(paiement.values.mois);
  const date = text(paiement.values.date_validation);
  const mode = text(paiement.values.mode_paiement);
  const locataire = text(input.locataireNom ?? '');
  const logement = text(input.logementNom ?? '');
  const bien = text(input.bienNom ?? '');
  const bailleur = text(input.bailleurNom ?? '');
  const arrears = arrearsAtPayment(contrat, paiement, input.paiementsDuContrat);

  const lines: string[] = ['🏠 *TakarDa*', '*Reçu de paiement de loyer*', `Référence : ${receiptReference(paiement.id)}`, ''];
  if (bailleur) lines.push(`👤 Propriétaire : ${bailleur}`);
  if (locataire) lines.push(`👤 Locataire : ${locataire}`);
  if (bien || logement) lines.push(`🏠 ${[bien && `Bien : ${bien}`, logement && `Logement : ${logement}`].filter(Boolean).join(' · ')}`);
  if (mois) lines.push(`📅 Période : ${monthLabel(mois)}`);
  if (date) lines.push(`📅 Date du paiement : ${formatDay(date)}`);
  if (mode) lines.push(`Mode de paiement : ${mode}`);
  if (montant !== null) lines.push(`💰 Montant payé : ${fcfa(montant)}`);
  if (arrears !== null) {
    lines.push(arrears === 0 ? '✅ Aucun loyer en retard à cette date' : `Loyers en retard à cette date : ${arrears} mois`);
  }
  lines.push('', '✅ Merci pour votre paiement.');
  return lines.join('\n');
}
