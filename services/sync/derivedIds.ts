// Identifiants des enregistrements DÉRIVÉS (créés automatiquement par l'application, pas par un geste de l'utilisateur).
//
// Problème : sans identifiant déterministe, deux appareils qui calculent la même chose créeraient deux enregistrements différents
// (identifiants aléatoires) pour le même fait logique. Un identifiant déterministe n'est introduit QUE si les règles métier
// garantissent une clé unique stable — c'est le cas des couvertures de loyer par l'avance : `planAdvanceCoverage` ne couvre jamais
// deux fois le même mois d'un contrat (services/rentAdvanceService.ts, `settledMonthsOf`).
//
// Les enregistrements déjà stockés gardent leur identifiant : ils ne sont ni renommés ni réattribués. Pour une même clé logique,
// le plan de couverture voit les couvertures anciennes (identifiant aléatoire) comme déjà réglées et n'en recrée pas.

const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;
const SAFE_ID = /^[A-Za-z0-9_-]+$/;
export const COVERAGE_ID_PREFIX = 'cov-';

/** Identifiant de la couverture d'un mois de loyer par l'avance : « cov-<contrat>-<AAAA-MM> ». Lève une erreur si la clé est invalide. */
export function coverageRecordId(contratId: string, mois: string): string {
  if (!SAFE_ID.test(contratId)) throw new Error('Identifiant de contrat invalide pour une couverture.');
  if (!MONTH.test(mois)) throw new Error('Mois invalide pour une couverture (AAAA-MM attendu).');
  return `${COVERAGE_ID_PREFIX}${contratId}-${mois}`;
}

/** Vrai si l'identifiant est celui d'une couverture déterministe (jamais généré au hasard). */
export const isCoverageRecordId = (id: string): boolean => id.startsWith(COVERAGE_ID_PREFIX) && SAFE_ID.test(id);
