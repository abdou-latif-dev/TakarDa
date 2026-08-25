// Hermes (React Native's JS engine, as shipped by Expo) doesn't reliably
// implement the Intl.* APIs — Intl.RelativeTimeFormat is outright missing
// (throws "Cannot read property 'prototype' of undefined"), and
// Intl.DateTimeFormat / Intl.NumberFormat support is inconsistent across
// builds. Every date/number label in this file is formatted by hand so the
// app never depends on Intl being present.

const MONTHS_LONG = [
  'janvier', 'février', 'mars', 'avril', 'mai', 'juin',
  'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre',
];
const MONTHS_SHORT = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'];

export function formatThousands(n: number): string {
  const sign = n < 0 ? '-' : '';
  return sign + Math.round(Math.abs(n)).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
}

export function formatFcfa(amount: number): string {
  return `${formatThousands(amount)} FCFA`;
}

/** "20 août" */
export function formatShortDate(date: Date): string {
  return `${date.getDate()} ${MONTHS_SHORT[date.getMonth()]}`;
}

/** "20 août" with full month name */
export function formatLongDate(date: Date): string {
  return `${date.getDate()} ${MONTHS_LONG[date.getMonth()]}`;
}

/** "août 2026" */
export function formatMonthYear(date: Date): string {
  return `${MONTHS_LONG[date.getMonth()]} ${date.getFullYear()}`;
}

function pluralize(count: number, singular: string, plural = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : plural}`;
}

/** "Il y a 5 min", "Hier", "20 août" style relative labels for activity/notification timestamps. */
export function formatRelativeTime(iso: string): string {
  const date = new Date(iso);
  const diffMs = date.getTime() - Date.now();
  const isPast = diffMs <= 0;
  const diffMinutes = Math.round(Math.abs(diffMs) / 60_000);
  const diffHours = Math.round(Math.abs(diffMs) / 3_600_000);
  const diffDays = Math.round(Math.abs(diffMs) / 86_400_000);

  if (diffMinutes < 1) return "À l'instant";
  if (diffDays === 1) return isPast ? 'Hier' : 'Demain';
  if (diffMinutes < 60) return isPast ? `il y a ${pluralize(diffMinutes, 'min')}` : `dans ${pluralize(diffMinutes, 'min')}`;
  if (diffHours < 24) return isPast ? `il y a ${pluralize(diffHours, 'heure')}` : `dans ${pluralize(diffHours, 'heure')}`;
  if (diffDays <= 6) return isPast ? `il y a ${pluralize(diffDays, 'jour')}` : `dans ${pluralize(diffDays, 'jour')}`;

  return formatShortDate(date);
}

export function formatDayGroup(iso: string): string {
  const date = new Date(iso);
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);

  const isSameDay = (a: Date, b: Date) =>
    a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();

  if (isSameDay(date, today)) return "Aujourd'hui";
  if (isSameDay(date, yesterday)) return 'Hier';
  return formatLongDate(date);
}

export function initials(name: string): string {
  return name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('');
}
