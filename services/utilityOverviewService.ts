// Synthèse d'un module CEET ou TDE : tableau de bord et historique.
//
// Tout est CALCULÉ à la lecture à partir des données réelles (participations,
// relevés, factures partagées, parts) — rien n'est stocké en double et rien n'est
// inventé : un module vide affiche des zéros et des « — ». Le moteur est commun à
// CEET et TDE, le fournisseur est un simple paramètre. Les comparaisons de
// fournisseur ignorent la casse (anciens relevés en « CEET »).

import { coreService } from './coreService';
import { ensureFacturesToolCached } from './facturesService';
import { fournisseurKey, sortPartsForDisplay, summarizePayments } from './utilityBillingService';
import { listParticipations, type UtilityModule, type UtilityParticipation } from './utilityParticipantsService';
import type { RecordItem } from '@/types/entities';

export type InvoiceState = 'a_repartir' | 'a_payer' | 'partielle' | 'payee';

export interface HistoryRow {
  factureId: string;
  periode: string;
  montantTotal: number | null;
  /** « Par compteur », « Partage équitable », ou null tant que la facture n'est pas répartie. */
  methode: string | null;
  paid: number;
  total: number;
  montantRestant: number;
  /** Dérivé des parts réelles (jamais lu d'un statut stocké). */
  state: InvoiceState;
}

export interface ModuleDashboard {
  participants: number;
  /** Période la plus récente ayant au moins un relevé d'un participant de ce module. */
  lastReleve: { periode: string; count: number } | null;
  lastFacture: { factureId: string; periode: string; montant: number | null } | null;
  /** Somme des parts non payées de toutes les factures du module. */
  aRecevoir: number;
  /** Factures du module qui ont encore au moins une part à payer (les plus récentes d'abord). */
  aRegler: HistoryRow[];
  facturesCount: number;
  /** Anciens relevés « saisie libre » de ce module, pas encore rattachés à une personne. */
  legacyReleves: number;
}

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const METHODES: Record<string, string> = { proportionnel: 'Par compteur', equitable: 'Partage équitable' };

function factureOrder(a: RecordItem, b: RecordItem): number {
  const pa = String(a.values.mois ?? '');
  const pb = String(b.values.mois ?? '');
  if (pa !== pb) return pa < pb ? 1 : -1; // période la plus récente d'abord
  return a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0;
}

/** Factures partagées du module (insensible à la casse), de la plus récente à la plus ancienne. */
export function facturesOfModule(factures: RecordItem[], module: UtilityModule): RecordItem[] {
  return factures.filter((f) => fournisseurKey(f.values.fournisseur) === module).sort(factureOrder);
}

/** Une ligne d'historique par facture du module : période, montant, méthode, « n/N payés ». */
export function buildHistory(factures: RecordItem[], parts: RecordItem[], module: UtilityModule): HistoryRow[] {
  return facturesOfModule(factures, module).map((f) => {
    const own = parts.filter((p) => p.values.facture_partagee === f.id);
    const sum = summarizePayments(own);
    const state: InvoiceState = own.length === 0 ? 'a_repartir' : sum.paid === 0 ? 'a_payer' : sum.paid === own.length ? 'payee' : 'partielle';
    return {
      factureId: f.id,
      periode: String(f.values.mois ?? ''),
      montantTotal: num(f.values.montant_total),
      methode: METHODES[String(f.values.mode_repartition ?? '')] ?? null,
      paid: sum.paid,
      total: sum.total,
      montantRestant: sum.montantRestant,
      state,
    };
  });
}

/** Tableau de bord du module. Fonction pure : les relevés comptés sont ceux des
 * participants de CE module (participations actives ou retirées), jamais ceux d'un
 * autre module ni des relevés « saisie libre » sans participation. */
export function buildDashboard(input: {
  module: UtilityModule;
  participations: UtilityParticipation[];
  releves: RecordItem[];
  factures: RecordItem[];
  parts: RecordItem[];
}): ModuleDashboard {
  const { module, participations, releves, factures, parts } = input;
  const own = participations.filter((p) => p.fournisseur === module);
  const identities = new Set(own.map((p) => `${p.participant.type}|${p.participant.id}`));
  const moduleReleves = releves.filter(
    (r) => fournisseurKey(r.values.fournisseur) === module && typeof r.values.mois === 'string' && identities.has(`${r.values.participant_type}|${r.values.participant_id}`),
  );
  const lastPeriode = moduleReleves.reduce<string | null>((max, r) => (max === null || String(r.values.mois) > max ? String(r.values.mois) : max), null);

  const history = buildHistory(factures, parts, module);
  const last = history[0];
  const moduleFactureIds = new Set(history.map((h) => h.factureId));
  const aRecevoir = parts
    .filter((p) => moduleFactureIds.has(String(p.values.facture_partagee)) && p.statusKey !== 'payee')
    .reduce((sum, p) => sum + (num(p.values.montant_attribue) ?? 0), 0);

  return {
    participants: own.filter((p) => !p.archived).length,
    lastReleve: lastPeriode ? { periode: lastPeriode, count: moduleReleves.filter((r) => r.values.mois === lastPeriode).length } : null,
    lastFacture: last ? { factureId: last.factureId, periode: last.periode, montant: last.montantTotal } : null,
    aRecevoir,
    aRegler: history.filter((h) => h.state === 'a_payer' || h.state === 'partielle'),
    facturesCount: history.length,
    legacyReleves: releves.filter((r) => fournisseurKey(r.values.fournisseur) === module && r.values.participant_type === 'manuel' && typeof r.values.compteur === 'string' && r.values.compteur.trim() !== '').length,
  };
}

/** Charge et calcule le tableau de bord ET l'historique en une seule passe
 * (4 lectures en parallèle, aucune boucle de lectures par participant). */
export async function loadModuleOverview(module: UtilityModule): Promise<{ dashboard: ModuleDashboard; history: HistoryRow[] }> {
  const ents = await ensureFacturesToolCached();
  const [participations, releves, factures, parts] = await Promise.all([
    listParticipations(module, { includeArchived: true }),
    coreService.getRecords({ toolId: ents.tool.id, entityDefinitionId: ents.releveDefinition.id }),
    coreService.getRecords({ toolId: ents.tool.id, entityDefinitionId: ents.facturePartageeDefinition.id }),
    coreService.getRecords({ toolId: ents.tool.id, entityDefinitionId: ents.partLocataireDefinition.id }),
  ]);
  return {
    dashboard: buildDashboard({ module, participations, releves, factures, parts: sortPartsForDisplay(parts) }),
    history: buildHistory(factures, parts, module),
  };
}
