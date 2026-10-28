import { Pressable, View } from 'react-native';
import { router } from 'expo-router';
import { MaterialIcons } from '@expo/vector-icons';
import { ProgressBar } from '@/components/ui/ProgressBar';
import { LabelText, SectionTitleText } from '@/components/ui/Typography';
import { Colors } from '@/constants/theme';
import { formatFcfa, formatLongDate } from '@/utils/format';
import { cn } from '@/utils/cn';
import type { TontineCard } from '@/services/tontineOverviewService';
import type { TontineFrequency, TourStatus } from '@/types/entities';

const PER: Record<TontineFrequency, string> = { daily: 'jour', weekly: 'semaine', monthly: 'mois', custom: 'période' };
const STATE_LABEL: Record<TourStatus, string> = { complete: 'Complet', partial: 'Partiel', upcoming: 'À venir', late: 'En retard' };
const STATE_STYLE: Record<TourStatus, string> = {
  complete: 'bg-success-container text-success',
  partial: 'bg-surface-container text-text-secondary',
  upcoming: 'bg-surface-container text-text-secondary',
  late: 'bg-error-container text-error',
};

/** Carte d'une tontine dans l'espace Tontine, alimentée par la synthèse du module
 * (aucun chargement propre). Un appui ouvre le détail existant de la tontine. */
export function TontineSpaceCard({ card }: { card: TontineCard }) {
  const amount = card.amountPerMember !== null ? `${formatFcfa(card.amountPerMember)}${card.frequency ? ` / ${PER[card.frequency]}` : ''}` : null;

  return (
    <Pressable
      accessibilityRole="button"
      onPress={() => router.push(`/group/${card.groupId}/tontine`)}
      className="gap-3 rounded-xl border border-border bg-surface p-gutter-card shadow-soft active:opacity-90">
      <View className="flex-row items-start gap-3">
        <View className="h-10 w-10 items-center justify-center rounded-full bg-primary-soft">
          <MaterialIcons name="savings" size={18} color={Colors.primary} />
        </View>
        <View className="flex-1">
          <SectionTitleText className="text-base" numberOfLines={1}>{card.name}</SectionTitleText>
          <LabelText>
            {card.memberCount} membre{card.memberCount > 1 ? 's' : ''}
            {amount ? ` · ${amount}` : ''}
          </LabelText>
        </View>
        <MaterialIcons name="chevron-right" size={20} color={Colors.emptyIcon} />
      </View>

      {card.tour ? (
        <View className="gap-3">
          <View className="flex-row items-start justify-between gap-3">
            <View className="flex-1">
              <LabelText>Prochain bénéficiaire</LabelText>
              <LabelText className="font-inter-semibold text-text-primary" numberOfLines={1}>{card.nextBeneficiary ?? '—'}</LabelText>
            </View>
            <View className="flex-1 items-end">
              <LabelText>Échéance</LabelText>
              <LabelText className="font-inter-semibold text-text-primary">{formatLongDate(new Date(card.tour.scheduledDate))}</LabelText>
            </View>
          </View>
          <View className="gap-1.5">
            <ProgressBar progress={card.expectedTotal > 0 ? Math.min(1, card.collected / card.expectedTotal) : 0} />
            <View className="flex-row items-center justify-between gap-2">
              <LabelText>
                Tour {card.tour.positionInCycle} / {card.memberCount} · {formatFcfa(card.collected)} / {formatFcfa(card.expectedTotal)}
              </LabelText>
              {card.tourStatus && (
                <View className={cn('rounded-full px-2.5 py-0.5', STATE_STYLE[card.tourStatus].split(' ')[0])}>
                  <LabelText className={cn('font-inter-semibold', STATE_STYLE[card.tourStatus].split(' ')[1])}>{STATE_LABEL[card.tourStatus]}</LabelText>
                </View>
              )}
            </View>
          </View>
        </View>
      ) : (
        <LabelText>Ajoutez des membres pour démarrer la rotation.</LabelText>
      )}
    </Pressable>
  );
}
