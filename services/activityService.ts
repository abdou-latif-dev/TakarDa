import { activityEvents, delay, genId } from './db';
import type { ActivityEvent } from '@/types/entities';

export const activityService = {
  async list(filterGroupId?: string): Promise<ActivityEvent[]> {
    await delay();
    const sorted = [...activityEvents].sort((a, b) => (a.at < b.at ? 1 : -1));
    return filterGroupId ? sorted.filter((e) => e.groupId === filterGroupId) : sorted;
  },

  async createEvent(input: { groupId: string; title: string; description: string }): Promise<ActivityEvent> {
    await delay();
    const event: ActivityEvent = {
      id: genId('a'),
      type: 'activity_created',
      title: input.title,
      description: input.description,
      groupId: input.groupId,
      at: new Date().toISOString(),
    };
    activityEvents.unshift(event);
    return event;
  },
};
