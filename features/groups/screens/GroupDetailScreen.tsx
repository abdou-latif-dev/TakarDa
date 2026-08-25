import { useEffect, useMemo, useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { AppHeader } from '@/components/ui/AppHeader';
import { Avatar } from '@/components/ui/Avatar';
import { StatCard } from '@/components/ui/StatCard';
import { MemberRow } from '@/components/ui/MemberRow';
import { ActivityItem } from '@/components/ui/ActivityItem';
import { SectionHeader } from '@/components/ui/SectionHeader';
import { PrimaryButton, SecondaryButton } from '@/components/ui/Button';
import { EmptyState, ErrorState, LoadingState } from '@/components/ui/States';
import { DisplayText, LabelText, ButtonLabelText } from '@/components/ui/Typography';
import { cn } from '@/utils/cn';
import { useGroupStore } from '@/store/groupStore';
import { useActivityStore } from '@/store/activityStore';

const TABS = ['Vue d’ensemble', 'Membres', 'Activité'] as const;

export function GroupDetailScreen() {
  const { groupId } = useLocalSearchParams<{ groupId: string }>();
  const [tab, setTab] = useState<(typeof TABS)[number]>(TABS[0]);

  const { groups, members, membersStatus, status, fetchGroups, fetchMembers } = useGroupStore();
  const { events, status: activityStatus, fetch: fetchActivity } = useActivityStore();

  const group = groups.find((g) => g.id === groupId);
  const groupMembers = members[groupId] ?? [];
  const groupEvents = useMemo(() => events.filter((e) => e.groupId === groupId), [events, groupId]);

  useEffect(() => {
    if (groups.length === 0) fetchGroups();
    fetchMembers(groupId);
    fetchActivity(groupId);
  }, [groupId, groups.length, fetchGroups, fetchMembers, fetchActivity]);

  if (status === 'loading' && !group) {
    return (
      <SafeAreaView className="flex-1 bg-white" edges={['top']}>
        <AppHeader showBack />
        <View className="px-page-margin">
          <LoadingState />
        </View>
      </SafeAreaView>
    );
  }

  if (!group) {
    return (
      <SafeAreaView className="flex-1 bg-white" edges={['top']}>
        <AppHeader showBack />
        <View className="px-page-margin">
          <ErrorState title="Groupe introuvable" description="Ce groupe n'existe plus ou a été supprimé." onBack={() => router.back()} />
        </View>
      </SafeAreaView>
    );
  }

  const activeMembers = groupMembers.filter((m) => m.status === 'active').length;

  return (
    <SafeAreaView className="flex-1 bg-white" edges={['top']}>
      <AppHeader showBack />
      <ScrollView contentContainerClassName="gap-6 px-page-margin pb-10" showsVerticalScrollIndicator={false}>
        <View className="items-center gap-2">
          <Avatar name={group.name} size={96} />
          <DisplayText className="text-2xl">{group.name}</DisplayText>
          <LabelText>{group.memberCount} membres</LabelText>
        </View>

        <View className="flex-row border-b border-border">
          {TABS.map((t) => (
            <Pressable key={t} onPress={() => setTab(t)} className="flex-1 items-center pb-3">
              <ButtonLabelText className={cn(t === tab ? 'text-primary' : 'text-text-secondary')}>{t}</ButtonLabelText>
              {t === tab && <View className="mt-2 h-0.5 w-10 rounded-full bg-primary" />}
            </Pressable>
          ))}
        </View>

        {tab === 'Vue d’ensemble' && (
          <View className="gap-6">
            <View className="flex-row flex-wrap gap-3">
              <StatCard icon="group" label="Membres" value={group.memberCount} className="basis-[30%]" />
              <StatCard icon="bolt" label="Actifs" value={activeMembers} className="basis-[30%]" />
              {group.kind === 'tontine' && (
                <StatCard icon="account-balance-wallet" label="Tontine" value="Active" className="basis-[30%]" />
              )}
            </View>

            <View className="gap-3">
              <SectionHeader title="Actions rapides" />
              <View className="gap-3">
                <PrimaryButton
                  label="Ajouter un membre"
                  icon="person-add"
                  iconPosition="left"
                  onPress={() => router.push(`/group/${groupId}/invite`)}
                />
                <View className="flex-row gap-3">
                  <SecondaryButton label="Inviter" icon="ios-share" onPress={() => router.push(`/group/${groupId}/invite`)} />
                  {group.kind === 'tontine' && (
                    <SecondaryButton
                      label="Voir la tontine"
                      icon="savings"
                      onPress={() => router.push(`/group/${groupId}/tontine`)}
                    />
                  )}
                </View>
              </View>
            </View>

            <View className="gap-3">
              <SectionHeader title="Activité récente" action="Voir tout" onAction={() => setTab('Activité')} />
              {activityStatus === 'success' && groupEvents.length === 0 && (
                <EmptyState icon="history" title="Pas encore d'activité" description="Les actions du groupe apparaîtront ici." compact />
              )}
              {groupEvents.length > 0 && (
                <View className="rounded-lg border border-border bg-surface p-gutter-card shadow-soft">
                  {groupEvents.slice(0, 3).map((event, i) => (
                    <ActivityItem key={event.id} event={event} isLast={i === Math.min(2, groupEvents.length - 1)} />
                  ))}
                </View>
              )}
            </View>
          </View>
        )}

        {tab === 'Membres' && (
          <View className="gap-3">
            <View className="flex-row gap-3">
              <PrimaryButton label="Ajouter un membre" onPress={() => router.push(`/group/${groupId}/invite`)} />
              <SecondaryButton label="Inviter" onPress={() => router.push(`/group/${groupId}/invite`)} />
            </View>
            {membersStatus[groupId] === 'loading' && <LoadingState />}
            {groupMembers.length > 0 && (
              <View className="rounded-lg border border-border bg-surface px-gutter-card shadow-soft">
                {groupMembers.map((member, i) => (
                  <View key={member.id} className={i < groupMembers.length - 1 ? 'border-b border-border' : undefined}>
                    <MemberRow
                      name={member.displayName}
                      role={member.role}
                      subtitle={member.status === 'invited' ? 'Invitation en attente' : undefined}
                      onMorePress={() => {}}
                    />
                  </View>
                ))}
              </View>
            )}
          </View>
        )}

        {tab === 'Activité' && (
          <View className="gap-3">
            {groupEvents.length === 0 ? (
              <EmptyState icon="history" title="Pas encore d'activité" description="Les actions du groupe apparaîtront ici." />
            ) : (
              <View className="rounded-lg border border-border bg-surface p-gutter-card shadow-soft">
                {groupEvents.map((event, i) => (
                  <ActivityItem key={event.id} event={event} isLast={i === groupEvents.length - 1} />
                ))}
              </View>
            )}
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}
