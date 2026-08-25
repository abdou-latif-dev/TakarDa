import { View, type ComponentProps } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { Card } from './Card';
import { HeadlineText, LabelText } from './Typography';
import { Colors } from '@/constants/theme';
import { cn } from '@/utils/cn';

interface StatCardProps {
  icon: ComponentProps<typeof MaterialIcons>['name'];
  label: string;
  value: string | number;
  trend?: number | null;
  className?: string;
}

/** Bento metric tile — icon badge, big value, optional up/down trend pill. */
export function StatCard({ icon, label, value, trend, className }: StatCardProps) {
  const trendPositive = typeof trend === 'number' && trend > 0;
  const trendNegative = typeof trend === 'number' && trend < 0;
  return (
    <Card className={cn('gap-3', className)}>
      <View className="flex-row items-center justify-between">
        <View className="h-10 w-10 items-center justify-center rounded-full bg-primary-soft">
          <MaterialIcons name={icon} size={20} color={Colors.primary} />
        </View>
        {typeof trend === 'number' && (
          <View
            className={cn(
              'flex-row items-center gap-0.5 rounded-full px-2 py-0.5',
              trendPositive && 'bg-info-container',
              trendNegative && 'bg-error-container',
            )}>
            <MaterialIcons
              name={trendPositive ? 'trending-up' : 'trending-down'}
              size={12}
              color={trendPositive ? Colors.info : Colors.error}
            />
            <LabelText className={cn('font-inter-semibold', trendPositive ? 'text-info' : 'text-error')}>
              {Math.abs(trend)}%
            </LabelText>
          </View>
        )}
      </View>
      <View>
        <HeadlineText>{value}</HeadlineText>
        <LabelText>{label}</LabelText>
      </View>
    </Card>
  );
}
