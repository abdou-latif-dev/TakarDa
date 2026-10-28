// Lecture de la vue du locataire par l'écran — F3c. Pur : transforme les éléments reçus en un modèle d'affichage, défensivement (un champ absent ou d'un
// mauvais type est ignoré, jamais inventé), et fabrique le texte d'un reçu à partir de ces seules données.

import type { ReceivedItem } from './tenantViewLocal';

export interface TenantContract {
  statut: string | null;
  locataireNom: string | null;
  locataireTelephone: string | null;
  locataireEmail: string | null;
  locataireNote: string | null;
  proprietaireNom: string | null;
  loyerMensuel: number | null;
  dateEntree: string | null;
  dateSortie: string | null;
  jourEcheance: number | null;
  dernierLoyerPaye: string | null;
  caution: number | null;
  avance: number | null;
}
export interface TenantHousing {
  nom: string | null;
  type: string | null;
  cuisine: string | null;
  wc: string | null;
  adresse: string | null;
  nomBien: string | null;
  loyerReference: number | null;
}
export interface TenantPayment {
  id: string;
  mois: string;
  montant: number | null;
  statut: 'paye' | 'en_attente' | 'rejete' | 'couvert';
  dateValidation: string | null;
  modePaiement: string | null;
  reference: string | null;
  retardsALaDate: number | null;
}
export interface TenantAdvance {
  montant: number;
  consomme: number;
  disponible: number;
  moisCouverts: string[];
}
export interface TenantLateness {
  fiable: boolean;
  mois: string[];
  jourEcheance: number | null;
  calculeLe: string | null;
}
export interface TenantEvent {
  id: string;
  type: 'contrat_cree' | 'loyer_enregistre' | 'contrat_termine';
  date: string;
  mois: string | null;
}
export interface TenantViewModel {
  contrat: TenantContract | null;
  logement: TenantHousing | null;
  paiements: TenantPayment[];
  avance: TenantAdvance | null;
  retards: TenantLateness | null;
  evenements: TenantEvent[];
}

const str = (v: unknown): string | null => (typeof v === 'string' && v !== '' ? v : null);
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);
const PAYMENT_STATUS = ['paye', 'en_attente', 'rejete', 'couvert'] as const;
const EVENT_TYPES = ['contrat_cree', 'loyer_enregistre', 'contrat_termine'] as const;

export function toViewModel(items: Record<string, Pick<ReceivedItem, 'kind' | 'body'>>): TenantViewModel {
  const model: TenantViewModel = { contrat: null, logement: null, paiements: [], avance: null, retards: null, evenements: [] };
  for (const [id, { kind, body: b }] of Object.entries(items)) {
    if (kind === 'contrat') {
      model.contrat = {
        statut: str(b.statut),
        locataireNom: str(b.locataireNom),
        locataireTelephone: str(b.locataireTelephone),
        locataireEmail: str(b.locataireEmail),
        locataireNote: str(b.locataireNote),
        proprietaireNom: str(b.proprietaireNom),
        loyerMensuel: num(b.loyerMensuel),
        dateEntree: str(b.dateEntree),
        dateSortie: str(b.dateSortie),
        jourEcheance: num(b.jourEcheance),
        dernierLoyerPaye: str(b.dernierLoyerPaye),
        caution: num(b.caution),
        avance: num(b.avance),
      };
    } else if (kind === 'logement') {
      model.logement = { nom: str(b.nom), type: str(b.type), cuisine: str(b.cuisine), wc: str(b.wc), adresse: str(b.adresse), nomBien: str(b.nomBien), loyerReference: num(b.loyerReference) };
    } else if (kind === 'paiement') {
      const statut = (PAYMENT_STATUS as readonly unknown[]).includes(b.statut) ? (b.statut as TenantPayment['statut']) : null;
      const mois = str(b.mois);
      if (statut && mois) model.paiements.push({ id, mois, montant: num(b.montant), statut, dateValidation: str(b.dateValidation), modePaiement: str(b.modePaiement), reference: str(b.reference), retardsALaDate: num(b.retardsALaDate) });
    } else if (kind === 'avance') {
      model.avance = { montant: num(b.montant) ?? 0, consomme: num(b.consomme) ?? 0, disponible: num(b.disponible) ?? 0, moisCouverts: strings(b.moisCouverts) };
    } else if (kind === 'retards') {
      model.retards = { fiable: b.fiable === true, mois: strings(b.mois), jourEcheance: num(b.jourEcheance), calculeLe: str(b.calculeLe) };
    } else if (kind === 'evenement') {
      const type = (EVENT_TYPES as readonly unknown[]).includes(b.type) ? (b.type as TenantEvent['type']) : null;
      const date = str(b.date);
      if (type && date) model.evenements.push({ id, type, date, mois: str(b.mois) });
    }
  }
  model.paiements.sort((a, b) => (a.mois < b.mois ? 1 : a.mois > b.mois ? -1 : a.id < b.id ? 1 : -1));
  model.evenements.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : a.id < b.id ? 1 : -1));
  return model;
}

export const EVENT_LABEL: Record<TenantEvent['type'], string> = {
  contrat_cree: 'Contrat enregistré',
  loyer_enregistre: 'Loyer enregistré',
  contrat_termine: 'Contrat terminé',
};

const MOIS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];
export const monthLabel = (mois: string): string => {
  const m = /^(\d{4})-(\d{2})$/.exec(mois);
  return m ? `${MOIS[Number(m[2]) - 1] ?? mois} ${m[1]}` : mois;
};
export const formatViewAmount = (n: number): string => `${Math.round(n).toLocaleString('fr-FR')} FCFA`;
export const formatViewDay = (iso: string): string => {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : iso;
};

/** Reçu d'un loyer PAYÉ, à partir de la seule vue (même contenu que le reçu du propriétaire : propriétaire, bien, logement, mode de paiement quand ils sont connus). Null pour un mois non payé. */
export function buildTenantReceiptText(model: TenantViewModel, payment: TenantPayment): string | null {
  if (payment.statut !== 'paye' || !payment.reference) return null;
  const lines: string[] = ['🏠 *TakarDa*', '*Reçu de paiement de loyer*', `Référence : ${payment.reference}`, ''];
  if (model.contrat?.proprietaireNom) lines.push(`👤 Propriétaire : ${model.contrat.proprietaireNom}`);
  if (model.contrat?.locataireNom) lines.push(`👤 Locataire : ${model.contrat.locataireNom}`);
  if (model.logement?.nomBien || model.logement?.nom) lines.push(`🏠 ${[model.logement.nomBien && `Bien : ${model.logement.nomBien}`, model.logement.nom && `Logement : ${model.logement.nom}`].filter(Boolean).join(' · ')}`);
  if (model.logement?.adresse) lines.push(`📍 Adresse : ${model.logement.adresse}`);
  lines.push(`📅 Période : ${monthLabel(payment.mois)}`);
  if (payment.dateValidation) lines.push(`📅 Date du paiement : ${formatViewDay(payment.dateValidation)}`);
  if (payment.modePaiement) lines.push(`Mode de paiement : ${payment.modePaiement}`);
  if (payment.montant !== null) lines.push(`💰 Montant payé : ${formatViewAmount(payment.montant)}`);
  if (payment.retardsALaDate !== null) lines.push(payment.retardsALaDate === 0 ? '✅ Aucun loyer en retard à cette date' : `Loyers en retard à cette date : ${payment.retardsALaDate} mois`);
  lines.push('', '✅ Merci pour votre paiement.');
  return lines.join('\n');
}
