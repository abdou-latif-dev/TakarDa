import { Pressable, View } from 'react-native';
import { SectionTitleText, LabelText } from './Typography';
import { cn } from '@/utils/cn';

interface SectionHeaderProps {
  title: string;
  action?: string;
  onAction?: () => void;
  className?: string;
}

export function SectionHeader({ title, action, onAction, className }: SectionHeaderProps) {
  return (
    <View className={cn('flex-row items-center justify-between', className)}>
      <SectionTitleText>{title}</SectionTitleText>
      {action && (
        <Pressable onPress={onAction} hitSlop={8}>
          <LabelText className="font-inter-semibold text-primary">{action}</LabelText>
        </Pressable>
      )}
    </View>
  );
}
