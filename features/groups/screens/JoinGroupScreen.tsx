import { useEffect, useState } from 'react';
import { View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { AppHeader } from '@/components/ui/AppHeader';
import { Avatar } from '@/components/ui/Avatar';
import { PrimaryButton, SecondaryButton } from '@/components/ui/Button';
import { ErrorState, LoadingState } from '@/components/ui/States';
import { DisplayText, LabelText } from '@/components/ui/Typography';
import { groupService } from '@/services/groupService';
import { useGroupStore } from '@/store/groupStore';
import type { Group } from '@/types/entities';

export function JoinGroupScreen() {
  const { groupId } = useLocalSearchParams<{ groupId: string }>();
  const joinGroup = useGroupStore((s) => s.joinGroup);
  const [group, setGroup] = useState<Group | null | undefined>(undefined);
  const [joining, setJoining] = useState(false);

  useEffect(() => {
    groupService.getGroup(groupId).then(setGroup);
  }, [groupId]);

  const onJoin = async () => {
    setJoining(true);
    try {
      await joinGroup(groupId);
      router.replace(`/group/${groupId}`);
    } finally {
      setJoining(false);
    }
  };

  if (group === undefined) {
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
          <ErrorState
            title="Groupe introuvable"
            description="Ce lien d'invitation n'est plus valide."
            onBack={() => router.replace('/(tabs)')}
          />
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView className="flex-1 bg-white" edges={['top', 'bottom']}>
      <AppHeader showBack />
      <View className="flex-1 items-center justify-center gap-4 px-page-margin">
        <Avatar name={group.name} size={96} />
        <DisplayText className="text-center text-2xl">{group.name}</DisplayText>
        {group.description ? <LabelText className="text-center">{group.description}</LabelText> : null}
        <LabelText>{group.memberCount} membres</LabelText>
      </View>
      <View className="gap-3 px-page-margin pb-6">
        <PrimaryButton label="Rejoindre ce groupe" icon="group-add" iconPosition="left" loading={joining} onPress={onJoin} />
        <SecondaryButton label="Plus tard" onPress={() => router.replace('/(tabs)')} />
      </View>
    </SafeAreaView>
  );
}
