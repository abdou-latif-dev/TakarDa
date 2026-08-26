import { Image, Pressable, View } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import * as DocumentPicker from 'expo-document-picker';
import { MaterialIcons } from '@expo/vector-icons';
import { TextField } from '@/components/ui/TextField';
import { Chip } from '@/components/ui/Chip';
import { SignaturePad } from '@/components/ui/SignaturePad';
import { BodyLgText, LabelText, SectionTitleText } from '@/components/ui/Typography';
import { Colors } from '@/constants/theme';
import type { FormField } from '@/types/entities';

interface FieldRendererProps {
  field: FormField;
  value: string | number | boolean | string[] | null;
  onChange: (value: string | number | boolean | string[] | null) => void;
}

export function FieldRenderer({ field, value, onChange }: FieldRendererProps) {
  if (field.type === 'section') {
    return (
      <View className="gap-1 pt-2">
        <SectionTitleText className="text-base">{field.label}</SectionTitleText>
        {field.description && <LabelText>{field.description}</LabelText>}
      </View>
    );
  }

  const label = `${field.label}${field.required ? ' *' : ''}`;

  if (field.type === 'text' || field.type === 'email' || field.type === 'phone' || field.type === 'number') {
    const keyboardType = field.type === 'number' ? 'numeric' : field.type === 'phone' ? 'phone-pad' : field.type === 'email' ? 'email-address' : 'default';
    return (
      <TextField
        label={label}
        placeholder={field.placeholder}
        value={typeof value === 'string' ? value : ''}
        onChangeText={(t) => onChange(t)}
        keyboardType={keyboardType}
        autoCapitalize={field.type === 'email' ? 'none' : 'sentences'}
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

  if (field.type === 'time') {
    return (
      <TextField
        label={label}
        placeholder="HH:MM"
        value={typeof value === 'string' ? value : ''}
        onChangeText={(t) => onChange(t)}
        keyboardType="numbers-and-punctuation"
        icon="schedule"
      />
    );
  }

  if (field.type === 'choice') {
    return (
      <View className="gap-2">
        <LabelText className="text-text-secondary">{label}</LabelText>
        <View className="gap-2">
          {(field.options ?? []).map((opt) => {
            const selected = value === opt.label;
            return (
              <Pressable
                key={opt.id}
                onPress={() => onChange(opt.label)}
                className="flex-row items-center gap-3 rounded-md border border-border bg-surface p-3 active:opacity-80">
                <View
                  className="h-5 w-5 items-center justify-center rounded-full border-2"
                  style={{ borderColor: selected ? Colors.primary : Colors.border }}>
                  {selected && <View className="h-2.5 w-2.5 rounded-full bg-primary" />}
                </View>
                <BodyLgText>{opt.label}</BodyLgText>
              </Pressable>
            );
          })}
        </View>
      </View>
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

  if (field.type === 'checkbox') {
    const checked = value === true;
    return (
      <Pressable onPress={() => onChange(!checked)} className="flex-row items-start gap-3">
        <View
          className="mt-0.5 h-5 w-5 items-center justify-center rounded"
          style={{ backgroundColor: checked ? Colors.primary : 'transparent', borderWidth: checked ? 0 : 1.5, borderColor: Colors.border }}>
          {checked && <MaterialIcons name="check" size={14} color="#FFFFFF" />}
        </View>
        <BodyLgText className="flex-1">{field.label}</BodyLgText>
      </Pressable>
    );
  }

  if (field.type === 'image') {
    const uri = typeof value === 'string' ? value : null;
    const pick = async () => {
      const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.6 });
      if (!result.canceled && result.assets[0]) onChange(result.assets[0].uri);
    };
    return (
      <View className="gap-2">
        <LabelText className="text-text-secondary">{label}</LabelText>
        <Pressable
          onPress={pick}
          className="items-center justify-center gap-2 overflow-hidden rounded-md border border-dashed border-border bg-background-secondary py-8">
          {uri ? (
            <Image source={{ uri }} style={{ width: '100%', height: 160 }} resizeMode="cover" />
          ) : (
            <>
              <MaterialIcons name="add-a-photo" size={26} color={Colors.textMuted} />
              <LabelText>Ajouter une photo</LabelText>
            </>
          )}
        </Pressable>
      </View>
    );
  }

  if (field.type === 'file') {
    const fileName = typeof value === 'string' ? value : null;
    const pick = async () => {
      const result = await DocumentPicker.getDocumentAsync({ multiple: false });
      if (!result.canceled && result.assets[0]) onChange(result.assets[0].name);
    };
    return (
      <View className="gap-2">
        <LabelText className="text-text-secondary">{label}</LabelText>
        <Pressable
          onPress={pick}
          className="flex-row items-center gap-3 rounded-md border border-dashed border-border bg-background-secondary p-4 active:opacity-80">
          <MaterialIcons name={fileName ? 'insert-drive-file' : 'attach-file'} size={22} color={fileName ? Colors.primary : Colors.textMuted} />
          <BodyLgText numberOfLines={1} className="flex-1">
            {fileName ?? 'Choisir un fichier'}
          </BodyLgText>
        </Pressable>
      </View>
    );
  }

  if (field.type === 'signature') {
    return (
      <View className="gap-2">
        <LabelText className="text-text-secondary">{label}</LabelText>
        <SignaturePad onChange={(signed) => onChange(signed)} />
      </View>
    );
  }

  return null;
}
