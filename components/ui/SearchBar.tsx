import { TextInput, View } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { Colors } from '@/constants/theme';
import { cn } from '@/utils/cn';

interface SearchBarProps {
  value: string;
  onChangeText: (text: string) => void;
  placeholder?: string;
  className?: string;
}

/** 44px pill search field on the app's light-gray surface. */
export function SearchBar({ value, onChangeText, placeholder = 'Rechercher...', className }: SearchBarProps) {
  return (
    <View className={cn('h-11 flex-row items-center gap-2 rounded-md bg-surface-container px-4', className)}>
      <MaterialIcons name="search" size={20} color={Colors.textMuted} />
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={Colors.textMuted}
        className="flex-1 font-inter text-[15px] text-text-primary"
      />
    </View>
  );
}
