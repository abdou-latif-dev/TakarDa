import { useEffect, useState } from 'react';
import { ScrollView, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { MaterialIcons } from '@expo/vector-icons';
import { BottomSheetCard } from '@/components/ui/BottomSheetCard';
import { IconButton, PrimaryButton } from '@/components/ui/Button';
import { TextField, TextAreaField } from '@/components/ui/TextField';
import { Switch } from '@/components/ui/Switch';
import { Card } from '@/components/ui/Card';
import { SectionTitleText, LabelText, BodyMdText } from '@/components/ui/Typography';
import { Colors } from '@/constants/theme';
import { useFormStore } from '@/store/formStore';

export function FieldSettingsModal() {
  const { formId, fieldId } = useLocalSearchParams<{ formId: string; fieldId: string }>();
  const { activeForm, fetchForm, updateField } = useFormStore();
  const field = activeForm?.fields.find((f) => f.id === fieldId);

  const [label, setLabel] = useState(field?.label ?? '');
  const [placeholder, setPlaceholder] = useState(field?.placeholder ?? '');
  const [description, setDescription] = useState(field?.description ?? '');
  const [required, setRequired] = useState(field?.required ?? false);

  useEffect(() => {
    if (!activeForm && formId) fetchForm(formId);
  }, [activeForm, formId, fetchForm]);

  useEffect(() => {
    if (field) {
      setLabel(field.label);
      setPlaceholder(field.placeholder ?? '');
      setDescription(field.description ?? '');
      setRequired(field.required);
    }
  }, [field]);

  if (!field) return null;

  const onSave = async () => {
    await updateField(formId, fieldId, { label, placeholder: placeholder || undefined, description: description || undefined, required });
    router.back();
  };

  return (
    <BottomSheetCard className="flex-1">
      <View className="flex-row items-center justify-between px-page-margin pb-4">
        <SectionTitleText numberOfLines={1} className="flex-1">
          Paramètres du champ
        </SectionTitleText>
        <IconButton icon="close" size={18} onPress={() => router.back()} />
      </View>

      <ScrollView contentContainerClassName="gap-4 px-page-margin pb-6" keyboardShouldPersistTaps="handled">
        <Card className="gap-4">
          <TextField label="Label" value={label} onChangeText={setLabel} />
          <TextField label="Placeholder" placeholder="Ex: Jean Dupont" value={placeholder} onChangeText={setPlaceholder} />
        </Card>

        <Card>
          <TextAreaField
            label="Description (Optionnel)"
            placeholder="Précisez le contexte ou les instructions pour ce champ..."
            value={description}
            onChangeText={setDescription}
          />
        </Card>

        <Card className="gap-4">
          <SectionTitleText className="text-base">Validation & règles</SectionTitleText>
          <View className="flex-row items-center justify-between">
            <View>
              <LabelText className="font-inter-semibold text-text-primary">Champ obligatoire</LabelText>
              <LabelText>L&apos;utilisateur doit remplir ce champ</LabelText>
            </View>
            <Switch value={required} onValueChange={setRequired} />
          </View>
        </Card>

        <Card className="items-center gap-2 py-6">
          <MaterialIcons name="account-tree" size={28} color={Colors.emptyIcon} />
          <BodyMdText className="text-center">Ce champ est toujours visible.</BodyMdText>
        </Card>

        <PrimaryButton label="Enregistrer les modifications" onPress={onSave} />
      </ScrollView>
    </BottomSheetCard>
  );
}
