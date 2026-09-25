import { useEffect, useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { router } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { MaterialIcons } from '@expo/vector-icons';
import { AppHeader } from '@/components/ui/AppHeader';
import { IconButton, SecondaryButton } from '@/components/ui/Button';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { EmptyState, ErrorState, LoadingState } from '@/components/ui/States';
import { SectionTitleText, LabelText } from '@/components/ui/Typography';
import { Colors } from '@/constants/theme';
import type { StatusKind } from '@/constants/theme';
import { formatFcfa, formatRelativeTime } from '@/utils/format';
import { useCoreStore } from '@/store/coreStore';
import { ensureFacturesTool } from '@/services/facturesService';
import { useFocusEffect } from 'expo-router';
import { useCallback } from 'react';

const STATUS_MAP: Record<string, StatusKind> = {
  payee: 'paid',
  a_payer: 'pending',
  partielle: 'pending',
  en_retard: 'late',
};

/** First screen built entirely on the Core engine (Tool/EntityDefinition/RecordItem) — see services/facturesService.ts. */
export function FacturesListScreen() {
  const [toolId, setToolId] = useState<string | null>(null);
  const [entityDefinitionId, setEntityDefinitionId] = useState<string | null>(null);
  const { records, recordsStatus, fetchRecords } = useCoreStore();

  useEffect(() => {
    ensureFacturesTool().then(({ tool, entityDefinition }) => {
      setToolId(tool.id);
      setEntityDefinitionId(entityDefinition.id);
      fetchRecords({ toolId: tool.id, entityDefinitionId: entityDefinition.id });
    });
  }, [fetchRecords]);

  useFocusEffect(useCallback(() => {
    if (toolId && entityDefinitionId) fetchRecords({ toolId, entityDefinitionId });
  }, [toolId, entityDefinitionId, fetchRecords]));

  const key = toolId && entityDefinitionId ? `${toolId}:${entityDefinitionId}` : null;
  const list = key ? (records[key] ?? []) : [];
  const status = key ? recordsStatus[key] : 'loading';

  return (
    <SafeAreaView className="flex-1 bg-background" edges={['top', 'bottom']}>
      <AppHeader title="Factures" showBack trailing={<IconButton icon="add" onPress={() => router.push('/factures/new')} />} />
      <ScrollView contentContainerClassName="gap-3 px-page-margin pb-10" showsVerticalScrollIndicator={false}>
        <View className="flex-row gap-3"><View className="flex-1"><SecondaryButton label="Cahier d’index" icon="speed" onPress={() => router.push('/factures/releves')} /></View><View className="flex-1"><SecondaryButton label="Personnaliser" icon="tune" onPress={() => toolId && entityDefinitionId && router.push({ pathname: '/schema/customize' as never, params: { toolId, entityDefinitionId } })} /></View></View>
        {status === 'loading' && list.length === 0 && <LoadingState />}
        {status === 'error' && (
          <ErrorState onRetry={() => toolId && entityDefinitionId && fetchRecords({ toolId, entityDefinitionId })} />
        )}
        {status === 'success' && list.length === 0 && (
          <EmptyState
            icon="receipt-long"
            title="Aucune facture"
            description="Ajoutez votre première facture CEET, TDE ou autre pour commencer le suivi."
            actionLabel="Ajouter une facture"
            onAction={() => router.push('/factures/new')}
          />
        )}
        {list.map((record) => (
          <Pressable
            key={record.id}
            onPress={() => router.push(`/factures/${record.id}`)}
            className="flex-row items-center gap-3 rounded-xl border border-border bg-surface p-gutter-card shadow-soft active:opacity-90">
            <View className="h-11 w-11 items-center justify-center rounded-full bg-primary-soft">
              <MaterialIcons name="receipt-long" size={20} color={Colors.primary} />
            </View>
            <View className="flex-1">
              <SectionTitleText className="text-base" numberOfLines={1}>
                {String(record.values.fournisseur ?? 'Facture')} · {String(record.values.mois ?? record.values.reference_compteur ?? '')}
              </SectionTitleText>
              <LabelText>
                {typeof record.values.montant === 'number' ? formatFcfa(record.values.montant) : '—'} ·{' '}
                {String(record.values.reference_compteur ?? formatRelativeTime(record.updatedAt))}
                {record.values.bien_nom ? ` · ${String(record.values.bien_nom)}` : ''}
              </LabelText>
            </View>
            {record.statusKey && <StatusBadge status={STATUS_MAP[record.statusKey] ?? 'pending'} />}
          </Pressable>
        ))}
      </ScrollView>
    </SafeAreaView>
  );
}
