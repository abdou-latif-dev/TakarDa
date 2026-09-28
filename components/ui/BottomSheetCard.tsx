import { View, type ViewProps } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { cn } from '@/utils/cn';

/**
 * Visual chrome for screens presented with Stack.Screen `presentation: 'modal'`
 * (create menu, confirm validation, field-type picker...) — rounded top
 * corners + a grab handle so the native modal reads as a bottom sheet.
 *
 * Adds the device's bottom safe-area inset as extra padding: on Android's
 * edge-to-edge (see app.json's `edgeToEdgeEnabled`), a modal's content isn't
 * automatically kept clear of the gesture nav bar the way a screen-level
 * SafeAreaView is, so without this the last row/button could sit under it.
 */
export function BottomSheetCard({ className, style, children, ...props }: ViewProps & { className?: string }) {
  const insets = useSafeAreaInsets();
  return (
    <View className={cn('rounded-t-xl bg-surface pt-3', className)} style={[{ paddingBottom: insets.bottom }, style]} {...props}>
      <View className="mb-2 self-center h-1 w-9 rounded-full bg-surface-container-high" />
      {children}
    </View>
  );
}
