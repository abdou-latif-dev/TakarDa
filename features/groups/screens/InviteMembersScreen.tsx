import { useState } from 'react';
import { Pressable, Share, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { MaterialIcons } from '@expo/vector-icons';
import { AppHeader } from '@/components/ui/AppHeader';
import { TextField } from '@/components/ui/TextField';
import { Card } from '@/components/ui/Card';
import { LabelText, SectionTitleText, BodyMdText } from '@/components/ui/Typography';
import { Colors } from '@/constants/theme';
import { useGroupStore } from '@/store/groupStore';

interface OptionProps {
  icon: keyof typeof MaterialIcons.glyphMap;
  title: string;
  description: string;
  onPress: () => void;
  large?: boolean;
}

function InviteOption({ icon, title, description, onPress, large }: OptionProps) {
  return (
    <Pressable
      onPress={onPress}
      className="flex-row items-center gap-4 overflow-hidden rounded-lg border border-border bg-surface p-gutter-card shadow-soft active:opacity-90">
      <View
        className="items-center justify-center rounded-full bg-primary-soft"
        style={{ width: large ? 56 : 48, height: large ? 56 : 48 }}>
        <MaterialIcons name={icon} size={large ? 26 : 22} color={Colors.primary} />
      </View>
      <View className="flex-1">
        <SectionTitleText className="text-base">{title}</SectionTitleText>
        <BodyMdText>{description}</BodyMdText>
      </View>
      <MaterialIcons name="chevron-right" size={20} color={Colors.emptyIcon} />
    </Pressable>
  );
}

export function InviteMembersScreen() {
  const { groupId } = useLocalSearchParams<{ groupId: string }>();
  const inviteMember = useGroupStore((s) => s.inviteMember);
  const group = useGroupStore((s) => s.groups.find((g) => g.id === groupId));
  const [phoneMode, setPhoneMode] = useState(false);
  const [contactName, setContactName] = useState('');

  const shareLink = async () => {
    await Share.share({
      message: `Rejoignez "${group?.name ?? 'mon groupe'}" sur FormEase : https://formease.app/invite/${groupId}`,
    });
  };

  const confirmContact = async () => {
    if (!contactName.trim()) return;
    await inviteMember(groupId, contactName.trim());
    setContactName('');
    setPhoneMode(false);
    router.back();
  };

  return (
    <SafeAreaView className="flex-1 bg-white" edges={['top']}>
      <AppHeader title="Inviter des membres" showBack />
      <View className="gap-6 px-page-margin pt-2">
        <View className="flex-row items-center gap-2 rounded-md border border-primary/30 bg-primary-soft/50 p-3">
          <MaterialIcons name="info" size={18} color={Colors.primary} />
          <LabelText className="flex-1 text-text-primary">
            {group ? `${group.memberCount} personnes peuvent rejoindre ce groupe.` : 'Invitez de nouveaux membres.'}
          </LabelText>
        </View>

        <View className="gap-3">
          <InviteOption
            icon="link"
            title="Partager le lien"
            description="Copiez et envoyez le lien d'invitation direct."
            onPress={shareLink}
            large
          />
          <InviteOption
            icon="qr-code-2"
            title="Partager le QR code"
            description="Laissez-les scanner pour rejoindre."
            onPress={() => router.push(`/group/${groupId}/invite-qr`)}
          />
          {phoneMode ? (
            <Card className="gap-3">
              <TextField
                label="Nom du contact"
                placeholder="Ex: Fatou Diallo"
                value={contactName}
                onChangeText={setContactName}
                autoFocus
                onSubmitEditing={confirmContact}
                returnKeyType="done"
              />
              <Pressable onPress={confirmContact} className="self-end">
                <LabelText className="font-inter-semibold text-primary">Envoyer l&apos;invitation</LabelText>
              </Pressable>
            </Card>
          ) : (
            <InviteOption
              icon="contact-phone"
              title="Inviter via téléphone"
              description="Accédez à vos contacts récents."
              onPress={() => setPhoneMode(true)}
            />
          )}
        </View>
      </View>
    </SafeAreaView>
  );
}
