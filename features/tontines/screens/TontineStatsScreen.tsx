import { useEffect, useState } from 'react';
import { ScrollView, View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { AppHeader } from '@/components/ui/AppHeader';
import { StatCard } from '@/components/ui/StatCard';
import { Card } from '@/components/ui/Card';
import { BarChart } from '@/components/ui/BarChart';
import { SectionTitleText, BodyMdText } from '@/components/ui/Typography';
import { LoadingState } from '@/components/ui/States';
import { formatFcfa } from '@/utils/format';
import { useGroupStore } from '@/store/groupStore';
import { useTontineStore } from '@/store/tontineStore';
import { tontineService } from '@/services/tontineService';

export function TontineStatsScreen() {
  const { groupId } = useLocalSearchParams<{ groupId: string }>();
  const group = useGroupStore((s) => s.groups.find((g) => g.id === groupId));
  const { summaries, summaryStatus, fetchSummary } = useTontineStore();
  const summary = summaries[groupId];
  const [monthlyData, setMonthlyData] = useState<{ label: string; value: number }[] | null>(null);

  useEffect(() => {
    fetchSummary(groupId);
    tontineService.getMonthlyContributions(groupId).then(setMonthlyData);
  }, [groupId, fetchSummary]);

  if (summaryStatus[groupId] !== 'success' || !summary) {
    return (
      <SafeAreaView className="flex-1 bg-white" edges={['top']}>
        <AppHeader showBack />
        <View className="px-page-margin">
          <LoadingState />
        </View>
      </SafeAreaView>
    );
  }

  const participation = summary.members.length > 0 ? Math.round((summary.paidCount / summary.members.length) * 100) : 0;
  const lateCount = Object.values(summary.contributionsByMember).filter((c) => c?.status === 'late').length;

  return (
    <SafeAreaView className="flex-1 bg-white" edges={['top']}>
      <AppHeader showBack />
      <ScrollView contentContainerClassName="gap-6 px-page-margin pb-10" showsVerticalScrollIndicator={false}>
        <View>
          <SectionTitleText className="text-xl">{group?.name}</SectionTitleText>
          <BodyMdText>Statistiques</BodyMdText>
        </View>

        <View className="gap-3">
          <StatCard icon="account-balance-wallet" label="Total collecté" value={formatFcfa(summary.totalCollected)} />
          <View className="flex-row gap-3">
            <StatCard icon="pie-chart" label="Participation" value={`${participation} %`} className="flex-1" />
            <StatCard icon="group" label="Membres" value={summary.members.length} className="flex-1" />
          </View>
          <View className="flex-row gap-3">
            <StatCard icon="schedule" label="Retard" value={lateCount} className="flex-1" />
            <StatCard icon="sync" label="Tour actuel" value={`${summary.currentRound} / ${summary.totalRounds}`} className="flex-1" />
          </View>
        </View>

        {summary.totalCollected > 0 && monthlyData && (
          <Card className="gap-4">
            <SectionTitleText className="text-base">Contributions mensuelles (en milliers FCFA)</SectionTitleText>
            <BarChart data={monthlyData} />
          </Card>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}
