import { useEffect, useMemo, useState } from 'react';
import { ScrollView, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { AppHeader } from '@/components/ui/AppHeader';
import { Card } from '@/components/ui/Card';
import { PrimaryButton, SecondaryButton } from '@/components/ui/Button';
import { DisplayText, BodyMdText, BodyLgText, LabelText } from '@/components/ui/Typography';
import { LoadingState } from '@/components/ui/States';
import { useFormStore } from '@/store/formStore';
import { useSubmissionStore } from '@/store/submissionStore';
import type { SubmissionAnswer } from '@/types/entities';

function formatValue(value: SubmissionAnswer['value']): string {
  if (value === null || value === undefined || value === '') return '—';
  if (typeof value === 'boolean') return value ? 'Oui' : 'Non';
  if (Array.isArray(value)) return value.join(', ');
  return String(value);
}

export function FormReviewScreen() {
  const { formId, clientName, answers: answersParam } = useLocalSearchParams<{
    formId: string;
    clientName: string;
    answers: string;
  }>();
  const { activeForm, fetchForm } = useFormStore();
  const createSubmission = useSubmissionStore((s) => s.createSubmission);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!activeForm) fetchForm(formId);
  }, [activeForm, formId, fetchForm]);

  const answers: SubmissionAnswer[] = useMemo(() => {
    try {
      return JSON.parse(answersParam ?? '[]');
    } catch {
      return [];
    }
  }, [answersParam]);

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

  const onSubmit = async () => {
    setSubmitting(true);
    try {
      const submission = await createSubmission({ formId, clientName, answers });
      router.replace(`/form/${formId}/success?submissionId=${submission.id}`);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <SafeAreaView className="flex-1 bg-white" edges={['top', 'bottom']}>
      <AppHeader showBack />
      <ScrollView contentContainerClassName="gap-6 px-page-margin pb-10">
        <View>
          <DisplayText className="text-2xl">Vérifiez vos informations</DisplayText>
          <BodyMdText className="mt-2">Veuillez vérifier les informations ci-dessous avant de soumettre.</BodyMdText>
        </View>

        <Card className="gap-0 p-0">
          <View className="flex-row items-center justify-between p-gutter-card">
            <LabelText>Nom du client</LabelText>
            <BodyLgText className="font-inter-semibold">{clientName}</BodyLgText>
          </View>
          {activeForm.fields
            .filter((f) => f.type !== 'section')
            .map((field, i, arr) => {
              const answer = answers.find((a) => a.fieldId === field.id);
              return (
                <View key={field.id}>
                  <View className="h-px bg-border" />
                  <View className="flex-row items-center justify-between p-gutter-card">
                    <LabelText className="flex-1 pr-3">{field.label}</LabelText>
                    <BodyLgText className="flex-1 text-right font-inter-semibold" numberOfLines={2}>
                      {formatValue(answer?.value ?? null)}
                    </BodyLgText>
                  </View>
                </View>
              );
            })}
        </Card>

        <View className="gap-3">
          <PrimaryButton label="Envoyer" loading={submitting} onPress={onSubmit} />
          <SecondaryButton label="Modifier" onPress={() => router.back()} />
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}
