import { Pressable, View } from 'react-native';
import { router } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { MaterialIcons } from '@expo/vector-icons';
import { AppHeader } from '@/components/ui/AppHeader';
import { SectionTitleText, BodyMdText, DisplayText, LabelText } from '@/components/ui/Typography';
import { Colors } from '@/constants/theme';

function ChoiceCard({
  icon,
  title,
  description,
  actionLabel,
  onPress,
}: {
  icon: keyof typeof MaterialIcons.glyphMap;
  title: string;
  description: string;
  actionLabel: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      className="min-h-[200px] flex-1 justify-between gap-4 rounded-xl border border-border bg-surface p-gutter-card shadow-soft active:opacity-90">
      <View className="h-14 w-14 items-center justify-center rounded-full bg-primary-soft">
        <MaterialIcons name={icon} size={26} color={Colors.primary} />
      </View>
      <View className="gap-2">
        <SectionTitleText>{title}</SectionTitleText>
        <BodyMdText>{description}</BodyMdText>
      </View>
      <View className="flex-row items-center gap-1">
        <LabelText className="font-inter-semibold text-primary">{actionLabel}</LabelText>
        <MaterialIcons name="arrow-forward" size={16} color={Colors.primary} />
      </View>
    </Pressable>
  );
}

export function NewFormChoiceScreen() {
  return (
    <SafeAreaView className="flex-1 bg-white" edges={['top', 'bottom']}>
      <AppHeader showBack />
      <View className="gap-6 px-page-margin pt-2">
        <View className="items-center gap-2">
          <DisplayText className="text-center text-2xl">Commencer la création</DisplayText>
          <BodyMdText className="text-center">
            Choisissez comment vous souhaitez démarrer votre nouveau formulaire aujourd&apos;hui.
          </BodyMdText>
        </View>

        <View className="gap-4">
          <ChoiceCard
            icon="dashboard-customize"
            title="Choisir un modèle"
            description="Parcourez notre bibliothèque de modèles professionnels prêts à l'emploi et gagnez du temps."
            actionLabel="Explorer la galerie"
            onPress={() => router.push('/form/templates')}
          />
          <ChoiceCard
            icon="add"
            title="Créer de zéro"
            description="Commencez avec une page blanche et concevez un formulaire entièrement sur mesure."
            actionLabel="Démarrer un canevas vide"
            onPress={() => router.push('/form/create')}
          />
        </View>
      </View>
    </SafeAreaView>
  );
}
