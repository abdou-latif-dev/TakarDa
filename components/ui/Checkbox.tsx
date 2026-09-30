import { Pressable } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { Colors } from '@/constants/theme';

/**
 * 24x24 square checkbox — monochrome, filled black when checked. A
 * `disabled` checkbox (used for an already-confirmed payment, see
 * "Cotisation +") renders checked-and-locked rather than interactive.
 */
export function Checkbox({
  checked,
  onValueChange,
  disabled,
}: {
  checked: boolean;
  onValueChange?: (v: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="checkbox"
      accessibilityState={{ checked, disabled }}
      disabled={disabled}
      onPress={() => onValueChange?.(!checked)}
      hitSlop={8}
      className="h-6 w-6 items-center justify-center rounded-md border"
      style={{
        borderColor: checked ? Colors.primary : Colors.border,
        backgroundColor: checked ? Colors.primary : Colors.surface,
        opacity: disabled && !checked ? 0.5 : 1,
      }}>
      {checked && <MaterialIcons name="check" size={16} color={Colors.textOnPrimary} />}
    </Pressable>
  );
}
