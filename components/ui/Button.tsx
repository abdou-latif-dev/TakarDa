import { ActivityIndicator, Pressable, View, type PressableProps } from 'react-native';
import type { ComponentProps } from 'react';
import { MaterialIcons } from '@expo/vector-icons';
import { ButtonLabelText } from './Typography';
import { cn } from '@/utils/cn';
import { Colors } from '@/constants/theme';

interface ButtonBaseProps extends Omit<PressableProps, 'children'> {
  label: string;
  loading?: boolean;
  disabled?: boolean;
  icon?: ComponentProps<typeof MaterialIcons>['name'];
  iconPosition?: 'left' | 'right';
  fullWidth?: boolean;
  multilineLabel?: boolean;
}

/** h-52px pill, orange fill, white label — the app's single high-intent CTA style. */
export function PrimaryButton({
  label,
  loading,
  disabled,
  icon,
  iconPosition = 'right',
  fullWidth = true,
  multilineLabel = false,
  className,
  ...props
}: ButtonBaseProps & { className?: string }) {
  const isDisabled = disabled || loading;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: isDisabled }}
      disabled={isDisabled}
      className={cn(
        multilineLabel
          ? 'min-h-[52px] h-auto py-2 flex-row items-center justify-center rounded-xl bg-primary px-3 shadow-soft-primary active:scale-[0.98]'
          : 'h-[52px] flex-row items-center justify-center rounded-xl bg-primary px-6 shadow-soft-primary active:scale-[0.98]',
        fullWidth && 'w-full',
        isDisabled && 'opacity-50',
        className,
      )}
      {...props}>
      {loading ? (
        <ActivityIndicator color="#FFFFFF" />
      ) : (
        <View className="max-w-full flex-shrink flex-row items-center justify-center gap-2">
          {icon && iconPosition === 'left' && <MaterialIcons name={icon} size={20} color="#FFFFFF" />}
          <ButtonLabelText numberOfLines={multilineLabel ? 2 : undefined} className="flex-shrink text-center text-white">{label}</ButtonLabelText>
          {icon && iconPosition === 'right' && <MaterialIcons name={icon} size={20} color="#FFFFFF" />}
        </View>
      )}
    </Pressable>
  );
}

/** Outline variant — neutral surface, subtle border, used for secondary actions. */
export function SecondaryButton({
  label,
  loading,
  disabled,
  icon,
  iconPosition = 'left',
  fullWidth = true,
  multilineLabel = false,
  className,
  ...props
}: ButtonBaseProps & { className?: string }) {
  const isDisabled = disabled || loading;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: isDisabled }}
      disabled={isDisabled}
      className={cn(
        multilineLabel
          ? 'min-h-[52px] h-auto py-2 flex-row items-center justify-center rounded-xl border border-border bg-surface px-3 active:scale-[0.98]'
          : 'h-[52px] flex-row items-center justify-center rounded-xl border border-border bg-surface px-6 active:scale-[0.98]',
        fullWidth && 'w-full',
        isDisabled && 'opacity-50',
        className,
      )}
      {...props}>
      {loading ? (
        <ActivityIndicator color={Colors.textPrimary} />
      ) : (
        <View className="max-w-full flex-shrink flex-row items-center justify-center gap-2">
          {icon && iconPosition === 'left' && <MaterialIcons name={icon} size={20} color={Colors.textPrimary} />}
          <ButtonLabelText numberOfLines={multilineLabel ? 2 : undefined} className="flex-shrink text-center text-text-primary">{label}</ButtonLabelText>
          {icon && iconPosition === 'right' && <MaterialIcons name={icon} size={20} color={Colors.textPrimary} />}
        </View>
      )}
    </Pressable>
  );
}

/** Destructive variant — reserved for reject/delete/logout actions. */
export function DestructiveButton({ label, loading, disabled, icon, fullWidth = true, multilineLabel = false, className, ...props }: ButtonBaseProps & { className?: string }) {
  const isDisabled = disabled || loading;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: isDisabled }}
      disabled={isDisabled}
      className={cn(
        multilineLabel
          ? 'min-h-[52px] h-auto py-2 flex-row items-center justify-center rounded-xl bg-error px-3 active:scale-[0.98]'
          : 'h-[52px] flex-row items-center justify-center rounded-xl bg-error px-6 active:scale-[0.98]',
        fullWidth && 'w-full',
        isDisabled && 'opacity-50',
        className,
      )}
      {...props}>
      {loading ? (
        <ActivityIndicator color="#FFFFFF" />
      ) : (
        <View className="max-w-full flex-shrink flex-row items-center justify-center gap-2">
          {icon && <MaterialIcons name={icon} size={20} color="#FFFFFF" />}
          <ButtonLabelText numberOfLines={multilineLabel ? 2 : undefined} className="flex-shrink text-center text-white">{label}</ButtonLabelText>
        </View>
      )}
    </Pressable>
  );
}

interface IconButtonProps extends PressableProps {
  icon: ComponentProps<typeof MaterialIcons>['name'];
  size?: number;
  variant?: 'surface' | 'transparent' | 'dark';
}

/** 44x44 circular tap target — headers, floating camera controls, chevron-free row actions. */
export function IconButton({ icon, size = 22, variant = 'surface', className, ...props }: IconButtonProps & { className?: string }) {
  const bg =
    variant === 'surface' ? 'bg-surface border border-border shadow-soft' : variant === 'dark' ? 'bg-black/40' : 'bg-transparent';
  const color = variant === 'dark' ? '#FFFFFF' : Colors.textPrimary;
  return (
    <Pressable
      accessibilityRole="button"
      className={cn('h-11 w-11 items-center justify-center rounded-full active:opacity-70', bg, className)}
      {...props}>
      <MaterialIcons name={icon} size={size} color={color} />
    </Pressable>
  );
}
