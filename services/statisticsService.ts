import { activityEvents, delay, forms, groups, submissions } from './db';
import type { StatisticsOverview } from '@/types/entities';

const WEEKDAY_LABELS = ['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim'];

export const statisticsService = {
  async getOverview(): Promise<StatisticsOverview> {
    await delay();
    const qrScanned = activityEvents.filter((e) => e.type === 'qr_scanned').length + submissions.length;
    const weeklyActivity = WEEKDAY_LABELS.map((label, i) => ({
      label,
      value: 8 + Math.round(Math.sin(i * 1.3) * 6) + (i === 3 ? 12 : 0),
    }));
    return {
      formsCount: forms.length,
      formsTrend: 12,
      qrScannedCount: qrScanned,
      qrScannedTrend: 8,
      groupsCount: groups.length,
      groupsTrend: null,
      activitiesCount: activityEvents.length,
      activitiesTrend: -3,
      weeklyActivity,
    };
  },

  async getFormStatistics(formId: string) {
    await delay(300);
    const relevant = submissions.filter((s) => s.formId === formId);
    return {
      responses: relevant.length || forms.find((f) => f.id === formId)?.responseCount || 0,
      validated: relevant.filter((s) => s.status === 'validated').length,
      pending: relevant.filter((s) => s.status === 'pending').length,
      rejected: relevant.filter((s) => s.status === 'rejected').length,
    };
  },
};
