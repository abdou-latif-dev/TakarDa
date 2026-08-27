import { useEffect, useState } from 'react';
import { Alert, ScrollView, View } from 'react-native';
import { router } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { AppHeader } from '@/components/ui/AppHeader';
import { TextField, TextAreaField } from '@/components/ui/TextField';
import { Chip } from '@/components/ui/Chip';
import { PrimaryButton } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/States';
import { LabelText } from '@/components/ui/Typography';
import { useGroupStore } from '@/store/groupStore';
import { useActivityStore } from '@/store/activityStore';

export function CreateActivityScreen() {
  const { groups, status, fetchGroups } = useGroupStore();
  const createEvent = useActivityStore((s) => s.createEvent);
  const [groupId, setGroupId] = useState<string | undefined>();
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (groups.length === 0) fetchGroups();
  }, [groups.length, fetchGroups]);

  useEffect(() => {
    if (!groupId && groups.length > 0) setGroupId(groups[0].id);
  }, [groups, groupId]);

  const onSubmit = async () => {
    if (!groupId || !title.trim()) {
      Alert.alert('Champs requis', 'Choisissez un groupe et donnez un titre à l’activité.');
      return;
    }
    setSaving(true);
    try {
      await createEvent({ groupId, title: title.trim(), description: description.trim() || 'Nouvelle activité organisée.' });
      router.replace('/(tabs)/activity');
    } finally {
      setSaving(false);
    }
  };

  if (status !== 'loading' && groups.length === 0) {
    return (
      <SafeAreaView className="flex-1 bg-white" edges={['top', 'bottom']}>
        <AppHeader title="Organiser une activité" showBack />
        <View className="px-page-margin pt-4">
          <EmptyState
            icon="savings"
            title="Aucune tontine pour l'instant"
            description="Créez d'abord une tontine pour pouvoir y organiser une activité."
            actionLabel="Créer une tontine"
            onAction={() => router.replace('/tontine/create')}
          />
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView className="flex-1 bg-white" edges={['top', 'bottom']}>
      <AppHeader title="Organiser une activité" showBack />
      <ScrollView contentContainerClassName="gap-5 px-page-margin pb-6" keyboardShouldPersistTaps="handled">
        <View className="gap-2">
          <LabelText className="text-text-secondary">Groupe</LabelText>
          <View className="flex-row flex-wrap gap-2">
            {groups.map((g) => (
              <Chip key={g.id} label={g.name} active={groupId === g.id} onPress={() => setGroupId(g.id)} />
            ))}
          </View>
        </View>

        <TextField label="Titre" placeholder="Ex: Réunion mensuelle" value={title} onChangeText={setTitle} />
        <TextAreaField
          label="Description (Optionnel)"
          placeholder="Détails de l'activité..."
          value={description}
          onChangeText={setDescription}
        />

        <PrimaryButton label="Organiser l'activité" loading={saving} onPress={onSubmit} />
      </ScrollView>
    </SafeAreaView>
  );
}
