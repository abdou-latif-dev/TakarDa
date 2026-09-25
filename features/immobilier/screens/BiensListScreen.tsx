import { useEffect, useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { router } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { MaterialIcons } from '@expo/vector-icons';
import { AppHeader } from '@/components/ui/AppHeader';
import { IconButton, SecondaryButton } from '@/components/ui/Button';
import { EmptyState, ErrorState, LoadingState } from '@/components/ui/States';
import { SectionTitleText, LabelText } from '@/components/ui/Typography';
import { Colors } from '@/constants/theme';
import { useCoreStore } from '@/store/coreStore';
import { ensureImmobilierTool } from '@/services/immobilierService';

export function BiensListScreen() {
  const [toolId, setToolId] = useState<string | null>(null);
  const [bienEdId, setBienEdId] = useState<string | null>(null);
  const { records, recordsStatus, fetchRecords } = useCoreStore();

  useEffect(() => {
    ensureImmobilierTool().then(({ tool, bien }) => {
      setToolId(tool.id);
      setBienEdId(bien.id);
      fetchRecords({ toolId: tool.id, entityDefinitionId: bien.id });
    });
  }, [fetchRecords]);

  const key = toolId && bienEdId ? `${toolId}:${bienEdId}` : null;
  const list = key ? (records[key] ?? []) : [];
  const status = key ? recordsStatus[key] : 'loading';

  return (
    <SafeAreaView className="flex-1 bg-background" edges={['top', 'bottom']}>
      <AppHeader title="Immobilier" showBack trailing={<IconButton icon="add" onPress={() => router.push('/immobilier/new')} />} />
      <ScrollView contentContainerClassName="gap-3 px-page-margin pb-10" showsVerticalScrollIndicator={false}>
        <SecondaryButton label="Personnaliser les formulaires" icon="tune" onPress={() => router.push('/immobilier/personnaliser')} />
        {status === 'loading' && list.length === 0 && <LoadingState />}
        {status === 'error' && (
          <ErrorState onRetry={() => toolId && bienEdId && fetchRecords({ toolId, entityDefinitionId: bienEdId })} />
        )}
        {status === 'success' && list.length === 0 && (
          <EmptyState
            icon="home-work"
            title="Aucun bien"
            description="Ajoutez votre premier bien pour commencer à gérer vos locataires et paiements."
            actionLabel="Ajouter un bien"
            onAction={() => router.push('/immobilier/new')}
          />
        )}
        {list.map((record) => (
          <Pressable
            key={record.id}
            onPress={() => router.push(`/immobilier/${record.id}`)}
            className="flex-row items-center gap-3 rounded-xl border border-border bg-surface p-gutter-card shadow-soft active:opacity-90">
            <View className="h-11 w-11 items-center justify-center rounded-full bg-primary-soft">
              <MaterialIcons name="home-work" size={20} color={Colors.primary} />
            </View>
            <View className="flex-1">
              <SectionTitleText className="text-base" numberOfLines={1}>
                {String(record.values.nom ?? 'Bien')}
              </SectionTitleText>
              <LabelText numberOfLines={1}>{String(record.values.adresse ?? '')}</LabelText>
            </View>
            <MaterialIcons name="chevron-right" size={20} color={Colors.emptyIcon} />
          </Pressable>
        ))}
      </ScrollView>
    </SafeAreaView>
  );
}
