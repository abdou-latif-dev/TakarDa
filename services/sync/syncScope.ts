// Périmètre de la synchronisation V1 : IMMOBILIER SEUL — phase 6, étape 1. Module pur : aucun SDK, aucun réseau, aucune écriture.
//
// Types autorisés dans le cloud (liste blanche, vérifiée à CHAQUE couche : capture, planification, envoi, transport, réception, applicateur,
// règles Firestore candidates — aucune couche ne se fie à la précédente) :
//   immobilier.bien, immobilier.logement, immobilier.contrat, immobilier.paiement, immobilier.depense, immobilier.correction_paiement,
//   et core.contact — UNIQUEMENT pour un contact locataire référencé par un contrat immobilier lui-même autorisé.
// Exclus et inchangés (restent strictement locaux, comportement actuel préservé, jamais adoptés) : CEET / TDE (factures, relevés, parts,
// participations), tontines, formulaires, contacts non liés à un contrat, journaux, outils, définitions, etc.
//
// Règles d'ÉLÉMENT (appliquées à la capture et à la planification) :
//   - contrat   : autorisé seulement si son locataire (`locataire_id`) est un contact LOCAL disponible ; sinon « incomplet » : jamais envoyé ;
//   - contact   : autorisé seulement s'il est le locataire d'un contrat autorisé (jamais un contact lié à un autre module seulement) ;
//   - paiement  : autorisé seulement si son contrat est autorisé ; correction : seulement si son paiement est autorisé.
// Un élément qui SORT du périmètre (le contrat perd son locataire, le contact n'est plus référencé…) n'est NI envoyé, NI supprimé dans le
// cloud : il reste figé là où il est (la capture ignore ses modifications ; ses opérations en attente sont retenues, `out_of_scope`).

import type { LocalItem } from './changeScanner';
import { KIND, type Kind } from './kindRegistry';

/** Liste blanche V1. Ne s'élargit qu'au prix d'un changement de ce fichier ET des règles candidates (un test les compare). */
export const SYNC_SCOPE_V1: readonly Kind[] = [
  KIND.IMMOBILIER_BIEN,
  KIND.IMMOBILIER_LOGEMENT,
  KIND.IMMOBILIER_CONTRAT,
  KIND.IMMOBILIER_PAIEMENT,
  KIND.IMMOBILIER_DEPENSE,
  KIND.IMMOBILIER_CORRECTION_PAIEMENT,
  KIND.CORE_CONTACT,
];

let active: readonly Kind[] = SYNC_SCOPE_V1;
let strict = true;

/** Types actuellement autorisés (la liste blanche V1, sauf dans les tests qui exercent le moteur générique avec d'autres types). */
export const activeSyncKinds = (): readonly Kind[] => active;

export const isSyncKind = (kind: string): boolean => (active as readonly string[]).includes(kind);

/**
 * RÉSERVÉ AUX TESTS du moteur générique (file, fusion, conflits…) qui utilisent des types hors V1 : remplace TEMPORAIREMENT la liste blanche
 * (et désactive les règles d'élément). `null` rétablit la liste V1. Aucun code de production ne l'appelle (un test statique le vérifie).
 */
export function __useSyncScopeForTests(kinds: readonly Kind[] | null): void {
  active = kinds ?? SYNC_SCOPE_V1;
  strict = kinds === null;
}

export type ScopeReason = 'kind_not_allowed' | 'tenant_missing' | 'contact_unlinked' | 'contract_not_allowed' | 'payment_not_allowed';

export interface ScopeResult {
  allowed: LocalItem[];
  excluded: { id: string; kind: Kind; reason: ScopeReason }[];
}

const text = (v: unknown): string => (typeof v === 'string' ? v : '');
const valuesOf = (item: Record<string, unknown>): Record<string, unknown> => (item.values && typeof item.values === 'object' ? (item.values as Record<string, unknown>) : {});

/** Périmètre appliqué à un ensemble d'éléments locaux (ceux que le compte actif peut utiliser). Pur. */
export function evaluateScope(items: readonly LocalItem[]): ScopeResult {
  const allowed: LocalItem[] = [];
  const excluded: ScopeResult['excluded'] = [];
  if (!strict) {
    // mode de test du moteur générique : seule la liste de types s'applique
    for (const i of items) {
      if (isSyncKind(i.kind)) allowed.push(i);
      else excluded.push({ id: i.id, kind: i.kind, reason: 'kind_not_allowed' });
    }
    return { allowed, excluded };
  }
  const contactIds = new Set(items.filter((i) => i.kind === KIND.CORE_CONTACT).map((i) => i.id));
  const contracts = items.filter((i) => i.kind === KIND.IMMOBILIER_CONTRAT);
  const okContracts = new Set<string>();
  const badContracts = new Map<string, ScopeReason>();
  for (const c of contracts) {
    const tenant = text(valuesOf(c.item).locataire_id);
    if (tenant !== '' && contactIds.has(tenant)) okContracts.add(c.id);
    else badContracts.set(c.id, 'tenant_missing');
  }
  const linkedContacts = new Set(contracts.filter((c) => okContracts.has(c.id)).map((c) => text(valuesOf(c.item).locataire_id)));
  const payments = items.filter((i) => i.kind === KIND.IMMOBILIER_PAIEMENT);
  const okPayments = new Set(payments.filter((p) => okContracts.has(text(valuesOf(p.item).contrat))).map((p) => p.id));

  for (const i of items) {
    let reason: ScopeReason | null = null;
    switch (i.kind) {
      case KIND.IMMOBILIER_BIEN:
      case KIND.IMMOBILIER_LOGEMENT:
      case KIND.IMMOBILIER_DEPENSE:
        break;
      case KIND.IMMOBILIER_CONTRAT:
        reason = badContracts.get(i.id) ?? null;
        break;
      case KIND.CORE_CONTACT:
        reason = linkedContacts.has(i.id) ? null : 'contact_unlinked';
        break;
      case KIND.IMMOBILIER_PAIEMENT:
        reason = okPayments.has(i.id) ? null : 'contract_not_allowed';
        break;
      case KIND.IMMOBILIER_CORRECTION_PAIEMENT:
        reason = okPayments.has(text(i.item.targetId)) ? null : 'payment_not_allowed';
        break;
      default:
        reason = 'kind_not_allowed';
    }
    if (reason === null && !isSyncKind(i.kind)) reason = 'kind_not_allowed';
    if (reason === null) allowed.push(i);
    else excluded.push({ id: i.id, kind: i.kind, reason });
  }
  return { allowed, excluded };
}
