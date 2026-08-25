import { View, type ViewProps } from 'react-native';
import { cn } from '@/utils/cn';

/** Standard elevated surface — rounded-xl white card, subtle border, soft ambient shadow. */
export function Card({ className, ...props }: ViewProps & { className?: string }) {
  return (
    <View
      className={cn('rounded-lg border border-border bg-surface p-gutter-card shadow-soft', className)}
      {...props}
    />
  );
}

/** Divider inset from the leading icon column, matching the iOS grouped-list pattern. */
export function InsetDivider({ className }: { className?: string }) {
  return <View className={cn('h-px bg-border ml-[52px]', className)} />;
}
