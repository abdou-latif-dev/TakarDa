import { Pressable, View } from 'react-native';
import { router } from 'expo-router';
import { MaterialIcons } from '@expo/vector-icons';
import { BottomSheetCard } from '@/components/ui/BottomSheetCard';
import { SectionTitleText, BodyMdText } from '@/components/ui/Typography';
import { Colors } from '@/constants/theme';

const OPTIONS = [
  { icon: 'savings' as const, title: 'Tontine', description: 'Gérer des cotisations', href: '/tontine/create' as const },
  { icon: 'home-work' as const, title: 'Immobilier', description: 'Gérer un bien et les loyers', href: '/immobilier' as const },
  { icon: 'receipt-long' as const, title: 'Facture', description: 'Suivre et valider un paiement', href: '/factures/new' as const },
  { icon: 'assignment' as const, title: 'Formulaire', description: 'Collecter des informations', href: '/form/new' as const },
  { icon: 'storefront' as const, title: 'Commerce / Business', description: 'Partir d’un modèle de suivi', href: '/form/templates' as const },
  { icon: 'event' as const, title: 'Activité', description: 'Organiser une activité', href: '/new-activity' as const },
];

export function CreateMenuModal() {
  return (
    <BottomSheetCard>
      <SectionTitleText className="px-page-margin pb-4">Créer</SectionTitleText>
      <View className="gap-3 px-page-margin pb-8">
        {OPTIONS.map((option) => (
          <Pressable
            key={option.title}
            onPress={() => router.replace(option.href as never)}
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
