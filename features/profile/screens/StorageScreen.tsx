import { useEffect } from 'react';
import { Alert, Share, ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { MaterialIcons } from '@expo/vector-icons';
import { AppHeader } from '@/components/ui/AppHeader';
import { Card } from '@/components/ui/Card';
import { SecondaryButton } from '@/components/ui/Button';
import { LoadingState } from '@/components/ui/States';
import { HeadlineText, BodyMdText, LabelText, BodyLgText } from '@/components/ui/Typography';
import { Colors } from '@/constants/theme';
import { useStorageUsageStore } from '@/store/storageUsageStore';
import {
  activityEvents,
  contributions,
  documents,
  entityDefinitions,
  events,
  externalContacts,
  forms,
  groups,
  memberships,
  notifications,
  records,
  roleDefinitions,
  submissions,
  tontineCycles,
  toolMembers,
  tools,
  users,
  workflowRules,
} from '@/services/db';

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

  const exportBackup = async () => {
    const backup = {
      format: 'TakarDa local backup',
      schemaVersion: 1,
      exportedAt: new Date().toISOString(),
      data: {
        users, groups, memberships, tontineCycles, contributions, forms, submissions,
        activityEvents, notifications, tools, entityDefinitions, records, toolMembers,
        externalContacts, roleDefinitions, events, documents, workflowRules,
      },
    };
    try {
      await Share.share({
        title: 'Sauvegarde TakarDa',
        message: JSON.stringify(backup),
      });
    } catch {
      Alert.alert('Export impossible', 'La sauvegarde n’a pas pu être partagée. Réessayez.');
    }
  };

  return (
    <SafeAreaView className="flex-1 bg-background" edges={['top', 'bottom']}>
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
          label="Exporter une sauvegarde"
          icon="ios-share"
          onPress={exportBackup}
        />
        <BodyMdText className="text-center">Export JSON de vos données locales pour les conserver dans un emplacement sûr.</BodyMdText>
      </ScrollView>
    </SafeAreaView>
  );
}
