import { useEffect, useState } from 'react';
import { Alert, Pressable, ScrollView, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { MaterialIcons } from '@expo/vector-icons';
import { AppHeader } from '@/components/ui/AppHeader';
import { Card } from '@/components/ui/Card';
import { Chip } from '@/components/ui/Chip';
import { PrimaryButton, SecondaryButton } from '@/components/ui/Button';
import { Switch } from '@/components/ui/Switch';
import { TextField } from '@/components/ui/TextField';
import { LoadingState } from '@/components/ui/States';
import { BodyMdText, LabelText, SectionTitleText } from '@/components/ui/Typography';
import { Colors } from '@/constants/theme';
import { coreService } from '@/services/coreService';
import type { CoreFieldType, EntityDefinition, FieldDefinition } from '@/types/entities';

const TYPES: { key: Extract<CoreFieldType, 'text' | 'number' | 'amount' | 'date' | 'boolean' | 'select'>; label: string }[] = [
  { key: 'text', label: 'Texte' }, { key: 'number', label: 'Nombre' }, { key: 'amount', label: 'Montant' },
  { key: 'date', label: 'Date' }, { key: 'boolean', label: 'Oui / non' }, { key: 'select', label: 'Choix' },
];

export function EntityFieldsScreen() {
  const { entityDefinitionId } = useLocalSearchParams<{ toolId: string; entityDefinitionId: string }>();
  const [entity, setEntity] = useState<EntityDefinition | null>(null);
  const [fields, setFields] = useState<FieldDefinition[]>([]);
  const [label, setLabel] = useState('');
  const [type, setType] = useState<CoreFieldType>('text');
  const [optionsText, setOptionsText] = useState('');
  const [required, setRequired] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    coreService.getEntityDefinition(String(entityDefinitionId)).then((definition) => {
      setEntity(definition);
      setFields(definition?.fields ?? []);
    });
  }, [entityDefinitionId]);

  const addField = () => {
    const cleanLabel = label.trim();
    if (!cleanLabel) return;
    const base = cleanLabel.toLocaleLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '') || 'champ';
    const key = `custom_${base}_${Date.now().toString(36)}`;
    const field: FieldDefinition = {
      id: `custom-${Date.now().toString(36)}`,
      key,
      type,
      label: cleanLabel,
      required,
      options: type === 'select' ? optionsText.split(',').map((value, index) => ({ id: `${key}-${index}`, label: value.trim() })).filter((option) => option.label) : undefined,
      order: fields.length,
    };
    setFields((current) => [...current, field]);
    setLabel('');
    setOptionsText('');
    setRequired(false);
  };

  const removeField = (field: FieldDefinition) => {
    if (!field.key.startsWith('custom_')) return;
    Alert.alert('Retirer ce champ ?', `« ${field.label} » sera supprimé du formulaire. Les valeurs déjà saisies dans les enregistrements ne seront pas effacées.`, [
      { text: 'Annuler', style: 'cancel' },
      { text: 'Retirer', style: 'destructive', onPress: () => setFields((current) => current.filter((item) => item.id !== field.id)) },
    ]);
  };

  const save = async () => {
    if (!entity) return;
    setSaving(true);
    try {
      const updated = await coreService.updateEntityDefinition(entity.id, { fields: fields.map((field, order) => ({ ...field, order })) });
      setEntity(updated);
      setFields(updated.fields);
      Alert.alert('Formulaire mis à jour', 'Les prochains enregistrements utiliseront ces champs.');
    } finally {
      setSaving(false);
    }
  };

  if (!entity) return <SafeAreaView className="flex-1 bg-background"><AppHeader title="Personnaliser" showBack /><LoadingState /></SafeAreaView>;

  return (
    <SafeAreaView className="flex-1 bg-background" edges={['top', 'bottom']}>
      <AppHeader title="Personnaliser le formulaire" showBack />
      <ScrollView contentContainerClassName="gap-4 px-page-margin pb-10" keyboardShouldPersistTaps="handled">
        <Card className="gap-3">
          <SectionTitleText className="text-base">{entity.label} · vos champs</SectionTitleText>
          <BodyMdText>Les champs standards restent disponibles. Ajoutez ceux qui correspondent à votre façon de tenir ce cahier.</BodyMdText>
          {fields.map((field) => (
            <View key={field.id} className="flex-row items-center gap-3 border-t border-border pt-3">
              <View className="flex-1"><LabelText className="font-inter-semibold text-text-primary">{field.label}</LabelText><LabelText>{field.type}{field.required ? ' · obligatoire' : ''}</LabelText></View>
              {field.key.startsWith('custom_') ? <Pressable accessibilityRole="button" accessibilityLabel={`Retirer ${field.label}`} onPress={() => removeField(field)} hitSlop={10}><MaterialIcons name="delete-outline" size={21} color={Colors.error} /></Pressable> : <MaterialIcons name="lock-outline" size={18} color={Colors.textMuted} />}
            </View>
          ))}
        </Card>

        <Card className="gap-4">
          <SectionTitleText className="text-base">Ajouter un champ</SectionTitleText>
          <TextField label="Nom du champ" value={label} onChangeText={setLabel} placeholder="Ex. Référence interne" />
          <View className="gap-2"><LabelText>Type</LabelText><View className="flex-row flex-wrap gap-2">{TYPES.map((item) => <Chip key={item.key} label={item.label} active={type === item.key} onPress={() => setType(item.key)} />)}</View></View>
          {type === 'select' && <TextField label="Options séparées par des virgules" value={optionsText} onChangeText={setOptionsText} placeholder="Petit, Moyen, Grand" />}
          <View className="flex-row items-center justify-between"><LabelText>Obligatoire</LabelText><Switch value={required} onValueChange={setRequired} /></View>
          <SecondaryButton label="Ajouter ce champ" icon="add" disabled={!label.trim() || (type === 'select' && !optionsText.trim())} onPress={addField} />
        </Card>
        <PrimaryButton label="Enregistrer le formulaire" loading={saving} onPress={save} />
      </ScrollView>
    </SafeAreaView>
  );
}
