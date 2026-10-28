// Correction ou annulation EXPLICITE d'un fait financier — P3, local, sans réseau.
//
// Règle : un paiement ou une cotisation déjà confirmé n'est JAMAIS supprimé ni réécrit silencieusement (ni localement par la réception,
// ni dans le cloud). Pour le corriger ou l'annuler, on ajoute un NOUVEAU fait, tracé, qui référence le fait initial :
//  - `annulation`  : le fait initial n'a plus d'effet (montant effectif 0) ; définitive, on ne peut pas annuler deux fois ;
//  - `correction`  : le montant effectif devient `correctedAmount` ; plusieurs corrections successives sont possibles (la plus récente prévaut).
// Ces faits sont ajoutés seulement (aucune modification, aucune suppression : le moteur retient toute modification ou suppression d'un
// fait financier), vivent dans un magasin séparé (le fait initial n'est pas touché) et se synchronisent comme tout fait financier :
// création seulement. L'état effectif est CALCULÉ à la lecture ; aucun service métier n'est modifié par ce module (voir la
// documentation : le branchement des écrans et des totaux est une étape ultérieure).

import { genId } from '../db';
import { snapshotCollections, workspaceId } from '../persistence';
import { createPersistentStore } from './localStore';
import { KIND, type Kind } from './kindRegistry';
import { collectSyncableItems } from './changeScanner';
import { getSyncAccount } from './syncAccount';

export type CorrectionKind = typeof KIND.IMMOBILIER_CORRECTION_PAIEMENT | typeof KIND.TONTINE_CORRECTION_COTISATION;
export type CorrectionType = 'annulation' | 'correction';

export interface FinancialCorrection {
  id: string;
  kind: CorrectionKind;
  /** Fait initial corrigé ou annulé (jamais modifié). */
  targetId: string;
  type: CorrectionType;
  reason: string;
  /** Nouveau montant effectif (type « correction » uniquement). */
  correctedAmount: number | null;
  createdAt: string;
  updatedAt: string;
  createdBy: string;
}

export interface CorrectionStoreData {
  schemaVersion: 1;
  items: Record<string, FinancialCorrection>;
}

function numberOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/** Fait financier ciblé par chaque type de correction, et champ qui porte son montant. */
export const CORRECTION_TARGETS: Record<CorrectionKind, { target: Kind; amountOf: (item: Record<string, unknown>) => number | null }> = {
  [KIND.IMMOBILIER_CORRECTION_PAIEMENT]: { target: KIND.IMMOBILIER_PAIEMENT, amountOf: (item) => numberOrNull((item.values as Record<string, unknown> | undefined)?.montant) },
  [KIND.TONTINE_CORRECTION_COTISATION]: { target: KIND.TONTINE_COTISATION, amountOf: (item) => numberOrNull(item.amount) },
};

export const isCorrectionKind = (kind: string): kind is CorrectionKind => kind in CORRECTION_TARGETS;

export function validateCorrection(value: unknown): string[] {
  if (!value || typeof value !== 'object') return ['correction illisible'];
  const c = value as Record<string, unknown>;
  const problems: string[] = [];
  if (typeof c.id !== 'string' || c.id === '') problems.push('identifiant manquant');
  if (typeof c.kind !== 'string' || !isCorrectionKind(c.kind)) problems.push('type de correction inconnu');
  if (typeof c.targetId !== 'string' || c.targetId === '') problems.push('fait initial non référencé');
  if (c.type !== 'annulation' && c.type !== 'correction') problems.push('nature inconnue');
  if (typeof c.reason !== 'string' || c.reason.trim() === '') problems.push('motif obligatoire');
  else if (c.reason.length > 500) problems.push('motif trop long');
  if (c.type === 'correction' && (typeof c.correctedAmount !== 'number' || !Number.isFinite(c.correctedAmount) || c.correctedAmount < 0)) problems.push('montant corrigé invalide');
  if (c.type === 'annulation' && c.correctedAmount !== null) problems.push('une annulation n’a pas de montant corrigé');
  if (typeof c.createdAt !== 'string' || c.createdAt === '' || typeof c.updatedAt !== 'string') problems.push('dates invalides');
  return problems;
}

export function validateCorrectionStore(value: unknown): string[] {
  if (!value || typeof value !== 'object') return ['magasin illisible'];
  const s = value as Record<string, unknown>;
  if (s.schemaVersion !== 1 || !s.items || typeof s.items !== 'object') return ['structure invalide'];
  const problems: string[] = [];
  for (const [id, c] of Object.entries(s.items as Record<string, unknown>)) {
    for (const p of validateCorrection(c)) problems.push(`${id} : ${p}`);
    if ((c as FinancialCorrection)?.id !== id) problems.push(`${id} : clé différente de l’identifiant`);
  }
  return problems;
}

export const correctionStore = createPersistentStore<CorrectionStoreData>({
  baseKey: 'sync_corrections',
  name: 'corrections financières',
  empty: () => ({ schemaVersion: 1, items: {} }),
  validate: validateCorrectionStore,
});

const chronological = (a: FinancialCorrection, b: FinancialCorrection): number => (a.createdAt === b.createdAt ? (a.id < b.id ? -1 : 1) : a.createdAt < b.createdAt ? -1 : 1);

export interface EffectiveFinancialState {
  state: 'active' | 'corrected' | 'annulled';
  /** Montant qui compte réellement (0 si annulé) ; null si le fait initial n'a pas de montant lisible. */
  effectiveAmount: number | null;
  /** Corrections prises en compte, dans l'ordre. */
  applied: string[];
  /** Corrections enregistrées après une annulation : ignorées (une annulation est définitive). */
  ignored: string[];
}

/** État effectif d'un fait financier, CALCULÉ à partir du fait initial et de ses corrections. Pur : rien n'est modifié. */
export function effectiveFinancialState(initialAmount: number | null, corrections: readonly FinancialCorrection[]): EffectiveFinancialState {
  const result: EffectiveFinancialState = { state: 'active', effectiveAmount: initialAmount, applied: [], ignored: [] };
  for (const c of [...corrections].sort(chronological)) {
    if (result.state === 'annulled') {
      result.ignored.push(c.id);
      continue;
    }
    result.applied.push(c.id);
    if (c.type === 'annulation') {
      result.state = 'annulled';
      result.effectiveAmount = 0;
    } else {
      result.state = 'corrected';
      result.effectiveAmount = c.correctedAmount;
    }
  }
  return result;
}

export class CorrectionError extends Error {
  constructor(readonly code: 'demo_workspace' | 'no_account' | 'invalid' | 'target_missing' | 'target_kind' | 'already_annulled', message: string) {
    super(message);
    this.name = 'CorrectionError';
  }
}

export interface RecordCorrectionInput {
  kind: CorrectionKind;
  targetId: string;
  type: CorrectionType;
  reason: string;
  correctedAmount?: number;
  now?: Date;
  id?: string;
}

/**
 * Enregistre une correction ou une annulation EXPLICITE. Vérifie que le fait initial existe, est du bon type, et n'est pas déjà annulé.
 * Ne modifie jamais le fait initial. Refusé dans l'espace de démonstration.
 */
export async function recordCorrection(input: RecordCorrectionInput): Promise<FinancialCorrection> {
  if (workspaceId() !== 'personal') throw new CorrectionError('demo_workspace', 'Aucune correction financière dans l’espace de démonstration.');
  if (!getSyncAccount()) throw new CorrectionError('no_account', 'Aucun compte actif : une correction est rangée dans l’espace du compte.');
  if (!isCorrectionKind(input.kind)) throw new CorrectionError('invalid', 'Type de correction inconnu.');
  const spec = CORRECTION_TARGETS[input.kind];
  const target = collectSyncableItems(snapshotCollections()).items.find((i) => i.id === input.targetId);
  if (!target) throw new CorrectionError('target_missing', 'Le fait financier à corriger est introuvable.');
  if (target.kind !== spec.target) throw new CorrectionError('target_kind', 'Ce fait n’est pas du type attendu pour cette correction.');
  const now = (input.now ?? new Date()).toISOString();
  const correction: FinancialCorrection = {
    id: input.id ?? genId('corr'),
    kind: input.kind,
    targetId: input.targetId,
    type: input.type,
    reason: input.reason,
    correctedAmount: input.type === 'correction' ? input.correctedAmount ?? NaN : null,
    createdAt: now,
    updatedAt: now,
    createdBy: 'u-me',
  };
  const problems = validateCorrection(correction);
  if (problems.length > 0) throw new CorrectionError('invalid', problems.join(' ; '));
  await correctionStore.update((store) => {
    if (store.items[correction.id]) throw new CorrectionError('invalid', 'Identifiant de correction déjà utilisé.');
    const prior = Object.values(store.items).filter((c) => c.targetId === correction.targetId);
    if (prior.some((c) => c.type === 'annulation')) throw new CorrectionError('already_annulled', 'Ce fait est déjà annulé : une annulation est définitive.');
    return { ...store, items: { ...store.items, [correction.id]: correction } };
  });
  return correction;
}

/** Corrections d'un fait initial, dans l'ordre chronologique. Lecture seule. */
export async function correctionsOf(targetId: string): Promise<FinancialCorrection[]> {
  const store = await correctionStore.load();
  return Object.values(store.items).filter((c) => c.targetId === targetId).sort(chronological);
}
