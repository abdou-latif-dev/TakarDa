import { Share, View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { AppHeader } from '@/components/ui/AppHeader';
import { QRCard } from '@/components/ui/QRCard';
import { SecondaryButton } from '@/components/ui/Button';
import { useGroupStore } from '@/store/groupStore';
import { buildJoinLink } from '@/utils/deepLink';

export function InviteQRScreen() {
  const { groupId } = useLocalSearchParams<{ groupId: string }>();
  const group = useGroupStore((s) => s.groups.find((g) => g.id === groupId));
  const token = buildJoinLink(groupId);

  return (
    <SafeAreaView className="flex-1 bg-white" edges={['top']}>
      <AppHeader title="QR d'invitation" showBack />
      <View className="flex-1 justify-center gap-6 px-page-margin">
        <QRCard token={token} dossierLabel={group?.name ?? 'Groupe FormEase'} validityLabel="Lien valide indéfiniment" />
        <SecondaryButton
          label="Partager"
          icon="ios-share"
          onPress={() => Share.share({ message: `Rejoignez "${group?.name ?? 'mon groupe'}" sur FormEase : ${token}` })}
        />
      </View>
    </SafeAreaView>
  );
}
