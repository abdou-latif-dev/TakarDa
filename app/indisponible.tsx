import { View } from 'react-native';
import { router } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { AppHeader } from '@/components/ui/AppHeader';
import { PrimaryButton } from '@/components/ui/Button';
import { BodyMdText, SectionTitleText } from '@/components/ui/Typography';

/** Information : ce module est indisponible tant que plusieurs comptes ont utilisé cet appareil (voir services/moduleLock.ts). */
export default function UnavailableRoute() {
  return (
    <SafeAreaView className="flex-1 bg-background" edges={['top']}>
      <AppHeader title="Module indisponible" />
      <View className="gap-4 p-gutter">
        <SectionTitleText>Indisponible avec plusieurs comptes</SectionTitleText>
        <BodyMdText>
          Les tontines, les formulaires et les factures CEET/TDE ne sont pas encore séparés par compte. Tant que plusieurs comptes ont utilisé cet appareil, ils restent fermés
          pour éviter qu’un compte voie les données d’un autre. Vos données sont conservées intactes et redeviennent accessibles hors connexion ou avec un seul compte.
        </BodyMdText>
        <PrimaryButton label="Retour à l’accueil" onPress={() => router.replace('/(tabs)' as never)} />
      </View>
    </SafeAreaView>
  );
}
