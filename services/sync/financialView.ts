// Vue FINANCIÈRE EFFECTIVE et garde des mutations de faits financiers — P5. Pur ou en lecture seule ; rien n'est branché, aucun total existant
// n'est modifié, aucune donnée n'est écrite.
//
// Pourquoi : une correction ou une annulation (financialCorrection.ts) est un NOUVEAU fait qui référence le paiement initial ; le paiement
// lui-même ne change jamais. Les totaux d'Immobilier (rapport, statistiques, solde d'avance, impayés, historique) lisent les paiements :
// pour qu'ils tiennent compte des corrections SANS changer leurs formules, on leur donne des paiements « effectifs » (copies en mémoire) :
//   - annulé   → statut `rejete` (le statut existant de « non payé » : non encaissé, mois redevenu à payer, couverture d'avance non consommée) ;
//   - corrigé  → montant remplacé par le montant corrigé le plus récent ;
//   - sinon    → LE MÊME enregistrement (même référence) : sans correction, les totaux sont strictement identiques.
//
// Garde : un paiement déjà confirmé par le cloud ne se modifie, ne se « rejette » ni ne se supprime plus directement (l'écran actuel le permet
// encore : « Marquer rejeté », suppression d'un contrat ou d'un bien avec ses paiements). Cette garde dit quoi faire à la place.

import type { RecordItem } from '@/types/entities';
import { effectiveFinancialState, type FinancialCorrection } from './financialCorrection';
import { getKindDefinition, kindOfRecord } from './kindRegistry';
import { getSyncAccount } from './syncAccount';
import { baselineStore } from './syncQueue';

/** Statut qui exprime « non payé » dans Immobilier (déjà compris par tous les totaux). */
export const ANNULLED_STATUS_KEY = 'rejete';

const amountOf = (p: RecordItem): number | null => (typeof p.values.montant === 'number' && Number.isFinite(p.values.montant) ? p.values.montant : null);

// Copies en mémoire produites pour un paiement ANNULÉ : permettent à l'affichage de distinguer « Annulé » d'un simple « rejeté » (même statut `rejete`),
// sans ajouter de champ aux données (une copie n'est jamais réécrite dans le stockage).
const annulledCopies = new WeakSet<object>();

/** Ce paiement (copie effective) est-il annulé par une annulation explicite ? Faux pour un paiement ordinaire ou rejeté à la main. */
export const isAnnulledPayment = (paiement: object): boolean => annulledCopies.has(paiement);

/** Paiements tels qu'ils comptent réellement, après corrections et annulations. Sans correction applicable : les mêmes références. */
export function effectivePaiements(paiements: readonly RecordItem[], corrections: readonly FinancialCorrection[]): RecordItem[] {
  if (corrections.length === 0) return [...paiements];
  const byTarget = new Map<string, FinancialCorrection[]>();
  for (const c of corrections) byTarget.set(c.targetId, [...(byTarget.get(c.targetId) ?? []), c]);
  return paiements.map((p) => {
    const mine = byTarget.get(p.id);
    if (!mine) return p;
    const state = effectiveFinancialState(amountOf(p), mine);
    if (state.state === 'annulled') {
      const copy = { ...p, statusKey: ANNULLED_STATUS_KEY };
      annulledCopies.add(copy);
      return copy;
    }
    if (state.state === 'corrected' && state.effectiveAmount !== null && state.effectiveAmount !== amountOf(p)) return { ...p, values: { ...p.values, montant: state.effectiveAmount } };
    return p;
  });
}

export type FinancialAction = 'edit' | 'reject' | 'delete';

export interface FinancialMutationAdvice {
  allowed: boolean;
  /** Ce qu'il faut faire à la place quand la mutation directe n'est pas permise. */
  instead: 'none' | 'correction' | 'annulation' | 'blocked';
  reason: string | null;
}

/**
 * Peut-on modifier, rejeter ou supprimer DIRECTEMENT ce fait ? Oui tant qu'il est purement local (jamais confirmé par le cloud du compte actif).
 * Dès qu'il est confirmé : modification → correction ; « rejet » → annulation ; suppression → interdite (aucune suppression d'un fait financier
 * confirmé). Lecture seule. Sans compte actif : rien n'est confirmé, tout reste permis comme aujourd'hui.
 */
export async function adviseFinancialMutation(record: Pick<RecordItem, 'id' | 'toolId' | 'entityDefinitionId'>, action: FinancialAction): Promise<FinancialMutationAdvice> {
  const allowed: FinancialMutationAdvice = { allowed: true, instead: 'none', reason: null };
  const kind = kindOfRecord(record);
  if (!kind || !getKindDefinition(kind).financialFact || !getSyncAccount()) return allowed;
  const confirmed = (await baselineStore.load()).entries[record.id];
  if (!confirmed) return allowed;
  if (action === 'edit') return { allowed: false, instead: 'correction', reason: 'Ce paiement est déjà confirmé dans le cloud : enregistrez une correction explicite (le paiement initial reste inchangé).' };
  if (action === 'reject') return { allowed: false, instead: 'annulation', reason: 'Ce paiement est déjà confirmé dans le cloud : enregistrez une annulation explicite (le paiement initial reste inchangé).' };
  return { allowed: false, instead: 'blocked', reason: 'Un fait financier confirmé dans le cloud ne se supprime pas : annulez-le par une annulation explicite.' };
}

/** Plusieurs faits à la fois (suppression d'un contrat, d'un logement ou d'un bien) : ceux qui s'y opposent. */
export async function financialBlockers(records: readonly Pick<RecordItem, 'id' | 'toolId' | 'entityDefinitionId'>[]): Promise<string[]> {
  const out: string[] = [];
  for (const record of records) if (!(await adviseFinancialMutation(record, 'delete')).allowed) out.push(record.id);
  return out;
}
