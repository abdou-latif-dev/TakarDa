import { Pressable, View, type ComponentProps } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { BodyMdText, LabelText, SectionTitleText } from './Typography';
import { Colors } from '@/constants/theme';
import { formatRelativeTime } from '@/utils/format';
import type { AppNotification, NotificationType } from '@/types/entities';
import { cn } from '@/utils/cn';

const NOTIF_ICON: Record<NotificationType, ComponentProps<typeof MaterialIcons>['name']> = {
  contribution_due: 'payments',
  form_validated: 'check-circle',
  member_joined: 'person-add',
  system: 'info',
};

const NOTIF_TINT: Record<NotificationType, { bg: string; fg: string }> = {
  contribution_due: { bg: '#FFDAD6', fg: '#BA1A1A' },
  form_validated: { bg: '#F0F0F2', fg: Colors.textSecondary },
  member_joined: { bg: '#CDE5FF', fg: Colors.info },
  system: { bg: '#F0F0F2', fg: Colors.textSecondary },
};

export function NotificationItem({ notification, onPress }: { notification: AppNotification; onPress?: () => void }) {
  const tint = NOTIF_TINT[notification.type];
  return (
    <Pressable onPress={onPress} className={cn('flex-row items-start gap-3 py-4', !notification.read && 'opacity-100')}>
      <View className="h-11 w-11 items-center justify-center rounded-full" style={{ backgroundColor: tint.bg }}>
        <MaterialIcons name={NOTIF_ICON[notification.type]} size={20} color={tint.fg} />
      </View>
      <View className={cn('flex-1', notification.read && 'opacity-75')}>
        {notification.read ? (
          <BodyMdText className="font-inter-semibold text-text-primary">{notification.title}</BodyMdText>
        ) : (
          <SectionTitleText className="text-base">{notification.title}</SectionTitleText>
        )}
        <BodyMdText>{notification.description}</BodyMdText>
        <LabelText className="mt-1">{formatRelativeTime(notification.at)}</LabelText>
      </View>
      {!notification.read && <View className="mt-2 h-2.5 w-2.5 rounded-full bg-primary" />}
    </Pressable>
  );
}
