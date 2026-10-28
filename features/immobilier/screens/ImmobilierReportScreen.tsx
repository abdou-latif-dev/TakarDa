import { useCallback, useEffect, useState } from 'react';
import { ScrollView, View } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { AppHeader } from '@/components/ui/AppHeader';
import { Card } from '@/components/ui/Card';
import { Chip } from '@/components/ui/Chip';
import { MonthPicker, formatMonth } from '@/components/ui/MonthPicker';
import { EmptyState, ErrorState, LoadingState } from '@/components/ui/States';
import { LabelText, SectionTitleText } from '@/components/ui/Typography';
import { InfoRow } from '@/components/immobilier/InfoRow';
import { Colors } from '@/constants/theme';
import { formatFcfa } from '@/utils/format';
import { formatDay } from '@/services/immobilierService';
import { currentMonth, loadImmobilierReport, type ImmobilierReport } from '@/services/immobilierReportService';
import type { RecordItem } from '@/types/entities';

const plural = (n: number, one: string) => `${n} ${one}${n > 1 ? 's' : ''}`;

function Section({ title, note, children }: { title: string; note?: string; children: React.ReactNode }) {
  return (
    <View className="gap-2">
      <SectionTitleText className="text-base">{title}</SectionTitleText>
      <Card className="gap-0 p-0">{children}</Card>
      {note ? <LabelText>{note}</LabelText> : null}
    </View>
  );
}

const Divider = () => <View className="h-px bg-border" />;

/** Rapport d'Immobilier : un mois, pour un bien ou pour tous. Consultation seulement — rien ne se modifie ici. Les loyers,
 * l'avance et la caution sont présentés séparément et ne s'additionnent jamais. */
export function ImmobilierReportScreen() {
  const [bienId, setBienId] = useState<string | null>(null);
  const [period, setPeriod] = useState<string>(currentMonth(new Date()));
  const [data, setData] = useState<{ report: ImmobilierReport; biens: RecordItem[] } | null | undefined>(undefined);
  const [error, setError] = useState(false);

  const load = useCallback(async () => {
    try {
      setData(await loadImmobilierReport({ bienId, period }));
      setError(false);
    } catch {
      setError(true);
    }
  }, [bienId, period]);

  useFocusEffect(useCallback(() => { load(); }, [load]));
  // Un bien supprimé entre-temps : retour à « Tous les biens ».
  useEffect(() => {
    if (data && bienId && !data.biens.some((b) => b.id === bienId)) setBienId(null);
  }, [data, bienId]);

  const r = data?.report;

  return (
    <SafeAreaView className="flex-1 bg-background" edges={['top', 'bottom']}>
      <AppHeader title="Rapport Immobilier" showBack />
      <ScrollView contentContainerClassName="w-full max-w-3xl gap-5 self-center px-page-margin pb-10" showsVerticalScrollIndicator={false}>
        {error ? (
          <ErrorState onRetry={load} />
        ) : data === undefined ? (
          <LoadingState />
        ) : data === null || data.biens.length === 0 ? (
          <EmptyState icon="assessment" title="Aucun rapport" description="Ajoutez un bien, ses logements et ses locataires pour consulter son rapport." />
        ) : (
          <>
            <View className="gap-3">
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerClassName="gap-2">
                <Chip label="Tous les biens" active={bienId === null} onPress={() => setBienId(null)} />
                {data.biens.map((b) => (
                  <Chip key={b.id} label={String(b.values.nom ?? 'Bien')} active={bienId === b.id} onPress={() => setBienId(b.id)} />
                ))}
              </ScrollView>
              <MonthPicker label="Période" value={period} onChange={(v) => v && setPeriod(v)} allowNone={false} />
            </View>

            {r && (
              <>
                <Section title="Logements">
                  <InfoRow label="Logements" value={String(r.logements.total)} />
                  <Divider />
                  <InfoRow label="Occupés" value={String(r.logements.occupes)} />
                  <Divider />
                  <InfoRow label="Vacants" value={String(r.logements.vacants)} />
                </Section>

                <Section
                  title={`Loyers — ${formatMonth(r.period)}`}
                  note="Attendus : loyer actuel des contrats concernés pour ce mois. Encaissés : vrais paiements de ce mois uniquement (ni avance, ni caution).">
                  <InfoRow label="Loyers attendus" value={formatFcfa(r.loyers.attendus)} />
                  <Divider />
                  <InfoRow label="Loyers encaissés" value={`${formatFcfa(r.loyers.encaisses)} · ${plural(r.loyers.paiements, 'paiement')}`} />
                  <Divider />
                  <InfoRow label="En retard" value={r.loyers.enRetard.contrats === 0 ? 'Aucun' : `${formatFcfa(r.loyers.enRetard.montant)} · ${plural(r.loyers.enRetard.contrats, 'contrat')}`} />
                  <Divider />
                  <InfoRow label="À payer ce mois" value={r.loyers.aPayer.contrats === 0 ? 'Aucun' : `${formatFcfa(r.loyers.aPayer.montant)} · ${plural(r.loyers.aPayer.contrats, 'contrat')}`} />
                </Section>

                <Section title="Avances" note="Une avance n’est pas un loyer encaissé : un mois couvert par l’avance n’est ni un paiement ni un reçu.">
                  <InfoRow label="Enregistrées" value={formatFcfa(r.avances.enregistrees)} />
                  <Divider />
                  <InfoRow label="Consommées" value={formatFcfa(r.avances.consommees)} />
                  <Divider />
                  <InfoRow label="Disponibles" value={formatFcfa(r.avances.disponibles)} />
                  <Divider />
                  <InfoRow label="Mois couverts" value={r.avances.couvertsCePeriode.mois === 0 ? 'Aucun' : `${plural(r.avances.couvertsCePeriode.mois, 'mois')} · ${formatFcfa(r.avances.couvertsCePeriode.montant)}`} />
                  {r.avances.contratsEpuises > 0 && (
                    <>
                      <Divider />
                      <InfoRow label="Épuisées" value={plural(r.avances.contratsEpuises, 'contrat')} />
                    </>
                  )}
                </Section>

                <Section title="Cautions détenues" note="La caution est à part : ce n’est pas un revenu et elle ne couvre aucun loyer.">
                  <InfoRow label="Cautions" value={formatFcfa(r.cautions.detenues)} />
                  <Divider />
                  <InfoRow label="Contrats" value={String(r.cautions.contrats)} />
                </Section>

                <Section title="Paiements et événements du mois">
                  {r.evenements.length === 0 ? (
                    <View className="p-gutter-card"><LabelText>Aucun événement pour cette période.</LabelText></View>
                  ) : (
                    r.evenements.map((e, i) => (
                      <View key={e.id}>
                        {i > 0 && <Divider />}
                        <View className="flex-row items-center gap-3 p-gutter-card">
                          <View className="min-w-0 flex-1 gap-0.5">
                            <LabelText className="font-inter-semibold text-text-primary" numberOfLines={1}>{e.title}</LabelText>
                            <LabelText numberOfLines={2}>{[e.detail, e.day ? formatDay(e.day) : ''].filter(Boolean).join(' · ')}</LabelText>
                          </View>
                          {e.amount !== null && <LabelText className="font-inter-semibold text-text-primary">{formatFcfa(e.amount)}</LabelText>}
                        </View>
                      </View>
                    ))
                  )}
                </Section>

                {r.missing.length > 0 && (
                  <View className="gap-1.5 rounded-xl bg-warning-container p-gutter-card">
                    <LabelText className="font-inter-semibold" style={{ color: Colors.warning }}>À savoir</LabelText>
                    {r.missing.map((m) => (
                      <LabelText key={m}>{m}</LabelText>
                    ))}
                  </View>
                )}
              </>
            )}
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}
