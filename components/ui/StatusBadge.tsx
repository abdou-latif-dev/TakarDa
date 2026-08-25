import { View } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { LabelText } from './Typography';
import { StatusColors, type StatusKind } from '@/constants/theme';
import { cn } from '@/utils/cn';

const ICONS: Partial<Record<StatusKind, keyof typeof MaterialIcons.glyphMap>> = {
  paid: 'check-circle',
  pending: 'schedule',
  late: 'error-outline',
  validated: 'check-circle',
  rejected: 'cancel',
};

/**
 * Pill status indicator. Never relies on color alone — always pairs a label
 * with the color, and an icon for the states where ambiguity matters most.
 */
export function StatusBadge({ status, className }: { status: StatusKind; className?: string }) {
  const { bg, text, label } = StatusColors[status];
  const icon = ICONS[status];
  return (
    <View
      className={cn('flex-row items-center gap-1 self-start rounded-full px-3 py-1', className)}
      style={{ backgroundColor: bg }}>
      {icon && <MaterialIcons name={icon} size={13} color={text} />}
      <LabelText style={{ color: text }} className="font-inter-semibold">
        {label}
      </LabelText>
    </View>
  );
}
