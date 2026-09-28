import { Pressable, View } from 'react-native';
import { router } from 'expo-router';
import { MaterialIcons } from '@expo/vector-icons';
import { BottomSheetCard } from '@/components/ui/BottomSheetCard';
import { SectionTitleText, BodyMdText } from '@/components/ui/Typography';
import { Colors } from '@/constants/theme';

/** Scope locked to the 4 demo-priority domains — see Étape 4D. Old templates
 * (Formulaire générique, Activité, ...) still exist and are still routable,
 * they're just no longer offered from this entry point. */
const OPTIONS = [
  { icon: 'home-work' as const, title: 'Bien immobilier', description: 'Ajouter un bien à gérer', href: '/immobilier/new' as const },
  { icon: 'receipt-long' as const, title: 'Facture', description: 'CEET, TDE ou autre facture', href: '/factures/new' as const },
  { icon: 'savings' as const, title: 'Tontine', description: 'Gérer des cotisations', href: '/tontine/create' as const },
  { icon: 'storefront' as const, title: 'Commerce / Business', description: 'Partir d’un modèle de suivi', href: '/form/templates?category=commerce' as const },
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
