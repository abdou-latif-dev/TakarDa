import { useEffect } from 'react';
import { router, useLocalSearchParams } from 'expo-router';
import { ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { AppHeader } from '@/components/ui/AppHeader';
import { Card } from '@/components/ui/Card';
import { MemberStatusCard } from '@/components/tontine/MemberStatusCard';
import { PrimaryButton } from '@/components/ui/Button';
import { LoadingState } from '@/components/ui/States';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { SectionTitleText, LabelText, HeadlineText, BodyMdText } from '@/components/ui/Typography';
import { formatFcfa, formatLongDate } from '@/utils/format';
import { useGroupStore } from '@/store/groupStore';
import { useTontineStore } from '@/store/tontineStore';
import type { TourStatus } from '@/types/entities';

const STATUS_BADGE: Record<TourStatus, 'paid' | 'pending' | 'late'> = {
  complete: 'paid',
  partial: 'pending',
  upcoming: 'pending',
  late: 'late',
};
const STATUS_LABEL: Record<TourStatus, string> = {
  complete: 'Complet',
  partial: 'Partiellement payé',
  upcoming: 'À venir',
  late: 'En retard',
};

/** Detail of a single tour, reachable from History or from the Dashboard
 * (current tour) — §27. Any tour, not only the current one. */
export function TourDetailScreen() {
  const { groupId, tourNumber } = useLocalSearchParams<{ groupId: string; tourNumber: string }>();
  const group = useGroupStore((s) => s.groups.find((g) => g.id === groupId));
  const { tourSummaries, tourSummaryStatus, fetchTourSummary } = useTontineStore();
  const key = `${groupId}:${tourNumber}`;

  useEffect(() => {
    fetchTourSummary(groupId, Number(tourNumber));
  }, [groupId, tourNumber, fetchTourSummary]);

  const summary = tourSummaries[key];
  const status = tourSummaryStatus[key];

  if (status !== 'success' || !summary || !summary.currentTour) {
    return (
      <SafeAreaView className="flex-1 bg-background" edges={['top', 'bottom']}>
        <AppHeader showBack />
        <View className="px-page-margin">
          <LoadingState />
        </View>
      </SafeAreaView>
    );
  }

  const tour = summary.currentTour;

  return (
    <SafeAreaView className="flex-1 bg-background" edges={['top', 'bottom']}>
      <AppHeader title={`Tour ${tour.tourNumber}`} showBack />
      <ScrollView contentContainerClassName="gap-6 px-page-margin pb-10" showsVerticalScrollIndicator={false}>
        <View>
          <SectionTitleText className="text-xl">{group?.name}</SectionTitleText>
          <BodyMdText>
            Boucle {tour.cycleNumber} · Tour {tour.positionInCycle} / {summary.totalMembers}
          </BodyMdText>
        </View>

        <Card className="gap-4">
          <View className="flex-row items-center justify-between">
            <View>
              <LabelText>Date</LabelText>
              <HeadlineText className="text-lg">{formatLongDate(new Date(tour.scheduledDate))}</HeadlineText>
            </View>
            <StatusBadge status={STATUS_BADGE[summary.tourStatus]} />
          </View>
          <View>
            <LabelText>Bénéficiaire</LabelText>
            <HeadlineText className="text-lg">{summary.nextBeneficiary?.displayName ?? '—'}</HeadlineText>
          </View>
          <View className="flex-row flex-wrap gap-3">
            <View className="min-w-[45%] flex-1 gap-0.5">
              <LabelText>Par membre</LabelText>
              <HeadlineText className="text-lg" numberOfLines={1} adjustsFontSizeToFit>{formatFcfa(tour.expectedAmountPerMember)}</HeadlineText>
            </View>
            <View className="min-w-[45%] flex-1 gap-0.5">
              <LabelText>Attendu</LabelText>
              <HeadlineText className="text-lg" numberOfLines={1} adjustsFontSizeToFit>{formatFcfa(summary.expectedTotal)}</HeadlineText>
            </View>
            <View className="min-w-[45%] flex-1 gap-0.5">
              <LabelText>Collecté</LabelText>
              <HeadlineText className="text-lg" numberOfLines={1} adjustsFontSizeToFit>{formatFcfa(summary.collected)}</HeadlineText>
            </View>
            <View className="min-w-[45%] flex-1 gap-0.5">
              <LabelText>Reste</LabelText>
              <HeadlineText className="text-lg" numberOfLines={1} adjustsFontSizeToFit>{formatFcfa(summary.remaining)}</HeadlineText>
            </View>
          </View>
          <LabelText className="font-inter-semibold text-text-primary">
            {summary.paidCount} / {summary.totalMembers} membres · {STATUS_LABEL[summary.tourStatus]}
          </LabelText>
        </Card>

        <View className="gap-3">
          <SectionTitleText className="text-base">Cotisations</SectionTitleText>
          <View className="gap-3">
            {summary.memberStatuses.map((s) => (
              <MemberStatusCard
                key={s.member.id}
                position={s.member.position ?? 0}
                name={s.member.displayName}
                accountType={s.member.accountType}
                amount={tour.expectedAmountPerMember}
                status={s.status}
              />
            ))}
          </View>
        </View>

        <PrimaryButton
          label="Cotisation +"
          icon="add"
          onPress={() => router.push(`/group/${groupId}/tontine/add-contribution?tourNumber=${tourNumber}`)}
        />
      </ScrollView>
    </SafeAreaView>
  );
}
