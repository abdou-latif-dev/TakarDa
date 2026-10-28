// Contenu de l'accueil : outils récents, « à surveiller », activités récentes, annonce locale.
//
// Tout vient des services existants — rien n'est inventé et rien n'est stocké en double :
//   - outils      : registre Mes Outils (toolRegistryService), classés par dernière activité liée
//                   à l'outil (journal existant), sinon par date d'ajout — pas d'historique de consultation ;
//   - alertes     : règles actuelles de chaque module (loyers : computeUnpaidDueMonths ; CEET/TDE :
//                   parts réellement non payées d'une facture validée ; Tontine : tour courant) ;
//   - activités   : journal existant (activityService).
// Une information qui ne peut pas être établie sans ambiguïté n'est pas affichée. Charger l'accueil
// ne crée aucune activité et ne provisionne aucun outil (lecture seule, hors rattrapage idempotent
// des installations existantes du registre).

import { reconcileAdvances } from './rentAdvanceService';
import { ANNOUNCEMENTS, type LocalAnnouncement } from '@/constants/announcements';
import { formatFcfa, formatLongDate } from '@/utils/format';
import { getRecentActivities } from './activityService';
import { coreService } from './coreService';
import { effectivePaiementsFor } from './effectivePayments';
import { computeUnpaidDueMonths } from './immobilierService';
import { isModuleLocked } from './moduleLock';
import { storage } from './storage';
import { ensureInstalledTools, getMyTools, type MyTool } from './toolRegistryService';
import { loadTontineOverview, type TontineOverview } from './tontineOverviewService';
import { loadModuleOverview, type ModuleDashboard } from './utilityOverviewService';
import type { UtilityModule } from './utilityParticipantsService';
import type { ActivityEvent, RecordItem } from '@/types/entities';

export type AlertModule = 'immobilier' | UtilityModule | 'tontine';
export type AlertSeverity = 'late' | 'pending' | 'info';

export interface HomeAlert {
  id: string;
  module: AlertModule;
  severity: AlertSeverity;
  title: string;
  detail: string;
  route: string;
}

export interface HomeFeed {
  tools: MyTool[];
  alerts: HomeAlert[];
  activities: ActivityEvent[];
  announcement: LocalAnnouncement | null;
}

export const MAX_ALERTS = 5;
export const MAX_ACTIVITIES = 3;
const DISMISSED_KEY = 'announcements_dismissed';

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const SEVERITY_ORDER: Record<AlertSeverity, number> = { late: 0, pending: 1, info: 2 };

// ---- Fonctions pures ----------------------------------------------------------------

/** Outils les plus récemment utilisés d'abord : dernière activité du journal portant le toolId de
 * l'outil, à défaut sa date d'ajout. Aucune consultation n'est enregistrée pour cela. */
export function sortToolsByRecency(tools: readonly MyTool[], events: readonly ActivityEvent[]): MyTool[] {
  const stamp = (t: MyTool): string => {
    let latest = '';
    for (const e of events) if (e.toolId === t.tool.id && e.at > latest) latest = e.at;
    return latest || String(t.tool.settings?.installedAt ?? t.tool.createdAt);
  };
  return tools
    .map((tool, index) => ({ tool, index, at: stamp(tool) }))
    .sort((a, b) => (a.at === b.at ? a.index - b.index : a.at < b.at ? 1 : -1))
    .map((e) => e.tool);
}

/** Loyers en retard : mois entièrement écoulés et non payés des contrats actifs (règle d'Immobilier).
 * Seuls des comptes sont affichés — aucun montant, le loyer pouvant avoir changé d'un mois à l'autre. */
export function buildImmobilierAlert(contrats: readonly RecordItem[], paiements: readonly RecordItem[], now: Date = new Date()): HomeAlert | null {
  let contratsEnRetard = 0;
  let moisImpayes = 0;
  for (const contrat of contrats) {
    if (contrat.statusKey !== 'actif') continue;
    const unpaid = computeUnpaidDueMonths(contrat, paiements as RecordItem[], now).length;
    if (unpaid > 0) {
      contratsEnRetard += 1;
      moisImpayes += unpaid;
    }
  }
  if (contratsEnRetard === 0) return null;
  return {
    id: 'immobilier-retard',
    module: 'immobilier',
    severity: 'late',
    title: 'Loyers en retard',
    detail: `${plural(contratsEnRetard, 'contrat')} · ${plural(moisImpayes, 'loyer impayé', 'loyers impayés')}`,
    route: '/immobilier',
  };
}

/** Parts CEET ou TDE réellement non payées — uniquement celles de factures VALIDÉES (une facture pas encore
 * répartie n'a aucune part et n'est donc jamais comptée). Le fournisseur n'est jamais mélangé avec l'autre. */
export function buildUtilityAlert(module: UtilityModule, dashboard: Pick<ModuleDashboard, 'aRegler' | 'aRecevoir'>): HomeAlert | null {
  const parts = dashboard.aRegler.reduce((sum, row) => sum + Math.max(0, row.total - row.paid), 0);
  if (parts === 0 || dashboard.aRecevoir <= 0) return null;
  return {
    id: `${module}-parts`,
    module,
    severity: 'pending',
    title: `${module.toUpperCase()} : parts à régler`,
    detail: `${plural(parts, 'part')} · ${formatFcfa(dashboard.aRecevoir)} · ${plural(dashboard.aRegler.length, 'facture')}`,
    route: `/${module}`,
  };
}

/** Échéances de tontine d'après la synthèse existante (tour courant et statuts de tontineService) :
 * chaque tour en retard, puis la prochaine échéance À VENIR (un tour en retard ne la masque pas). */
export function buildTontineAlerts(overview: Pick<TontineOverview, 'tontines'>): HomeAlert[] {
  const alerts: HomeAlert[] = [];
  for (const card of overview.tontines) {
    if (card.tourStatus !== 'late' || !card.tour) continue;
    const missing = Math.max(0, card.memberCount - card.paidCount);
    alerts.push({
      id: `tontine-retard:${card.groupId}`,
      module: 'tontine',
      severity: 'late',
      title: 'Tour en retard',
      detail: `${card.name} · échéance ${formatLongDate(new Date(card.tour.scheduledDate))} · ${plural(missing, 'cotisation manquante', 'cotisations manquantes')}`,
      route: `/group/${card.groupId}/tontine`,
    });
  }
  const upcoming = overview.tontines
    .filter((c) => c.tour && c.tourStatus !== 'late' && c.tourStatus !== 'complete')
    .sort((a, b) => (a.tour!.scheduledDate < b.tour!.scheduledDate ? -1 : a.tour!.scheduledDate > b.tour!.scheduledDate ? 1 : 0))[0];
  if (upcoming) {
    alerts.push({
      id: `tontine-echeance:${upcoming.groupId}`,
      module: 'tontine',
      severity: 'info',
      title: 'Prochaine échéance',
      detail: `${upcoming.name}${upcoming.nextBeneficiary ? ` · ${upcoming.nextBeneficiary}` : ''} · ${formatLongDate(new Date(upcoming.tour!.scheduledDate))}`,
      route: `/group/${upcoming.groupId}/tontine`,
    });
  }
  return alerts;
}

export function sortAlerts(alerts: readonly HomeAlert[], limit = MAX_ALERTS): HomeAlert[] {
  return alerts
    .map((alert, index) => ({ alert, index }))
    .sort((a, b) => SEVERITY_ORDER[a.alert.severity] - SEVERITY_ORDER[b.alert.severity] || a.index - b.index)
    .map((e) => e.alert)
    .slice(0, limit);
}

/** Première annonce locale non masquée, ou null. */
export function selectAnnouncement(list: readonly LocalAnnouncement[], dismissed: readonly string[]): LocalAnnouncement | null {
  return list.find((a) => !dismissed.includes(a.id)) ?? null;
}

// ---- Annonces masquées (préférence locale de l'appareil) -----------------------------

export async function loadDismissedAnnouncements(): Promise<string[]> {
  try {
    const stored = await storage.get<string[]>(DISMISSED_KEY);
    return Array.isArray(stored) ? stored : [];
  } catch {
    return [];
  }
}

export async function dismissAnnouncement(id: string): Promise<void> {
  const current = await loadDismissedAnnouncements();
  if (!current.includes(id)) await storage.set(DISMISSED_KEY, [...current, id]);
}

// ---- Chargement ----------------------------------------------------------------------

/** Une source en échec ne doit jamais vider ni casser l'accueil : elle est simplement ignorée. */
async function safe<T>(fn: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await fn();
  } catch {
    return fallback;
  }
}

// Clés des entités Immobilier (définies dans immobilierService, non exportées).
const CONTRAT_KEY = 'contrat';
const PAIEMENT_KEY = 'paiement';

async function immobilierAlerts(toolId: string, now: Date): Promise<HomeAlert[]> {
  const definitions = await coreService.getEntityDefinitions(toolId);
  const contratDef = definitions.find((d) => d.key === CONTRAT_KEY);
  const paiementDef = definitions.find((d) => d.key === PAIEMENT_KEY);
  if (!contratDef || !paiementDef) return [];
  const [contrats, paiements] = await Promise.all([
    coreService.getRecords({ toolId, entityDefinitionId: contratDef.id }),
    coreService.getRecords({ toolId, entityDefinitionId: paiementDef.id }).then(effectivePaiementsFor),
  ]);
  const alert = buildImmobilierAlert(contrats, paiements, now);
  return alert ? [alert] : [];
}

async function utilityAlerts(module: UtilityModule): Promise<HomeAlert[]> {
  // Sans outil Factures, il n'y a rien à lire — et on ne le crée pas en ouvrant l'accueil.
  if (!(await coreService.getTools({ kind: 'facture' }))[0]) return [];
  const alert = buildUtilityAlert(module, (await loadModuleOverview(module)).dashboard);
  return alert ? [alert] : [];
}

export async function loadHomeFeed(now: Date = new Date()): Promise<HomeFeed> {
  await safe(() => ensureInstalledTools(), []); // une installation existante retrouve ses outils
  const mine = await safe(() => getMyTools(), { owned: [], shared: [], hidden: [] });
  const installed = new Map(mine.owned.map((t) => [t.model.key, t]));
  const activities = getRecentActivities();

  const alerts: HomeAlert[] = [];
  const immobilier = installed.get('immobilier');
  if (immobilier) await safe(() => reconcileAdvances(now), 0); // mois couverts par l'avance autorisée : à jour avant de calculer les retards
  if (immobilier) alerts.push(...(await safe(() => immobilierAlerts(immobilier.tool.id, now), [])));
  for (const module of ['ceet', 'tde'] as const) {
    if (installed.has(module) && !isModuleLocked('utility')) alerts.push(...(await safe(() => utilityAlerts(module), [])));
  }
  if (installed.has('tontine') && !isModuleLocked('tontine')) {
    const overview = await safe(() => loadTontineOverview(), null);
    if (overview) alerts.push(...buildTontineAlerts(overview));
  }

  return {
    tools: sortToolsByRecency(mine.owned, activities),
    alerts: sortAlerts(alerts),
    activities: activities.slice(0, MAX_ACTIVITIES),
    announcement: selectAnnouncement(ANNOUNCEMENTS, await loadDismissedAnnouncements()),
  };
}
