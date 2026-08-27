import { useEffect, useMemo, useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { AppHeader } from '@/components/ui/AppHeader';
import { SearchBar } from '@/components/ui/SearchBar';
import { Chip } from '@/components/ui/Chip';
import { StatCard } from '@/components/ui/StatCard';
import { Avatar } from '@/components/ui/Avatar';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { EmptyState, ErrorState, LoadingState } from '@/components/ui/States';
import { BodyLgText, LabelText } from '@/components/ui/Typography';
import { MaterialIcons } from '@expo/vector-icons';
import { Colors } from '@/constants/theme';
import { useSubmissionStore } from '@/store/submissionStore';
import { formatShortDate } from '@/utils/format';
import type { SubmissionStatus } from '@/types/entities';

const FILTERS: { label: string; value: SubmissionStatus | 'all' }[] = [
  { label: 'Tout', value: 'all' },
  { label: 'Validées', value: 'validated' },
  { label: 'En attente', value: 'pending' },
  { label: 'Rejetées', value: 'rejected' },
];

const STATUS_MAP = { pending: 'pending', validated: 'validated', rejected: 'rejected', correction_requested: 'pending' } as const;

export function RecordsListScreen() {
  const { formId: filterFormId, formTitle } = useLocalSearchParams<{ formId?: string; formTitle?: string }>();
  const { submissions, status, fetchAll } = useSubmissionStore();
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<SubmissionStatus | 'all'>('all');

  useEffect(() => {
    fetchAll();
  }, [fetchAll]);

  const scoped = useMemo(
    () => (filterFormId ? submissions.filter((s) => s.formId === filterFormId) : submissions),
    [submissions, filterFormId],
  );

  const filtered = useMemo(
    () =>
      scoped
        .filter((s) => filter === 'all' || s.status === filter)
        .filter((s) => s.clientName.toLowerCase().includes(search.trim().toLowerCase())),
    [scoped, filter, search],
  );

  const counts = useMemo(
    () => ({
      total: scoped.length,
      validated: scoped.filter((s) => s.status === 'validated').length,
      pending: scoped.filter((s) => s.status === 'pending').length,
      rejected: scoped.filter((s) => s.status === 'rejected').length,
    }),
    [scoped],
  );

  return (
    <SafeAreaView className="flex-1 bg-white" edges={['top', 'bottom']}>
      <AppHeader title={filterFormId ? formTitle || 'Réponses' : 'Réponses'} showBack />
      <ScrollView contentContainerClassName="gap-5 px-page-margin pb-10" showsVerticalScrollIndicator={false}>
        {status === 'loading' && <LoadingState />}
        {status === 'error' && <ErrorState onRetry={fetchAll} />}

        {status === 'success' && (
          <>
            <View className="flex-row flex-wrap gap-3">
              <StatCard icon="inbox" label="Total" value={counts.total} className="basis-[47%]" />
              <StatCard icon="check-circle" label="Validées" value={counts.validated} className="basis-[47%]" />
              <StatCard icon="schedule" label="En attente" value={counts.pending} className="basis-[47%]" />
              <StatCard icon="cancel" label="Rejetées" value={counts.rejected} className="basis-[47%]" />
            </View>

            <SearchBar value={search} onChangeText={setSearch} placeholder="Rechercher un dossier..." />

            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerClassName="gap-2">
              {FILTERS.map((f) => (
                <Chip key={f.value} label={f.label} active={filter === f.value} onPress={() => setFilter(f.value)} />
              ))}
            </ScrollView>

            {filtered.length === 0 ? (
              scoped.length === 0 ? (
                <EmptyState
                  icon="inbox"
                  title="Aucun dossier"
                  description={
                    filterFormId
                      ? 'Les soumissions de ce formulaire apparaîtront ici.'
                      : "Les dossiers apparaîtront ici dès qu'un client aura soumis un formulaire et que vous aurez scanné son QR code."
                  }
                />
              ) : (
                <EmptyState icon="search-off" title="Aucun résultat" description="Aucun dossier ne correspond à cette recherche." />
              )
            ) : (
              <View className="gap-3">
                {filtered.map((submission) => (
                  <Pressable
                    key={submission.id}
                    onPress={() => router.push(`/records/${submission.id}`)}
                    className="flex-row items-center gap-3 rounded-lg border border-border bg-surface p-gutter-card shadow-soft active:opacity-90">
                    <Avatar name={submission.clientName} size={44} />
                    <View className="flex-1">
                      <BodyLgText className="font-inter-semibold" numberOfLines={1}>
                        {submission.clientName}
                      </BodyLgText>
                      <LabelText numberOfLines={1}>
                        {formatShortDate(new Date(submission.createdAt))} · {submission.formTitle}
                      </LabelText>
                    </View>
                    <StatusBadge status={STATUS_MAP[submission.status]} />
                    <MaterialIcons name="chevron-right" size={18} color={Colors.emptyIcon} />
                  </Pressable>
                ))}
              </View>
            )}
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}
