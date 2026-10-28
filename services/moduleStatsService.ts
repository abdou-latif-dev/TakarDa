// Historique et statistiques d'Immobilier, CEET et TDE : fonctions de LECTURE pures + chargeurs en lecture seule.
//
// Règles de cette phase :
//  - tout est calculé à la lecture depuis les données actuelles (aucun total stocké qui pourrait diverger) ;
//  - rien n'est inventé : une valeur qui ne peut pas être établie vaut `null`, jamais 0 quand cela changerait
//    le sens (ex. consommation inconnue ≠ consommation nulle) ;
//  - les chargeurs ne créent ni outil, ni donnée, ni activité (pas de provisionnement : sans outil, ils renvoient null) ;
//  - CEET et TDE ne sont jamais mélangés (isolation par les factures de chaque fournisseur) ;
//  - les montants et consommations CEET/TDE viennent des PARTS FIGÉES à la validation : modifier ensuite un relevé,
//    un participant ou son nom ne change ni les anciennes répartitions ni les reçus.

import { formatLongDate } from '@/utils/format';
import { coreService } from './coreService';
import { effectivePaiementsFor } from './effectivePayments';
import { computeUnpaidDueMonths, getActiveContrat } from './immobilierService';
import { getRecentActivities } from './activityService';
import { isModuleLocked } from './moduleLock';
import { getPartPaymentInfo, periodeLabel } from './utilityBillingService';
import { facturesOfModule } from './utilityOverviewService';
import type { UtilityModule } from './utilityParticipantsService';
import type { ActivityEvent, ExternalContact, RecordItem } from '@/types/entities';

const PERIODE = /^\d{4}-(0[1-9]|1[0-2])$/;
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const text = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');
const monthIndex = (periode: string) => {
  const [y, m] = periode.split('-').map(Number);
  return y * 12 + (m - 1);
};

// ================================================================================================
// Immobilier
// ================================================================================================

export type StatsPeriod = 'all' | 'month' | 'year';

export interface ImmobilierStats {
  biens: number;
  logements: number;
  occupes: number;
  vacants: number;
  contratsActifs: number;
  contratsTermines: number;
  /** Loyers effectivement encaissés : paiements `paye` dont la date de validation tombe dans la période. */
  encaisse: { period: StatsPeriod; amount: number; count: number; /** paiements sans date exploitable, exclus d'une période précise */ sansDate: number };
  /** Mois entièrement écoulés et non payés des contrats actifs (règle d'Immobilier). Des comptes seulement :
   * un montant attendu n'est pas affiché, le loyer pouvant changer d'un mois à l'autre. */
  impayes: { contrats: number; loyers: number };
}

const inPeriod = (day: string, now: Date, period: StatsPeriod): boolean => {
  if (period === 'all') return true;
  const year = String(now.getFullYear());
  return period === 'year' ? day.startsWith(`${year}-`) : day.startsWith(`${year}-${String(now.getMonth() + 1).padStart(2, '0')}`);
};

export function buildImmobilierStats(
  input: { biens: readonly RecordItem[]; logements: readonly RecordItem[]; contrats: readonly RecordItem[]; paiements: readonly RecordItem[] },
  now: Date = new Date(),
  period: StatsPeriod = 'all',
): ImmobilierStats {
  const contrats = input.contrats as RecordItem[];
  const occupes = input.logements.filter((l) => getActiveContrat(l.id, contrats) !== null).length;

  let amount = 0;
  let count = 0;
  let sansDate = 0;
  for (const p of input.paiements) {
    const montant = num(p.values.montant);
    if (p.statusKey !== 'paye' || montant === null) continue;
    const day = text(p.values.date_validation);
    const dated = /^\d{4}-\d{2}-\d{2}/.test(day);
    if (period !== 'all' && !dated) {
      sansDate += 1;
      continue;
    }
    if (inPeriod(day, now, period)) {
      amount += montant;
      count += 1;
    }
  }

  let contratsEnRetard = 0;
  let loyersImpayes = 0;
  for (const c of contrats) {
    if (c.statusKey !== 'actif') continue;
    const unpaid = computeUnpaidDueMonths(c, input.paiements as RecordItem[], now).length;
    if (unpaid > 0) {
      contratsEnRetard += 1;
      loyersImpayes += unpaid;
    }
  }

  return {
    biens: input.biens.length,
    logements: input.logements.length,
    occupes,
    vacants: input.logements.length - occupes,
    contratsActifs: contrats.filter((c) => c.statusKey === 'actif').length,
    contratsTermines: contrats.filter((c) => c.statusKey === 'termine').length,
    encaisse: { period, amount, count, sansDate },
    impayes: { contrats: contratsEnRetard, loyers: loyersImpayes },
  };
}

/** Historique d'Immobilier : les paiements ENREGISTRÉS (source de vérité, y compris ceux d'avant le journal) et
 * les autres événements du journal du module. Un paiement n'apparaît qu'une fois ; son événement de journal
 * n'est repris que si l'enregistrement du paiement n'existe plus (ex. contrat supprimé). Les événements des
 * autres modules ne sont jamais repris. Lignes affichables comme des activités, de la plus récente à la plus ancienne. */
export function buildImmobilierHistory(input: {
  paiements: readonly RecordItem[];
  logements: readonly RecordItem[];
  contacts: readonly Pick<ExternalContact, 'id' | 'name'>[];
  activities: readonly ActivityEvent[];
}): ActivityEvent[] {
  const logementName = new Map(input.logements.map((l) => [l.id, text(l.values.nom)]));
  const contactName = new Map(input.contacts.map((c) => [c.id, c.name]));
  const paiementIds = new Set(input.paiements.map((p) => p.id));

  const payments: ActivityEvent[] = input.paiements
    .filter((p) => p.statusKey === 'paye')
    .map((p) => {
      const mois = text(p.values.mois);
      const parts = [contactName.get(text(p.values.locataire_id)), logementName.get(text(p.values.logement))].filter(Boolean).join(' — ');
      const montant = num(p.values.montant);
      return {
        id: `paiement:${p.id}`,
        type: 'immobilier.loyer_paid' as const,
        title: 'Loyer enregistré',
        description: `${parts}${parts && mois ? ' · ' : ''}${PERIODE.test(mois) ? periodeLabel(mois) : mois}`,
        at: p.createdAt,
        module: 'immobilier' as const,
        entityType: 'paiement',
        entityId: p.id,
        ...(montant !== null ? { amount: montant } : {}),
      };
    });

  const events = input.activities.filter((e) => e.module === 'immobilier' && !(e.type === 'immobilier.loyer_paid' && e.entityId && paiementIds.has(e.entityId)));
  return [...payments, ...events]
    .map((event, index) => ({ event, index }))
    .sort((a, b) => (a.event.at === b.event.at ? a.index - b.index : a.event.at < b.event.at ? 1 : -1))
    .map((e) => e.event);
}

// ================================================================================================
// CEET / TDE
// ================================================================================================

export interface UtilityPeriodStat {
  periode: string;
  /** Montant des factures validées de la période ; null si l'une n'a pas de montant. */
  montantFacture: number | null;
  /** Consommation de la période : somme des consommations FIGÉES des parts d'une répartition PAR COMPTEUR ; null sinon
   * (partage équitable : aucune consommation n'est connue). */
  consommation: number | null;
  /** Variation de consommation en % par rapport au mois précédent immédiat, seulement si les deux consommations
   * sont connues et la précédente non nulle ; null sinon. */
  variation: number | null;
}

export interface UtilityStats {
  module: UtilityModule;
  /** Factures dont la répartition est validée (elles ont des parts). */
  facturesValidees: number;
  /** Factures créées mais pas encore réparties : ni parts, ni impayé. */
  facturesEnAttente: number;
  parts: { total: number; payees: number; restantes: number };
  /** Sommes des montants FIGÉS des parts. */
  montants: { paye: number; restant: number };
  /** Périodes AAAA-MM des factures validées, de la plus récente à la plus ancienne. */
  periodes: UtilityPeriodStat[];
  /** Factures validées dont la période n'est pas au format AAAA-MM : comptées partout, mais absentes de `periodes`. */
  periodesNonStandard: number;
}

export function buildUtilityStats(module: UtilityModule, factures: readonly RecordItem[], parts: readonly RecordItem[]): UtilityStats {
  const own = facturesOfModule(factures as RecordItem[], module);
  const partsOf = (f: RecordItem) => parts.filter((p) => p.values.facture_partagee === f.id);
  const validated = own.filter((f) => partsOf(f).length > 0);
  const allParts = validated.flatMap(partsOf);
  const paid = allParts.filter((p) => p.statusKey === 'payee');
  const unpaid = allParts.filter((p) => p.statusKey !== 'payee');
  const sum = (list: RecordItem[]) => list.reduce((s, p) => s + (num(p.values.montant_attribue) ?? 0), 0);

  const byPeriod = new Map<string, RecordItem[]>();
  let nonStandard = 0;
  for (const f of validated) {
    const periode = text(f.values.mois);
    if (!PERIODE.test(periode)) {
      nonStandard += 1;
      continue;
    }
    byPeriod.set(periode, [...(byPeriod.get(periode) ?? []), f]);
  }

  const stats = new Map<string, Omit<UtilityPeriodStat, 'variation'>>();
  for (const [periode, list] of byPeriod) {
    const montants = list.map((f) => num(f.values.montant_total));
    // Une consommation n'existe que pour une répartition PAR COMPTEUR : les parts d'un partage équitable portent
    // `consommation: 0`, ce qui n'est pas une consommation connue.
    const consommations = list.map((f) => {
      if (f.values.mode_repartition !== 'proportionnel') return null;
      const consos = partsOf(f).map((p) => num(p.values.consommation));
      return consos.every((c) => c !== null) ? (consos as number[]).reduce((s, c) => s + c, 0) : null;
    });
    stats.set(periode, {
      periode,
      montantFacture: montants.every((m) => m !== null) ? (montants as number[]).reduce((s, m) => s + m, 0) : null,
      consommation: consommations.every((c) => c !== null) ? (consommations as number[]).reduce((s, c) => s + c, 0) : null,
    });
  }

  const periodes = [...stats.values()].sort((a, b) => (a.periode < b.periode ? 1 : -1)).map((s): UtilityPeriodStat => {
    const previous = stats.get(previousMonth(s.periode));
    const variation =
      s.consommation !== null && previous && previous.consommation !== null && previous.consommation > 0
        ? Math.round(((s.consommation - previous.consommation) / previous.consommation) * 1000) / 10
        : null;
    return { ...s, variation };
  });

  return {
    module,
    facturesValidees: validated.length,
    facturesEnAttente: own.length - validated.length,
    parts: { total: allParts.length, payees: paid.length, restantes: unpaid.length },
    montants: { paye: sum(paid), restant: sum(unpaid) },
    periodes,
    periodesNonStandard: nonStandard,
  };
}

function previousMonth(periode: string): string {
  const index = monthIndex(periode) - 1;
  return `${Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, '0')}`;
}

export interface UtilityPaymentRow {
  partId: string;
  /** Nom figé dans la part au moment de la validation. */
  label: string;
  periode: string;
  montant: number | null;
  /** Date réelle du paiement, ou null si elle n'a pas été enregistrée (anciennes parts) — jamais la date du jour. */
  datePaiement: string | null;
}

/** Paiements de parts du fournisseur (parts payées de SES factures uniquement), le plus récent d'abord ;
 * les paiements sans date enregistrée sont listés en dernier. */
export function buildUtilityPayments(module: UtilityModule, factures: readonly RecordItem[], parts: readonly RecordItem[]): UtilityPaymentRow[] {
  const own = new Map(facturesOfModule(factures as RecordItem[], module).map((f) => [f.id, f]));
  return parts
    .filter((p) => p.statusKey === 'payee' && own.has(String(p.values.facture_partagee)))
    .map((p) => {
      const facture = own.get(String(p.values.facture_partagee))!;
      return {
        partId: p.id,
        label: text(p.values.label) || 'Participant',
        periode: text(p.values.periode) || text(facture.values.mois),
        montant: num(p.values.montant_attribue),
        datePaiement: getPartPaymentInfo(p).date,
      };
    })
    .sort((a, b) => (a.datePaiement === b.datePaiement ? 0 : a.datePaiement === null ? 1 : b.datePaiement === null ? -1 : a.datePaiement < b.datePaiement ? 1 : -1));
}

export const formatPaymentDate = (day: string | null): string => {
  const date = day ? new Date(`${day.slice(0, 10)}T12:00:00`) : null;
  return date && !Number.isNaN(date.getTime()) ? `${formatLongDate(date)} ${date.getFullYear()}` : 'date non enregistrée';
};

// ================================================================================================
// Chargeurs en lecture seule (aucun outil provisionné, aucune écriture)
// ================================================================================================

async function readEntities(kind: 'immobilier' | 'facture', keys: readonly string[]): Promise<Record<string, RecordItem[]> | null> {
  const tool = (await coreService.getTools({ kind }))[0];
  if (!tool) return null;
  const definitions = await coreService.getEntityDefinitions(tool.id);
  const out: Record<string, RecordItem[]> = {};
  for (const key of keys) {
    const definition = definitions.find((d) => d.key === key);
    const records = definition ? await coreService.getRecords({ toolId: tool.id, entityDefinitionId: definition.id }) : [];
    out[key] = kind === 'immobilier' && key === 'paiement' ? await effectivePaiementsFor(records) : records;
  }
  return out;
}

const IMMO_KEYS = ['bien', 'logement', 'contrat', 'paiement'] as const;
const FACTURE_KEYS = ['facture_partagee', 'part_locataire'] as const;

/** null tant que l'outil Immobilier n'existe pas (rien n'est provisionné pour afficher une statistique). */
export async function loadImmobilierStats(period: StatsPeriod = 'all', now: Date = new Date()): Promise<ImmobilierStats | null> {
  const data = await readEntities('immobilier', IMMO_KEYS);
  return data ? buildImmobilierStats({ biens: data.bien, logements: data.logement, contrats: data.contrat, paiements: data.paiement }, now, period) : null;
}

export async function loadImmobilierHistory(): Promise<ActivityEvent[]> {
  const data = await readEntities('immobilier', IMMO_KEYS);
  const contacts = data ? await coreService.getExternalContacts() : [];
  return buildImmobilierHistory({ paiements: data?.paiement ?? [], logements: data?.logement ?? [], contacts, activities: getRecentActivities() });
}

export async function loadUtilityStats(module: UtilityModule): Promise<UtilityStats | null> {
  if (isModuleLocked('utility')) return null; // indisponible en contexte multi-compte (moduleLock.ts)
  const data = await readEntities('facture', FACTURE_KEYS);
  return data ? buildUtilityStats(module, data.facture_partagee, data.part_locataire) : null;
}

export async function loadUtilityPayments(module: UtilityModule): Promise<UtilityPaymentRow[]> {
  if (isModuleLocked('utility')) return [];
  const data = await readEntities('facture', FACTURE_KEYS);
  return data ? buildUtilityPayments(module, data.facture_partagee, data.part_locataire) : [];
}
