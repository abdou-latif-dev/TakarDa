import { useState } from 'react';
import { Alert, Pressable, ScrollView, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { MaterialIcons } from '@expo/vector-icons';
import { AppHeader } from '@/components/ui/AppHeader';
import { TextField, TextAreaField } from '@/components/ui/TextField';
import { PrimaryButton } from '@/components/ui/Button';
import { Avatar } from '@/components/ui/Avatar';
import { Card } from '@/components/ui/Card';
import { SectionTitleText, LabelText } from '@/components/ui/Typography';
import { Colors } from '@/constants/theme';
import { useGroupStore } from '@/store/groupStore';
import { groupService } from '@/services/groupService';

export function CreateGroupScreen() {
  const { kind } = useLocalSearchParams<{ kind?: string }>();
  const isTontine = kind === 'tontine';
  const createGroup = useGroupStore((s) => s.createGroup);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [pendingMembers, setPendingMembers] = useState<string[]>([]);
  const [newMemberName, setNewMemberName] = useState('');
  const [addingMember, setAddingMember] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const onSubmit = async () => {
    if (!name.trim()) {
      Alert.alert('Nom requis', 'Donnez un nom à votre groupe.');
      return;
    }
    setSubmitting(true);
    try {
      const group = await createGroup({
        name: name.trim(),
        description: description.trim() || undefined,
        kind: isTontine ? 'tontine' : 'general',
      });
      for (const memberName of pendingMembers) {
        await groupService.inviteMember(group.id, memberName);
      }
      router.replace(`/group/${group.id}`);
    } finally {
      setSubmitting(false);
    }
  };

  const confirmAddMember = () => {
    const trimmed = newMemberName.trim();
    if (!trimmed) return;
    setPendingMembers((prev) => [...prev, trimmed]);
    setNewMemberName('');
    setAddingMember(false);
  };

  return (
    <SafeAreaView className="flex-1 bg-white" edges={['top', 'bottom']}>
      <AppHeader title="Créer un groupe" />
      <ScrollView contentContainerClassName="gap-6 px-page-margin pb-6 pt-2" keyboardShouldPersistTaps="handled">
        <View>
          <SectionTitleText>Nouveau Groupe</SectionTitleText>
          <LabelText className="mt-1">Configurez les détails de votre nouveau groupe de gestion.</LabelText>
        </View>

        <View className="items-center gap-2">
          <View className="h-28 w-28 items-center justify-center rounded-full bg-background-secondary">
            <MaterialIcons name="add-a-photo" size={28} color={Colors.textMuted} />
          </View>
          <LabelText>Ajouter une photo</LabelText>
        </View>

        <Card className="gap-4">
          <TextField label="Nom du groupe" placeholder="Ex: Famille, Colocation..." value={name} onChangeText={setName} />
          <TextAreaField
            label="Description (Optionnel)"
            placeholder="Quel est le but de ce groupe ?"
            value={description}
            onChangeText={setDescription}
          />
        </Card>

        <View className="gap-3">
          <SectionTitleText>Membres</SectionTitleText>
          <Card className="gap-3">
            <View className="flex-row items-center gap-3">
              <Avatar name="Vous" size={40} />
              <View className="flex-1">
                <LabelText className="font-inter-semibold text-text-primary">Vous</LabelText>
                <LabelText className="text-primary-dark">Administrateur·rice</LabelText>
              </View>
              <MaterialIcons name="admin-panel-settings" size={20} color={Colors.primary} />
            </View>
            {pendingMembers.length > 0 && (
              <View className="gap-2 border-t border-border pt-3">
                {pendingMembers.map((m) => (
                  <LabelText key={m} className="text-text-primary">
                    {m}
                  </LabelText>
                ))}
              </View>
            )}
            {addingMember ? (
              <View className="gap-2 border-t border-border pt-3">
                <TextField
                  placeholder="Nom du membre"
                  value={newMemberName}
                  onChangeText={setNewMemberName}
                  autoFocus
                  onSubmitEditing={confirmAddMember}
                  returnKeyType="done"
                />
                <Pressable onPress={confirmAddMember} className="self-end px-1">
                  <LabelText className="font-inter-semibold text-primary">Ajouter</LabelText>
                </Pressable>
              </View>
            ) : (
              <Pressable onPress={() => setAddingMember(true)} className="flex-row items-center gap-2 pt-1">
                <MaterialIcons name="person-add-alt" size={18} color={Colors.primary} />
                <LabelText className="font-inter-semibold text-primary">Ajouter des membres</LabelText>
              </Pressable>
            )}
          </Card>
        </View>
      </ScrollView>
      <View className="gap-3 border-t border-border bg-white px-page-margin pb-4 pt-4">
        <PrimaryButton label="Créer le groupe" icon="arrow-forward" loading={submitting} onPress={onSubmit} />
      </View>
    </SafeAreaView>
  );
}
