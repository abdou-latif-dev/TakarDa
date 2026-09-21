import { useEffect, useState } from 'react';
import { Alert, Pressable, ScrollView, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { AppHeader } from '@/components/ui/AppHeader';
import { Card } from '@/components/ui/Card';
import { IconButton } from '@/components/ui/Button';
import { SectionHeader } from '@/components/ui/SectionHeader';
import { EmptyState, LoadingState } from '@/components/ui/States';
import { DisplayText, BodyMdText, SectionTitleText, LabelText } from '@/components/ui/Typography';
import { Colors } from '@/constants/theme';
import { formatFcfa } from '@/utils/format';
import { coreService } from '@/services/coreService';
import { ensureImmobilierTool, computeContratLateness } from '@/services/immobilierService';
import type { RecordItem } from '@/types/entities';

const LATENESS_TONE: Record<string, string> = {
  a_jour: Colors.success,
  retard: Colors.error,
  sans_paiement: Colors.textMuted,
};

export function BienDetailScreen() {
  const { bienId } = useLocalSearchParams<{ bienId: string }>();
  const [toolId, setToolId] = useState<string | null>(null);
  const [bien, setBien] = useState<RecordItem | null>(null);
  const [contrats, setContrats] = useState<RecordItem[]>([]);
  const [paiements, setPaiements] = useState<RecordItem[]>([]);
  const [depenses, setDepenses] = useState<RecordItem[]>([]);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    const { tool, contrat, paiement, depense } = await ensureImmobilierTool();
    setToolId(tool.id);
    const b = await coreService.getRecord(bienId);
    setBien(b);
    const allContrats = await coreService.getRecords({ toolId: tool.id, entityDefinitionId: contrat.id });
    setContrats(allContrats.filter((c) => c.values.bien === bienId));
    const allPaiements = await coreService.getRecords({ toolId: tool.id, entityDefinitionId: paiement.id });
    setPaiements(allPaiements);
    const allDepenses = await coreService.getRecords({ toolId: tool.id, entityDefinitionId: depense.id });
    setDepenses(allDepenses.filter((d) => d.values.bien === bienId));
    setLoading(false);
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bienId]);

  const onDeleteBien = () => {
    if (!toolId) return;
    Alert.alert('Supprimer ce bien', 'Le bien et ses contrats/dépenses seront définitivement supprimés. Continuer ?', [
      { text: 'Annuler', style: 'cancel' },
      {
        text: 'Supprimer',
        style: 'destructive',
        onPress: async () => {
          for (const c of contrats) await coreService.deleteRecord(c.id);
          for (const d of depenses) await coreService.deleteRecord(d.id);
          await coreService.deleteRecord(bienId);
          router.replace('/immobilier');
        },
      },
    ]);
  };

  if (loading || !bien) {
    return (
      <SafeAreaView className="flex-1 bg-white" edges={['top', 'bottom']}>
        <AppHeader showBack />
        <View className="px-page-margin">
          <LoadingState />
        </View>
      </SafeAreaView>
    );
  }

  const totalDepenses = depenses.reduce((sum, d) => sum + (typeof d.values.montant === 'number' ? d.values.montant : 0), 0);

  return (
    <SafeAreaView className="flex-1 bg-white" edges={['top', 'bottom']}>
      <AppHeader showBack trailing={<IconButton icon="delete-outline" onPress={onDeleteBien} />} />
      <ScrollView contentContainerClassName="gap-6 px-page-margin pb-10" showsVerticalScrollIndicator={false}>
        <View>
          <DisplayText className="text-2xl">{String(bien.values.nom)}</DisplayText>
          <BodyMdText>{String(bien.values.adresse)}</BodyMdText>
        </View>

        <View className="gap-3">
          <SectionHeader title="Contrats / Locataires" action="Ajouter" onAction={() => router.push(`/immobilier/${bienId}/contrat-new`)} />
          {contrats.length === 0 ? (
            <EmptyState compact icon="description" title="Aucun contrat" description="Ajoutez un locataire pour ce bien." />
          ) : (
            <View className="gap-3">
              {contrats.map((c) => {
                const lateness = computeContratLateness(c, paiements);
                return (
                  <Pressable
                    key={c.id}
                    onPress={() => router.push(`/immobilier/contrat/${c.id}`)}
                    className="gap-2 rounded-xl border border-border bg-surface p-gutter-card shadow-soft active:opacity-90">
                    <View className="flex-row items-center justify-between">
                      <SectionTitleText numberOfLines={1}>{String(c.values.nom_logement ?? 'Logement')}</SectionTitleText>
                      <LabelText style={{ color: LATENESS_TONE[lateness.key] }} className="font-inter-semibold">
                        {lateness.key === 'retard' ? `${lateness.label} (${lateness.lateMonths} mois)` : lateness.label}
                      </LabelText>
                    </View>
                    <LabelText>
                      {c.values.locataire_nom ? String(c.values.locataire_nom) : 'Vacant'} ·{' '}
                      {typeof c.values.loyer_mensuel === 'number' ? formatFcfa(c.values.loyer_mensuel) : '—'} / mois
                    </LabelText>
                  </Pressable>
                );
              })}
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
                  <View className="flex-row items-center justify-between p-gutter-card">
                    <View className="flex-1">
                      <SectionTitleText className="text-base" numberOfLines={1}>
                        {String(d.values.libelle ?? '')}
                      </SectionTitleText>
                      <LabelText>{d.values.date ? String(d.values.date) : ''}</LabelText>
                    </View>
                    <LabelText className="font-inter-semibold text-text-primary">
                      {typeof d.values.montant === 'number' ? formatFcfa(d.values.montant) : '—'}
                    </LabelText>
                  </View>
                </View>
              ))}
              <View className="h-px bg-border" />
              <View className="flex-row items-center justify-between p-gutter-card">
                <LabelText className="font-inter-semibold text-text-primary">Total dépenses</LabelText>
                <LabelText className="font-inter-semibold text-text-primary">{formatFcfa(totalDepenses)}</LabelText>
              </View>
            </Card>
          )}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}
