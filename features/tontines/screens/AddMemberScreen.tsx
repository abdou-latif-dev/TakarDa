import { useState } from 'react';
import { Alert, KeyboardAvoidingView, Platform, ScrollView, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { MaterialIcons } from '@expo/vector-icons';
import { AppHeader } from '@/components/ui/AppHeader';
import { Card } from '@/components/ui/Card';
import { TextField } from '@/components/ui/TextField';
import { PrimaryButton, SecondaryButton } from '@/components/ui/Button';
import { SectionTitleText, BodyMdText, LabelText } from '@/components/ui/Typography';
import { Colors } from '@/constants/theme';
import { useGroupStore } from '@/store/groupStore';
import { useAuthStore } from '@/store/authStore';

export function AddMemberScreen() {
  const { groupId } = useLocalSearchParams<{ groupId: string }>();
  const { addFormeaseMember, addGuestMember } = useGroupStore();
  const myFormeaseId = useAuthStore((s) => s.user?.formeaseId);

  const [formeaseId, setFormeaseId] = useState('');
  const [searching, setSearching] = useState(false);

  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [phone, setPhone] = useState('');
  const [creatingGuest, setCreatingGuest] = useState(false);

  const onSearch = async () => {
    if (!formeaseId.trim()) return;
    setSearching(true);
    try {
      await addFormeaseMember(groupId, formeaseId.trim());
      Alert.alert('Membre ajouté', 'Cet utilisateur FormEase a rejoint la tontine.', [{ text: 'OK', onPress: () => router.back() }]);
    } catch (e) {
      Alert.alert('Introuvable', e instanceof Error ? e.message : "Vérifiez l'ID FormEase saisi.");
    } finally {
      setSearching(false);
    }
  };

  const onCreateGuest = async () => {
    if (!firstName.trim() || !lastName.trim()) {
      Alert.alert('Champs requis', 'Le nom et le prénom sont nécessaires.');
      return;
    }
    setCreatingGuest(true);
    try {
      await addGuestMember(groupId, { firstName: firstName.trim(), lastName: lastName.trim(), phone: phone.trim() || undefined });
      router.back();
    } finally {
      setCreatingGuest(false);
    }
  };

  return (
    <SafeAreaView className="flex-1 bg-white" edges={['top', 'bottom']}>
      <AppHeader title="Ajouter" showBack />
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} className="flex-1">
        <ScrollView contentContainerClassName="gap-5 px-page-margin pb-8 pt-2" keyboardShouldPersistTaps="handled">
          <Card className="gap-4">
            <View className="flex-row items-center gap-3">
              <View className="h-10 w-10 items-center justify-center rounded-full bg-primary-soft">
                <MaterialIcons name="person-search" size={20} color={Colors.primary} />
              </View>
              <View className="flex-1">
                <SectionTitleText className="text-base">Ajouter un utilisateur FormEase</SectionTitleText>
                <LabelText>Trouvez-le via son ID FormEase</LabelText>
              </View>
            </View>
            <TextField placeholder="Ex: FE-4821" value={formeaseId} onChangeText={setFormeaseId} autoCapitalize="characters" />
            <SecondaryButton label="Rechercher" icon="search" loading={searching} onPress={onSearch} />
            {myFormeaseId && (
              <LabelText>
                Chaque membre retrouve son ID FormEase ({myFormeaseId} pour vous) dans son profil, sous son nom.
              </LabelText>
            )}
          </Card>

          <View className="flex-row items-center gap-3">
            <View className="h-px flex-1 bg-border" />
            <LabelText>OU</LabelText>
            <View className="h-px flex-1 bg-border" />
          </View>

          <Card className="gap-4">
            <View className="flex-row items-center gap-3">
              <View className="h-10 w-10 items-center justify-center rounded-full bg-surface-container">
                <MaterialIcons name="person-add" size={20} color={Colors.textSecondary} />
              </View>
              <View className="flex-1">
                <SectionTitleText className="text-base">Ajouter une personne sans compte</SectionTitleText>
                <LabelText>Créez un profil invité manuellement</LabelText>
              </View>
            </View>
            <TextField label="Nom" placeholder="Dupont" value={lastName} onChangeText={setLastName} />
            <TextField label="Prénom" placeholder="Marie" value={firstName} onChangeText={setFirstName} />
            <TextField
              label="Téléphone (optionnel)"
              placeholder="+225 07 00 00 00 00"
              value={phone}
              onChangeText={setPhone}
              keyboardType="phone-pad"
            />
            <PrimaryButton label="Créer l'invité" loading={creatingGuest} onPress={onCreateGuest} />
          </Card>

          <BodyMdText className="text-center">
            Une personne n&apos;a pas besoin d&apos;avoir FormEase pour participer à votre tontine. Vous pourrez gérer sa
            participation pour elle.
          </BodyMdText>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
