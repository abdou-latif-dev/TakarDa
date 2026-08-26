import { useEffect } from 'react';
import { Alert, ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { MaterialIcons } from '@expo/vector-icons';
import { AppHeader } from '@/components/ui/AppHeader';
import { Card } from '@/components/ui/Card';
import { SecondaryButton } from '@/components/ui/Button';
import { LoadingState } from '@/components/ui/States';
import { HeadlineText, BodyMdText, LabelText, BodyLgText } from '@/components/ui/Typography';
import { Colors } from '@/constants/theme';
import { useStorageUsageStore } from '@/store/storageUsageStore';

const ROWS = [
  { key: 'formsCount' as const, icon: 'description' as const, label: 'Formulaires', description: 'Structures et modèles créés' },
  { key: 'submissionsCount' as const, icon: 'list-alt' as const, label: 'Soumissions', description: 'Dossiers et données collectées' },
  { key: 'attachmentFieldsCount' as const, icon: 'attach-file' as const, label: 'Champs de pièces jointes', description: 'Photos, fichiers et signatures configurés' },
];

export function StorageScreen() {
  const { usage, status, fetchUsage } = useStorageUsageStore();

  useEffect(() => {
    fetchUsage();
  }, [fetchUsage]);

  return (
    <SafeAreaView className="flex-1 bg-white" edges={['top']}>
      <AppHeader title="Stockage" showBack />
      <ScrollView contentContainerClassName="gap-6 px-page-margin pb-10" showsVerticalScrollIndicator={false}>
        {status === 'loading' && !usage && <LoadingState />}

        <Card className="items-center gap-2 py-8">
          <View className="h-16 w-16 items-center justify-center rounded-full bg-primary-soft">
            <MaterialIcons name="folder" size={28} color={Colors.primary} />
          </View>
          <HeadlineText>Stockage local</HeadlineText>
          <BodyMdText className="text-center">
            FormEase V1 conserve vos données sur cet appareil. Un vrai espace cloud avec quota arrivera dans une prochaine
            version.
          </BodyMdText>
        </Card>

        {usage && (
          <Card className="gap-0 p-0">
            {ROWS.map((row, i) => (
              <View key={row.key}>
                {i > 0 && <View className="h-px bg-border ml-[52px]" />}
                <View className="flex-row items-center gap-3 p-gutter-card">
                  <View className="h-8 w-8 items-center justify-center rounded-full bg-surface-container">
                    <MaterialIcons name={row.icon} size={16} color={Colors.textSecondary} />
                  </View>
                  <View className="flex-1">
                    <BodyLgText>{row.label}</BodyLgText>
                    <LabelText>{row.description}</LabelText>
                  </View>
                  <BodyLgText className="font-inter-semibold">{usage[row.key]}</BodyLgText>
                </View>
              </View>
            ))}
          </Card>
        )}

        <SecondaryButton
          label="Gérer mon stockage"
          icon="settings"
          onPress={() => Alert.alert('Bientôt disponible', 'La gestion avancée du stockage arrivera avec la synchronisation cloud.')}
        />
      </ScrollView>
    </SafeAreaView>
  );
}
