export function formatFcfa(amount: number): string {
  return `${amount.toLocaleString('fr-FR')} FCFA`;
}

// Hermes (React Native's JS engine) doesn't reliably ship Intl.RelativeTimeFormat
// in Expo's default build — calling it throws "Cannot read property 'prototype'
// of undefined" at runtime. Format French relative-time strings by hand instead.
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

  return date.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' });
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
  return date.toLocaleDateString('fr-FR', { day: 'numeric', month: 'long' });
}

export function initials(name: string): string {
  return name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('');
}
