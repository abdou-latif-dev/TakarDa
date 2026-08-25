import { Pressable, View, type ComponentProps } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { BodyLgText, LabelText } from './Typography';
import { Colors } from '@/constants/theme';

interface QuickActionCardProps {
  icon: ComponentProps<typeof MaterialIcons>['name'];
  title: string;
  subtitle: string;
  onPress?: () => void;
}

/** Home-screen bento tile — icon in a soft orange badge, title + subtitle. */
export function QuickActionCard({ icon, title, subtitle, onPress }: QuickActionCardProps) {
  return (
    <Pressable
      onPress={onPress}
      className="flex-1 basis-[47%] gap-3 rounded-lg border border-border bg-surface p-gutter-card shadow-soft active:scale-[0.98]">
      <View className="h-10 w-10 items-center justify-center rounded-full bg-primary-soft">
        <MaterialIcons name={icon} size={20} color={Colors.primary} />
      </View>
      <View>
        <BodyLgText className="font-inter-semibold">{title}</BodyLgText>
        <LabelText>{subtitle}</LabelText>
      </View>
    </Pressable>
  );
}
