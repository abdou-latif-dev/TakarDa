import { View, type ComponentProps } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { BodyLgText, BodyMdText, LabelText } from './Typography';
import { Colors } from '@/constants/theme';
import { formatRelativeTime } from '@/utils/format';
import type { ActivityEvent, ActivityType } from '@/types/entities';
import { cn } from '@/utils/cn';

const ACTIVITY_ICON: Record<ActivityType, ComponentProps<typeof MaterialIcons>['name']> = {
  submission_validated: 'check-circle',
  submission_rejected: 'cancel',
  contribution_added: 'account-balance-wallet',
  member_joined: 'person-add',
  member_invited: 'person-add-alt',
  form_submitted: 'assignment-turned-in',
  qr_scanned: 'qr-code-scanner',
  group_created: 'group-add',
  activity_created: 'event',
};

const ACTIVITY_TINT: Record<ActivityType, string> = {
  submission_validated: '#2E7D32',
  submission_rejected: '#BA1A1A',
  contribution_added: Colors.primary,
  member_joined: Colors.info,
  member_invited: Colors.info,
  form_submitted: Colors.primary,
  qr_scanned: Colors.primary,
  group_created: Colors.info,
  activity_created: Colors.info,
};

/** Timeline row: tinted icon circle, title + description, relative timestamp, optional amount. */
export function ActivityItem({ event, isLast }: { event: ActivityEvent; isLast?: boolean }) {
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
            +{event.amount.toLocaleString('fr-FR')}
          </LabelText>
        )}
      </View>
    </View>
  );
}
