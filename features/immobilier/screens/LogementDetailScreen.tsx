import { useCallback, useState } from 'react';
import { Alert, Pressable, ScrollView, View } from 'react-native';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { AppHeader } from '@/components/ui/AppHeader';
import { Card } from '@/components/ui/Card';
import { PrimaryButton, SecondaryButton } from '@/components/ui/Button';
import { ErrorState, LoadingState } from '@/components/ui/States';
import { BodyMdText, LabelText, SectionTitleText } from '@/components/ui/Typography';
import { InfoRow } from '@/components/immobilier/InfoRow';
import { PaiementsSection } from '@/components/immobilier/PaiementsSection';
import { OccupancyBadge } from '@/components/immobilier/OccupancyBadge';
import { formatMonth } from '@/components/ui/MonthPicker';
import { Colors } from '@/constants/theme';
import { formatFcfa } from '@/utils/format';
import { deleteLogement, formatDay, loadLogementDetail, terminerContrat, type LogementDetail } from '@/services/immobilierService';

/** Fiche d'un LOGEMENT : occupé (locataire, loyer, entrée, caution, avance,
 * paiements) ou vacant (aucun locataire, ajout possible). Terminer un contrat
 * ici rend le logement vacant sans jamais le supprimer ; l'historique des
 * contrats précédents reste consultable en bas de page. */
export function LogementDetailScreen() {
  const { logementId } = useLocalSearchParams<{ logementId: string }>();
  const [detail, setDetail] = useState<LogementDetail | null>(null);
  const [missingLogement, setMissingLogement] = useState(false);
  const [error, setError] = useState(false);

  const load = useCallback(async () => {
    try {
      const result = await loadLogementDetail(logementId);
      setMissingLogement(result === null);
      setDetail(result);
      setError(false);
    } catch {
      setError(true);
    }
  }, [logementId]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  if (error || missingLogement) {
    return (
      <SafeAreaView className="flex-1 bg-background" edges={['top', 'bottom']}>
        <AppHeader showBack />
        <View className="px-page-margin">
          <ErrorState title={missingLogement ? 'Logement introuvable' : undefined} onRetry={load} />
        </View>
      </SafeAreaView>
    );
  }
  if (!detail) {
    return (
      <SafeAreaView className="flex-1 bg-background" edges={['top', 'bottom']}>
        <AppHeader showBack />
        <View className="px-page-margin">
          <LoadingState />
        </View>
      </SafeAreaView>
    );
  }

  const { logement, bien, view, paiements, history, canDelete } = detail;
  const { contrat, locataire, occupied, lateness } = view;
  const bienId = String(logement.values.bien);

  const onTerminer = () => {
    if (!contrat) return;
    Alert.alert(
      'Marquer le départ',
      `${locataire?.name ?? 'Le locataire'} quitte ${String(logement.values.nom)}. Le contrat sera terminé et le logement redeviendra vacant. L'historique est conservé.`,
      [
        { text: 'Annuler', style: 'cancel' },
        {
          text: 'Confirmer le départ',
          style: 'destructive',
          onPress: async () => {
            try {
              await terminerContrat(contrat.id);
              await load();
            } catch (e) {
              Alert.alert('Impossible', e instanceof Error ? e.message : 'Une erreur est survenue.');
            }
          },
        },
      ],
    );
  };

  const onDelete = () => {
    Alert.alert('Supprimer ce logement', 'Ce logement n’a aucun contrat. Le supprimer ?', [
      { text: 'Annuler', style: 'cancel' },
      {
        text: 'Supprimer',
        style: 'destructive',
        onPress: async () => {
          try {
            await deleteLogement(logement.id);
            router.back();
          } catch (e) {
            Alert.alert('Impossible', e instanceof Error ? e.message : 'Une erreur est survenue.');
          }
        },
      },
    ]);
  };

  const montant = (value: unknown) => (typeof value === 'number' ? formatFcfa(value) : '—');
  const textOrDash = (value: unknown) => (typeof value === 'string' && value ? value : '—');

  return (
    <SafeAreaView className="flex-1 bg-background" edges={['top', 'bottom']}>
      <AppHeader showBack />
      <ScrollView contentContainerClassName="w-full max-w-3xl gap-5 self-center px-page-margin pb-10" showsVerticalScrollIndicator={false}>
        <View className="gap-2">
          <View className="flex-row items-center gap-3">
            <SectionTitleText className="flex-1 text-xl" numberOfLines={3}>
              {String(logement.values.nom)}
            </SectionTitleText>
            <OccupancyBadge occupied={occupied} />
          </View>
          <BodyMdText numberOfLines={1}>{String(bien?.values.nom ?? '')}</BodyMdText>
          {occupied && lateness?.key === 'retard' && (
            <LabelText className="font-inter-semibold" style={{ color: Colors.error }}>
              En retard ({lateness.lateMonths} mois)
            </LabelText>
          )}
        </View>

        <Card className="gap-0 p-0">
          <InfoRow label="Type" value={textOrDash(logement.values.type)} />
          <View className="h-px bg-border" />
          <InfoRow label="Cuisine" value={textOrDash(logement.values.cuisine)} />
          <View className="h-px bg-border" />
          <InfoRow label="WC" value={textOrDash(logement.values.wc)} />
        </Card>

        {occupied && contrat ? (
          <>
            <Card className="gap-0 p-0">
              <InfoRow label="Locataire" value={locataire?.name ?? '—'} />
              <View className="h-px bg-border" />
              <InfoRow label="Téléphone" value={locataire?.phone ?? '—'} />
              <View className="h-px bg-border" />
              <InfoRow label="Loyer" value={typeof contrat.values.loyer_mensuel === 'number' ? `${formatFcfa(contrat.values.loyer_mensuel)} / mois` : '—'} />
              <View className="h-px bg-border" />
              <InfoRow label="Entrée" value={formatDay(contrat.values.date_entree)} />
              <View className="h-px bg-border" />
              <InfoRow label="Caution" value={montant(contrat.values.caution)} />
              <View className="h-px bg-border" />
              <InfoRow label="Avance" value={montant(contrat.values.avance)} />
              <View className="h-px bg-border" />
              <InfoRow label="Dernier loyer payé" value={typeof contrat.values.dernier_loyer_paye === 'string' ? formatMonth(contrat.values.dernier_loyer_paye) : '—'} />
            </Card>

            <PaiementsSection
              contrat={contrat}
              paiements={paiements}
              locataireNom={locataire?.name ?? '—'}
              logementNom={String(logement.values.nom)}
              bienNom={bien ? String(bien.values.nom) : undefined}
              onRecorded={load}
            />

            <View className="gap-3">
              <SecondaryButton label="Voir le contrat" icon="description" onPress={() => router.push(`/immobilier/contrat/${contrat.id}`)} />
              <SecondaryButton label="Modifier le logement" icon="edit" onPress={() => router.push(`/immobilier/logement/${logement.id}/edit`)} />
              <SecondaryButton label="Marquer le départ" icon="logout" onPress={onTerminer} />
            </View>
          </>
        ) : (
          <>
            <Card className="gap-2">
              <LabelText className="font-inter-semibold text-text-primary">Statut : Vacant</LabelText>
              <BodyMdText>Aucun locataire actuellement.</BodyMdText>
              {typeof logement.values.loyer_reference === 'number' && (
                <LabelText>Loyer de référence : {formatFcfa(logement.values.loyer_reference)}</LabelText>
              )}
            </Card>
            <View className="gap-3">
              <PrimaryButton
                label="Ajouter un locataire"
                icon="person-add"
                onPress={() => router.push(`/immobilier/${bienId}/contrat-new?logementId=${logement.id}`)}
              />
              <SecondaryButton label="Modifier le logement" icon="edit" onPress={() => router.push(`/immobilier/logement/${logement.id}/edit`)} />
              {canDelete && <SecondaryButton label="Supprimer le logement" icon="delete-outline" onPress={onDelete} />}
            </View>
          </>
        )}

        {history.length > 0 && (
          <View className="gap-3">
            <SectionTitleText className="text-base">Historique d&apos;occupation</SectionTitleText>
            <Card className="gap-0 p-0">
              {history.map(({ contrat: old, locataire: tenant }, i) => (
                <View key={old.id}>
                  {i > 0 && <View className="h-px bg-border" />}
                  <Pressable onPress={() => router.push(`/immobilier/contrat/${old.id}`)} className="gap-0.5 p-gutter-card active:bg-background-secondary">
                    <SectionTitleText className="text-base" numberOfLines={1}>{tenant?.name ?? 'Sans locataire'}</SectionTitleText>
                    <LabelText numberOfLines={1}>
                      {formatDay(old.values.date_entree)} → {old.values.date_sortie ? formatDay(old.values.date_sortie) : '—'}
                    </LabelText>
                  </Pressable>
                </View>
              ))}
            </Card>
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}
