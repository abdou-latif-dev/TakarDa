import { useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { MaterialIcons } from '@expo/vector-icons';
import { AppHeader } from '@/components/ui/AppHeader';
import { TextAreaField } from '@/components/ui/TextField';
import { DestructiveButton, SecondaryButton } from '@/components/ui/Button';
import { LabelText, SectionTitleText, BodyMdText } from '@/components/ui/Typography';
import { Colors } from '@/constants/theme';
import { useSubmissionStore } from '@/store/submissionStore';

const REJECT_REASONS = [
  { id: 'incorrect', label: 'Informations incorrectes', icon: 'error' as const },
  { id: 'missing_doc', label: 'Document manquant', icon: 'find-in-page' as const },
  { id: 'incomplete', label: 'Incomplètes', icon: 'rule' as const },
  { id: 'other', label: 'Autre', icon: 'more-horiz' as const },
];

export function RejectDossierScreen() {
  const { submissionId, mode } = useLocalSearchParams<{ submissionId: string; mode?: string }>();
  const isCorrection = mode === 'correction';
  const setStatus = useSubmissionStore((s) => s.setStatus);
  const [reason, setReason] = useState('incorrect');
  const [note, setNote] = useState('');
  const [loading, setLoading] = useState(false);

  const reasonLabel = REJECT_REASONS.find((r) => r.id === reason)?.label ?? '';

  const onConfirm = async () => {
    setLoading(true);
    try {
      await setStatus(submissionId, isCorrection ? 'correction_requested' : 'rejected', `${reasonLabel}${note ? ` — ${note}` : ''}`);
      router.replace('/records');
    } finally {
      setLoading(false);
    }
  };

  return (
    <SafeAreaView className="flex-1 bg-white" edges={['top', 'bottom']}>
      <AppHeader title="FormEase" showBack />
      <ScrollView contentContainerClassName="gap-6 px-page-margin pb-6" keyboardShouldPersistTaps="handled">
        <View className="items-center gap-2">
          <View className="h-16 w-16 items-center justify-center rounded-full bg-error-container">
            <MaterialIcons name={isCorrection ? 'edit-note' : 'cancel'} size={28} color={Colors.error} />
          </View>
          <SectionTitleText className="text-xl">{isCorrection ? 'Demander une correction' : 'Rejeter le dossier'}</SectionTitleText>
          <BodyMdText className="text-center">
            {isCorrection
              ? 'Précisez ce que le client doit corriger dans son dossier.'
              : 'Veuillez indiquer la raison du rejet de ce dossier.'}
          </BodyMdText>
        </View>

        <View className="gap-3">
          <LabelText>Motif</LabelText>
          <View className="flex-row flex-wrap gap-3">
            {REJECT_REASONS.map((r) => {
              const selected = reason === r.id;
              return (
                <Pressable
                  key={r.id}
                  onPress={() => setReason(r.id)}
                  className="basis-[47%] flex-1 flex-row items-center gap-2 rounded-lg border p-3"
                  style={{
                    borderColor: selected ? Colors.error : Colors.border,
                    backgroundColor: selected ? Colors.errorContainer : Colors.surface,
                  }}>
                  <MaterialIcons name={r.icon} size={18} color={selected ? Colors.error : Colors.textSecondary} />
                  <LabelText style={{ color: selected ? '#93000A' : Colors.textPrimary }} className="flex-1">
                    {r.label}
                  </LabelText>
                </Pressable>
              );
            })}
          </View>
        </View>

        <TextAreaField
          label="Remarques additionnelles"
          placeholder="Ex: La pièce d'identité fournie est illisible..."
          value={note}
          onChangeText={setNote}
        />
      </ScrollView>

      <View className="gap-3 border-t border-border px-page-margin pb-4 pt-4">
        <DestructiveButton
          label={isCorrection ? 'Envoyer la demande' : 'Rejeter le dossier'}
          icon={isCorrection ? 'send' : 'cancel'}
          loading={loading}
          onPress={onConfirm}
        />
        <SecondaryButton label="Annuler" onPress={() => router.back()} />
      </View>
    </SafeAreaView>
  );
}
