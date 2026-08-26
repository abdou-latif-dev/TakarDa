import { useEffect, useMemo, useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { router } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { MaterialIcons } from '@expo/vector-icons';
import { AppHeader } from '@/components/ui/AppHeader';
import { Chip } from '@/components/ui/Chip';
import { LoadingState } from '@/components/ui/States';
import { SectionTitleText, BodyMdText, LabelText, DisplayText } from '@/components/ui/Typography';
import { Colors } from '@/constants/theme';
import { useFormTemplateStore } from '@/store/formTemplateStore';
import type { FormTemplate } from '@/types/entities';

const CATEGORIES: { value: FormTemplate['category'] | 'all'; label: string }[] = [
  { value: 'all', label: 'Tous' },
  { value: 'tontine', label: 'Tontine' },
  { value: 'commerce', label: 'Commerce' },
  { value: 'inventaire', label: 'Inventaire' },
  { value: 'inscription', label: 'Inscription' },
  { value: 'association', label: 'Association' },
  { value: 'feedback', label: 'Feedback' },
];

export function FormTemplateLibraryScreen() {
  const { templates, status, fetchTemplates, useTemplate } = useFormTemplateStore();
  const [category, setCategory] = useState<(typeof CATEGORIES)[number]['value']>('all');
  const [applyingId, setApplyingId] = useState<string | null>(null);

  useEffect(() => {
    fetchTemplates();
  }, [fetchTemplates]);

  const filtered = useMemo(
    () => (category === 'all' ? templates : templates.filter((t) => t.category === category)),
    [templates, category],
  );

  const onUse = async (templateId: string) => {
    setApplyingId(templateId);
    try {
      const form = await useTemplate(templateId);
      router.replace(`/form/${form.id}/edit`);
    } finally {
      setApplyingId(null);
    }
  };

  return (
    <SafeAreaView className="flex-1 bg-white" edges={['top']}>
      <AppHeader showBack />
      <View className="gap-4 px-page-margin pt-2">
        <View>
          <DisplayText className="text-2xl">Modèles de formulaires</DisplayText>
          <BodyMdText className="mt-1">Commencez rapidement avec nos templates pré-conçus.</BodyMdText>
        </View>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerClassName="gap-2">
          {CATEGORIES.map((c) => (
            <Chip key={c.value} label={c.label} active={category === c.value} onPress={() => setCategory(c.value)} />
          ))}
        </ScrollView>
      </View>

      <ScrollView contentContainerClassName="gap-3 px-page-margin py-4" showsVerticalScrollIndicator={false}>
        {status === 'loading' && <LoadingState />}
        {filtered.map((t) => (
          <View key={t.id} className="flex-row items-center gap-4 rounded-xl border border-border bg-surface p-gutter-card shadow-soft">
            <View className="h-12 w-12 items-center justify-center rounded-full bg-primary-soft">
              <MaterialIcons name={t.icon as keyof typeof MaterialIcons.glyphMap} size={22} color={Colors.primary} />
            </View>
            <View className="flex-1">
              <SectionTitleText className="text-base">{t.name}</SectionTitleText>
              <BodyMdText numberOfLines={2}>{t.description}</BodyMdText>
            </View>
            <Pressable
              onPress={() => onUse(t.id)}
              disabled={applyingId === t.id}
              className="rounded-full bg-primary px-4 py-2 active:opacity-80">
              <LabelText className="font-inter-semibold text-white">{applyingId === t.id ? '...' : 'Utiliser'}</LabelText>
            </Pressable>
          </View>
        ))}
      </ScrollView>
    </SafeAreaView>
  );
}
