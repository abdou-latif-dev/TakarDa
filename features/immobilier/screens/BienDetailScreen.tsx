import { useCallback, useState } from 'react';
import { Alert, ScrollView, useWindowDimensions, View } from 'react-native';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { AppHeader } from '@/components/ui/AppHeader';
import { Card } from '@/components/ui/Card';
import { IconButton, PrimaryButton, SecondaryButton } from '@/components/ui/Button';
import { SectionHeader } from '@/components/ui/SectionHeader';
import { EmptyState, ErrorState, LoadingState } from '@/components/ui/States';
import { DisplayText, BodyMdText, SectionTitleText, LabelText } from '@/components/ui/Typography';
import { LogementCard } from '@/components/immobilier/LogementCard';
import { formatFcfa } from '@/utils/format';
import { deleteBienCascade, formatOccupancySummary, getBienDeletionImpact, loadBienOverview, type BienOverview } from '@/services/immobilierService';

/** Le BIEN — point central de navigation : ses logements (occupés/vacants),
 * ses dépenses. (CEET/TDE est un module séparé : rien ici.) Recharge à chaque retour sur l'écran
 * (nouveau logement, locataire, paiement, dépense…). */
export function BienDetailScreen() {
  const { bienId } = useLocalSearchParams<{ bienId: string }>();
  const [overview, setOverview] = useState<BienOverview | null>(null);
  const [error, setError] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const { width } = useWindowDimensions();
  const wide = width >= 720;

  const load = useCallback(async () => {
    try {
      setOverview(await loadBienOverview(bienId));
      setError(false);
    } catch {
      setError(true);
    }
  }, [bienId]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

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

  const { bien, views, summary, depenses } = overview;
  const totalDepenses = depenses.reduce((sum, d) => sum + (typeof d.values.montant === 'number' ? d.values.montant : 0), 0);

  return (
    <SafeAreaView className="flex-1 bg-background" edges={['top', 'bottom']}>
      <AppHeader showBack trailing={<IconButton icon="delete-outline" onPress={onDeleteBien} disabled={deleting} />} />
      <ScrollView contentContainerClassName="w-full max-w-3xl gap-6 self-center px-page-margin pb-10" showsVerticalScrollIndicator={false}>
        <View>
          <DisplayText className="text-2xl" numberOfLines={2}>{String(bien.values.nom)}</DisplayText>
          <BodyMdText numberOfLines={2}>{String(bien.values.adresse ?? '')}</BodyMdText>
          <LabelText className="mt-2 font-inter-semibold text-text-primary">{formatOccupancySummary(summary)}</LabelText>
        </View>

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

        <View className="gap-3">
          <SectionHeader title="Dépenses" action="Ajouter" onAction={() => router.push(`/immobilier/${bienId}/depense-new`)} />
          {depenses.length === 0 ? (
            <EmptyState compact icon="receipt" title="Aucune dépense" description="Suivez l'entretien et les charges de ce bien." />
          ) : (
            <Card className="gap-0 p-0">
              {depenses.map((d, i) => (
                <View key={d.id}>
                  {i > 0 && <View className="h-px bg-border" />}
                  <View className="flex-row items-center gap-3 p-gutter-card">
                    <View className="flex-1">
                      <SectionTitleText className="text-base" numberOfLines={1}>
                        {String(d.values.libelle ?? '')}
                      </SectionTitleText>
                      <LabelText numberOfLines={1}>{d.values.date ? String(d.values.date) : ''}</LabelText>
                    </View>
                    <LabelText className="font-inter-semibold text-text-primary" numberOfLines={1}>
                      {typeof d.values.montant === 'number' ? formatFcfa(d.values.montant) : '—'}
                    </LabelText>
                  </View>
                </View>
              ))}
              <View className="h-px bg-border" />
              <View className="flex-row items-center gap-3 p-gutter-card">
                <LabelText className="flex-1 font-inter-semibold text-text-primary">Total dépenses</LabelText>
                <LabelText className="font-inter-semibold text-text-primary" numberOfLines={1}>{formatFcfa(totalDepenses)}</LabelText>
              </View>
            </Card>
          )}
        </View>

      </ScrollView>
    </SafeAreaView>
  );
}
