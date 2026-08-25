import { Pressable, View } from 'react-native';
import type { ComponentProps } from 'react';
import { MaterialIcons } from '@expo/vector-icons';
import { BodyLgText, LabelText } from './Typography';
import { Colors } from '@/constants/theme';

interface SettingsRowProps {
  icon: ComponentProps<typeof MaterialIcons>['name'];
  label: string;
  subtitle?: string;
  onPress?: () => void;
  trailing?: React.ReactNode;
  destructive?: boolean;
}

/** iOS-style settings/profile row — leading icon badge, label, trailing chevron or custom control. */
export function SettingsRow({ icon, label, subtitle, onPress, trailing, destructive }: SettingsRowProps) {
  return (
    <Pressable
      onPress={onPress}
      disabled={!onPress}
      className="min-h-[52px] flex-row items-center gap-3 py-2 active:opacity-70">
      <View className="h-8 w-8 items-center justify-center rounded-full bg-surface-container">
        <MaterialIcons name={icon} size={18} color={destructive ? Colors.error : Colors.textSecondary} />
      </View>
      <View className="flex-1">
        <BodyLgText className={destructive ? 'text-error' : undefined}>{label}</BodyLgText>
        {subtitle && <LabelText>{subtitle}</LabelText>}
      </View>
      {trailing ?? (onPress && <MaterialIcons name="chevron-right" size={20} color={Colors.emptyIcon} />)}
    </Pressable>
  );
}
