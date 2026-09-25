import { useEffect } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { AppHeader } from '@/components/ui/AppHeader';
import { NotificationItem } from '@/components/ui/NotificationItem';
import { EmptyState, ErrorState, LoadingState } from '@/components/ui/States';
import { LabelText } from '@/components/ui/Typography';
import { useNotificationStore } from '@/store/notificationStore';

export function NotificationsScreen() {
  const { notifications, status, fetch, markAsRead, markAllAsRead } = useNotificationStore();

  useEffect(() => {
    fetch();
  }, [fetch]);

  const hasUnread = notifications.some((n) => !n.read);

  return (
    <SafeAreaView className="flex-1 bg-background" edges={['top', 'bottom']}>
      <AppHeader
        title="Notifications"
        showBack
        trailing={
          hasUnread ? (
            <Pressable onPress={markAllAsRead} hitSlop={8}>
              <LabelText className="font-inter-semibold text-primary">Tout lire</LabelText>
            </Pressable>
          ) : undefined
        }
      />
      <ScrollView contentContainerClassName="px-page-margin pb-10" showsVerticalScrollIndicator={false}>
        {status === 'loading' && <LoadingState />}
        {status === 'error' && <ErrorState onRetry={fetch} />}
        {status === 'success' && notifications.length === 0 && (
          <EmptyState icon="notifications-off" title="Tout est à jour" description="Vous n'avez aucune nouvelle notification." />
        )}
        {notifications.map((n, i) => (
          <View key={n.id} className={i < notifications.length - 1 ? 'border-b border-border' : undefined}>
            <NotificationItem notification={n} onPress={() => !n.read && markAsRead(n.id)} />
          </View>
        ))}
      </ScrollView>
    </SafeAreaView>
  );
}
