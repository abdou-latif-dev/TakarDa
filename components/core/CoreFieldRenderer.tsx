import { Pressable, View } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import * as DocumentPicker from 'expo-document-picker';
import { MaterialIcons } from '@expo/vector-icons';
import { TextField } from '@/components/ui/TextField';
import { Chip } from '@/components/ui/Chip';
import { LabelText } from '@/components/ui/Typography';
import { Colors } from '@/constants/theme';
import type { FieldDefinition, FieldValue } from '@/types/entities';

interface CoreFieldRendererProps {
  field: FieldDefinition;
  value: FieldValue;
  onChange: (value: FieldValue) => void;
}

/** Generic renderer for Core FieldDefinition — shared by every Core-backed module
 * (Factures, Immobilier, ...). Covers the field types actually in use so far
 * (text/phone/email/number/amount/date/select/boolean/file/image). 'relation'
 * fields are deliberately NOT rendered here — the screens that need one (e.g. a
 * Contrat's "bien" field, a Paiement's "contrat" field) already know the target
 * record from navigation context and set it programmatically, so no generic
 * relation-picker UI exists yet (see "ne pas construire de moteur de relation
 * complexe" in the Étape 2 brief). Extend as a real module needs more. */
export function CoreFieldRenderer({ field, value, onChange }: CoreFieldRendererProps) {
  const label = `${field.label}${field.required ? ' *' : ''}`;

  if (field.type === 'text' || field.type === 'phone' || field.type === 'email') {
    return (
      <TextField
        label={label}
        value={typeof value === 'string' ? value : ''}
        onChangeText={(t) => onChange(t)}
        keyboardType={field.type === 'phone' ? 'phone-pad' : field.type === 'email' ? 'email-address' : 'default'}
      />
    );
  }

  if (field.type === 'number' || field.type === 'amount') {
    return (
      <TextField
        label={label}
        value={value !== null && value !== undefined ? String(value) : ''}
        onChangeText={(t) => onChange(t === '' ? null : Number(t.replace(/[^0-9.]/g, '')) || 0)}
        keyboardType="numeric"
        icon={field.type === 'amount' ? 'payments' : undefined}
      />
    );
  }

  if (field.type === 'date') {
    return (
      <TextField
        label={label}
        placeholder="JJ/MM/AAAA"
        value={typeof value === 'string' ? value : ''}
        onChangeText={(t) => onChange(t)}
        keyboardType="numbers-and-punctuation"
        icon="calendar-today"
      />
    );
  }

  if (field.type === 'select') {
    return (
      <View className="gap-2">
        <LabelText className="text-text-secondary">{label}</LabelText>
        <View className="flex-row flex-wrap gap-2">
          {(field.options ?? []).map((opt) => (
            <Chip key={opt.id} label={opt.label} active={value === opt.label} onPress={() => onChange(opt.label)} />
          ))}
        </View>
      </View>
    );
  }

  if (field.type === 'boolean') {
    const checked = value === true;
    return (
      <Pressable onPress={() => onChange(!checked)} className="flex-row items-center gap-3">
        <View
          className="h-5 w-5 items-center justify-center rounded"
          style={{ backgroundColor: checked ? Colors.primary : 'transparent', borderWidth: checked ? 0 : 1.5, borderColor: Colors.border }}>
          {checked && <MaterialIcons name="check" size={14} color="#FFFFFF" />}
        </View>
        <LabelText className="text-text-primary">{field.label}</LabelText>
      </Pressable>
    );
  }

  if (field.type === 'file' || field.type === 'image') {
    const uri = typeof value === 'string' ? value : null;
    const pick = async () => {
      if (field.type === 'image') {
        const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.6 });
        if (!result.canceled && result.assets[0]) onChange(result.assets[0].uri);
      } else {
        const result = await DocumentPicker.getDocumentAsync({ multiple: false });
        if (!result.canceled && result.assets[0]) onChange(result.assets[0].uri);
      }
    };
    return (
      <View className="gap-2">
        <LabelText className="text-text-secondary">{label}</LabelText>
        <Pressable
          onPress={pick}
          className="flex-row items-center gap-3 rounded-md border border-dashed border-border bg-background-secondary p-4 active:opacity-80">
          <MaterialIcons name={uri ? 'insert-drive-file' : 'attach-file'} size={22} color={uri ? Colors.primary : Colors.textMuted} />
          <LabelText numberOfLines={1} className="flex-1 text-text-primary">
            {uri ? 'Justificatif ajouté' : 'Ajouter un justificatif'}
          </LabelText>
        </Pressable>
      </View>
    );
  }

  // 'multiselect' | 'relation' | 'computed' | 'signature' | 'time' | 'section':
  // types defined for the model, no real consumer yet — nothing to render.
  return null;
}
