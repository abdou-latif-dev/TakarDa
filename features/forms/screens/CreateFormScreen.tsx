import { useEffect, useRef, useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { MaterialIcons } from '@expo/vector-icons';
import { AppHeader } from '@/components/ui/AppHeader';
import { TextField, TextAreaField } from '@/components/ui/TextField';
import { PrimaryButton } from '@/components/ui/Button';
import { LoadingState } from '@/components/ui/States';
import { SectionTitleText, LabelText } from '@/components/ui/Typography';
import { Colors } from '@/constants/theme';
import { FIELD_TYPE_META } from '@/constants/fieldTypes';
import { useFormStore } from '@/store/formStore';

/** Handles both "Créer de zéro" (no formId param — starts a blank form) and
 * "Modifier" an existing/template-cloned form (formId param — just loads it). */
export function CreateFormScreen() {
  const { formId: existingFormId } = useLocalSearchParams<{ formId?: string }>();
  const { activeForm, createForm, updateForm, fetchForm, removeField } = useFormStore();
  const [title, setTitle] = useState('Nouveau Formulaire Client');
  const [description, setDescription] = useState('');
  const initializedRef = useRef(false);
  const syncedRef = useRef<string | null>(null);

  useEffect(() => {
    if (initializedRef.current) return;
    initializedRef.current = true;
    if (existingFormId) fetchForm(existingFormId);
    else createForm({ title: 'Nouveau Formulaire Client' });
  }, [existingFormId, fetchForm, createForm]);

  useEffect(() => {
    if (activeForm && syncedRef.current !== activeForm.id) {
      syncedRef.current = activeForm.id;
      setTitle(activeForm.title);
      setDescription(activeForm.description ?? '');
    }
  }, [activeForm]);

  if (!activeForm) {
    return (
      <SafeAreaView className="flex-1 bg-white" edges={['top', 'bottom']}>
        <AppHeader title={existingFormId ? 'Modifier le formulaire' : 'Créer un formulaire'} showBack />
        <View className="px-page-margin">
          <LoadingState />
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView className="flex-1 bg-white" edges={['top', 'bottom']}>
      <AppHeader title={existingFormId ? 'Modifier le formulaire' : 'Créer un formulaire'} showBack />
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} className="flex-1">
      <ScrollView contentContainerClassName="gap-6 px-page-margin pb-6" keyboardShouldPersistTaps="handled">
        <View className="gap-3">
          <SectionTitleText>Détails du formulaire</SectionTitleText>
          <TextField label="Nom du formulaire" value={title} onChangeText={setTitle} />
          <TextAreaField
            label="Description (Optionnelle)"
            placeholder="À quoi sert ce formulaire ?"
            value={description}
            onChangeText={setDescription}
          />
        </View>

        <View className="gap-3">
          <View className="flex-row items-center gap-2">
            <SectionTitleText>Champs du formulaire</SectionTitleText>
            <View className="rounded-full bg-surface-container px-2.5 py-0.5">
              <LabelText>{activeForm.fields.length} champs</LabelText>
            </View>
          </View>

          <View className="gap-3">
            {activeForm.fields.map((field) => {
              const meta = FIELD_TYPE_META[field.type];
              return (
                <Pressable
                  key={field.id}
                  onPress={() => router.push(`/modals/field-settings?formId=${activeForm.id}&fieldId=${field.id}`)}
                  className="flex-row items-center gap-3 rounded-lg border border-border bg-surface p-gutter-card shadow-soft active:scale-[0.98]">
                  <View className="h-10 w-10 items-center justify-center rounded-full bg-primary-soft">
                    <MaterialIcons name={meta.icon} size={18} color={Colors.primary} />
                  </View>
                  <View className="flex-1">
                    <View className="flex-row items-center gap-1">
                      <LabelText className="font-inter-semibold text-text-primary">{field.label}</LabelText>
                      {field.required && <LabelText className="text-error">*</LabelText>}
                    </View>
                    <LabelText>{meta.label}</LabelText>
                  </View>
                  <Pressable hitSlop={8} onPress={() => removeField(activeForm.id, field.id)}>
                    <MaterialIcons name="close" size={18} color={Colors.textMuted} />
                  </Pressable>
                </Pressable>
              );
            })}
          </View>

          <Pressable
            onPress={() => router.push(`/modals/add-field?formId=${activeForm.id}`)}
            className="flex-row items-center justify-center gap-2 rounded-lg border-2 border-dashed border-border py-4 active:opacity-80">
            <MaterialIcons name="add" size={18} color={Colors.primary} />
            <LabelText className="font-inter-semibold text-primary">Ajouter un champ</LabelText>
          </Pressable>
        </View>
      </ScrollView>

      <View className="gap-2 border-t border-border px-page-margin pb-4 pt-4">
        {activeForm.fields.length === 0 && (
          <LabelText className="text-center">Ajoutez au moins un champ pour enregistrer ce formulaire.</LabelText>
        )}
        <PrimaryButton
          label="Enregistrer le formulaire"
          disabled={activeForm.fields.length === 0}
          onPress={async () => {
            await updateForm(activeForm.id, { title, description: description.trim() || undefined });
            router.replace(`/form/${activeForm.id}/preview`);
          }}
        />
      </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
