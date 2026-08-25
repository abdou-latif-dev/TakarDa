import { View } from 'react-native';
import { router } from 'expo-router';
import { SectionTitleText } from './Typography';
import { IconButton } from './Button';
import { cn } from '@/utils/cn';

interface AppHeaderProps {
  title?: string;
  showBack?: boolean;
  onBack?: () => void;
  trailing?: React.ReactNode;
  className?: string;
}

/** Sticky top bar: optional back button, centered title, optional trailing action. */
export function AppHeader({ title, showBack, onBack, trailing, className }: AppHeaderProps) {
  return (
    <View className={cn('h-14 flex-row items-center justify-between px-page-margin', className)}>
      <View className="w-11">
        {showBack && <IconButton icon="arrow-back-ios-new" size={18} onPress={onBack ?? (() => router.back())} />}
      </View>
      {title ? (
        <SectionTitleText numberOfLines={1} className="flex-1 text-center">
          {title}
        </SectionTitleText>
      ) : (
        <View className="flex-1" />
      )}
      <View className="w-11 items-end">{trailing}</View>
    </View>
  );
}
