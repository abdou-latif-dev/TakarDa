import { useEffect, useMemo } from 'react';
import { ScrollView, View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { AppHeader } from '@/components/ui/AppHeader';
import { StatCard } from '@/components/ui/StatCard';
import { MemberRow } from '@/components/ui/MemberRow';
import { LoadingState } from '@/components/ui/States';
import { BodyMdText } from '@/components/ui/Typography';
import { formatRelativeTime } from '@/utils/format';
import { useGroupStore } from '@/store/groupStore';

export function ActiveMembersScreen() {
  const { groupId } = useLocalSearchParams<{ groupId: string }>();
  const { members, membersStatus, fetchMembers } = useGroupStore();

  useEffect(() => {
    fetchMembers(groupId);
  }, [groupId, fetchMembers]);

  const groupMembers = members[groupId] ?? [];

  const { activeToday, activeWeek, inactive } = useMemo(() => {
    const now = Date.now();
    let today = 0;
    let week = 0;
    let inactiveCount = 0;
    for (const m of groupMembers) {
      if (m.status === 'inactive') {
        inactiveCount += 1;
        continue;
      }
      const lastActive = m.lastActiveAt ? new Date(m.lastActiveAt).getTime() : 0;
      if (now - lastActive < 86_400_000) today += 1;
      if (now - lastActive < 7 * 86_400_000) week += 1;
    }
    return { activeToday: today, activeWeek: week, inactive: inactiveCount };
  }, [groupMembers]);

  return (
    <SafeAreaView className="flex-1 bg-background" edges={['top', 'bottom']}>
      <AppHeader title="Membres actifs" showBack />
      <ScrollView contentContainerClassName="gap-6 px-page-margin pb-10" showsVerticalScrollIndicator={false}>
        <BodyMdText>Aperçu de l&apos;activité des membres de votre groupe.</BodyMdText>

        <View className="flex-row gap-3">
          <StatCard icon="bolt" label="Actifs aujourd'hui" value={activeToday} className="flex-1" />
          <StatCard icon="event-available" label="Cette semaine" value={activeWeek} className="flex-1" />
          <StatCard icon="snooze" label="Inactifs" value={inactive} className="flex-1" />
        </View>

        {membersStatus[groupId] === 'loading' && <LoadingState />}
        {groupMembers.length > 0 && (
          <View className="rounded-lg border border-border bg-surface px-gutter-card shadow-soft">
            {groupMembers.map((m, i) => (
              <View key={m.id} className={i < groupMembers.length - 1 ? 'border-b border-border' : undefined}>
                <MemberRow
                  name={m.displayName}
                  subtitle={m.lastActiveAt ? `Dernière activité : ${formatRelativeTime(m.lastActiveAt)}` : 'Jamais connecté·e'}
                  status={m.status === 'inactive' ? 'inactive' : 'active'}
                />
              </View>
            ))}
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}
