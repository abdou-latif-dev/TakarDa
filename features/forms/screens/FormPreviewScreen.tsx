import { useEffect, useState } from 'react';
import { Alert, ScrollView, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { MaterialIcons } from '@expo/vector-icons';
import { AppHeader } from '@/components/ui/AppHeader';
import { Card } from '@/components/ui/Card';
import { LoadingState } from '@/components/ui/States';
import { DisplayText, BodyMdText, LabelText } from '@/components/ui/Typography';
import { PrimaryButton, SecondaryButton, IconButton } from '@/components/ui/Button';
import { Colors } from '@/constants/theme';
import { FieldRenderer } from '@/features/forms/components/FieldRenderer';
import { useFormStore } from '@/store/formStore';
import type { SubmissionAnswer } from '@/types/entities';

export function FormPreviewScreen() {
  const { formId } = useLocalSearchParams<{ formId: string }>();
  const { activeForm, fetchForm, deleteForm } = useFormStore();
  const [answers, setAnswers] = useState<Record<string, SubmissionAnswer['value']>>({});
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    fetchForm(formId);
  }, [formId, fetchForm]);

  const onDelete = () => {
    Alert.alert(
      'Supprimer ce modèle',
      `"${activeForm?.title}" et les données déjà collectées seront définitivement supprimés. Continuer ?`,
      [
        { text: 'Annuler', style: 'cancel' },
        {
          text: 'Supprimer',
          style: 'destructive',
          onPress: async () => {
            setDeleting(true);
            try {
              await deleteForm(formId);
              router.replace({ pathname: '/(tabs)/modeles', params: { justDeleted: 'Modèle supprimé' } });
            } finally {
              setDeleting(false);
            }
          },
        },
      ],
    );
  };

  if (!activeForm) {
    return (
      <SafeAreaView className="flex-1 bg-white" edges={['top', 'bottom']}>
        <AppHeader showBack />
        <View className="px-page-margin">
          <LoadingState />
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView className="flex-1 bg-white" edges={['top', 'bottom']}>
      <AppHeader
        showBack
        trailing={<IconButton icon="edit" onPress={() => router.push(`/form/${activeForm.id}/edit`)} />}
      />
      <ScrollView contentContainerClassName="gap-6 px-page-margin pb-10" keyboardShouldPersistTaps="handled">
        <View className="flex-row items-center gap-2 self-start rounded-full bg-success-container px-3 py-1">
          <MaterialIcons name="check-circle" size={14} color={Colors.success} />
          <LabelText style={{ color: Colors.success }} className="font-inter-semibold">
            Aperçu · non enregistré
          </LabelText>
        </View>

        <View>
          <DisplayText className="text-2xl">{activeForm.title}</DisplayText>
          {activeForm.description ? <BodyMdText className="mt-2">{activeForm.description}</BodyMdText> : null}
        </View>

        <Card className="gap-5">
          {activeForm.fields.length === 0 ? (
            <BodyMdText>Ce formulaire n&apos;a pas encore de champs.</BodyMdText>
          ) : (
            activeForm.fields.map((field) => (
              <FieldRenderer
                key={field.id}
                field={field}
                value={answers[field.id] ?? null}
                onChange={(v) => setAnswers((prev) => ({ ...prev, [field.id]: v }))}
              />
            ))
          )}
        </Card>

        <View className="gap-3">
          <PrimaryButton
            label="Remplir comme un client"
            icon="visibility"
            iconPosition="left"
            onPress={() => router.push(`/form/${activeForm.id}/fill`)}
          />
          <SecondaryButton
            label="Voir les statistiques"
            icon="bar-chart"
            onPress={() => router.push(`/form/${activeForm.id}/stats`)}
          />
          <SecondaryButton
            label="Voir les soumissions"
            icon="inbox"
            onPress={() => router.push(`/records?formId=${activeForm.id}&formTitle=${encodeURIComponent(activeForm.title)}`)}
          />
          <SecondaryButton label="Supprimer ce modèle" icon="delete-outline" loading={deleting} onPress={onDelete} />
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}
