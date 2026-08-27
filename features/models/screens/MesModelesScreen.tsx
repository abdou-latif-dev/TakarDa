import { useEffect, useMemo, useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { MaterialIcons } from '@expo/vector-icons';
import { AppHeader } from '@/components/ui/AppHeader';
import { Avatar } from '@/components/ui/Avatar';
import { ProgressBar } from '@/components/ui/ProgressBar';
import { EmptyState, ErrorState, LoadingState } from '@/components/ui/States';
import { SectionHeader } from '@/components/ui/SectionHeader';
import { SectionTitleText, LabelText } from '@/components/ui/Typography';
import { IconButton } from '@/components/ui/Button';
import { Colors } from '@/constants/theme';
import { formatFcfa, formatRelativeTime } from '@/utils/format';
import { useGroupStore } from '@/store/groupStore';
import { useFormStore } from '@/store/formStore';
import type { Group } from '@/types/entities';

const FREQUENCY_LABEL: Record<string, string> = {
  daily: 'Quotidienne',
  weekly: 'Hebdomadaire',
  monthly: 'Mensuelle',
  custom: 'Personnalisée',
};

const FORM_TINTS = ['#FFE3CC', '#DCEEFF', '#E4F7E1', '#F3E4FF'];

/** A tontine, rendered as one of the user's personal tools — same native rotation/cotisation logic underneath. */
function TontineCard({ tontine }: { tontine: Group }) {
  const members = useGroupStore((s) => s.members[tontine.id]) ?? [];
  const round = tontine.currentRound ?? 1;
  const total = tontine.memberCount || 1;
  const next = members.find((m) => m.position === round);
  const progress = Math.min(1, (round - 1) / total);

  return (
    <Pressable
      onPress={() => router.push(`/group/${tontine.id}/tontine`)}
      className="gap-3 overflow-hidden rounded-xl border border-border bg-surface p-gutter-card shadow-soft active:opacity-90">
      <View className="flex-row items-start justify-between">
        <View className="flex-1">
          <SectionTitleText numberOfLines={1}>{tontine.name}</SectionTitleText>
          <LabelText>
            {FREQUENCY_LABEL[tontine.frequency ?? 'monthly']} · {formatFcfa(tontine.contributionAmount ?? 0)} / membre
          </LabelText>
        </View>
        <View className="h-10 w-10 items-center justify-center rounded-full bg-primary-soft">
          <MaterialIcons name="savings" size={18} color={Colors.primary} />
        </View>
      </View>

      <View className="flex-row items-center justify-between">
        <View className="flex-row">
          {members.slice(0, 4).map((m, i) => (
            <View key={m.id} style={{ marginLeft: i === 0 ? 0 : -10 }}>
              <Avatar name={m.displayName} size={28} />
            </View>
          ))}
          {tontine.memberCount > 4 && (
            <View className="ml-[-10px] h-7 w-7 items-center justify-center rounded-full bg-surface-container">
              <LabelText>+{tontine.memberCount - 4}</LabelText>
            </View>
          )}
        </View>
        {tontine.tontineStatus === 'completed' ? (
          <LabelText className="font-inter-semibold text-success">Terminée</LabelText>
        ) : (
          next && (
            <View className="items-end">
              <LabelText>Prochain bénéficiaire</LabelText>
              <LabelText className="font-inter-semibold text-text-primary">{next.displayName}</LabelText>
            </View>
          )
        )}
      </View>

      <View className="gap-1.5">
        <ProgressBar progress={progress} />
        <LabelText>
          Tour {round} / {total}
        </LabelText>
      </View>
    </Pressable>
  );
}

export function MesModelesScreen() {
  const { justDeleted } = useLocalSearchParams<{ justDeleted?: string }>();
  const { groups, status: groupsStatus, fetchGroups, fetchMembers } = useGroupStore();
  const { forms, status: formsStatus, fetchForms } = useFormStore();
  const [confirmation, setConfirmation] = useState<string | null>(null);

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

  const tontines = useMemo(() => groups.filter((g) => g.kind === 'tontine'), [groups]);

  useEffect(() => {
    tontines.forEach((t) => fetchMembers(t.id));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tontines.length]);

  const loading = groupsStatus === 'loading' || formsStatus === 'loading';
  const hasError = groupsStatus === 'error' || formsStatus === 'error';
  const isEmpty = groupsStatus !== 'loading' && formsStatus !== 'loading' && tontines.length === 0 && forms.length === 0;

  return (
    <SafeAreaView className="flex-1 bg-white" edges={['top']}>
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
                <TontineCard key={t.id} tontine={t} />
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
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}
