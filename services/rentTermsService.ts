// Conditions du bail exprimées comme le font les bailleurs : « 3 mois d'avance, 3 mois de caution »,
// « loyer attendu le 31 ». Fonctions PURES, sans accès aux données : l'écran s'en sert pour saisir et afficher.
//
// Règle de donnée : le montant en FCFA (entier) reste la seule valeur enregistrée (`caution`, `avance` du
// contrat). Le nombre de mois n'est qu'une aide de saisie et d'affichage, recalculée à partir du loyer.

/** Jours du mois (monthIndex 0-11). */
export function daysInMonth(year: number, monthIndex: number): number {
  return new Date(year, monthIndex + 1, 0).getDate();
}

/** Jour réellement utilisé pour un mois donné : un jour absent du mois (29, 30, 31) devient le dernier jour du mois. */
export function effectiveDueDay(day: number, year: number, monthIndex: number): number {
  return Math.min(Math.max(1, Math.floor(day)), daysInMonth(year, monthIndex));
}

/** Texte d'aide pour le jour de paiement (indicatif : TakarDa compte le retard par mois complet écoulé). */
export function describeDueDay(day: number | null | undefined): string | null {
  if (typeof day !== 'number' || !Number.isInteger(day) || day < 1 || day > 31) return null;
  return day > 28 ? `le ${day} de chaque mois (le dernier jour des mois plus courts)` : `le ${day} de chaque mois`;
}

/** Montant entier en FCFA pour un nombre de mois (arrondi au franc le plus proche). */
export function monthsToAmount(months: number, monthlyRent: number): number {
  if (!Number.isFinite(months) || months < 0 || !Number.isFinite(monthlyRent) || monthlyRent <= 0) return 0;
  return Math.round(months * monthlyRent);
}

export interface MonthsEquivalent {
  /** Nombre de mois entiers couverts. */
  wholeMonths: number;
  /** Reste en FCFA après les mois entiers (0 si le montant est un multiple du loyer). */
  remainder: number;
  /** true quand le montant correspond exactement à un nombre entier de mois. */
  exact: boolean;
}

/** Équivalent en mois d'un montant : « 150 000 FCFA » pour un loyer de 25 000 → 6 mois exacts. */
export function amountToMonths(amount: number, monthlyRent: number): MonthsEquivalent | null {
  if (!Number.isFinite(amount) || amount < 0 || !Number.isFinite(monthlyRent) || monthlyRent <= 0) return null;
  const wholeMonths = Math.floor(amount / monthlyRent);
  const remainder = amount - wholeMonths * monthlyRent;
  return { wholeMonths, remainder, exact: remainder === 0 };
}

/** Lit un nombre de mois saisi (entier ou demi-mois, virgule ou point). null si invalide. */
export function parseMonths(text: string): number | null {
  const cleaned = text.trim().replace(',', '.');
  if (!cleaned || !/^\d+(\.\d)?$/.test(cleaned)) return null;
  const value = Number(cleaned);
  return Number.isFinite(value) && value >= 0 && value <= 120 ? value : null;
}

const fcfa = (n: number) => `${Math.round(n).toLocaleString('fr-FR')} FCFA`;

/** « 6 mois », « 5 mois et 12 500 FCFA », « moins d'un mois ». */
export function describeMonths(amount: number, monthlyRent: number): string | null {
  const eq = amountToMonths(amount, monthlyRent);
  if (!eq) return null;
  if (eq.wholeMonths === 0) return eq.remainder === 0 ? '0 mois' : 'moins d’un mois';
  const base = `${eq.wholeMonths} mois`;
  return eq.exact ? base : `${base} et ${fcfa(eq.remainder)}`;
}

/** Total demandé à l'entrée : avance + caution (le loyer du premier mois est un autre sujet). */
export function entryTotal(avance: number | null | undefined, caution: number | null | undefined): number {
  return (avance && avance > 0 ? avance : 0) + (caution && caution > 0 ? caution : 0);
}
