import { View } from 'react-native';
import type { ComponentProps } from 'react';
import { MaterialIcons } from '@expo/vector-icons';
import { BodyLgText, BodyMdText, LabelText } from './Typography';
import { Colors } from '@/constants/theme';
import { formatRelativeTime, formatThousands } from '@/utils/format';
import type { ActivityEvent, ActivityType } from '@/types/entities';
import { cn } from '@/utils/cn';

const ACTIVITY_ICON: Record<ActivityType, ComponentProps<typeof MaterialIcons>['name']> = {
  submission_validated: 'check-circle',
  submission_rejected: 'cancel',
  contribution_added: 'account-balance-wallet',
  member_joined: 'person-add',
  member_invited: 'person-add-alt',
  form_submitted: 'assignment-turned-in',
  form_created: 'note-add',
  form_updated: 'edit-note',
  qr_scanned: 'qr-code-scanner',
  group_created: 'savings',
  group_updated: 'edit-note',
  activity_created: 'event',
  order_updated: 'swap-vert',
  cycle_completed: 'flag',
  form_deleted: 'delete-outline',
  tontine_deleted: 'delete-outline',
  'immobilier.bien_created': 'home-work',
  'immobilier.bien_deleted': 'delete-outline',
  'immobilier.logement_created': 'meeting-room',
  'immobilier.contrat_created': 'description',
  'immobilier.contrat_ended': 'event-busy',
  'immobilier.loyer_paid': 'payments',
  'utility.participant_added': 'person-add',
  'utility.releves_saved': 'speed',
  'utility.facture_validated': 'receipt-long',
  'utility.part_paid': 'payments',
  'tool.installed': 'add-circle-outline',
  'tool.hidden': 'visibility-off',
  'tool.restored': 'visibility',
};

/** Timeline row: tinted icon circle, title + description, relative timestamp, optional amount. */
export function ActivityItem({ event, isLast, variant = 'timeline' }: { event: ActivityEvent; isLast?: boolean; variant?: 'timeline' | 'card' }) {
  // Computed inside the component (not a module-level const) so it re-reads
  // `Colors` fresh every render — a module-level object literal would
  // capture whatever `Colors.X` happened to be at import time and freeze
  // there forever, the same bug `StatusColors` had before the Étape 4A audit.
  const ACTIVITY_TINT: Record<ActivityType, string> = {
    submission_validated: Colors.success,
    submission_rejected: Colors.error,
    contribution_added: Colors.primary,
    member_joined: Colors.textSecondary,
    member_invited: Colors.textSecondary,
    form_submitted: Colors.primary,
    form_created: Colors.primary,
    form_updated: Colors.textSecondary,
    qr_scanned: Colors.primary,
    group_created: Colors.primary,
    group_updated: Colors.textSecondary,
    activity_created: Colors.textSecondary,
    order_updated: Colors.textSecondary,
    cycle_completed: Colors.success,
    form_deleted: Colors.error,
    tontine_deleted: Colors.error,
    'immobilier.bien_created': Colors.primary,
    'immobilier.bien_deleted': Colors.error,
    'immobilier.logement_created': Colors.primary,
    'immobilier.contrat_created': Colors.primary,
    'immobilier.contrat_ended': Colors.textSecondary,
    'immobilier.loyer_paid': Colors.success,
    'utility.participant_added': Colors.textSecondary,
    'utility.releves_saved': Colors.primary,
    'utility.facture_validated': Colors.primary,
    'utility.part_paid': Colors.success,
    'tool.installed': Colors.primary,
    'tool.hidden': Colors.textSecondary,
    'tool.restored': Colors.primary,
  };
  const tint = ACTIVITY_TINT[event.type];
  // Maquettes : pastille grise neutre ; seuls les états sémantiques (réussite, erreur, alerte) gardent leur couleur.
  const neutral = tint === Colors.primary || tint === Colors.textSecondary || tint === Colors.textMuted;
  if (variant === 'card') {
    // Carte individuelle (écran Activités) : pas de bordure, juste le fond de carte et l'ombre douce.
    return (
      <View className="flex-row items-start gap-3.5 rounded-xl bg-surface p-4 shadow-soft">
        <View className="h-11 w-11 items-center justify-center rounded-full bg-surface-container">
          <MaterialIcons name={ACTIVITY_ICON[event.type]} size={20} color={neutral ? Colors.textSecondary : tint} />
        </View>
        <View className="min-w-0 flex-1 gap-0.5">
          <BodyLgText className="font-inter-semibold" numberOfLines={2}>{event.title}</BodyLgText>
          <BodyMdText numberOfLines={3}>{event.description}</BodyMdText>
          <LabelText className="mt-1">{formatRelativeTime(event.at)}</LabelText>
        </View>
        {typeof event.amount === 'number' && (
          <View className="rounded-full bg-success-container px-2.5 py-1">
            <LabelText className="font-inter-semibold" style={{ color: Colors.success }}>+{formatThousands(event.amount)} FCFA</LabelText>
          </View>
        )}
      </View>
    );
  }
  return (
    <View className="flex-row gap-3.5">
      <View className="items-center">
        <View className="h-10 w-10 items-center justify-center rounded-full bg-surface-container">
          <MaterialIcons name={ACTIVITY_ICON[event.type]} size={18} color={neutral ? Colors.textSecondary : tint} />
        </View>
      </View>
      <View className={cn('flex-1 flex-row items-start justify-between', !isLast && 'border-b border-border pb-4')}>
        <View className="flex-1 pr-2">
          <BodyLgText className="font-inter-semibold">{event.title}</BodyLgText>
          <BodyMdText>{event.description}</BodyMdText>
          <LabelText className="mt-1">{formatRelativeTime(event.at)}</LabelText>
        </View>
        {typeof event.amount === 'number' && (
          <LabelText className="font-inter-semibold text-primary-dark">
            +{formatThousands(event.amount)}
          </LabelText>
        )}
      </View>
    </View>
  );
}
