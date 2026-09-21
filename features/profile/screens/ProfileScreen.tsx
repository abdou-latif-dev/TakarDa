import { Alert, ScrollView, View } from 'react-native';
import { router } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Avatar } from '@/components/ui/Avatar';
import { Card } from '@/components/ui/Card';
import { SettingsRow } from '@/components/ui/SettingsRow';
import { HeadlineText, BodyMdText } from '@/components/ui/Typography';
import { useAuthStore } from '@/store/authStore';

export function ProfileScreen() {
  const { user, logout } = useAuthStore();

  const onLogout = () => {
    Alert.alert('Déconnexion', 'Voulez-vous vraiment vous déconnecter ?', [
      { text: 'Annuler', style: 'cancel' },
      {
        text: 'Déconnexion',
        style: 'destructive',
        onPress: async () => {
          await logout();
          router.replace('/(auth)/login');
        },
      },
    ]);
  };

  return (
    <SafeAreaView className="flex-1 bg-white" edges={['top']}>
      <ScrollView contentContainerClassName="gap-6 px-page-margin pb-10 pt-4" showsVerticalScrollIndicator={false}>
        <View className="items-center gap-2">
          <Avatar name={user?.name ?? 'Vous'} size={112} />
          <HeadlineText className="mt-2">{user?.name}</HeadlineText>
          <BodyMdText>{user?.email}</BodyMdText>
          {user?.phone && <BodyMdText>{user.phone}</BodyMdText>}
          {user?.formeaseId && (
            <View className="mt-1 rounded-full bg-surface-container px-3 py-1">
              <BodyMdText className="text-text-primary">ID FormEase : {user.formeaseId}</BodyMdText>
            </View>
          )}
        </View>

        <Card className="gap-1">
          <SettingsRow icon="person-outline" label="Mon compte" onPress={() => router.push('/account')} />
          <SettingsRow icon="dashboard-customize" label="Mes modèles" onPress={() => router.push('/(tabs)/modeles')} />
          <SettingsRow icon="home-work" label="Immobilier (bêta)" onPress={() => router.push('/immobilier')} />
          <SettingsRow icon="receipt-long" label="Factures (bêta)" onPress={() => router.push('/factures')} />
          <SettingsRow icon="bar-chart" label="Statistiques" onPress={() => router.push('/(tabs)/statistiques')} />
        </Card>

        <Card className="gap-1">
          <SettingsRow
            icon="notifications-none"
            label="Notifications"
            onPress={() => router.push('/notifications/settings')}
          />
          <SettingsRow icon="security" label="Sécurité" onPress={() => router.push('/account/security')} />
          <SettingsRow icon="folder" label="Stockage" onPress={() => router.push('/account/storage')} />
          <SettingsRow icon="tune" label="Paramètres" onPress={() => router.push('/notifications/settings')} />
        </Card>

        <Card>
          <SettingsRow icon="logout" label="Déconnexion" destructive onPress={onLogout} trailing={<View />} />
        </Card>
      </ScrollView>
    </SafeAreaView>
  );
}
