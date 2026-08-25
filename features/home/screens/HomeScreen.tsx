import { useEffect, useState } from 'react';
import { ScrollView, View } from 'react-native';
import { router } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Avatar } from '@/components/ui/Avatar';
import { SearchBar } from '@/components/ui/SearchBar';
import { QuickActionCard } from '@/components/ui/QuickActionCard';
import { SectionHeader } from '@/components/ui/SectionHeader';
import { ActivityItem } from '@/components/ui/ActivityItem';
import { EmptyState, LoadingState } from '@/components/ui/States';
import { HeadlineText, BodyMdText } from '@/components/ui/Typography';
import { IconButton } from '@/components/ui/Button';
import { useAuthStore } from '@/store/authStore';
import { useActivityStore } from '@/store/activityStore';
import { useGroupStore } from '@/store/groupStore';
import { useNotificationStore } from '@/store/notificationStore';

export function HomeScreen() {
  const user = useAuthStore((s) => s.user);
  const [search, setSearch] = useState('');

  const { events, status: activityStatus, fetch: fetchActivity } = useActivityStore();
  const { groups, fetchGroups } = useGroupStore();
  const { unreadCount, fetch: fetchNotifications } = useNotificationStore();

  useEffect(() => {
    fetchActivity();
    fetchGroups();
    fetchNotifications();
  }, [fetchActivity, fetchGroups, fetchNotifications]);

  const goToTontine = () => {
    const tontine = groups.find((g) => g.kind === 'tontine');
    if (tontine) router.push(`/group/${tontine.id}/tontine`);
    else router.push('/group/create?kind=tontine');
  };

  return (
    <SafeAreaView className="flex-1 bg-white" edges={['top']}>
      <ScrollView contentContainerClassName="gap-6 px-page-margin pb-10 pt-2" showsVerticalScrollIndicator={false}>
        <View className="flex-row items-center gap-3">
          <Avatar name={user?.name ?? 'Vous'} size={48} />
          <View className="flex-1">
            <HeadlineText className="text-xl">Bonjour, {user?.name?.split(' ')[0] ?? 'Vous'} 👋</HeadlineText>
            <BodyMdText>Que souhaitez-vous faire aujourd&apos;hui ?</BodyMdText>
          </View>
          <View>
            <IconButton icon="notifications-none" onPress={() => router.push('/notifications')} />
            {unreadCount > 0 && (
              <View className="absolute -right-0.5 -top-0.5 h-2.5 w-2.5 rounded-full border border-white bg-primary" />
            )}
          </View>
        </View>

        <SearchBar value={search} onChangeText={setSearch} />

        <View className="gap-3">
          <SectionHeader title="Actions rapides" />
          <View className="flex-row flex-wrap gap-3">
            <QuickActionCard
              icon="assignment"
              title="Formulaire"
              subtitle="Collecter des infos"
              onPress={() => router.push('/form')}
            />
            <QuickActionCard icon="savings" title="Tontine" subtitle="Gérer une tontine" onPress={goToTontine} />
            <QuickActionCard
              icon="groups"
              title="Groupe"
              subtitle="Créer et gérer"
              onPress={() => router.push('/(tabs)/groups')}
            />
            <QuickActionCard
              icon="qr-code-scanner"
              title="Scanner"
              subtitle="Scanner un QR code"
              onPress={() => router.push('/scan')}
            />
          </View>
        </View>

        <View className="gap-3">
          <SectionHeader title="Activité récente" action="Voir tout" onAction={() => router.push('/(tabs)/activity')} />
          {activityStatus === 'loading' && <LoadingState />}
          {activityStatus === 'success' && events.length === 0 && (
            <EmptyState
              icon="history"
              title="Pas encore d'activité"
              description="Vos actions apparaîtront ici."
              compact
            />
          )}
          {activityStatus === 'success' && events.length > 0 && (
            <View className="rounded-lg border border-border bg-surface p-gutter-card shadow-soft">
              {events.slice(0, 3).map((event, i) => (
                <ActivityItem key={event.id} event={event} isLast={i === Math.min(2, events.length - 1)} />
              ))}
            </View>
          )}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}
