import { reconcileAdvances } from '@/services/rentAdvanceService';
import { useCallback, useEffect, useRef, useState } from 'react';
import { getAccountEpoch } from '@/services/cloudVisibility';
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
import { SyncBadge } from '@/components/immobilier/SyncBadge';
import { SyncBanner } from '@/components/immobilier/SyncBanner';
import { useCloudStore } from '@/store/cloudStore';

/** Liste des BIENS (point d'entrée d'Immobilier) : chaque ligne résume ses
 * logements — « 4 logements · 3 occupés · 1 vacant » — et ouvre le bien. */
export function BiensListScreen() {
  const [items, setItems] = useState<BienSummary[] | null>(null);
  const [error, setError] = useState(false);
  const [seeding, setSeeding] = useState(false);

  const lastSyncAt = useCloudStore((s) => s.lastSyncAt);
  const accountEpoch = useCloudStore((s) => s.accountEpoch);
  const shownEpoch = useRef(accountEpoch);

  const load = useCallback(async (sync = true) => {
    const epoch = getAccountEpoch();
    try {
      await reconcileAdvances().catch(() => 0);
      await useCloudStore.getState().refreshStates().catch(() => undefined); // modifications locales : « en attente » dès l'affichage
      if (sync) void useCloudStore.getState().syncIfEnabled(); // seulement si le compte est connecté ET la synchronisation activée
      const next = await listBiensWithSummary();
      if (epoch !== getAccountEpoch()) return; // résultat d'un ancien compte : écarté
      setItems(next);
      setError(false);
    } catch {
      setError(true);
    }
  }, []);

  // Recharge à chaque retour sur l'écran (après création/suppression d'un bien…).
  useFocusEffect(useCallback(() => { load(); }, [load]));
  // Après une synchronisation (des biens ont pu arriver du cloud) : rechargement sans relancer de synchronisation.
  useEffect(() => { if (lastSyncAt) load(false); }, [lastSyncAt, load]);
  // Changement de compte pendant que l'écran est ouvert : on retire tout de suite l'ancien contenu, puis on recharge.
  useEffect(() => {
    if (shownEpoch.current === accountEpoch) return;
    shownEpoch.current = accountEpoch;
    setItems(null);
    load(false);
  }, [accountEpoch, load]);

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
        <SyncBanner />
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
              <SyncBadge recordId={bien.id} />
            </View>
            <MaterialIcons name="chevron-right" size={20} color={Colors.emptyIcon} />
          </Pressable>
        ))}
        {items !== null && (
          <View className="flex-row gap-3">
            <View className="flex-1"><SecondaryButton label="Historique" icon="history" onPress={() => router.push('/immobilier/historique' as never)} /></View>
            <View className="flex-1"><SecondaryButton label="Statistiques" icon="bar-chart" onPress={() => router.push('/immobilier/statistiques' as never)} /></View>
          </View>
        )}
        {items !== null && <SecondaryButton label="Rapport" icon="assessment" onPress={() => router.push('/immobilier/rapport' as never)} />}
        <SecondaryButton label="Personnaliser les formulaires" icon="tune" onPress={() => router.push('/immobilier/personnaliser')} />
        {/* Données de démonstration : développement uniquement, jamais dans une version publiée. */}
        {__DEV__ && (
          <SecondaryButton
            label="Essayer avec des biens de démonstration"
            icon="auto-awesome"
            loading={seeding}
            onPress={onSeedDemo}
          />
        )}
      </ScrollView>
    </SafeAreaView>
  );
}
