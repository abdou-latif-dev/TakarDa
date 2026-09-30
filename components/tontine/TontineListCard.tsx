import { useEffect } from 'react';
import { Pressable, View } from 'react-native';
import { router } from 'expo-router';
import { MaterialIcons } from '@expo/vector-icons';
import { Avatar } from '@/components/ui/Avatar';
import { ProgressBar } from '@/components/ui/ProgressBar';
import { SectionTitleText, LabelText } from '@/components/ui/Typography';
import { Colors } from '@/constants/theme';
import { formatFcfa } from '@/utils/format';
import { useTontineStore } from '@/store/tontineStore';
import type { Group, TontineFrequency } from '@/types/entities';

const FREQUENCY_LABEL: Record<TontineFrequency, string> = {
  daily: 'Quotidienne',
  weekly: 'Hebdomadaire',
  monthly: 'Mensuelle',
  custom: 'Personnalisée',
};

/**
 * One tontine's summary card — the SINGLE place this is rendered from
 * (Tour/Boucle audit, 2026-09-30, §32: MesModelesScreen and the dead-in-nav-
 * but-still-routable MesTontinesScreen each used to compute their own
 * progress/next-beneficiary independently, one of them from `Group.
 * memberCount` rather than the real live member count). Both screens now
 * render this instead, reading the same tontineService summary the
 * Dashboard itself uses.
 */
export function TontineListCard({ tontine }: { tontine: Group }) {
  const { summaries, fetchSummary } = useTontineStore();

  useEffect(() => {
    fetchSummary(tontine.id);
  }, [tontine.id, fetchSummary]);

  const summary = summaries[tontine.id];

  return (
    <Pressable
      onPress={() => router.push(`/group/${tontine.id}/tontine`)}
      className="gap-3 overflow-hidden rounded-xl border border-border bg-surface p-gutter-card shadow-soft active:opacity-90">
      <View className="flex-row items-start justify-between">
        <View className="flex-1">
          <SectionTitleText numberOfLines={1}>{tontine.name}</SectionTitleText>
          <LabelText>
            {FREQUENCY_LABEL[tontine.frequency ?? 'monthly']} · {formatFcfa(tontine.contributionAmount ?? 0)} / membre
          </LabelText>
        </View>
        <View className="h-10 w-10 items-center justify-center rounded-full bg-primary-soft">
          <MaterialIcons name="savings" size={18} color={Colors.primary} />
        </View>
      </View>

      {summary?.currentTour ? (
        <>
          <View className="flex-row items-center justify-between">
            <View className="flex-row">
              {summary.members.slice(0, 4).map((m, i) => (
                <View key={m.id} style={{ marginLeft: i === 0 ? 0 : -10 }}>
                  <Avatar name={m.displayName} size={28} />
                </View>
              ))}
              {summary.totalMembers > 4 && (
                <View className="ml-[-10px] h-7 w-7 items-center justify-center rounded-full bg-surface-container">
                  <LabelText>+{summary.totalMembers - 4}</LabelText>
                </View>
              )}
            </View>
            {summary.nextBeneficiary && (
              <View className="items-end">
                <LabelText>Prochain bénéficiaire</LabelText>
                <LabelText className="font-inter-semibold text-text-primary" numberOfLines={1}>
                  {summary.nextBeneficiary.displayName}
                </LabelText>
              </View>
            )}
          </View>

          <View className="gap-1.5">
            <ProgressBar progress={summary.totalMembers > 0 ? (summary.currentTour.positionInCycle - 1) / summary.totalMembers : 0} />
            <LabelText>
              Boucle {summary.currentTour.cycleNumber} · Tour {summary.currentTour.positionInCycle} / {summary.totalMembers}
            </LabelText>
          </View>
        </>
      ) : (
        <LabelText>Ajoutez des membres pour démarrer la rotation.</LabelText>
      )}
    </Pressable>
  );
}
