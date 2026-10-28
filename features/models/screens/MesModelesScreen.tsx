import { useCallback, useEffect, useMemo, useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
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
import { ensureInstalledTools, getMyTools, type MyTool } from '@/services/toolRegistryService';
import { TontineListCard } from '@/components/tontine/TontineListCard';

export function MesModelesScreen() {
  const { justDeleted } = useLocalSearchParams<{ justDeleted?: string }>();
  const { groups, status: groupsStatus, fetchGroups } = useGroupStore();
  const { forms, status: formsStatus, fetchForms } = useFormStore();
  const [confirmation, setConfirmation] = useState<string | null>(null);
  const [seedingDemo, setSeedingDemo] = useState(false);
  // « Mes outils » vient du registre (source unique), plus d'une liste écrite en dur ici.
  const [myTools, setMyTools] = useState<MyTool[] | null>(null);

  useFocusEffect(
    useCallback(() => {
      ensureInstalledTools()
        .then(() => getMyTools())
        .then((r) => setMyTools(r.owned))
        .catch(() => setMyTools([]));
    }, []),
  );

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
        trailing={<IconButton icon="add" onPress={() => router.push('/mes-outils/catalogue' as never)} />}
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
          <SectionHeader title="Mes outils" action="Gérer" onAction={() => router.push('/mes-outils' as never)} />
          {myTools !== null && myTools.length === 0 && (
            <LabelText>Aucun outil ajouté. Choisissez-en dans le catalogue.</LabelText>
          )}
          <View className="flex-row flex-wrap gap-3">
            {(myTools ?? []).map((item) => (
              <Pressable
                key={item.tool.id}
                accessibilityRole="button"
                onPress={() => router.push(item.route as never)}
                className="min-h-14 min-w-[47%] flex-1 flex-row items-center gap-2 rounded-xl border border-border bg-surface px-3 py-3 active:opacity-80">
                <MaterialIcons name={item.model.icon} size={20} color={Colors.primary} />
                <LabelText className="flex-1 font-inter-semibold text-text-primary">{item.model.title}</LabelText>
                <MaterialIcons name="chevron-right" size={18} color={Colors.emptyIcon} />
              </Pressable>
            ))}
          </View>
          <SecondaryButton label="Catalogue" icon="dashboard-customize" onPress={() => router.push('/mes-outils/catalogue' as never)} />
          <LabelText>Chaque paiement reste validé manuellement par vous.</LabelText>
          {/* Données de démonstration : développement uniquement, jamais dans une version publiée. */}
          {__DEV__ && (
            <SecondaryButton
              label="Essayer avec une tontine de démonstration"
              icon="auto-awesome"
              loading={seedingDemo}
              onPress={onSeedDemo}
            />
          )}
        </View>
        {loading && tontines.length === 0 && forms.length === 0 && <LoadingState />}
        {hasError && <ErrorState onRetry={() => { fetchGroups(); fetchForms(); }} />}

        {isEmpty && (
          <EmptyState
            icon="dashboard-customize"
            title="Aucun modèle pour l'instant"
            description="Utilisez un modèle de la bibliothèque ou créez une tontine pour commencer."
            actionLabel="Ouvrir le catalogue"
            onAction={() => router.push('/mes-outils/catalogue' as never)}
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
