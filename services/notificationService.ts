import { delay, notifications } from './db';
import { isMultiAccountContext } from './moduleLock';
import type { AppNotification } from '@/types/entities';

export const notificationService = {
  async list(): Promise<AppNotification[]> {
    await delay();
    if (isMultiAccountContext()) return []; // notifications sans propriétaire : indisponibles en contexte multi-compte (moduleLock.ts)
    return [...notifications].sort((a, b) => (a.at < b.at ? 1 : -1));
  },

  async markAsRead(id: string): Promise<void> {
    await delay(150);
    if (isMultiAccountContext()) return;
    const notification = notifications.find((n) => n.id === id);
    if (notification) notification.read = true;
  },

  async markAllAsRead(): Promise<void> {
    await delay(200);
    if (isMultiAccountContext()) return;
    notifications.forEach((n) => (n.read = true));
  },
};
