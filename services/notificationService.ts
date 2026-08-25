import { delay, notifications } from './db';
import type { AppNotification } from '@/types/entities';

export const notificationService = {
  async list(): Promise<AppNotification[]> {
    await delay();
    return [...notifications].sort((a, b) => (a.at < b.at ? 1 : -1));
  },

  async markAsRead(id: string): Promise<void> {
    await delay(150);
    const notification = notifications.find((n) => n.id === id);
    if (notification) notification.read = true;
  },

  async markAllAsRead(): Promise<void> {
    await delay(200);
    notifications.forEach((n) => (n.read = true));
  },
};
