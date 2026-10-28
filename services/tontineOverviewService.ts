// Synthèse du module Tontine : ce que l'espace Tontine affiche, calculé depuis les
// données réelles. Aucun chiffre inventé : une valeur qui ne peut pas être déterminée
// (tontine sans membres, aucun tour) vaut `null`, jamais 0 ni une approximation.
//
// Aucune formule n'est recalculée ici : le tour courant, le bénéficiaire, les montants
// collectés/restants et le retard viennent de tontineService.getSummary, l'historique des
// tours de tontineService.getTourHistory (eux-mêmes bâtis sur tontineTours). Ce fichier
// ne fait qu'agréger.
//
// Les tontines restent des `Group` (aucun Tool par tontine) : le Tool Tontine du registre
// Mes Outils n'est que l'enveloppe d'installation du module.

import { assertModuleAvailable } from './moduleLock';
import { getRecentActivities } from './activityService';
import { memberships } from './db';
import { groupService } from './groupService';
import { tontineService, type TontineSummary, type TourHistoryEntry } from './tontineService';
import { ensureInstalledTools } from './toolRegistryService';
import type { ActivityEvent, TontineFrequency, TontineStatus, TourStatus } from '@/types/entities';

export interface TontineCard {
  groupId: string;
  name: string;
  status: TontineStatus;
  frequency: TontineFrequency | null;
  amountPerMember: number | null;
  /** Membres actifs de la rotation. */
  memberCount: number;
  /** Tour en cours, ou null tant que la tontine n'a pas de membres (rotation impossible). */
  tour: { tourNumber: number; cycleNumber: number; positionInCycle: number; scheduledDate: string } | null;
  tourStatus: TourStatus | null;
  nextBeneficiary: string | null;
  paidCount: number;
  lateCount: number;
  collected: number;
  expectedTotal: number;
  remaining: number;
}

export interface TontineOverview {
  tontines: TontineCard[];
  /** Tontines non terminées. */
  activeTontines: number;
  /** Participations : membres actifs additionnés tontine par tontine (une personne dans deux tontines compte deux fois). */
  totalMembers: number;
  /** Personnes distinctes : une même personne présente dans plusieurs tontines (même identité locale, ex. « Vous ») n'est comptée
   * qu'une fois. Les invités ajoutés à la main n'ont pas d'identité commune : ils ne peuvent pas être rapprochés d'une tontine à l'autre. */
  distinctMembers: number;
  /** Tour en attente à la date la plus proche (un tour en retard est signalé), ou null. */
  nextTour: { groupId: string; name: string; beneficiary: string | null; date: string; late: boolean } | null;
  /** Cotisations non payées pour les tours en cours ; null si aucun tour en cours n'existe. */
  pendingContributions: number | null;
  /** Montant restant à collecter pour les tours en cours ; null si aucun tour en cours n'existe. */
  expectedAmount: number | null;
  /** Tontines dont le tour en cours est en retard. */
  lateTontines: number;
}

export function toTontineCard(summary: TontineSummary): TontineCard {
  const tour = summary.currentTour;
  const group = summary.group;
  return {
    groupId: group.id,
    name: group.name,
    status: group.tontineStatus ?? 'active',
    frequency: group.frequency ?? null,
    amountPerMember: typeof group.contributionAmount === 'number' ? group.contributionAmount : null,
    memberCount: summary.totalMembers,
    tour: tour ? { tourNumber: tour.tourNumber, cycleNumber: tour.cycleNumber, positionInCycle: tour.positionInCycle, scheduledDate: tour.scheduledDate } : null,
    tourStatus: tour ? summary.tourStatus : null,
    nextBeneficiary: summary.nextBeneficiary?.displayName ?? null,
    paidCount: summary.paidCount,
    lateCount: summary.lateCount,
    collected: summary.collected,
    expectedTotal: summary.expectedTotal,
    remaining: summary.remaining,
  };
}

/** Fonction pure : agrège les synthèses de tontines (dans l'ordre reçu, sans doublon). */
export function buildTontineOverview(summaries: readonly TontineSummary[]): TontineOverview {
  const seen = new Set<string>();
  const unique = summaries.filter((s) => (seen.has(s.group.id) ? false : (seen.add(s.group.id), true)));
  const cards = unique.map(toTontineCard);
  const withTour = cards.filter((c) => c.tour !== null);

  const waiting = withTour
    .filter((c) => c.tourStatus !== 'complete')
    .sort((a, b) => (a.tour!.scheduledDate < b.tour!.scheduledDate ? -1 : a.tour!.scheduledDate > b.tour!.scheduledDate ? 1 : 0));
  const first = waiting[0];

  return {
    tontines: cards,
    activeTontines: cards.filter((c) => c.status !== 'completed').length,
    totalMembers: cards.reduce((sum, c) => sum + c.memberCount, 0),
    distinctMembers: new Set(unique.flatMap((s) => s.members.map((m) => m.userId))).size,
    nextTour: first ? { groupId: first.groupId, name: first.name, beneficiary: first.nextBeneficiary, date: first.tour!.scheduledDate, late: first.tourStatus === 'late' } : null,
    pendingContributions: withTour.length > 0 ? withTour.reduce((sum, c) => sum + Math.max(0, c.memberCount - c.paidCount), 0) : null,
    expectedAmount: withTour.length > 0 ? withTour.reduce((sum, c) => sum + c.remaining, 0) : null,
    lateTontines: withTour.filter((c) => c.tourStatus === 'late').length,
  };
}

export interface TontineStats {
  tontines: number;
  /** Participations (membres actifs additionnés par tontine). */
  members: number;
  /** Personnes distinctes (voir TontineOverview.distinctMembers). */
  distinctMembers: number;
  /** Tours déjà générés (passés et en cours) ; les tours futurs n'existent pas encore. */
  toursGenerated: number;
  toursComplete: number;
  /** Montants sur les tours générés uniquement. */
  collected: number;
  expected: number;
  remaining: number;
  /** collected / expected ; null tant qu'aucun tour n'est généré. */
  paymentRate: number | null;
  /** Cotisations de tous les tours générés : payées ; non payées d'un tour pas encore échu (en attente) ; non payées d'un
   * tour dont l'échéance est passée sans qu'il soit complet (en retard). Un tour complet n'a aucune cotisation non payée. */
  paidContributions: number;
  pendingContributions: number;
  lateContributions: number;
}

/** Fonction pure : statistiques sur les tours déjà générés de toutes les tontines. */
export function buildTontineStats(input: { tontines: number; members: number; distinctMembers?: number; histories: readonly (readonly TourHistoryEntry[])[] }): TontineStats {
  const entries = input.histories.flat();
  const unpaidOf = (e: TourHistoryEntry) => Math.max(0, e.totalMembers - e.paidCount);
  const collected = entries.reduce((sum, e) => sum + e.collected, 0);
  const expected = entries.reduce((sum, e) => sum + e.expectedTotal, 0);
  return {
    tontines: input.tontines,
    members: input.members,
    distinctMembers: input.distinctMembers ?? input.members,
    toursGenerated: entries.length,
    toursComplete: entries.filter((e) => e.status === 'complete').length,
    collected,
    expected,
    remaining: entries.reduce((sum, e) => sum + Math.max(0, e.expectedTotal - e.collected), 0),
    paymentRate: expected > 0 ? collected / expected : null,
    paidContributions: entries.reduce((sum, e) => sum + e.paidCount, 0),
    pendingContributions: entries.filter((e) => e.status === 'upcoming' || e.status === 'partial').reduce((sum, e) => sum + unpaidOf(e), 0),
    lateContributions: entries.filter((e) => e.status === 'late').reduce((sum, e) => sum + unpaidOf(e), 0),
  };
}

async function loadSummaries(): Promise<TontineSummary[]> {
  // Une installation existante retrouve son outil Tontine (idempotent, ne crée aucun Tool par groupe).
  await ensureInstalledTools().catch(() => undefined);
  const groups = (await groupService.listMyGroups()).filter((g) => g.kind === 'tontine');
  const summaries = await Promise.all(groups.map((g) => tontineService.getSummary(g.id)));
  return summaries.filter((s): s is TontineSummary => s !== null);
}

export async function loadTontineOverview(): Promise<TontineOverview> {
  assertModuleAvailable('tontine'); // indisponible en contexte multi-compte (moduleLock.ts)
  return buildTontineOverview(await loadSummaries());
}

/** Statistiques du module — LECTURE SEULE : contrairement à l'espace Tontine, elles ne passent pas par getSummary, donc ne
 * génèrent aucun tour ; elles lisent les tours déjà générés (getTourHistory) et les membres actifs. */
export async function loadTontineStats(): Promise<TontineStats> {
  const groups = (await groupService.listMyGroups()).filter((g) => g.kind === 'tontine');
  const histories = await Promise.all(groups.map((g) => tontineService.getTourHistory(g.id)));
  const active = groups.map((g) => memberships.filter((m) => m.groupId === g.id && m.status === 'active' && typeof m.position === 'number'));
  return buildTontineStats({
    tontines: groups.length,
    members: active.reduce((sum, list) => sum + list.length, 0),
    distinctMembers: new Set(active.flat().map((m) => m.userId)).size,
    histories,
  });
}

/** Historique du module : les activités Tontine du journal, de la plus récente à la plus ancienne. */
export function getTontineHistory(limit?: number): ActivityEvent[] {
  return getRecentActivities({ module: 'tontine', limit });
}
