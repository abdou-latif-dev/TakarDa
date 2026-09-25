import { View } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { LabelText } from './Typography';
import { StatusColors, type StatusKind } from '@/constants/theme';
import { useColorScheme } from 'nativewind';
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
  const { colorScheme } = useColorScheme();
  const light = StatusColors[status];
  const dark: Record<StatusKind, { bg: string; text: string }> = {
    paid: { bg: '#17351F', text: '#8BE3A2' }, pending: { bg: '#38383A', text: '#D1D1D6' },
    late: { bg: '#451D1B', text: '#FF8A80' }, active: { bg: '#F2F2F7', text: '#111113' },
    inactive: { bg: '#38383A', text: '#D1D1D6' }, validated: { bg: '#17351F', text: '#8BE3A2' },
    rejected: { bg: '#451D1B', text: '#FF8A80' },
  };
  const { bg, text } = colorScheme === 'dark' ? dark[status] : light;
  const { label } = light;
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
