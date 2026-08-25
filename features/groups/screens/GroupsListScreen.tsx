import { useEffect, useMemo, useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { router } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { MaterialIcons } from '@expo/vector-icons';
import { AppHeader } from '@/components/ui/AppHeader';
import { SearchBar } from '@/components/ui/SearchBar';
import { GroupCard } from '@/components/ui/GroupCard';
import { EmptyState, ErrorState, LoadingState } from '@/components/ui/States';
import { SectionTitleText, LabelText } from '@/components/ui/Typography';
import { Colors } from '@/constants/theme';
import { useGroupStore } from '@/store/groupStore';

export function GroupsListScreen() {
  const { groups, status, error, fetchGroups } = useGroupStore();
  const [search, setSearch] = useState('');

  useEffect(() => {
    fetchGroups();
  }, [fetchGroups]);

  const filtered = useMemo(
    () => groups.filter((g) => g.name.toLowerCase().includes(search.trim().toLowerCase())),
    [groups, search],
  );

  return (
    <SafeAreaView className="flex-1 bg-white" edges={['top']}>
      <AppHeader title="Mes groupes" />
      <ScrollView contentContainerClassName="gap-4 px-page-margin pb-10" showsVerticalScrollIndicator={false}>
        <SearchBar value={search} onChangeText={setSearch} placeholder="Rechercher un groupe..." />

        {status === 'loading' && <LoadingState />}
        {status === 'error' && <ErrorState onRetry={fetchGroups} />}

        {status === 'success' && groups.length === 0 && (
          <EmptyState
            icon="group-off"
            title="Aucun groupe"
            description="Rejoignez un espace de travail collaboratif ou créez le vôtre."
            actionLabel="Créer un groupe"
            onAction={() => router.push('/group/create')}
          />
        )}

        {status === 'success' && groups.length > 0 && (
          <>
            {filtered.length === 0 ? (
              <EmptyState icon="search-off" title="Aucun résultat" description="Essayez un autre nom de groupe." compact />
            ) : (
              <View className="gap-3">
                {filtered.map((group) => (
                  <GroupCard key={group.id} group={group} onPress={() => router.push(`/group/${group.id}`)} />
                ))}
              </View>
            )}

            <Pressable
              onPress={() => router.push('/group/create')}
              className="flex-row items-center gap-4 rounded-lg border border-dashed border-primary/40 bg-primary-soft/40 p-gutter-card active:opacity-80">
              <View className="h-11 w-11 items-center justify-center rounded-full bg-primary-soft">
                <MaterialIcons name="add" size={22} color={Colors.primary} />
              </View>
              <View>
                <SectionTitleText className="text-base">Créer un nouveau groupe</SectionTitleText>
                <LabelText>Invitez vos amis ou collègues</LabelText>
              </View>
            </Pressable>
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}
