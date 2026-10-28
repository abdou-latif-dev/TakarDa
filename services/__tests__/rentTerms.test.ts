// Avance / caution en mois ou en montant, jour de paiement du loyer.

import { amountToMonths, daysInMonth, describeDueDay, describeMonths, effectiveDueDay, entryTotal, monthsToAmount, parseMonths } from '../rentTermsService';

describe('Mois ↔ montant', () => {
  it('exemple du bailleur : loyer 25 000, avance 6 mois = 150 000, caution 3 mois = 75 000, total 225 000', () => {
    expect(monthsToAmount(6, 25000)).toBe(150000);
    expect(monthsToAmount(3, 25000)).toBe(75000);
    expect(entryTotal(150000, 75000)).toBe(225000);
  });

  it('dans l’autre sens : 150 000 FCFA pour un loyer de 25 000 = 6 mois exacts', () => {
    expect(amountToMonths(150000, 25000)).toEqual({ wholeMonths: 6, remainder: 0, exact: true });
    expect(describeMonths(150000, 25000)).toBe('6 mois');
  });

  it('un montant qui n’est pas un multiple du loyer garde son reste, sans arrondi caché', () => {
    expect(amountToMonths(162500, 25000)).toEqual({ wholeMonths: 6, remainder: 12500, exact: false });
    expect((describeMonths(162500, 25000) ?? '').replace(/\s/g, ' ')).toMatch(/^6 mois et 12.500 FCFA$/);
    expect(describeMonths(10000, 25000)).toBe('moins d’un mois');
  });

  it('les montants restent des entiers (demi-mois et loyers impairs arrondis au franc)', () => {
    expect(monthsToAmount(1.5, 25000)).toBe(37500);
    expect(Number.isInteger(monthsToAmount(2.5, 33333))).toBe(true);
    expect(monthsToAmount(0.5, 25001)).toBe(Math.round(12500.5));
  });

  it('un aller-retour mois → montant → mois redonne les mêmes mois (aucune dérive)', () => {
    for (const months of [1, 2, 3, 6, 12]) {
      for (const rent of [15000, 25000, 33333, 100000]) {
        const amount = monthsToAmount(months, rent);
        expect(amountToMonths(amount, rent)).toMatchObject({ wholeMonths: months, exact: true });
      }
    }
  });

  it('loyer absent ou nul, montants invalides : pas de calcul, jamais NaN', () => {
    expect(amountToMonths(150000, 0)).toBeNull();
    expect(describeMonths(150000, 0)).toBeNull();
    expect(monthsToAmount(3, 0)).toBe(0);
    expect(monthsToAmount(-1, 25000)).toBe(0);
    expect(amountToMonths(NaN, 25000)).toBeNull();
  });

  it('si le loyer change, le même montant donne un autre nombre de mois (le montant enregistré ne bouge pas)', () => {
    expect(amountToMonths(150000, 25000)!.wholeMonths).toBe(6);
    expect(amountToMonths(150000, 30000)!.wholeMonths).toBe(5);
  });

  it('lecture du nombre de mois saisi', () => {
    expect(parseMonths('3')).toBe(3);
    expect(parseMonths('2,5')).toBe(2.5);
    expect(parseMonths('2.5')).toBe(2.5);
    for (const bad of ['', 'abc', '-1', '1.25', '1e3', '999']) expect(parseMonths(bad)).toBeNull();
    expect(entryTotal(null, undefined)).toBe(0);
    expect(entryTotal(75000, null)).toBe(75000);
  });
});

describe('Jour de paiement du loyer', () => {
  it('un jour absent du mois devient le dernier jour du mois (29, 30, 31)', () => {
    expect(daysInMonth(2026, 1)).toBe(28); // février 2026
    expect(daysInMonth(2028, 1)).toBe(29); // bissextile
    expect(effectiveDueDay(31, 2026, 1)).toBe(28);
    expect(effectiveDueDay(30, 2026, 1)).toBe(28);
    expect(effectiveDueDay(29, 2026, 1)).toBe(28);
    expect(effectiveDueDay(29, 2028, 1)).toBe(29);
    expect(effectiveDueDay(31, 2026, 3)).toBe(30); // avril
    expect(effectiveDueDay(31, 2026, 0)).toBe(31);
    expect(effectiveDueDay(5, 2026, 1)).toBe(5);
  });

  it('description lisible, honnête sur les mois plus courts ; rien pour une valeur invalide', () => {
    expect(describeDueDay(5)).toBe('le 5 de chaque mois');
    expect(describeDueDay(31)).toContain('dernier jour des mois plus courts');
    expect(describeDueDay(0)).toBeNull();
    expect(describeDueDay(32)).toBeNull();
    expect(describeDueDay(null)).toBeNull();
  });
});
