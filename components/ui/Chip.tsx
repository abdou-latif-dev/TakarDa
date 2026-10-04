import { Pressable } from 'react-native';
import { LabelText } from './Typography';
import { Colors } from '@/constants/theme';
import { cn } from '@/utils/cn';

/** Pill filter chip — active state fills black (primary) with white text. The
 * fill is set from the `Colors` singleton rather than only the nested
 * `bg-primary` class, same safeguard as PrimaryButton/the "+" FAB: white text
 * on an unresolved background would be unreadable. */
export function Chip({ label, active, onPress }: { label: string; active?: boolean; onPress?: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      className={cn('h-8 items-center justify-center rounded-full px-4 active:opacity-80', !active && 'border border-border bg-surface')}
      style={active ? { backgroundColor: Colors.primary } : undefined}>
      <LabelText className={cn('font-inter-semibold', active ? 'text-white' : 'text-text-secondary')}>
        {label}
      </LabelText>
    </Pressable>
  );
}
