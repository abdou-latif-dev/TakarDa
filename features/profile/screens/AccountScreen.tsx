import { useState } from 'react';
import { Alert, Pressable, ScrollView, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as ImagePicker from 'expo-image-picker';
import { MaterialIcons } from '@expo/vector-icons';
import { AppHeader } from '@/components/ui/AppHeader';
import { Avatar } from '@/components/ui/Avatar';
import { Card } from '@/components/ui/Card';
import { PrimaryButton } from '@/components/ui/Button';
import { LabelText } from '@/components/ui/Typography';
import { useAuthStore } from '@/store/authStore';

function EditableRow({
  label,
  value,
  onChangeText,
  isLast,
}: {
  label: string;
  value: string;
  onChangeText: (t: string) => void;
  isLast?: boolean;
}) {
  return (
    <View className={`flex-row items-center gap-4 p-gutter-card ${isLast ? '' : 'border-b border-border'}`}>
      <LabelText className="w-1/3 text-text-secondary">{label}</LabelText>
      <TextInput
        value={value}
        onChangeText={onChangeText}
        className="flex-1 text-right font-inter text-[15px] text-text-primary"
      />
    </View>
  );
}

export function AccountScreen() {
  const { user, updateProfile } = useAuthStore();
  const [avatarUri, setAvatarUri] = useState(user?.avatarUrl);
  const [name, setName] = useState(user?.name ?? '');
  const [email, setEmail] = useState(user?.email ?? '');
  const [phone, setPhone] = useState(user?.phone ?? '');
  const [saving, setSaving] = useState(false);

  const pickPhoto = async () => {
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.7, allowsEditing: true });
    if (!result.canceled && result.assets[0]) setAvatarUri(result.assets[0].uri);
  };

  const onSave = async () => {
    setSaving(true);
    try {
      await updateProfile({ name, email, phone, avatarUrl: avatarUri });
      Alert.alert('Profil mis à jour', 'Vos informations ont été enregistrées.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <SafeAreaView className="flex-1 bg-background" edges={['top', 'bottom']}>
      <AppHeader title="Mon compte" showBack />
      <ScrollView contentContainerClassName="gap-6 px-page-margin pb-10" keyboardShouldPersistTaps="handled">
        <View className="items-center gap-2">
          <Pressable onPress={pickPhoto} className="relative">
            <Avatar name={name || 'Vous'} uri={avatarUri} size={96} />
            <View className="absolute bottom-0 right-0 h-8 w-8 items-center justify-center rounded-full border-2 border-white bg-primary">
              <MaterialIcons name="photo-camera" size={16} color="#FFFFFF" />
            </View>
          </Pressable>
          <Pressable onPress={pickPhoto} hitSlop={8}>
            <LabelText className="font-inter-semibold text-primary">Modifier</LabelText>
          </Pressable>
        </View>

        <Card className="gap-0 p-0">
          <EditableRow label="Nom" value={name} onChangeText={setName} />
          <EditableRow label="Email" value={email} onChangeText={setEmail} />
          <EditableRow label="Téléphone" value={phone} onChangeText={setPhone} isLast />
        </Card>

        <PrimaryButton label="Enregistrer" loading={saving} onPress={onSave} />
      </ScrollView>
    </SafeAreaView>
  );
}
