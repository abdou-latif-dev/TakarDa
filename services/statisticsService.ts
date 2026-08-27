import { activityEvents, delay, forms, groups, submissions } from './db';
import type { StatisticsOverview } from '@/types/entities';

const WEEKDAY_LABELS = ['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim'];

/** Real counts for the last 7 days (today included), Monday-first — never fabricated. */
function countByDayOfLast7Days(dates: string[]): { label: string; value: number }[] {
  const now = new Date();
  const days: { label: string; value: number }[] = [];
  for (let offset = 6; offset >= 0; offset--) {
    const day = new Date(now.getFullYear(), now.getMonth(), now.getDate() - offset);
    const label = WEEKDAY_LABELS[(day.getDay() + 6) % 7];
    const value = dates.filter((iso) => {
      const at = new Date(iso);
      return at.getFullYear() === day.getFullYear() && at.getMonth() === day.getMonth() && at.getDate() === day.getDate();
    }).length;
    days.push({ label, value });
  }
  return days;
}

export const statisticsService = {
  async getOverview(): Promise<StatisticsOverview> {
    await delay();
    return {
      formsCount: forms.length,
      formsTrend: null,
      qrScannedCount: activityEvents.filter((e) => e.type === 'qr_scanned').length,
      qrScannedTrend: null,
      tontinesCount: groups.filter((g) => g.kind === 'tontine').length,
      tontinesTrend: null,
      activitiesCount: activityEvents.length,
      activitiesTrend: null,
      weeklyActivity: countByDayOfLast7Days(activityEvents.map((e) => e.at)),
    };
  },

  async getFormStatistics(formId: string) {
    await delay(300);
    const relevant = submissions.filter((s) => s.formId === formId);
    return {
      responses: relevant.length,
      validated: relevant.filter((s) => s.status === 'validated').length,
      pending: relevant.filter((s) => s.status === 'pending').length,
      rejected: relevant.filter((s) => s.status === 'rejected').length,
      weeklyResponses: countByDayOfLast7Days(relevant.map((s) => s.createdAt)),
    };
  },
};
