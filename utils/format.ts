export function formatFcfa(amount: number): string {
  return `${amount.toLocaleString('fr-FR')} FCFA`;
}

const RTF = new Intl.RelativeTimeFormat('fr', { numeric: 'auto' });

/** "Il y a 5 min", "Hier", "20 août" style relative labels for activity/notification timestamps. */
export function formatRelativeTime(iso: string): string {
  const date = new Date(iso);
  const diffMs = date.getTime() - Date.now();
  const diffMinutes = Math.round(diffMs / 60_000);
  const diffHours = Math.round(diffMs / 3_600_000);
  const diffDays = Math.round(diffMs / 86_400_000);

  if (Math.abs(diffMinutes) < 1) return "À l'instant";
  if (Math.abs(diffMinutes) < 60) return RTF.format(diffMinutes, 'minute');
  if (Math.abs(diffHours) < 24) return RTF.format(diffHours, 'hour');
  if (Math.abs(diffDays) <= 6) return RTF.format(diffDays, 'day');

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
