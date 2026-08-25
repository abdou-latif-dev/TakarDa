import { useEffect } from 'react';
import { ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { AppHeader } from '@/components/ui/AppHeader';
import { StatCard } from '@/components/ui/StatCard';
import { Card } from '@/components/ui/Card';
import { Chip } from '@/components/ui/Chip';
import { BarChart } from '@/components/ui/BarChart';
import { LoadingState, ErrorState } from '@/components/ui/States';
import { BodyMdText, SectionTitleText } from '@/components/ui/Typography';
import { useStatisticsStore } from '@/store/statisticsStore';

export function StatisticsOverviewScreen() {
  const { overview, status, fetchOverview } = useStatisticsStore();

  useEffect(() => {
    fetchOverview();
  }, [fetchOverview]);

  return (
    <SafeAreaView className="flex-1 bg-white" edges={['top']}>
      <AppHeader title="Statistiques" showBack />
      <ScrollView contentContainerClassName="gap-6 px-page-margin pb-10" showsVerticalScrollIndicator={false}>
        <View>
          <BodyMdText>Aperçu de votre activité globale</BodyMdText>
          <View className="mt-3 flex-row">
            <Chip label="Ce mois" active />
          </View>
        </View>

        {status === 'loading' && <LoadingState />}
        {status === 'error' && <ErrorState onRetry={fetchOverview} />}

        {overview && (
          <>
            <View className="flex-row flex-wrap gap-3">
              <StatCard icon="assignment" label="Formulaires" value={overview.formsCount} trend={overview.formsTrend} className="basis-[47%]" />
              <StatCard icon="qr-code-scanner" label="QR scannés" value={overview.qrScannedCount} trend={overview.qrScannedTrend} className="basis-[47%]" />
              <StatCard icon="groups" label="Groupes" value={overview.groupsCount} trend={overview.groupsTrend} className="basis-[47%]" />
              <StatCard icon="schedule" label="Activités" value={overview.activitiesCount} trend={overview.activitiesTrend} className="basis-[47%]" />
            </View>

            <Card className="gap-4">
              <SectionTitleText className="text-base">Activité cette semaine</SectionTitleText>
              <BarChart data={overview.weeklyActivity} />
            </Card>
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}
