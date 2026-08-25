import { Pressable, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { MaterialIcons } from '@expo/vector-icons';
import { BottomSheetCard } from '@/components/ui/BottomSheetCard';
import { IconButton } from '@/components/ui/Button';
import { SectionTitleText, LabelText } from '@/components/ui/Typography';
import { Colors } from '@/constants/theme';
import { FIELD_TYPE_META, FIELD_TYPE_ORDER } from '@/constants/fieldTypes';
import { useFormStore } from '@/store/formStore';

export function AddFieldModal() {
  const { formId } = useLocalSearchParams<{ formId: string }>();
  const addField = useFormStore((s) => s.addField);

  const onSelect = async (type: (typeof FIELD_TYPE_ORDER)[number]) => {
    const meta = FIELD_TYPE_META[type];
    const field = await addField(formId, { type, label: meta.label, required: false });
    router.replace(`/modals/field-settings?formId=${formId}&fieldId=${field.id}`);
  };

  return (
    <BottomSheetCard>
      <View className="flex-row items-center justify-between px-page-margin pb-4">
        <SectionTitleText>Ajouter un champ</SectionTitleText>
        <IconButton icon="close" size={18} onPress={() => router.back()} />
      </View>
      <View className="flex-row flex-wrap gap-3 px-page-margin pb-8">
        {FIELD_TYPE_ORDER.map((type) => {
          const meta = FIELD_TYPE_META[type];
          const isSection = type === 'section';
          return (
            <Pressable
              key={type}
              onPress={() => onSelect(type)}
              className={`min-h-[100px] items-center justify-center gap-2 rounded-lg border border-border bg-surface p-3 active:border-primary ${isSection ? 'basis-full' : 'basis-[30%] flex-1'}`}>
              <View className="h-12 w-12 items-center justify-center rounded-full bg-surface-container">
                <MaterialIcons name={meta.icon} size={22} color={Colors.textSecondary} />
              </View>
              <LabelText className="text-center text-text-primary">{meta.label}</LabelText>
            </Pressable>
          );
        })}
      </View>
    </BottomSheetCard>
  );
}
