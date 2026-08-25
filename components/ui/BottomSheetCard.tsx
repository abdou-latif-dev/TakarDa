import { View, type ViewProps } from 'react-native';
import { cn } from '@/utils/cn';

/**
 * Visual chrome for screens presented with Stack.Screen `presentation: 'modal'`
 * (create menu, confirm validation, field-type picker...) — rounded top
 * corners + a grab handle so the native modal reads as a bottom sheet.
 */
export function BottomSheetCard({ className, children, ...props }: ViewProps & { className?: string }) {
  return (
    <View className={cn('flex-1 rounded-t-xl bg-surface pt-3', className)} {...props}>
      <View className="mb-2 self-center h-1 w-9 rounded-full bg-surface-container-high" />
      {children}
    </View>
  );
}
