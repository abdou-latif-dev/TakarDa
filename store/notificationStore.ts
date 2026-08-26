import { create } from 'zustand';
import { notificationService } from '@/services/notificationService';
import type { AsyncStatus } from './asyncStatus';
import type { AppNotification } from '@/types/entities';

interface NotificationState {
  notifications: AppNotification[];
  status: AsyncStatus;
  unreadCount: number;
  fetch: () => Promise<void>;
  markAsRead: (id: string) => Promise<void>;
  markAllAsRead: () => Promise<void>;
}

export const useNotificationStore = create<NotificationState>((set, get) => ({
  notifications: [],
  status: 'idle',
  unreadCount: 0,

  fetch: async () => {
    set({ status: 'loading' });
    try {
      const notifications = await notificationService.list();
      set({ notifications, status: 'success', unreadCount: notifications.filter((n) => !n.read).length });
    } catch {
      set({ status: 'error' });
    }
  },

  markAsRead: async (id) => {
    await notificationService.markAsRead(id);
    const notifications = get().notifications.map((n) => (n.id === id ? { ...n, read: true } : n));
    set({ notifications, unreadCount: notifications.filter((n) => !n.read).length });
  },

  markAllAsRead: async () => {
    await notificationService.markAllAsRead();
    const notifications = get().notifications.map((n) => ({ ...n, read: true }));
    set({ notifications, unreadCount: 0 });
  },
}));
