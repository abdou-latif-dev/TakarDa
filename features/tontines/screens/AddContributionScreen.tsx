import { useEffect, useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { AppHeader } from '@/components/ui/AppHeader';
import { Card } from '@/components/ui/Card';
import { Checkbox } from '@/components/ui/Checkbox';
import { Avatar } from '@/components/ui/Avatar';
import { PrimaryButton } from '@/components/ui/Button';
import { LoadingState } from '@/components/ui/States';
import { SectionTitleText, LabelText, BodyLgText, HeadlineText } from '@/components/ui/Typography';
import { formatFcfa, formatLongDate } from '@/utils/format';
import { useTontineStore } from '@/store/tontineStore';

/**
 * "Cotisation +" — refonte (Tour/Boucle audit, 2026-09-30, §19-20).
 *
 * The amount is the tour's own frozen `expectedAmountPerMember` — never an
 * editable field (§7). Checking a member records their payment; a member
 * already marked paid renders checked-and-locked (can't be unchecked from
 * here — see Checkbox `disabled` and the comment on recordContributions()
 * in tontineService.ts for why this is the safest of the three options the
 * brief offered for §20).
 *
 * Defaults to the tontine's current tour; pass `?tourNumber=` (used by the
 * Tour detail screen) to record contributions for a different tour.
 */
export function AddContributionScreen() {
  const { groupId, tourNumber: tourNumberParam } = useLocalSearchParams<{ groupId: string; tourNumber?: string }>();
  const { summaries, summaryStatus, tourSummaries, tourSummaryStatus, fetchSummary, fetchTourSummary, recordContributions } = useTontineStore();

  const explicitTourNumber = tourNumberParam ? Number(tourNumberParam) : undefined;
  const key = explicitTourNumber ? `${groupId}:${explicitTourNumber}` : groupId;

  useEffect(() => {
    if (explicitTourNumber) fetchTourSummary(groupId, explicitTourNumber);
    else fetchSummary(groupId);
  }, [groupId, explicitTourNumber, fetchSummary, fetchTourSummary]);

  const summary = explicitTourNumber ? tourSummaries[key] : summaries[groupId];
  const status = explicitTourNumber ? tourSummaryStatus[key] : summaryStatus[groupId];

  const [checked, setChecked] = useState<Record<string, boolean>>({});
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!summary) return;
    setChecked((prev) => {
      const next = { ...prev };
      for (const s of summary.memberStatuses) {
        if (s.status === 'paid') next[s.member.id] = true;
        else if (!(s.member.id in next)) next[s.member.id] = false;
      }
      return next;
    });
  }, [summary]);

  if (status !== 'success' || !summary || !summary.currentTour) {
    return (
      <SafeAreaView className="flex-1 bg-background" edges={['top', 'bottom']}>
        <AppHeader title="Cotisation" showBack />
        <View className="px-page-margin">
          <LoadingState />
        </View>
      </SafeAreaView>
    );
  }

  const tour = summary.currentTour;
  const dateLabel = formatLongDate(new Date(tour.scheduledDate));

  const toggle = (memberId: string, alreadyPaid: boolean) => {
    if (alreadyPaid) return;
    setChecked((prev) => ({ ...prev, [memberId]: !prev[memberId] }));
  };

  const checkedCount = Object.values(checked).filter(Boolean).length;
  const previewCollected = summary.memberStatuses.reduce(
    (sum, s) => sum + (checked[s.member.id] ? tour.expectedAmountPerMember : 0),
    0,
  );

  const onSave = async () => {
    const newlyChecked = summary.memberStatuses.filter((s) => checked[s.member.id] && s.status !== 'paid').map((s) => s.member.id);
    setSaving(true);
    try {
      if (newlyChecked.length > 0) {
        await recordContributions({ groupId, tourId: tour.id, memberIds: newlyChecked });
      }
      router.back();
    } finally {
      setSaving(false);
    }
  };

  return (
    <SafeAreaView className="flex-1 bg-background" edges={['top', 'bottom']}>
      <AppHeader title={`Tour ${tour.tourNumber}`} showBack />
      <ScrollView contentContainerClassName="gap-4 px-page-margin pb-6" showsVerticalScrollIndicator={false}>
        <Card className="gap-3">
          <View>
            <LabelText>{dateLabel}</LabelText>
            <SectionTitleText className="text-base" numberOfLines={2}>
              Bénéficiaire : {summary.nextBeneficiary?.displayName ?? '—'}
            </SectionTitleText>
          </View>
          <View className="flex-row flex-wrap gap-4">
            <View className="gap-0.5">
              <LabelText>Par membre</LabelText>
              <HeadlineText className="text-lg">{formatFcfa(tour.expectedAmountPerMember)}</HeadlineText>
            </View>
            <View className="gap-0.5">
              <LabelText>Attendu</LabelText>
              <HeadlineText className="text-lg">{formatFcfa(tour.expectedTotalAmount)}</HeadlineText>
            </View>
          </View>
        </Card>

        <View className="gap-2">
          <SectionTitleText className="text-base">Membres</SectionTitleText>
          <View className="rounded-lg border border-border bg-surface px-gutter-card shadow-soft">
            {summary.memberStatuses.map((s, i) => (
              <Pressable
                key={s.member.id}
                onPress={() => toggle(s.member.id, s.status === 'paid')}
                className={`flex-row items-center gap-3 py-3 ${i < summary.memberStatuses.length - 1 ? 'border-b border-border' : ''}`}>
                <Checkbox checked={!!checked[s.member.id]} disabled={s.status === 'paid'} onValueChange={() => toggle(s.member.id, s.status === 'paid')} />
                <Avatar name={s.member.displayName} size={36} />
                <BodyLgText className="flex-1" numberOfLines={1}>
                  {s.member.displayName}
                </BodyLgText>
                <LabelText className="font-inter-semibold text-text-primary">{formatFcfa(tour.expectedAmountPerMember)}</LabelText>
              </Pressable>
            ))}
          </View>
        </View>
      </ScrollView>

      <View className="gap-3 border-t border-border px-page-margin pb-4 pt-4">
        <View className="flex-row items-center justify-between">
          <LabelText className="font-inter-semibold text-text-primary">
            {checkedCount} / {summary.totalMembers} membres
          </LabelText>
          <LabelText className="font-inter-semibold text-text-primary">
            {formatFcfa(previewCollected)} / {formatFcfa(tour.expectedTotalAmount)}
          </LabelText>
        </View>
        <PrimaryButton label="Enregistrer" loading={saving} onPress={onSave} />
      </View>
    </SafeAreaView>
  );
}
