import { useEffect, useMemo, useState } from 'react';
import { ScrollView, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { AppHeader } from '@/components/ui/AppHeader';
import { ProgressBar } from '@/components/ui/ProgressBar';
import { TextField } from '@/components/ui/TextField';
import { PrimaryButton, SecondaryButton } from '@/components/ui/Button';
import { LoadingState } from '@/components/ui/States';
import { DisplayText, BodyMdText, LabelText } from '@/components/ui/Typography';
import { FieldRenderer } from '@/features/forms/components/FieldRenderer';
import { useFormStore } from '@/store/formStore';
import type { SubmissionAnswer } from '@/types/entities';

export function FormFillScreen() {
  const { formId } = useLocalSearchParams<{ formId: string }>();
  const { activeForm, fetchForm } = useFormStore();
  const [clientName, setClientName] = useState('');
  const [answers, setAnswers] = useState<Record<string, SubmissionAnswer['value']>>({});
  const [step, setStep] = useState(0);

  useEffect(() => {
    fetchForm(formId);
  }, [formId, fetchForm]);

  const pages = useMemo(() => {
    if (!activeForm) return [];
    const result: (typeof activeForm.fields)[] = [];
    let current: typeof activeForm.fields = [];
    for (const field of activeForm.fields) {
      if (field.type === 'section' && current.length > 0) {
        result.push(current);
        current = [];
      }
      current.push(field);
    }
    if (current.length > 0) result.push(current);
    return result.length > 0 ? result : [[]];
  }, [activeForm]);

  if (!activeForm) {
    return (
      <SafeAreaView className="flex-1 bg-white" edges={['top']}>
        <AppHeader showBack />
        <View className="px-page-margin">
          <LoadingState />
        </View>
      </SafeAreaView>
    );
  }

  const totalSteps = pages.length + 1;
  const currentPage = step === 0 ? [] : pages[step - 1];
  const progress = (step + 1) / totalSteps;

  const canContinue =
    step === 0
      ? clientName.trim().length > 0
      : currentPage.every((f) => !f.required || f.type === 'section' || Boolean(answers[f.id]));

  const onNext = () => {
    if (step < totalSteps - 1) {
      setStep((s) => s + 1);
      return;
    }
    router.push({
      pathname: '/form/[formId]/review',
      params: {
        formId,
        clientName,
        answers: JSON.stringify(Object.entries(answers).map(([fieldId, value]) => ({ fieldId, value }))),
      },
    });
  };

  return (
    <SafeAreaView className="flex-1 bg-white" edges={['top', 'bottom']}>
      <AppHeader showBack={step > 0} onBack={() => setStep((s) => s - 1)} title="FormEase" />
      <View className="gap-2 px-page-margin">
        <View className="flex-row items-center justify-between">
          <LabelText className="uppercase tracking-wide">
            Étape {step + 1} sur {totalSteps}
          </LabelText>
          <LabelText>{Math.round(progress * 100)}%</LabelText>
        </View>
        <ProgressBar progress={progress} />
      </View>

      <ScrollView contentContainerClassName="gap-5 px-page-margin py-6" keyboardShouldPersistTaps="handled">
        <View>
          <DisplayText className="text-2xl">{activeForm.title}</DisplayText>
          {activeForm.description ? <BodyMdText className="mt-2">{activeForm.description}</BodyMdText> : null}
        </View>

        {step === 0 ? (
          <TextField label="Votre nom complet" placeholder="Ex: Jean Dupont" value={clientName} onChangeText={setClientName} />
        ) : (
          currentPage.map((field) => (
            <FieldRenderer
              key={field.id}
              field={field}
              value={answers[field.id] ?? null}
              onChange={(v) => setAnswers((prev) => ({ ...prev, [field.id]: v }))}
            />
          ))
        )}
      </ScrollView>

      <View className="flex-row gap-3 border-t border-border px-page-margin pb-4 pt-4">
        {step > 0 && <SecondaryButton label="Retour" onPress={() => setStep((s) => s - 1)} className="flex-1" fullWidth={false} />}
        <PrimaryButton
          label={step === totalSteps - 1 ? 'Continuer' : 'Continuer'}
          icon="arrow-forward"
          disabled={!canContinue}
          onPress={onNext}
          className="flex-[2]"
          fullWidth={step === 0}
        />
      </View>
    </SafeAreaView>
  );
}
