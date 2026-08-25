import { useEffect, useMemo } from 'react';
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

const MONTHS = ['Jan', 'Fév', 'Mar', 'Avr', 'Mai', 'Jun', 'Jul', 'Aoû', 'Sep', 'Oct', 'Nov', 'Déc'];

export function TontineStatsScreen() {
  const { groupId } = useLocalSearchParams<{ groupId: string }>();
  const group = useGroupStore((s) => s.groups.find((g) => g.id === groupId));
  const { summaries, summaryStatus, fetchSummary } = useTontineStore();
  const summary = summaries[groupId];

  useEffect(() => {
    fetchSummary(groupId);
  }, [groupId, fetchSummary]);

  const monthlyData = useMemo(() => {
    const now = new Date();
    const base = summary?.totalCollected ?? 60000;
    return Array.from({ length: 6 }).map((_, i) => {
      const monthIndex = (now.getMonth() - (5 - i) + 12) % 12;
      const variance = [0.6, 0.7, 0.85, 0.75, 0.9, 1][i];
      return { label: MONTHS[monthIndex], value: Math.round((base * variance) / 1000) };
    });
  }, [summary]);

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
          <StatCard icon="schedule" label="Retard" value={lateCount} />
        </View>

        <Card className="gap-4">
          <SectionTitleText className="text-base">Contributions mensuelles (en milliers FCFA)</SectionTitleText>
          <BarChart data={monthlyData} />
        </Card>
      </ScrollView>
    </SafeAreaView>
  );
}
