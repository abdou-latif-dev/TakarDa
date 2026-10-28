import { View } from 'react-native';
import { router } from 'expo-router';
import { Card } from '@/components/ui/Card';
import { PrimaryButton, SecondaryButton } from '@/components/ui/Button';
import { BodyMdText, SectionTitleText } from '@/components/ui/Typography';
import { CLOUD_ACCOUNT_ENABLED } from '@/constants/features';
import { HOME_ACCOUNT_PROMPT_COPY, resolveAccountChoice, showHomeAccountPrompt, type AccountChoice } from '@/services/accountPromptService';
import { useAccountPromptStore } from '@/store/accountPromptStore';
import { useCloudStore } from '@/store/cloudStore';

/** Accueil, sous l'en-tête (profil et notifications) : « S'inscrire » et « Se connecter ». Facultatif, jamais bloquant ; disparaît
 * une fois connecté. Comptes fermés : les boutons ouvrent le message « Comptes bientôt disponibles » (aucun écran de compte,
 * rien n'est envoyé). Voir services/accountPromptService.ts. */
export function HomeAccountPrompt() {
  const authStatus = useCloudStore((s) => s.authStatus);
  const openUnavailable = useAccountPromptStore((s) => s.openUnavailable);

  if (!showHomeAccountPrompt(CLOUD_ACCOUNT_ENABLED, authStatus)) return null;

  const choose = (choice: AccountChoice) => {
    const result = resolveAccountChoice(choice, CLOUD_ACCOUNT_ENABLED);
    if (result.kind === 'unavailable') openUnavailable();
    else router.push(result.route as never);
  };

  return (
    <Card className="gap-3">
      <View className="gap-1">
        <SectionTitleText className="text-base">{HOME_ACCOUNT_PROMPT_COPY.title}</SectionTitleText>
        <BodyMdText>{HOME_ACCOUNT_PROMPT_COPY.message}</BodyMdText>
      </View>
      <View className="flex-row gap-3">
        <View className="flex-1">
          <PrimaryButton label="S’inscrire" onPress={() => choose('sign-up')} />
        </View>
        <View className="flex-1">
          <SecondaryButton label="Se connecter" onPress={() => choose('login')} />
        </View>
      </View>
    </Card>
  );
}
