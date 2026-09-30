import { useEffect, useMemo, useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { MaterialIcons } from '@expo/vector-icons';
import { AppHeader } from '@/components/ui/AppHeader';
import { EmptyState, ErrorState, LoadingState } from '@/components/ui/States';
import { SectionHeader } from '@/components/ui/SectionHeader';
import { SectionTitleText, LabelText } from '@/components/ui/Typography';
import { IconButton, SecondaryButton } from '@/components/ui/Button';
import { Colors } from '@/constants/theme';
import { formatRelativeTime } from '@/utils/format';
import { useGroupStore } from '@/store/groupStore';
import { useFormStore } from '@/store/formStore';
import { seedDemoTontine } from '@/services/tontineDemoService';
import { TontineListCard } from '@/components/tontine/TontineListCard';

export function MesModelesScreen() {
  const { justDeleted } = useLocalSearchParams<{ justDeleted?: string }>();
  const { groups, status: groupsStatus, fetchGroups } = useGroupStore();
  const { forms, status: formsStatus, fetchForms } = useFormStore();
  const [confirmation, setConfirmation] = useState<string | null>(null);
  const [seedingDemo, setSeedingDemo] = useState(false);

  const onSeedDemo = async () => {
    setSeedingDemo(true);
    try {
      const group = await seedDemoTontine();
      await fetchGroups();
      router.push(`/group/${group.id}/tontine`);
    } finally {
      setSeedingDemo(false);
    }
  };

  useEffect(() => {
    fetchGroups();
    fetchForms();
  }, [fetchGroups, fetchForms]);

  useEffect(() => {
    if (!justDeleted) return;
    setConfirmation(justDeleted);
    router.setParams({ justDeleted: undefined });
    const timer = setTimeout(() => setConfirmation(null), 2500);
    return () => clearTimeout(timer);
  }, [justDeleted]);

  // Each TontineListCard fetches its own tour summary (progress, next
  // beneficiary, member avatars) — no need to prefetch members here too.
  const tontines = useMemo(() => groups.filter((g) => g.kind === 'tontine'), [groups]);

  const loading = groupsStatus === 'loading' || formsStatus === 'loading';
  const hasError = groupsStatus === 'error' || formsStatus === 'error';
  const isEmpty = groupsStatus !== 'loading' && formsStatus !== 'loading' && tontines.length === 0 && forms.length === 0;

  return (
    <SafeAreaView className="flex-1 bg-background" edges={['top']}>
      <AppHeader
        title="Mes modèles"
        trailing={<IconButton icon="add" onPress={() => router.push('/modals/create-menu')} />}
      />
      {confirmation && (
        <View className="mx-page-margin mb-2 flex-row items-center gap-2 self-start rounded-full bg-success-container px-3 py-1.5">
          <MaterialIcons name="check-circle" size={14} color={Colors.success} />
          <LabelText style={{ color: Colors.success }} className="font-inter-semibold">
            {confirmation}
          </LabelText>
        </View>
      )}
      <ScrollView contentContainerClassName="gap-6 px-page-margin pb-10" showsVerticalScrollIndicator={false}>
        <View className="gap-3">
          <SectionHeader title="Mes outils" />
          <View className="flex-row flex-wrap gap-3">
            {[
              { title: 'Immobilier', icon: 'home-work' as const, href: '/immobilier' as const },
              { title: 'Factures', icon: 'receipt-long' as const, href: '/factures' as const },
              { title: 'Commerce / Business', icon: 'storefront' as const, href: '/form/templates?category=commerce' as const },
              { title: 'Tontines', icon: 'savings' as const, href: '/tontine/create' as const },
            ].map((tool) => (
              <Pressable
                key={tool.title}
                accessibilityRole="button"
                onPress={() => router.push(tool.href as never)}
                className="min-h-14 min-w-[47%] flex-1 flex-row items-center gap-2 rounded-xl border border-border bg-surface px-3 py-3 active:opacity-80">
                <MaterialIcons name={tool.icon} size={20} color={Colors.primary} />
                <LabelText className="flex-1 font-inter-semibold text-text-primary">{tool.title}</LabelText>
                <MaterialIcons name="chevron-right" size={18} color={Colors.emptyIcon} />
              </Pressable>
            ))}
          </View>
          <LabelText>Chaque paiement reste validé manuellement par vous.</LabelText>
          <SecondaryButton
            label="Essayer avec une tontine de démonstration"
            icon="auto-awesome"
            loading={seedingDemo}
            onPress={onSeedDemo}
          />
        </View>
        {loading && tontines.length === 0 && forms.length === 0 && <LoadingState />}
        {hasError && <ErrorState onRetry={() => { fetchGroups(); fetchForms(); }} />}

        {isEmpty && (
          <EmptyState
            icon="dashboard-customize"
            title="Aucun modèle pour l'instant"
            description="Utilisez un modèle de la bibliothèque ou créez une tontine pour commencer."
            actionLabel="Créer"
            onAction={() => router.push('/modals/create-menu')}
          />
        )}

        {tontines.length > 0 && (
          <View className="gap-3">
            <SectionHeader title="Tontines" />
            <View className="gap-3">
              {tontines.map((t) => (
                <TontineListCard key={t.id} tontine={t} />
              ))}
            </View>
          </View>
        )}

        {forms.length > 0 && (
          <View className="gap-3">
            <SectionHeader title="Formulaires" />
            <View className="rounded-lg border border-border bg-surface px-gutter-card shadow-soft">
              {forms.map((form, i) => (
                <Pressable
                  key={form.id}
                  onPress={() => router.push(`/form/${form.id}/preview`)}
                  className={`flex-row items-center gap-3 py-3 ${i < forms.length - 1 ? 'border-b border-border' : ''}`}>
                  <View className="h-12 w-12 items-center justify-center rounded-md bg-surface-container">
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
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}
