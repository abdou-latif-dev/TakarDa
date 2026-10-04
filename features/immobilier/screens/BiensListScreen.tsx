import { useCallback, useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { MaterialIcons } from '@expo/vector-icons';
import { AppHeader } from '@/components/ui/AppHeader';
import { IconButton, SecondaryButton } from '@/components/ui/Button';
import { EmptyState, ErrorState, LoadingState } from '@/components/ui/States';
import { SectionTitleText, LabelText, BodyMdText } from '@/components/ui/Typography';
import { Colors } from '@/constants/theme';
import { formatOccupancySummary, listBiensWithSummary, type BienSummary } from '@/services/immobilierService';
import { seedDemoImmobilier } from '@/services/immobilierDemoService';

/** Liste des BIENS (point d'entrée d'Immobilier) : chaque ligne résume ses
 * logements — « 4 logements · 3 occupés · 1 vacant » — et ouvre le bien. */
export function BiensListScreen() {
  const [items, setItems] = useState<BienSummary[] | null>(null);
  const [error, setError] = useState(false);
  const [seeding, setSeeding] = useState(false);

  const load = useCallback(async () => {
    try {
      setItems(await listBiensWithSummary());
      setError(false);
    } catch {
      setError(true);
    }
  }, []);

  // Recharge à chaque retour sur l'écran (après création/suppression d'un bien…).
  useFocusEffect(useCallback(() => { load(); }, [load]));

  const onSeedDemo = async () => {
    setSeeding(true);
    try {
      const firstBienId = await seedDemoImmobilier();
      await load();
      router.push(`/immobilier/${firstBienId}`);
    } finally {
      setSeeding(false);
    }
  };

  return (
    <SafeAreaView className="flex-1 bg-background" edges={['top', 'bottom']}>
      <AppHeader title="Immobilier" showBack trailing={<IconButton icon="add" onPress={() => router.push('/immobilier/new')} />} />
      <ScrollView contentContainerClassName="gap-3 px-page-margin pb-10" showsVerticalScrollIndicator={false}>
        {items !== null && items.length > 0 && (
          <BodyMdText>
            {items.length} bien{items.length > 1 ? 's' : ''}
          </BodyMdText>
        )}
        {items === null && !error && <LoadingState />}
        {error && <ErrorState onRetry={load} />}
        {items !== null && items.length === 0 && (
          <EmptyState
            icon="home-work"
            title="Aucun bien"
            description="Ajoutez votre premier bien (maison, immeuble…), puis ses logements et ses locataires."
            actionLabel="Ajouter un bien"
            onAction={() => router.push('/immobilier/new')}
          />
        )}
        {items?.map(({ bien, summary }) => (
          <Pressable
            key={bien.id}
            onPress={() => router.push(`/immobilier/${bien.id}`)}
            className="flex-row items-center gap-3 rounded-xl border border-border bg-surface p-gutter-card shadow-soft active:opacity-90">
            <View className="h-11 w-11 items-center justify-center rounded-full bg-primary-soft">
              <MaterialIcons name="home-work" size={20} color={Colors.primary} />
            </View>
            <View className="flex-1 gap-0.5">
              <SectionTitleText className="text-base" numberOfLines={2} ellipsizeMode="tail">
                {String(bien.values.nom ?? 'Bien')}
              </SectionTitleText>
              <LabelText numberOfLines={2} ellipsizeMode="tail">
                {formatOccupancySummary(summary)}
              </LabelText>
            </View>
            <MaterialIcons name="chevron-right" size={20} color={Colors.emptyIcon} />
          </Pressable>
        ))}
        <SecondaryButton label="Personnaliser les formulaires" icon="tune" onPress={() => router.push('/immobilier/personnaliser')} />
        <SecondaryButton
          label="Essayer avec des biens de démonstration"
          icon="auto-awesome"
          loading={seeding}
          onPress={onSeedDemo}
        />
      </ScrollView>
    </SafeAreaView>
  );
}
