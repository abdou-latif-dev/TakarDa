import { View } from 'react-native';
import { cn } from '@/utils/cn';

/** Thin fill bar — form wizard progress, tontine payment progress. */
export function ProgressBar({ progress, className }: { progress: number; className?: string }) {
  const clamped = Math.max(0, Math.min(1, progress));
  return (
    <View className={cn('h-1.5 w-full overflow-hidden rounded-full bg-surface-container', className)}>
      <View className="h-full rounded-full bg-primary" style={{ width: `${clamped * 100}%` }} />
    </View>
  );
}

/** Onboarding-style step dots — active step is a wider pill with a soft glow. */
export function ProgressDots({ total, activeIndex }: { total: number; activeIndex: number }) {
  return (
    <View className="flex-row items-center justify-center gap-2">
      {Array.from({ length: total }).map((_, i) => (
        <View
          key={i}
          className={cn('h-2 rounded-full', i === activeIndex ? 'w-6 bg-primary' : 'w-2 bg-surface-container-high')}
        />
      ))}
    </View>
  );
}
