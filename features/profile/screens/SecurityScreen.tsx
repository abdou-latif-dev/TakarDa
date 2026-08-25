import { useState } from 'react';
import { Alert, ScrollView, View } from 'react-native';
import { router } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { AppHeader } from '@/components/ui/AppHeader';
import { Card } from '@/components/ui/Card';
import { SettingsRow } from '@/components/ui/SettingsRow';
import { Switch } from '@/components/ui/Switch';
import { SecondaryButton } from '@/components/ui/Button';
import { BodyMdText, SectionTitleText } from '@/components/ui/Typography';
import { useAuthStore } from '@/store/authStore';

export function SecurityScreen() {
  const logout = useAuthStore((s) => s.logout);
  const [biometric, setBiometric] = useState(true);

  const onLogoutAll = () => {
    Alert.alert('Déconnexion de tous les appareils', 'Toutes vos sessions actives seront fermées. Continuer ?', [
      { text: 'Annuler', style: 'cancel' },
      {
        text: 'Déconnecter',
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
      <AppHeader title="Sécurité" showBack />
      <ScrollView contentContainerClassName="gap-6 px-page-margin pb-10">
        <BodyMdText>Gérez vos paramètres de sécurité pour protéger votre compte FormEase et vos données.</BodyMdText>

        <View className="gap-2">
          <SectionTitleText className="px-1 text-base">Connexion</SectionTitleText>
          <Card className="gap-0 p-0">
            <View className="p-gutter-card">
              <SettingsRow
                icon="lock-outline"
                label="Changer le mot de passe"
                subtitle="Dernière modification il y a 3 mois"
                onPress={() => router.push('/(auth)/forgot-password')}
              />
            </View>
            <View className="h-px bg-border ml-[52px]" />
            <View className="p-gutter-card">
              <SettingsRow
                icon="fingerprint"
                label="Authentification biométrique"
                subtitle="Face ID / Touch ID"
                trailing={<Switch value={biometric} onValueChange={setBiometric} />}
              />
            </View>
          </Card>
        </View>

        <View className="gap-2">
          <SectionTitleText className="px-1 text-base">Appareils &amp; Sessions</SectionTitleText>
          <Card className="gap-0 p-0">
            <View className="p-gutter-card">
              <SettingsRow
                icon="devices"
                label="Appareils connectés"
                subtitle="2 appareils reconnus"
                onPress={() => Alert.alert('Appareils connectés', '• iPhone 14 — cette session\n• Chrome (Windows) — il y a 2 jours')}
              />
            </View>
            <View className="h-px bg-border ml-[52px]" />
            <View className="p-gutter-card">
              <SettingsRow
                icon="history"
                label="Sessions actives"
                subtitle="Gérer vos connexions actuelles"
                onPress={() => Alert.alert('Sessions actives', 'Une seule session active pour le moment.')}
              />
            </View>
          </Card>
        </View>

        <SecondaryButton
          label="Déconnexion de tous les appareils"
          icon="logout"
          onPress={onLogoutAll}
          className="border-error"
        />
      </ScrollView>
    </SafeAreaView>
  );
}
