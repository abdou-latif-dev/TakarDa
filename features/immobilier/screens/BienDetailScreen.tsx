import { useCloudStore } from '@/store/cloudStore';
import { SyncBadge } from '@/components/immobilier/SyncBadge';
import { SyncBanner } from '@/components/immobilier/SyncBanner';
import { reconcileAdvances } from '@/services/rentAdvanceService';
import { useCallback, useEffect, useRef, useState } from 'react';
import { getAccountEpoch } from '@/services/cloudVisibility';
import { Alert, ScrollView, useWindowDimensions, View } from 'react-native';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { AppHeader } from '@/components/ui/AppHeader';
import { IconButton, PrimaryButton, SecondaryButton } from '@/components/ui/Button';
import { EmptyState, ErrorState, LoadingState } from '@/components/ui/States';
import { DisplayText, BodyMdText, SectionTitleText, LabelText } from '@/components/ui/Typography';
import { LogementCard } from '@/components/immobilier/LogementCard';
import { deleteBienCascade, formatOccupancySummary, getBienDeletionImpact, loadBienOverview, type BienOverview } from '@/services/immobilierService';

/** Le BIEN — point central de navigation : ses logements (occupés/vacants),
 * ses dépenses. (CEET/TDE est un module séparé : rien ici.) Recharge à chaque retour sur l'écran
 * (nouveau logement, locataire, paiement…). Les dépenses ne sont plus proposées dans l'interface (V1) : leurs données et leurs routes sont conservées. */
export function BienDetailScreen() {
  const { bienId } = useLocalSearchParams<{ bienId: string }>();
  const [overview, setOverview] = useState<BienOverview | null>(null);
  const [error, setError] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const { width } = useWindowDimensions();
  const wide = width >= 720;

  const lastSyncAt = useCloudStore((s) => s.lastSyncAt);
  const accountEpoch = useCloudStore((s) => s.accountEpoch);
  const shownEpoch = useRef(accountEpoch);

  const load = useCallback(async (sync = true) => {
    const epoch = getAccountEpoch();
    try {
      await reconcileAdvances().catch(() => 0); // couvre les mois dus par l'avance autorisée (idempotent)
      await useCloudStore.getState().refreshStates().catch(() => undefined); // modifications locales : « en attente » dès l'affichage
      if (sync) void useCloudStore.getState().syncIfEnabled();
      const next = await loadBienOverview(bienId);
      if (epoch !== getAccountEpoch()) return; // résultat d'un ancien compte : écarté
      setOverview(next);
      setError(false);
    } catch {
      if (epoch === getAccountEpoch()) setError(true);
    }
  }, [bienId]);

  useFocusEffect(useCallback(() => { load(); }, [load]));
  useEffect(() => { if (lastSyncAt) load(false); }, [lastSyncAt, load]);
  // Changement de compte pendant que l'écran est ouvert : le bien peut être devenu invisible pour ce compte.
  useEffect(() => {
    if (shownEpoch.current === accountEpoch) return;
    shownEpoch.current = accountEpoch;
    setOverview(null);
    load(false);
  }, [accountEpoch, load]);

  const onDeleteBien = async () => {
    const impact = await getBienDeletionImpact(bienId);
    const parts = [
      impact.logements ? `${impact.logements} logement${impact.logements > 1 ? 's' : ''}` : null,
      impact.contrats ? `${impact.contrats} contrat${impact.contrats > 1 ? 's' : ''}` : null,
      impact.paiements ? `${impact.paiements} paiement${impact.paiements > 1 ? 's' : ''}` : null,
      impact.depenses ? `${impact.depenses} dépense${impact.depenses > 1 ? 's' : ''}` : null,
      impact.facturesPartagees ? `${impact.facturesPartagees} facture${impact.facturesPartagees > 1 ? 's' : ''} partagée${impact.facturesPartagees > 1 ? 's' : ''}` : null,
    ].filter(Boolean);
    Alert.alert(
      'Supprimer ce bien',
      parts.length
        ? `Seront définitivement supprimés avec ce bien : ${parts.join(', ')}. Cette action est irréversible. Continuer ?`
        : 'Ce bien est vide. Le supprimer ?',
      [
        { text: 'Annuler', style: 'cancel' },
        {
          text: 'Supprimer',
          style: 'destructive',
          onPress: async () => {
            setDeleting(true);
            try {
              await deleteBienCascade(bienId);
              router.replace('/immobilier');
            } finally {
              setDeleting(false);
            }
          },
        },
      ],
    );
  };

  if (error) {
    return (
      <SafeAreaView className="flex-1 bg-background" edges={['top', 'bottom']}>
        <AppHeader showBack />
        <View className="px-page-margin">
          <ErrorState onRetry={load} />
        </View>
      </SafeAreaView>
    );
  }

  if (!overview || !overview.bien) {
    return (
      <SafeAreaView className="flex-1 bg-background" edges={['top', 'bottom']}>
        <AppHeader showBack />
        <View className="px-page-margin">
          <LoadingState />
        </View>
      </SafeAreaView>
    );
  }

  const { bien, views, summary } = overview;

  return (
    <SafeAreaView className="flex-1 bg-background" edges={['top', 'bottom']}>
      <AppHeader showBack trailing={<IconButton icon="delete-outline" onPress={onDeleteBien} disabled={deleting} />} />
      <ScrollView contentContainerClassName="w-full max-w-3xl gap-6 self-center px-page-margin pb-10" showsVerticalScrollIndicator={false}>
        <View>
          <DisplayText className="text-2xl" numberOfLines={2}>{String(bien.values.nom)}</DisplayText>
          <BodyMdText numberOfLines={2}>{String(bien.values.adresse ?? '')}</BodyMdText>
          <LabelText className="mt-2 font-inter-semibold text-text-primary">{formatOccupancySummary(summary)}</LabelText>
          <View className="mt-1"><SyncBadge recordId={bien.id} /></View>
        </View>

        <SyncBanner />

        <View className="flex-row gap-3">
          <SecondaryButton
            fullWidth={false}
            multilineLabel
            className="flex-1 px-2"
            label="Ajouter un logement"
            icon="add"
            onPress={() => router.push(`/immobilier/${bienId}/logement-new`)}
          />
          <PrimaryButton
            fullWidth={false}
            multilineLabel
            className="flex-1 px-2"
            label="Ajouter un locataire"
            icon="person-add"
            onPress={() => router.push(`/immobilier/${bienId}/contrat-new`)}
          />
        </View>

        <View className="gap-3">
          <SectionTitleText>Logements</SectionTitleText>
          {views.length === 0 ? (
            <EmptyState
              compact
              icon="meeting-room"
              title="Aucun logement"
              description="Ajoutez les chambres, appartements ou boutiques de ce bien."
              actionLabel="Ajouter un logement"
              onAction={() => router.push(`/immobilier/${bienId}/logement-new`)}
            />
          ) : (
            <View className="flex-row flex-wrap gap-3">
              {views.map((view) => (
                <View key={view.logement.id} style={{ width: wide ? '48.5%' : '100%' }}>
                  <LogementCard view={view} onPress={() => router.push(`/immobilier/logement/${view.logement.id}`)} />
                </View>
              ))}
            </View>
          )}
        </View>

      </ScrollView>
    </SafeAreaView>
  );
}
