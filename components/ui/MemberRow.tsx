import { Pressable, View } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { Avatar } from './Avatar';
import { BodyLgText, LabelText } from './Typography';
import { StatusBadge } from './StatusBadge';
import { Colors } from '@/constants/theme';
import type { StatusKind } from '@/constants/theme';

interface MemberRowProps {
  name: string;
  subtitle?: string;
  avatarUrl?: string;
  role?: 'admin' | 'member';
  status?: StatusKind;
  trailingText?: string;
  accountType?: 'formease_user' | 'guest';
  onPress?: () => void;
  onMorePress?: () => void;
}

/** List row for group members — avatar, name, role/subtitle, trailing status or amount. */
export function MemberRow({
  name,
  subtitle,
  avatarUrl,
  role,
  status,
  trailingText,
  accountType,
  onPress,
  onMorePress,
}: MemberRowProps) {
  return (
    <Pressable onPress={onPress} className="flex-row items-center gap-3 py-3 active:opacity-80">
      <Avatar name={name} uri={avatarUrl} size={44} />
      <View className="flex-1">
        <View className="flex-row items-center gap-2">
          <BodyLgText numberOfLines={1} className="shrink">
            {name}
          </BodyLgText>
          {accountType === 'guest' && (
            <View className="rounded-full bg-surface-container px-2 py-0.5">
              <LabelText className="text-text-secondary">Invité·e</LabelText>
            </View>
          )}
        </View>
        {(subtitle || role) && (
          <LabelText className={role === 'admin' ? 'text-primary-dark font-inter-semibold' : undefined}>
            {role === 'admin' ? 'Administrateur·rice' : subtitle}
          </LabelText>
        )}
      </View>
      {trailingText && <LabelText className="text-text-primary font-inter-semibold">{trailingText}</LabelText>}
      {status && <StatusBadge status={status} />}
      {onMorePress && (
        <Pressable onPress={onMorePress} hitSlop={8} className="ml-1">
          <MaterialIcons name="more-vert" size={20} color={Colors.textMuted} />
        </Pressable>
      )}
    </Pressable>
  );
}
