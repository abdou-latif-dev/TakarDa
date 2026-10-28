// Avance consommable — Immobilier.
//
// L'AVANCE est un montant affecté à des loyers futurs ; la CAUTION est un autre montant et ne couvre JAMAIS
// un loyer ici (son utilisation éventuelle sera une décision explicite du bailleur, tracée, dans une étape à part).
//
// Quand le bailleur autorise « Utiliser automatiquement l'avance » sur un contrat (`avance_utilisable`, désactivé
// par défaut), chaque mois DÛ (mois en cours ou écoulé) est couvert tant que l'avance restante couvre un loyer
// ENTIER. Un mois couvert est un enregistrement de statut distinct `couvert` dans la collection des paiements :
//   - ce n'est PAS un paiement (pas de mode de paiement, pas de date de validation, aucun reçu) ;
//   - il compte comme « réglé » pour les échéances et les retards (immobilierService.settledMonthsOf) ;
//   - il n'est jamais compté dans les loyers encaissés (les statistiques ne lisent que le statut `paye`) ;
//   - il fige le loyer du mois, l'avance avant/après et la date : trace complète, jamais recalculée.
// Pas de couverture partielle : un reste inférieur à un loyer reste inutilisé et le bailleur en est informé.
// La consommation ne remonte jamais avant le mois d'activation ni avant le premier mois dû du contrat, et
// ne touche aucun paiement existant. Le calcul est idempotent : un mois n'est couvert qu'une fois.

import { coreService } from './coreService';
import { effectivePaiementsFor } from './effectivePayments';
import { ensureImmobilierTool, firstDueMonth, settledMonthsOf, toIsoDay } from './immobilierService';
import { coverageRecordId } from './sync/derivedIds';
import type { FieldValue, RecordItem } from '@/types/entities';

const MOIS_FORMAT = /^\d{4}-\d{2}$/;
const monthIndex = (mois: string): number => {
  const [y, m] = mois.split('-').map(Number);
  return y * 12 + (m - 1);
};
const monthFromIndex = (index: number): string => `${Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, '0')}`;
const monthOfDate = (date: Date): string => monthFromIndex(date.getFullYear() * 12 + date.getMonth());
const num = (value: FieldValue | undefined): number | null => (typeof value === 'number' && Number.isFinite(value) ? value : null);

export const ADVANCE_STATUS_KEY = 'couvert';

export interface AdvanceCoverage {
  mois: string;
  /** Loyer du mois, figé au moment de la couverture. */
  montant: number;
}

export interface AdvanceStatus {
  /** Option activée sur ce contrat ET avance et loyer exploitables. */
  active: boolean;
  /** L'option est cochée (même si l'avance n'est plus exploitable). */
  authorized: boolean;
  avance: number;
  consumed: number;
  /** Avance non consommée (jamais négative). */
  balance: number;
  coveredMonths: number;
  /** Mois entiers que l'avance restante peut encore couvrir (0 si moins d'un loyer). */
  monthsLeft: number;
  /** Reste inutilisable : positif mais inférieur à un loyer. */
  unusableRemainder: number;
  /** Avance épuisée (ou trop faible pour un loyer entier) : un paiement normal redevient nécessaire. */
  exhausted: boolean;
}

export const isAdvanceAuthorized = (contrat: RecordItem): boolean => contrat.values.avance_utilisable === true;

/** Couvertures (statut `couvert`) d'un contrat. */
export function coveragesOf(contratId: string, paiements: readonly RecordItem[]): RecordItem[] {
  return paiements.filter((p) => p.values.contrat === contratId && p.statusKey === ADVANCE_STATUS_KEY && typeof p.values.mois === 'string');
}

export function getAdvanceStatus(contrat: RecordItem, paiements: readonly RecordItem[]): AdvanceStatus {
  const avance = num(contrat.values.avance) ?? 0;
  const loyer = num(contrat.values.loyer_mensuel) ?? 0;
  const covered = coveragesOf(contrat.id, paiements);
  const consumed = covered.reduce((sum, c) => sum + (num(c.values.montant) ?? 0), 0);
  const balance = Math.max(0, avance - consumed);
  const authorized = isAdvanceAuthorized(contrat);
  const monthsLeft = loyer > 0 ? Math.floor(balance / loyer) : 0;
  const unusableRemainder = loyer > 0 ? balance - monthsLeft * loyer : balance;
  return {
    active: authorized && contrat.statusKey === 'actif' && avance > 0 && loyer > 0,
    authorized,
    avance,
    consumed,
    balance,
    coveredMonths: covered.length,
    monthsLeft,
    unusableRemainder,
    exhausted: authorized && avance > 0 && (loyer <= 0 || balance < loyer),
  };
}

export interface AdvancePlan {
  toCover: AdvanceCoverage[];
  /** Avance restante une fois ces mois couverts. */
  balanceAfter: number;
  /** Premier mois dû qui n'a PAS pu être couvert faute d'avance suffisante (null s'il n'y en a pas). */
  blockedMonth: string | null;
}

/** Mois à couvrir MAINTENANT (fonction pure, sans écriture). */
export function planAdvanceCoverage(contrat: RecordItem, paiements: readonly RecordItem[], now: Date = new Date()): AdvancePlan {
  const status = getAdvanceStatus(contrat, paiements);
  const empty: AdvancePlan = { toCover: [], balanceAfter: status.balance, blockedMonth: null };
  if (!status.active) return empty;
  const loyer = num(contrat.values.loyer_mensuel) as number;

  const first = firstDueMonth(contrat);
  if (!first) return empty;
  const since = typeof contrat.values.avance_depuis === 'string' && MOIS_FORMAT.test(contrat.values.avance_depuis) ? contrat.values.avance_depuis : null;
  if (!since) return empty; // option cochée sans mois d'activation (donnée incohérente) : on ne consomme rien
  const start = Math.max(monthIndex(first), monthIndex(since));
  const last = monthIndex(monthOfDate(now)); // jamais un mois futur

  const settled = settledMonthsOf(contrat, paiements as RecordItem[]);
  let balance = status.balance;
  const toCover: AdvanceCoverage[] = [];
  for (let i = start; i <= last; i += 1) {
    const mois = monthFromIndex(i);
    if (settled.has(mois)) continue; // déjà payé ou déjà couvert : jamais consommé deux fois
    if (balance < loyer) return { toCover, balanceAfter: balance, blockedMonth: mois };
    toCover.push({ mois, montant: loyer });
    balance -= loyer;
  }
  return { toCover, balanceAfter: balance, blockedMonth: null };
}

const inFlight = new Set<string>();

/** Applique le plan d'un contrat : crée les couvertures manquantes, une seule fois par mois. Renvoie les mois couverts. */
export async function applyAdvanceCoverage(contratId: string, now: Date = new Date()): Promise<AdvanceCoverage[]> {
  if (inFlight.has(contratId)) return [];
  inFlight.add(contratId);
  try {
    const ents = await ensureImmobilierTool();
    const contrat = await coreService.getRecord(contratId);
    if (!contrat || contrat.entityDefinitionId !== ents.contrat.id) return [];
    const paiements = await effectivePaiementsFor(await coreService.getRecords({ toolId: ents.tool.id, entityDefinitionId: ents.paiement.id }));
    const plan = planAdvanceCoverage(contrat, paiements, now);
    if (plan.toCover.length === 0) return [];
    let balance = getAdvanceStatus(contrat, paiements).balance;
    for (const item of plan.toCover) {
      const before = balance;
      balance -= item.montant;
      await coreService.createRecord({
        // Identifiant déterministe : deux appareils qui calculent la même couverture produisent le MÊME enregistrement.
        id: coverageRecordId(contrat.id, item.mois),
        toolId: ents.tool.id,
        entityDefinitionId: ents.paiement.id,
        statusKey: ADVANCE_STATUS_KEY,
        values: {
          contrat: contrat.id,
          logement: typeof contrat.values.logement === 'string' ? contrat.values.logement : '',
          bien: typeof contrat.values.bien === 'string' ? contrat.values.bien : '',
          locataire_id: typeof contrat.values.locataire_id === 'string' ? contrat.values.locataire_id : '',
          mois: item.mois,
          montant: item.montant,
          source: 'avance',
          avance_avant: before,
          avance_restante: balance,
          date_couverture: toIsoDay(now),
        },
      });
    }
    return plan.toCover;
  } finally {
    inFlight.delete(contratId);
  }
}

/** Passe sur tous les contrats actifs qui l'autorisent (au démarrage et à l'ouverture d'Immobilier). Idempotent. */
export async function reconcileAdvances(now: Date = new Date()): Promise<number> {
  const ents = await ensureImmobilierTool();
  const contrats = await coreService.getRecords({ toolId: ents.tool.id, entityDefinitionId: ents.contrat.id });
  let covered = 0;
  for (const contrat of contrats) {
    if (contrat.statusKey !== 'actif' || !isAdvanceAuthorized(contrat)) continue;
    covered += (await applyAdvanceCoverage(contrat.id, now)).length;
  }
  return covered;
}

/** Le bailleur autorise la consommation de l'avance pour les loyers à venir. Désactivée par défaut, jamais rétroactive :
 * seuls les mois à partir du mois d'activation peuvent être couverts. */
export async function enableAdvanceUse(contratId: string, now: Date = new Date()): Promise<AdvanceCoverage[]> {
  const ents = await ensureImmobilierTool();
  const contrat = await coreService.getRecord(contratId);
  if (!contrat || contrat.entityDefinitionId !== ents.contrat.id) throw new Error('Contrat introuvable.');
  if (contrat.statusKey !== 'actif') throw new Error('Ce contrat est terminé : l’avance ne peut plus être utilisée.');
  if (!((num(contrat.values.avance) ?? 0) > 0)) throw new Error('Ce contrat n’a pas d’avance enregistrée.');
  if (!((num(contrat.values.loyer_mensuel) ?? 0) > 0)) throw new Error('Le loyer mensuel du contrat est manquant.');
  await coreService.updateRecord(contratId, { values: { avance_utilisable: true, avance_depuis: monthOfDate(now) } });
  return applyAdvanceCoverage(contratId, now);
}

/** Retire l'autorisation. Les mois déjà couverts le restent (trace conservée) ; rien n'est annulé ni recalculé. */
export async function disableAdvanceUse(contratId: string): Promise<void> {
  const contrat = await coreService.getRecord(contratId);
  if (!contrat) throw new Error('Contrat introuvable.');
  await coreService.updateRecord(contratId, { values: { avance_utilisable: false } });
}
