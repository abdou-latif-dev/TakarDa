// Rapport Immobilier — consultation INFORMATIVE d'un mois, pour un bien ou pour tous les biens.
//
// Lecture seule : rien ici ne modifie un paiement, un contrat ou une avance. Tout est calculé à la lecture à partir des
// données enregistrées ; ce qui ne peut pas être établi est signalé dans `missing`, jamais remplacé par un chiffre.
//
// Séparations impératives :
//  - LOYERS encaissés = vrais paiements `paye` du mois (un paiement n'est compté qu'une fois) ;
//  - AVANCE : mois `couvert` par l'avance — ce n'est pas un loyer encaissé ;
//  - CAUTION : somme détenue, jamais un revenu et jamais ajoutée aux loyers.
// Limite connue : le loyer d'un mois est le loyer actuel du contrat (l'historique des changements de loyer n'est pas
// conservé) ; pour un mois couvert ou payé, c'est toutefois le montant figé qui est repris.

import { coreService } from './coreService';
import { effectivePaiementsFor } from './effectivePayments';
import { firstDueMonth, getActiveContrat, settledMonthsOf } from './immobilierService';
import { coveragesOf, getAdvanceStatus } from './rentAdvanceService';
import type { FieldValue, RecordItem } from '@/types/entities';

const MOIS = /^\d{4}-(0[1-9]|1[0-2])$/;
const num = (v: FieldValue | undefined): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const text = (v: FieldValue | undefined): string => (typeof v === 'string' ? v.trim() : '');
const monthIndex = (m: string): number => {
  const [y, mo] = m.split('-').map(Number);
  return y * 12 + (mo - 1);
};
const monthOfDay = (day: string): string | null => (/^\d{4}-\d{2}/.test(day) ? day.slice(0, 7) : null);
export const currentMonth = (now: Date): string => `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

export interface ReportInput {
  biens: readonly RecordItem[];
  logements: readonly RecordItem[];
  contrats: readonly RecordItem[];
  /** Tous les enregistrements de la collection des paiements : paiements `paye` ET mois `couvert`. */
  paiements: readonly RecordItem[];
}

export interface ReportEvent {
  id: string;
  kind: 'paiement' | 'avance' | 'contrat_cree' | 'contrat_termine';
  title: string;
  detail: string;
  amount: number | null;
  day: string | null;
}

export interface ImmobilierReport {
  scope: { kind: 'all' | 'bien'; bienId: string | null; label: string };
  period: string;
  logements: { total: number; occupes: number; vacants: number };
  loyers: {
    /** Loyers dus pour le mois par les contrats actifs concernés. */
    attendus: number;
    /** Vrais paiements du mois (statut `paye`). */
    encaisses: number;
    paiements: number;
    /** Mois entièrement écoulé non réglé : en retard. */
    enRetard: { contrats: number; montant: number };
    /** Mois en cours non encore réglé : à payer. */
    aPayer: { contrats: number; montant: number };
  };
  avances: {
    /** Avance enregistrée des contrats actifs. */
    enregistrees: number;
    /** Part consommée par des mois couverts. */
    consommees: number;
    /** Avance restante des contrats qui l'utilisent automatiquement. */
    disponibles: number;
    /** Mois de la période couverts par l'avance (jamais comptés comme loyers encaissés). */
    couvertsCePeriode: { mois: number; montant: number };
    contratsEpuises: number;
  };
  cautions: { detenues: number; contrats: number };
  evenements: ReportEvent[];
  /** Données qui manquent ou qui limitent la précision du rapport. */
  missing: string[];
}

/** Contrat « actif pendant le mois » : entré au plus tard ce mois-là, non sorti avant. */
function activeDuring(contrat: RecordItem, period: string): boolean {
  const entree = monthOfDay(text(contrat.values.date_entree)) ?? monthOfDay(contrat.createdAt);
  if (entree && monthIndex(entree) > monthIndex(period)) return false;
  const sortie = monthOfDay(text(contrat.values.date_sortie));
  if (contrat.statusKey === 'actif') return true;
  return sortie !== null && monthIndex(sortie) >= monthIndex(period);
}

export function buildImmobilierReport(input: ReportInput, opts: { bienId?: string | null; period: string }, now: Date = new Date()): ImmobilierReport {
  const period = MOIS.test(opts.period) ? opts.period : currentMonth(now);
  const bienId = opts.bienId ?? null;
  const bien = bienId ? input.biens.find((b) => b.id === bienId) : null;
  const logements = input.logements.filter((l) => !bienId || l.values.bien === bienId);
  const logementIds = new Set(logements.map((l) => l.id));
  const contrats = input.contrats.filter((c) => (!bienId || c.values.bien === bienId || logementIds.has(text(c.values.logement))));
  const contratIds = new Set(contrats.map((c) => c.id));
  const paiements = input.paiements.filter((p) => contratIds.has(text(p.values.contrat)));
  const missing: string[] = [];

  const occupes = logements.filter((l) => getActiveContrat(l.id, contrats as RecordItem[]) !== null).length;
  const nowMonth = currentMonth(now);

  // ---- loyers du mois ----
  let attendus = 0;
  let encaisses = 0;
  let nbPaiements = 0;
  const retard = { contrats: 0, montant: 0 };
  const aPayer = { contrats: 0, montant: 0 };
  let sansLoyer = 0;
  const seen = new Set<string>();

  for (const contrat of contrats) {
    if (!activeDuring(contrat, period)) continue;
    const loyer = num(contrat.values.loyer_mensuel);
    const first = firstDueMonth(contrat);
    const due = first !== null && monthIndex(first) <= monthIndex(period);
    const mine = paiements.filter((p) => p.values.contrat === contrat.id);
    const payeThisMonth = mine.filter((p) => p.statusKey === 'paye' && p.values.mois === period);
    const couvertThisMonth = coveragesOf(contrat.id, mine).filter((p) => p.values.mois === period);
    for (const p of payeThisMonth) {
      if (seen.has(p.id)) continue; // un même enregistrement n'est jamais compté deux fois
      seen.add(p.id);
      encaisses += num(p.values.montant) ?? 0;
      nbPaiements += 1;
    }

    if (loyer === null || loyer <= 0) {
      if (due) sansLoyer += 1;
      continue;
    }
    if (!due) continue; // mois déjà réglé avant le suivi dans TakarDa (dernier loyer payé déclaré) ou avant l'entrée
    attendus += loyer;
    const settled = settledMonthsOf(contrat, mine as RecordItem[]).has(period);
    if (!settled && couvertThisMonth.length === 0 && contrat.statusKey === 'actif') {
      if (monthIndex(period) < monthIndex(nowMonth)) {
        retard.contrats += 1;
        retard.montant += loyer;
      } else if (period === nowMonth) {
        aPayer.contrats += 1;
        aPayer.montant += loyer;
      }
    }
  }
  if (sansLoyer > 0) missing.push(`${sansLoyer} contrat${sansLoyer > 1 ? 's' : ''} sans loyer mensuel : non compté${sansLoyer > 1 ? 's' : ''} dans les loyers attendus.`);

  // ---- avances ----
  let enregistrees = 0;
  let consommees = 0;
  let disponibles = 0;
  let epuises = 0;
  let couvMois = 0;
  let couvMontant = 0;
  for (const contrat of contrats) {
    if (contrat.statusKey !== 'actif') continue;
    const mine = paiements.filter((p) => p.values.contrat === contrat.id);
    const avance = num(contrat.values.avance);
    if (avance && avance > 0) {
      const status = getAdvanceStatus(contrat, mine);
      enregistrees += avance;
      consommees += status.consumed;
      if (status.authorized) {
        disponibles += status.balance;
        if (status.exhausted) epuises += 1;
      }
    }
  }
  for (const contrat of contrats) {
    for (const c of coveragesOf(contrat.id, paiements.filter((p) => p.values.contrat === contrat.id))) {
      if (c.values.mois === period) {
        couvMois += 1;
        couvMontant += num(c.values.montant) ?? 0;
      }
    }
  }

  // ---- cautions (séparées des loyers) ----
  const withCaution = contrats.filter((c) => c.statusKey === 'actif' && (num(c.values.caution) ?? 0) > 0);
  const cautions = { detenues: withCaution.reduce((sum, c) => sum + (num(c.values.caution) ?? 0), 0), contrats: withCaution.length };
  if (withCaution.length > 0) missing.push('Cautions : montants des contrats actifs ; la restitution d’une caution n’est pas encore suivie dans TakarDa.');

  // ---- événements du mois ----
  const events: ReportEvent[] = [];
  for (const p of paiements) {
    if (p.statusKey === 'paye') {
      const day = text(p.values.date_validation);
      if (monthOfDay(day) === period) {
        events.push({ id: `p:${p.id}`, kind: 'paiement', title: 'Loyer encaissé', detail: `Loyer de ${text(p.values.mois) || '—'}`, amount: num(p.values.montant), day });
      } else if (!day) {
        missing.push('Un paiement n’a pas de date de validation : il ne peut pas être placé dans une période par date.');
      }
    } else if (p.statusKey === 'couvert' && monthOfDay(text(p.values.date_couverture)) === period) {
      events.push({ id: `a:${p.id}`, kind: 'avance', title: 'Mois couvert par l’avance', detail: `Loyer de ${text(p.values.mois)} (pas un paiement)`, amount: num(p.values.montant), day: text(p.values.date_couverture) });
    }
  }
  for (const c of contrats) {
    const created = monthOfDay(text(c.values.date_entree)) ?? monthOfDay(c.createdAt);
    if (created === period) events.push({ id: `c:${c.id}`, kind: 'contrat_cree', title: 'Nouveau contrat', detail: '', amount: null, day: text(c.values.date_entree) || null });
    const sortie = text(c.values.date_sortie);
    if (c.statusKey === 'termine' && monthOfDay(sortie) === period) events.push({ id: `s:${c.id}`, kind: 'contrat_termine', title: 'Contrat terminé', detail: '', amount: null, day: sortie });
  }
  events.sort((a, b) => (b.day ?? '').localeCompare(a.day ?? ''));

  const uniqueMissing = [...new Set(missing)];
  return {
    scope: { kind: bienId ? 'bien' : 'all', bienId, label: bienId ? text(bien?.values.nom) || 'Bien' : 'Tous les biens' },
    period,
    logements: { total: logements.length, occupes, vacants: logements.length - occupes },
    loyers: { attendus, encaisses, paiements: nbPaiements, enRetard: retard, aPayer },
    avances: { enregistrees, consommees, disponibles, couvertsCePeriode: { mois: couvMois, montant: couvMontant }, contratsEpuises: epuises },
    cautions,
    evenements: events,
    missing: uniqueMissing,
  };
}

/** Chargeur en lecture seule : sans outil Immobilier, rien n'est créé et le rapport est null. */
export async function loadImmobilierReport(opts: { bienId?: string | null; period: string }, now: Date = new Date()): Promise<{ report: ImmobilierReport; biens: RecordItem[] } | null> {
  const tool = (await coreService.getTools({ kind: 'immobilier' }))[0];
  if (!tool) return null;
  const definitions = await coreService.getEntityDefinitions(tool.id);
  const read = async (key: string): Promise<RecordItem[]> => {
    const def = definitions.find((d) => d.key === key);
    return def ? coreService.getRecords({ toolId: tool.id, entityDefinitionId: def.id }) : [];
  };
  const [biens, logements, contrats, paiements] = await Promise.all([read('bien'), read('logement'), read('contrat'), read('paiement').then(effectivePaiementsFor)]);
  return { report: buildImmobilierReport({ biens, logements, contrats, paiements }, opts, now), biens };
}
