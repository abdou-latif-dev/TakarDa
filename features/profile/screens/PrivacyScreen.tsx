import { Linking, ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { AppHeader } from '@/components/ui/AppHeader';
import { SecondaryButton } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { BodyMdText, LabelText, SectionTitleText } from '@/components/ui/Typography';
import { CLOUD_ACCOUNT_ENABLED } from '@/constants/features';
import { ACCOUNT_DELETION_URL, PRIVACY_POLICY_URL } from '@/constants/legalLinks';
import { buildLegalLinks } from '@/services/legalLinks';
import { buildPrivacySections } from '@/services/privacyNotice';

/** Mes données : ce qui reste sur le téléphone, ce qui part dans le cloud, ce que voient propriétaire et locataire, et comment tout supprimer. Texte de premier niveau,
 * toujours disponible hors ligne ; les rubriques qui concernent les comptes et le partage n'apparaissent que lorsque ces fonctions sont ouvertes. */
export function PrivacyScreen() {
  const sections = buildPrivacySections().filter((s) => CLOUD_ACCOUNT_ENABLED || !s.cloudOnly);
  const links = buildLegalLinks({ privacy: PRIVACY_POLICY_URL, accountDeletion: ACCOUNT_DELETION_URL });
  return (
    <SafeAreaView className="flex-1 bg-background" edges={['top', 'bottom']}>
      <AppHeader title="Mes données" showBack />
      <ScrollView contentContainerClassName="w-full max-w-3xl gap-4 self-center px-page-margin pb-10">
        <LabelText>Ce que TakarDa fait de vos données, en clair. Rien n’est envoyé sans que vous l’ayez choisi.</LabelText>
        {sections.map((section) => (
          <Card key={section.id} className="gap-2">
            <SectionTitleText className="text-base">{section.title}</SectionTitleText>
            {section.lines.map((line, index) => (
              <BodyMdText key={`${section.id}-${index}`}>{line}</BodyMdText>
            ))}
          </Card>
        ))}
        {links.length > 0 ? (
          <View className="gap-2">
            {links.map((link) => (
              <SecondaryButton key={link.id} label={link.label} icon={link.icon} onPress={() => void Linking.openURL(link.url)} />
            ))}
          </View>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}
