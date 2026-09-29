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
};

/** Timeline row: tinted icon circle, title + description, relative timestamp, optional amount. */
export function ActivityItem({ event, isLast }: { event: ActivityEvent; isLast?: boolean }) {
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
  };
  const tint = ACTIVITY_TINT[event.type];
  return (
    <View className="flex-row gap-3">
      <View className="items-center">
        <View className="h-10 w-10 items-center justify-center rounded-full" style={{ backgroundColor: `${tint}1A` }}>
          <MaterialIcons name={ACTIVITY_ICON[event.type]} size={18} color={tint} />
        </View>
        {!isLast && <View className="mt-1 w-px flex-1 bg-border" />}
      </View>
      <View className={cn('flex-1 flex-row items-start justify-between pb-5', isLast && 'pb-0')}>
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
