import { useEffect } from 'react';
import { ScrollView, View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { AppHeader } from '@/components/ui/AppHeader';
import { MemberRow } from '@/components/ui/MemberRow';
import { EmptyState, LoadingState } from '@/components/ui/States';
import { LabelText } from '@/components/ui/Typography';
import { formatFcfa, formatLongDate } from '@/utils/format';
import { useTontineStore } from '@/store/tontineStore';

/** Full "Ordre | Membre | Montant | État | Échéance" table for the current
 * cycle — reached from the Dashboard's "Membres" → "Voir tout". Sourced
 * entirely from tontineStore's summary (already the single source of truth
 * for position + derived payment status), not a separate activity-tracking
 * concept — guest members without a FormEase account have no "last active"
 * signal to show anyway. */
export function ActiveMembersScreen() {
  const { groupId } = useLocalSearchParams<{ groupId: string }>();
  const { summaries, summaryStatus, fetchSummary } = useTontineStore();

  useEffect(() => {
    fetchSummary(groupId);
  }, [groupId, fetchSummary]);

  const summary = summaries[groupId];
  const dueDate = summary?.cycle ? formatLongDate(new Date(summary.cycle.dueDate)) : '—';
  const amount = summary?.cycle?.amountExpectedPerMember;

  return (
    <SafeAreaView className="flex-1 bg-background" edges={['top', 'bottom']}>
      <AppHeader title="Membres" showBack />
      <ScrollView contentContainerClassName="gap-6 px-page-margin pb-10" showsVerticalScrollIndicator={false}>
        {summaryStatus[groupId] !== 'success' && <LoadingState />}
        {summaryStatus[groupId] === 'success' && summary && summary.members.length === 0 && (
          <EmptyState icon="group" title="Aucun membre" description="Ajoutez des membres pour démarrer la rotation." />
        )}
        {summary && summary.members.length > 0 && (
          <View className="rounded-lg border border-border bg-surface px-gutter-card shadow-soft">
            {summary.members.map((member, i) => (
              <View
                key={member.id}
                className={`flex-row items-center gap-3 ${i < summary.members.length - 1 ? 'border-b border-border' : ''}`}>
                <View className="h-7 w-7 items-center justify-center rounded-full bg-primary-soft">
                  <LabelText className="font-inter-semibold text-primary-dark">{member.position ?? i + 1}</LabelText>
                </View>
                <View className="flex-1">
                  <MemberRow
                    name={member.displayName}
                    accountType={member.accountType}
                    subtitle={`Échéance : ${dueDate}`}
                    trailingText={typeof amount === 'number' ? formatFcfa(amount) : undefined}
                    status={summary.statusByMember[member.id] ?? 'pending'}
                  />
                </View>
              </View>
            ))}
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}
