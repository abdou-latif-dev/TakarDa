import { Pressable, View } from 'react-native';
import { router } from 'expo-router';
import { MaterialIcons } from '@expo/vector-icons';
import { BottomSheetCard } from '@/components/ui/BottomSheetCard';
import { SectionTitleText, BodyMdText } from '@/components/ui/Typography';
import { Colors } from '@/constants/theme';

/** Ancien menu « + » (plus accessible depuis la navigation : le « + » est maintenant dans Mes Outils et ouvre
 * le catalogue). Conservé ; ses entrées ouvrent l'ESPACE du module — jamais directement un formulaire de
 * création — et seuls les modèles du catalogue V1 y figurent. */
const OPTIONS = [
  { icon: 'home-work' as const, title: 'Immobilier', description: 'Ouvrir votre espace Immobilier', href: '/immobilier' as const },
  { icon: 'savings' as const, title: 'Tontine', description: 'Ouvrir votre espace Tontine', href: '/tontine' as const },
];

export function CreateMenuModal() {
  return (
    <BottomSheetCard>
      <SectionTitleText className="px-page-margin pb-4">Créer</SectionTitleText>
      <View className="gap-3 px-page-margin pb-8">
        {OPTIONS.map((option) => (
          <Pressable
            key={option.title}
            onPress={() => router.dismissTo(option.href as never)}
            className="flex-row items-center gap-4 rounded-lg border border-border p-gutter-card active:bg-background-secondary">
            <View className="h-12 w-12 items-center justify-center rounded-full bg-surface-container">
              <MaterialIcons name={option.icon} size={22} color={Colors.textPrimary} />
            </View>
            <View className="flex-1">
              <SectionTitleText className="text-base">{option.title}</SectionTitleText>
              <BodyMdText>{option.description}</BodyMdText>
            </View>
            <MaterialIcons name="chevron-right" size={20} color={Colors.emptyIcon} />
          </Pressable>
        ))}
      </View>
    </BottomSheetCard>
  );
}
