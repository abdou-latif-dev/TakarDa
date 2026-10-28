import { Linking, ScrollView, View } from 'react-native';
import { router } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Avatar } from '@/components/ui/Avatar';
import { Card } from '@/components/ui/Card';
import { SettingsRow } from '@/components/ui/SettingsRow';
import { HeadlineText, BodyMdText, LabelText } from '@/components/ui/Typography';
import { useAuthStore } from '@/store/authStore';
import { useAccountPromptStore } from '@/store/accountPromptStore';
import { DemoEntryCard } from '@/components/demo/DemoEntryCard';
import { CLOUD_ACCOUNT_ENABLED } from '@/constants/features';
import { buildProfileView, PROFILE_ENTRIES } from '@/services/profileService';
import { ACCOUNT_DELETION_URL, PRIVACY_POLICY_URL } from '@/constants/legalLinks';
import { buildLegalLinks } from '@/services/legalLinks';

/** Profil V1 : l'identité LOCALE de cet appareil et les quelques entrées qui fonctionnent. Pas de connexion
 * ni de déconnexion (sans compte, il n'y a aucune session à fermer). */
export function ProfileScreen() {
  const user = useAuthStore((s) => s.user);
  const openAccountPrompt = useAccountPromptStore((s) => s.open);
  const view = buildProfileView(user);
  // Liens légaux : vides tant qu'aucune adresse réelle n'est renseignée dans constants/legalLinks.ts (rien n'est affiché).
  const legalLinks = buildLegalLinks({ privacy: PRIVACY_POLICY_URL, accountDeletion: ACCOUNT_DELETION_URL });

  return (
    <SafeAreaView className="flex-1 bg-background" edges={['top']}>
      <ScrollView contentContainerClassName="gap-6 px-page-margin pb-10 pt-4" showsVerticalScrollIndicator={false}>
        <View className="items-center gap-2">
          <Avatar name={view.name} uri={view.avatarUri} size={112} />
          <HeadlineText className="mt-2">{view.name}</HeadlineText>
          {view.contact.map((line) => (
            <BodyMdText key={line}>{line}</BodyMdText>
          ))}
          {view.localIdLabel && (
            <View className="mt-1 rounded-full bg-surface-container px-3 py-1">
              <BodyMdText className="text-text-primary">{view.localIdLabel}</BodyMdText>
            </View>
          )}
        </View>

        <LabelText className="text-center">{view.note}</LabelText>

        <Card className="gap-1">
          {PROFILE_ENTRIES.map((entry) => (
            <SettingsRow key={entry.id} icon={entry.icon} label={entry.label} subtitle={entry.subtitle} onPress={() => (entry.id === 'cloud' && !CLOUD_ACCOUNT_ENABLED ? openAccountPrompt('sync') : router.push(entry.route as never))} />
          ))}
        </Card>

        {/* Démonstration facultative : un espace d'exemples séparé de vos données (masqué quand on y est déjà) */}
        <DemoEntryCard />

        {legalLinks.length > 0 && (
          <Card className="gap-1">
            {legalLinks.map((link) => (
              <SettingsRow key={link.id} icon={link.icon} label={link.label} subtitle={link.subtitle} onPress={() => void Linking.openURL(link.url)} />
            ))}
          </Card>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}
