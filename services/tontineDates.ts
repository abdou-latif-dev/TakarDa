// Centralized tour-date math for Tontine — the ONLY place this calculation
// should live (see the Tour/Boucle audit, 2026-09-30, §16/§43: "ne pas
// dupliquer cette logique dans plusieurs écrans").
//
// tourIndex is 0-based: index 0 is the tour scheduled ON startDate itself,
// index 1 is the next one, etc. (tour N in user-facing 1-based numbering is
// tourIndex = N - 1).
import type { TontineFrequency } from '@/types/entities';

function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * 86_400_000);
}

/** Adds `months` calendar months, clamping the day-of-month to the target
 * month's real length — 31 Jan + 1 month => 28/29 Feb, never "3 March". */
function addMonths(date: Date, months: number): Date {
  const day = date.getDate();
  const d = new Date(date);
  d.setDate(1); // avoid overflow while stepping setMonth()
  d.setMonth(d.getMonth() + months);
  const daysInTargetMonth = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
  d.setDate(Math.min(day, daysInTargetMonth));
  return d;
}

/**
 * "weekly" here means a fixed 7-day interval from the start date (Option A
 * from the audit), NOT the real calendar week (Option B) — an explicit,
 * documented product choice, not an oversight.
 *
 * "custom" has no rule defined anywhere in the project (confirmed during the
 * audit: the frequency field was purely decorative before this change) and
 * no UI lets a user specify what "custom" would even mean numerically. In
 * the absence of any existing rule to respect, this treats it the same as
 * "weekly" (7-day interval) as an explicit, documented placeholder — not a
 * silent invention — until a real custom-interval input exists.
 */
export function calculateTourDate(startDate: Date, frequency: TontineFrequency, tourIndex: number): Date {
  switch (frequency) {
    case 'daily':
      return addDays(startDate, tourIndex);
    case 'monthly':
      return addMonths(startDate, tourIndex);
    case 'weekly':
    case 'custom':
    default:
      return addDays(startDate, tourIndex * 7);
  }
}
