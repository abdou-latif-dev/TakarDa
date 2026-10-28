// Modèle d'ESTIMATION de la consommation Firestore (plan gratuit) — F4. Pur : aucun SDK, aucun réseau ; ne mesure rien, il calcule des ordres de grandeur à partir des plafonds
// du moteur (passés par l'appelant) et d'hypothèses d'usage EXPLICITES. Les quotas du plan gratuit sont une hypothèse à confirmer dans la console (valeurs publiques usuelles),
// jamais lues d'un service. Servent à dimensionner, pas à promettre.

// Ne dépend d'aucun module du moteur : les plafonds sont passés par l'appelant (le moteur en possède la définition : `DEFAULT_LIMITS` de syncCycle.ts).

/** Les seuls plafonds du moteur que le modèle utilise (sous-ensemble de `SyncLimits`). */
export interface QuotaLimits {
  dailyReads: number;
  dailyWrites: number;
  foregroundIntervalMs: number;
  maxCyclesPerHour: number;
}

/** Quotas quotidiens du plan gratuit (HYPOTHÈSE à confirmer dans la console Firebase avant l'ouverture). */
export const FREE_PLAN_DAILY = { reads: 50_000, writes: 20_000, deletes: 20_000 } as const;

export interface Usage {
  reads: number;
  writes: number;
}

export interface OwnerScenario {
  /** Heures par jour avec l'application au premier plan (le minuteur de réception tourne alors). */
  foregroundHours: number;
  /** Éléments d'Immobilier créés ou modifiés par jour (chacun = une écriture synchronisée). */
  changedItemsPerDay: number;
  /** Locataires approuvés dont la vue est tenue à jour. */
  tenants: number;
  /** Éléments de vue réécrits par locataire et par jour (seuls les changements sont publiés). */
  viewItemsChangedPerTenantPerDay: number;
}

export interface TenantScenario {
  /** Actualisations de la vue par jour. */
  refreshesPerDay: number;
  /** Éléments dans la vue du locataire (contrat, logement, paiements, événements…). */
  viewItems: number;
}

/**
 * Lectures comptées par écriture : la transaction lit le document avant d'écrire (1) ; les règles relisent une fiche (1, espace ou module) — ESTIMATION PAR EXCÈS,
 * Firestore pouvant ne compter qu'une fois un même document relu dans une même requête.
 */
export const READS_PER_WRITE = 2;
/** Lectures d'une actualisation de vue hors éléments : ma demande, ma fiche, le module, et les relectures des règles. */
export const READS_PER_VIEW_REFRESH_OVERHEAD = 5;

export function ownerDailyUsage(s: OwnerScenario, limits: QuotaLimits): Usage {
  // minuteur de réception : un cycle toutes les `foregroundIntervalMs` au premier plan, jamais plus que le plafond horaire ; un cycle au repos lit au moins une page
  const cyclesPerHour = Math.min(limits.maxCyclesPerHour, Math.floor(3_600_000 / limits.foregroundIntervalMs));
  const idleReads = Math.ceil(s.foregroundHours * cyclesPerHour);
  const syncWrites = s.changedItemsPerDay;
  const viewWrites = s.tenants * s.viewItemsChangedPerTenantPerDay;
  const writes = syncWrites + viewWrites;
  return { reads: idleReads + writes * READS_PER_WRITE, writes };
}

export function tenantDailyUsage(s: TenantScenario): Usage {
  return { reads: s.refreshesPerDay * (s.viewItems + READS_PER_VIEW_REFRESH_OVERHEAD), writes: 0 };
}

/** Nombre de « familles » (un propriétaire et ses locataires) que le plan gratuit supporte par jour, au plus. */
export function familiesPerFreePlan(owner: Usage, tenants: Usage[]): { byReads: number; byWrites: number; limit: number } {
  const reads = owner.reads + tenants.reduce((sum, t) => sum + t.reads, 0);
  const writes = owner.writes + tenants.reduce((sum, t) => sum + t.writes, 0);
  const byReads = reads > 0 ? Math.floor(FREE_PLAN_DAILY.reads / reads) : Infinity;
  const byWrites = writes > 0 ? Math.floor(FREE_PLAN_DAILY.writes / writes) : Infinity;
  return { byReads, byWrites, limit: Math.min(byReads, byWrites) };
}

/** Combien de comptes qui atteignent TOUS les plafonds du moteur épuisent le quota gratuit : le plafond par compte ne protège pas d'un client qui contourne l'application. */
export function accountsAtCapToExhaust(limits: QuotaLimits): { byReads: number; byWrites: number } {
  return { byReads: Math.ceil(FREE_PLAN_DAILY.reads / limits.dailyReads), byWrites: Math.ceil(FREE_PLAN_DAILY.writes / limits.dailyWrites) };
}
