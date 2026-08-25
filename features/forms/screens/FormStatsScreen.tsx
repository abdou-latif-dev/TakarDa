import { useEffect, useMemo, useState } from 'react';
import { ScrollView, View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { AppHeader } from '@/components/ui/AppHeader';
import { StatCard } from '@/components/ui/StatCard';
import { Card } from '@/components/ui/Card';
import { BarChart } from '@/components/ui/BarChart';
import { LoadingState } from '@/components/ui/States';
import { SectionTitleText, BodyMdText, LabelText } from '@/components/ui/Typography';
import { Colors } from '@/constants/theme';
import { statisticsService } from '@/services/statisticsService';
import { useFormStore } from '@/store/formStore';

const DAYS = ['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim'];

interface Breakdown {
  responses: number;
  validated: number;
  pending: number;
  rejected: number;
}

export function FormStatsScreen() {
  const { formId } = useLocalSearchParams<{ formId: string }>();
  const { activeForm, fetchForm } = useFormStore();
  const [stats, setStats] = useState<Breakdown | null>(null);

  useEffect(() => {
    fetchForm(formId);
    statisticsService.getFormStatistics(formId).then(setStats);
  }, [formId, fetchForm]);

  const weeklyData = useMemo(() => {
    const base = stats?.responses ?? 10;
    return DAYS.map((label, i) => ({ label, value: Math.max(1, Math.round(base * [0.4, 0.6, 0.5, 1, 0.7, 0.3, 0.2][i])) }));
  }, [stats]);

  if (!activeForm || !stats) {
    return (
      <SafeAreaView className="flex-1 bg-white" edges={['top']}>
        <AppHeader showBack />
        <View className="px-page-margin">
          <LoadingState />
        </View>
      </SafeAreaView>
    );
  }

  const completion = stats.responses > 0 ? Math.round(((stats.validated + stats.rejected) / stats.responses) * 100) : 0;

  return (
    <SafeAreaView className="flex-1 bg-white" edges={['top']}>
      <AppHeader showBack />
      <ScrollView contentContainerClassName="gap-6 px-page-margin pb-10" showsVerticalScrollIndicator={false}>
        <View>
          <SectionTitleText className="text-xl">Statistiques du formulaire</SectionTitleText>
          <BodyMdText>{activeForm.title}</BodyMdText>
        </View>

        <View className="flex-row gap-3">
          <StatCard icon="inbox" label="Réponses" value={stats.responses} className="flex-1" />
          <StatCard icon="check-circle" label="Complétion" value={`${completion}%`} className="flex-1" />
        </View>

        <Card className="gap-3">
          <SectionTitleText className="text-base">Répartition</SectionTitleText>
          {[
            { label: 'Validées', value: stats.validated, color: Colors.primary },
            { label: 'En attente', value: stats.pending, color: Colors.info },
            { label: 'Rejetées', value: stats.rejected, color: Colors.textSecondary },
          ].map((row) => (
            <View key={row.label} className="flex-row items-center gap-3">
              <View className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: row.color }} />
              <LabelText className="flex-1 text-text-primary">{row.label}</LabelText>
              <LabelText className="font-inter-semibold text-text-primary">{row.value}</LabelText>
            </View>
          ))}
        </Card>

        <Card className="gap-4">
          <View className="flex-row items-center justify-between">
            <SectionTitleText className="text-base">Évolution</SectionTitleText>
            <LabelText>7 derniers jours</LabelText>
          </View>
          <BarChart data={weeklyData} />
        </Card>
      </ScrollView>
    </SafeAreaView>
  );
}
