import { useEffect } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { router } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { MaterialIcons } from '@expo/vector-icons';
import { AppHeader } from '@/components/ui/AppHeader';
import { EmptyState, ErrorState, LoadingState } from '@/components/ui/States';
import { SectionTitleText, LabelText } from '@/components/ui/Typography';
import { IconButton } from '@/components/ui/Button';
import { Colors } from '@/constants/theme';
import { formatRelativeTime } from '@/utils/format';
import { useFormStore } from '@/store/formStore';

const FORM_TINTS = ['#FFE3CC', '#DCEEFF', '#E4F7E1', '#F3E4FF'];

export function FormsListScreen() {
  const { forms, status, fetchForms } = useFormStore();

  useEffect(() => {
    fetchForms();
  }, [fetchForms]);

  return (
    <SafeAreaView className="flex-1 bg-white" edges={['top']}>
      <AppHeader
        title="Mes formulaires"
        showBack
        trailing={<IconButton icon="add" onPress={() => router.push('/form/create')} />}
      />
      <ScrollView contentContainerClassName="gap-4 px-page-margin pb-10" showsVerticalScrollIndicator={false}>
        {status === 'loading' && <LoadingState />}
        {status === 'error' && <ErrorState onRetry={fetchForms} />}
        {status === 'success' && forms.length === 0 && (
          <EmptyState
            icon="assignment"
            title="Aucun formulaire"
            description="Créez votre premier formulaire pour commencer à collecter des réponses."
            actionLabel="Créer un formulaire"
            onAction={() => router.push('/form/create')}
          />
        )}

        {forms.length > 0 && (
          <View className="rounded-lg border border-border bg-surface px-gutter-card shadow-soft">
            {forms.map((form, i) => (
              <Pressable
                key={form.id}
                onPress={() => router.push(`/form/${form.id}/preview`)}
                className={`flex-row items-center gap-3 py-3 ${i < forms.length - 1 ? 'border-b border-border' : ''}`}>
                <View
                  className="h-12 w-12 items-center justify-center rounded-md"
                  style={{ backgroundColor: FORM_TINTS[i % FORM_TINTS.length] }}>
                  <MaterialIcons name="assignment" size={20} color={Colors.textPrimary} />
                </View>
                <View className="flex-1">
                  <SectionTitleText className="text-base" numberOfLines={1}>
                    {form.title}
                  </SectionTitleText>
                  <View className="mt-1 flex-row items-center gap-2">
                    <View className="rounded-full bg-surface-container px-2 py-0.5">
                      <LabelText>{form.responseCount} réponses</LabelText>
                    </View>
                    <LabelText>{formatRelativeTime(form.updatedAt)}</LabelText>
                  </View>
                </View>
                <MaterialIcons name="chevron-right" size={20} color={Colors.emptyIcon} />
              </Pressable>
            ))}
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}
