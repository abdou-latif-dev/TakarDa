import { useEffect } from 'react';
import { ScrollView, View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { AppHeader } from '@/components/ui/AppHeader';
import { MemberStatusCard } from '@/components/tontine/MemberStatusCard';
import { EmptyState, LoadingState } from '@/components/ui/States';
import { BodyMdText } from '@/components/ui/Typography';
import { formatFcfa, formatLongDate } from '@/utils/format';
import { useTontineStore } from '@/store/tontineStore';

/** Full member list for the tontine's CURRENT tour — reached from the
 * Dashboard's "Membres" → "Voir tout". One vertical card per member (§21/§22:
 * a dense horizontal row with name + badge + amount + status all fighting
 * for space reads badly on a small Android phone), always in rotation order
 * (§33 — never reordered by who has or hasn't paid). */
export function ActiveMembersScreen() {
  const { groupId } = useLocalSearchParams<{ groupId: string }>();
  const { summaries, summaryStatus, fetchSummary } = useTontineStore();

  useEffect(() => {
    fetchSummary(groupId);
  }, [groupId, fetchSummary]);

  const summary = summaries[groupId];

  return (
    <SafeAreaView className="flex-1 bg-background" edges={['top', 'bottom']}>
      <AppHeader title="Membres" showBack />
      <ScrollView contentContainerClassName="gap-4 px-page-margin pb-10" showsVerticalScrollIndicator={false}>
        {summaryStatus[groupId] !== 'success' && <LoadingState />}
        {summaryStatus[groupId] === 'success' && summary?.currentTour && (
          <BodyMdText>
            Tour {summary.currentTour.tourNumber} · {formatLongDate(new Date(summary.currentTour.scheduledDate))} ·{' '}
            {formatFcfa(summary.currentTour.expectedAmountPerMember)} / membre
          </BodyMdText>
        )}
        {summary && summary.members.length === 0 && (
          <EmptyState icon="group" title="Aucun membre" description="Ajoutez des membres pour démarrer la rotation." />
        )}
        {summary?.currentTour && (
          <View className="gap-3">
            {summary.memberStatuses.map((s) => (
              <MemberStatusCard
                key={s.member.id}
                position={s.member.position ?? 0}
                name={s.member.displayName}
                accountType={s.member.accountType}
                amount={summary.currentTour!.expectedAmountPerMember}
                status={s.status}
              />
            ))}
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}
