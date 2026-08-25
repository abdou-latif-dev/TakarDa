import { useState, type ComponentProps } from 'react';
import { Pressable, TextInput, View } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { LabelText } from './Typography';
import { cn } from '@/utils/cn';
import { Colors } from '@/constants/theme';

interface TextFieldProps extends Omit<ComponentProps<typeof TextInput>, 'style'> {
  label?: string;
  error?: string;
  icon?: ComponentProps<typeof MaterialIcons>['name'];
  secureToggle?: boolean;
  containerClassName?: string;
}

/** h-52 bordered input, label above, optional left icon and secure-text toggle. Focus ring turns primary orange. */
export function TextField({
  label,
  error,
  icon,
  secureToggle,
  secureTextEntry,
  containerClassName,
  ...props
}: TextFieldProps) {
  const [focused, setFocused] = useState(false);
  const [hidden, setHidden] = useState(!!secureTextEntry);

  return (
    <View className={cn('gap-2', containerClassName)}>
      {label && <LabelText className="text-text-secondary">{label}</LabelText>}
      <View
        className={cn(
          'h-[52px] flex-row items-center rounded-md border bg-surface px-4',
          focused ? 'border-primary' : 'border-border',
          error && 'border-error',
        )}>
        {icon && <MaterialIcons name={icon} size={20} color={focused ? Colors.primary : Colors.textMuted} style={{ marginRight: 10 }} />}
        <TextInput
          className="flex-1 font-inter text-[15px] text-text-primary"
          placeholderTextColor={Colors.textMuted}
          onFocus={(e) => {
            setFocused(true);
            props.onFocus?.(e);
          }}
          onBlur={(e) => {
            setFocused(false);
            props.onBlur?.(e);
          }}
          secureTextEntry={secureToggle ? hidden : secureTextEntry}
          {...props}
        />
        {secureToggle && (
          <Pressable onPress={() => setHidden((h) => !h)} hitSlop={8}>
            <MaterialIcons name={hidden ? 'visibility-off' : 'visibility'} size={20} color={Colors.textMuted} />
          </Pressable>
        )}
      </View>
      {error && <LabelText className="text-error">{error}</LabelText>}
    </View>
  );
}

/** Multiline variant sharing the same card chrome — descriptions, notes, rejection remarks. */
export function TextAreaField({ label, error, containerClassName, ...props }: TextFieldProps) {
  const [focused, setFocused] = useState(false);
  return (
    <View className={cn('gap-2', containerClassName)}>
      {label && <LabelText className="text-text-secondary">{label}</LabelText>}
      <View
        className={cn(
          'min-h-[100px] rounded-md border bg-surface px-4 py-3',
          focused ? 'border-primary' : 'border-border',
          error && 'border-error',
        )}>
        <TextInput
          multiline
          textAlignVertical="top"
          className="flex-1 font-inter text-[15px] text-text-primary"
          placeholderTextColor={Colors.textMuted}
          onFocus={(e) => {
            setFocused(true);
            props.onFocus?.(e);
          }}
          onBlur={(e) => {
            setFocused(false);
            props.onBlur?.(e);
          }}
          {...props}
        />
      </View>
      {error && <LabelText className="text-error">{error}</LabelText>}
    </View>
  );
}
