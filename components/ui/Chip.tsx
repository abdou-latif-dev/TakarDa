import { Pressable } from 'react-native';
import { LabelText } from './Typography';
import { cn } from '@/utils/cn';

/** Pill filter chip — active state fills primary orange with white text. */
export function Chip({ label, active, onPress }: { label: string; active?: boolean; onPress?: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      className={cn(
        'h-8 items-center justify-center rounded-full px-4 active:opacity-80',
        active ? 'bg-primary' : 'border border-border bg-surface',
      )}>
      <LabelText className={cn('font-inter-semibold', active ? 'text-white' : 'text-text-secondary')}>
        {label}
      </LabelText>
    </Pressable>
  );
}
