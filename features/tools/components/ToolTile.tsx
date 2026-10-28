import { Pressable, View } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { LabelText, SectionTitleText } from '@/components/ui/Typography';
import { Colors } from '@/constants/theme';
import type { MyTool } from '@/services/toolRegistryService';

/** Ligne d'un outil de Mes Outils : icône, nom, description ; un appui ouvre l'outil. */
export function ToolTile({ item, onOpen }: { item: MyTool; onOpen: () => void }) {
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onOpen}
      className="min-h-14 flex-row items-center gap-3 rounded-xl border border-border bg-surface p-gutter-card active:opacity-80">
      <View className="h-11 w-11 items-center justify-center rounded-full bg-primary-soft">
        <MaterialIcons name={item.model.icon} size={20} color={Colors.primary} />
      </View>
      <View className="flex-1">
        <SectionTitleText className="text-base" numberOfLines={1}>{item.model.title}</SectionTitleText>
        <LabelText numberOfLines={2}>{item.model.description}</LabelText>
      </View>
      <MaterialIcons name="chevron-right" size={20} color={Colors.emptyIcon} />
    </Pressable>
  );
}
