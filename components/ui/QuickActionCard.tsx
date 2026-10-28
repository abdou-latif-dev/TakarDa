import { Pressable, View } from 'react-native';
import type { ComponentProps } from 'react';
import { MaterialIcons } from '@expo/vector-icons';
import { BodyLgText, LabelText } from './Typography';
import { Colors } from '@/constants/theme';

interface QuickActionCardProps {
  icon: ComponentProps<typeof MaterialIcons>['name'];
  title: string;
  subtitle: string;
  onPress?: () => void;
}

/** Tuile de l'accueil (maquettes Stitch) : pastille d'icône teintée en haut, titre + description en bas. */
export function QuickActionCard({ icon, title, subtitle, onPress }: QuickActionCardProps) {
  return (
    <Pressable
      onPress={onPress}
      className="min-h-[140px] flex-1 basis-[47%] justify-between gap-3 rounded-lg border border-border bg-surface p-gutter-card shadow-soft active:scale-[0.98]">
      <View className="h-9 w-9 items-center justify-center rounded-xl bg-primary-soft">
        <MaterialIcons name={icon} size={20} color={Colors.primary} />
      </View>
      <View>
        <BodyLgText className="font-manrope-bold">{title}</BodyLgText>
        <LabelText>{subtitle}</LabelText>
      </View>
    </Pressable>
  );
}
