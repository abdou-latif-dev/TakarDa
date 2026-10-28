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

/** 48px, rayon 12, fond violet primaire, libellé blanc — l'unique style d'appel à l'action principal. */
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
          ? 'min-h-12 h-auto py-2 flex-row items-center justify-center rounded-md px-3 shadow-soft-primary active:scale-[0.98]'
          : 'h-12 flex-row items-center justify-center rounded-md px-6 shadow-soft-primary active:scale-[0.98]',
        fullWidth && 'w-full',
        isDisabled && 'opacity-50',
        className,
      )}
      style={{ backgroundColor: Colors.primary }}
      {...props}>
      {loading ? (
        <ActivityIndicator color={Colors.textOnPrimary} />
      ) : (
        <View className="max-w-full flex-shrink flex-row items-center justify-center gap-2">
          {icon && iconPosition === 'left' && <MaterialIcons name={icon} size={20} color={Colors.textOnPrimary} />}
          <ButtonLabelText numberOfLines={multilineLabel ? 2 : undefined} className="flex-shrink text-center" style={{ color: Colors.textOnPrimary }}>{label}</ButtonLabelText>
          {icon && iconPosition === 'right' && <MaterialIcons name={icon} size={20} color={Colors.textOnPrimary} />}
        </View>
      )}
    </Pressable>
  );
}

/** Secondaire « tonal » (comme WhatsApp / Telegram) : fond teinté de l'accent, texte et icône d'accent — se lit clairement comme un bouton, sans concurrencer l'action principale pleine. */
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
          ? 'min-h-12 h-auto py-2 flex-row items-center justify-center rounded-md border border-primary/20 bg-primary-soft px-3 active:scale-[0.98]'
          : 'h-12 flex-row items-center justify-center rounded-md border border-primary/20 bg-primary-soft px-6 active:scale-[0.98]',
        fullWidth && 'w-full',
        isDisabled && 'opacity-50',
        className,
      )}
      {...props}>
      {loading ? (
        <ActivityIndicator color={Colors.primary} />
      ) : (
        <View className="max-w-full flex-shrink flex-row items-center justify-center gap-2">
          {icon && iconPosition === 'left' && <MaterialIcons name={icon} size={20} color={Colors.primary} />}
          <ButtonLabelText numberOfLines={multilineLabel ? 2 : undefined} className="flex-shrink text-center" style={{ color: Colors.primary }}>{label}</ButtonLabelText>
          {icon && iconPosition === 'right' && <MaterialIcons name={icon} size={20} color={Colors.primary} />}
        </View>
      )}
    </Pressable>
  );
}

/** Destructive : fond rouge très clair, bordure fine, texte rouge (design system) — réservé aux actions de refus/suppression. */
export function DestructiveButton({ label, loading, disabled, icon, fullWidth = true, multilineLabel = false, className, ...props }: ButtonBaseProps & { className?: string }) {
  const isDisabled = disabled || loading;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: isDisabled }}
      disabled={isDisabled}
      className={cn(
        multilineLabel
          ? 'min-h-12 h-auto py-2 flex-row items-center justify-center rounded-md border border-error/20 bg-error-container px-3 active:scale-[0.98]'
          : 'h-12 flex-row items-center justify-center rounded-md border border-error/20 bg-error-container px-6 active:scale-[0.98]',
        fullWidth && 'w-full',
        isDisabled && 'opacity-50',
        className,
      )}
      {...props}>
      {loading ? (
        <ActivityIndicator color={Colors.errorOnContainer} />
      ) : (
        <View className="max-w-full flex-shrink flex-row items-center justify-center gap-2">
          {icon && <MaterialIcons name={icon} size={20} color={Colors.errorOnContainer} />}
          <ButtonLabelText numberOfLines={multilineLabel ? 2 : undefined} className="flex-shrink text-center" style={{ color: Colors.errorOnContainer }}>{label}</ButtonLabelText>
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
