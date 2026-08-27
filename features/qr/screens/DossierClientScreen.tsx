import { useEffect, useMemo, useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { AppHeader } from '@/components/ui/AppHeader';
import { Avatar } from '@/components/ui/Avatar';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { Card } from '@/components/ui/Card';
import { PrimaryButton, SecondaryButton, DestructiveButton } from '@/components/ui/Button';
import { LoadingState, ErrorState, EmptyState } from '@/components/ui/States';
import { BodyLgText, BodyMdText, ButtonLabelText, LabelText } from '@/components/ui/Typography';
import { cn } from '@/utils/cn';
import { formatRelativeTime } from '@/utils/format';
import { useSubmissionStore } from '@/store/submissionStore';
import { useFormStore } from '@/store/formStore';
import type { FieldType } from '@/types/entities';

const TABS = ['Identité', 'Contact', 'Informations', 'Documents', 'Historique'] as const;
type Tab = (typeof TABS)[number];

const TAB_FOR_TYPE: Record<FieldType, Tab> = {
  text: 'Identité',
  date: 'Identité',
  time: 'Identité',
  choice: 'Identité',
  select: 'Identité',
  checkbox: 'Informations',
  section: 'Informations',
  number: 'Informations',
  signature: 'Informations',
  email: 'Contact',
  phone: 'Contact',
  file: 'Documents',
  image: 'Documents',
};

const STATUS_MAP = { pending: 'pending', validated: 'validated', rejected: 'rejected', correction_requested: 'pending' } as const;

export function DossierClientScreen() {
  const { submissionId } = useLocalSearchParams<{ submissionId: string }>();
  const { activeSubmission, fetchOne } = useSubmissionStore();
  const { activeForm, fetchForm } = useFormStore();
  const [tab, setTab] = useState<Tab>('Identité');

  useEffect(() => {
    fetchOne(submissionId);
  }, [submissionId, fetchOne]);

  useEffect(() => {
    if (activeSubmission?.formId) fetchForm(activeSubmission.formId);
  }, [activeSubmission?.formId, fetchForm]);

  const rows = useMemo(() => {
    if (!activeSubmission || !activeForm) return [];
    return activeForm.fields
      .filter((f) => f.type !== 'section')
      .map((field) => {
        const answer = activeSubmission.answers.find((a) => a.fieldId === field.id);
        return { field, tab: TAB_FOR_TYPE[field.type], value: answer?.value };
      });
  }, [activeSubmission, activeForm]);

  if (!activeSubmission) {
    return (
      <SafeAreaView className="flex-1 bg-white" edges={['top', 'bottom']}>
        <AppHeader showBack />
        <View className="px-page-margin">
          <LoadingState />
        </View>
      </SafeAreaView>
    );
  }

  const tabRows = rows.filter((r) => r.tab === tab);
  const documentsCount = rows.filter((r) => r.tab === 'Documents').length;
  const isPending = activeSubmission.status === 'pending';

  return (
    <SafeAreaView className="flex-1 bg-white" edges={['top', 'bottom']}>
      <AppHeader title="Dossier client" showBack />
      <View className="items-center gap-2 px-page-margin pt-2">
        <Avatar name={activeSubmission.clientName} size={64} />
        <BodyLgText className="font-inter-semibold text-lg">{activeSubmission.clientName}</BodyLgText>
        <LabelText>ID : {activeSubmission.qrToken}</LabelText>
        <StatusBadge status={STATUS_MAP[activeSubmission.status]} />
      </View>

      <View className="mt-4 flex-row border-b border-border px-page-margin">
        {TABS.map((t) => (
          <Pressable key={t} onPress={() => setTab(t)} className="mr-6 items-center gap-2 pb-3">
            <View className="flex-row items-center gap-1">
              <ButtonLabelText className={cn(t === tab ? 'text-primary' : 'text-text-secondary')}>{t}</ButtonLabelText>
              {t === 'Documents' && documentsCount > 0 && (
                <View className="h-4 min-w-4 items-center justify-center rounded-full bg-error px-1">
                  <LabelText className="text-[10px] text-white">{documentsCount}</LabelText>
                </View>
              )}
            </View>
            {t === tab && <View className="h-0.5 w-full rounded-full bg-primary" />}
          </Pressable>
        ))}
      </View>

      <ScrollView contentContainerClassName="gap-4 px-page-margin py-4" showsVerticalScrollIndicator={false}>
        {tab === 'Historique' ? (
          activeSubmission.history.length === 0 ? (
            <EmptyState icon="history" title="Aucun historique" description="Aucune action n'a encore été enregistrée sur ce dossier." compact />
          ) : (
            <Card className="gap-0 p-0">
              {[...activeSubmission.history]
                .sort((a, b) => (a.at < b.at ? 1 : -1))
                .map((entry, i, arr) => (
                  <View key={entry.id}>
                    {i > 0 && <View className="h-px bg-border" />}
                    <View className="flex-row items-start justify-between gap-3 p-gutter-card">
                      <View className="flex-1">
                        <BodyLgText className="font-inter-semibold">{entry.actorName}</BodyLgText>
                        {entry.note && <BodyMdText className="mt-0.5">{entry.note}</BodyMdText>}
                        <LabelText className="mt-1">{formatRelativeTime(entry.at)}</LabelText>
                      </View>
                      <StatusBadge status={entry.status === 'correction_requested' ? 'pending' : entry.status} />
                    </View>
                  </View>
                ))}
            </Card>
          )
        ) : tabRows.length === 0 ? (
          <ErrorState title="Aucune donnée" description="Rien à afficher dans cette section." />
        ) : (
          <Card className="gap-0 p-0">
            {tabRows.map((row, i) => (
              <View key={row.field.id}>
                {i > 0 && <View className="h-px bg-border" />}
                <View className="flex-row items-center justify-between p-gutter-card">
                  <LabelText className="flex-1 pr-3">{row.field.label}</LabelText>
                  <BodyLgText className="flex-1 text-right font-inter-semibold" numberOfLines={2}>
                    {row.value === null || row.value === undefined || row.value === '' ? '—' : String(row.value)}
                  </BodyLgText>
                </View>
              </View>
            ))}
          </Card>
        )}
      </ScrollView>

      {isPending ? (
        <View className="gap-3 border-t border-border px-page-margin pb-4 pt-4">
          <PrimaryButton
            label="Valider"
            icon="check-circle"
            iconPosition="left"
            onPress={() => router.push(`/modals/confirm-validation?submissionId=${submissionId}`)}
          />
          <View className="flex-row gap-3">
            <SecondaryButton label="Demander une correction" onPress={() => router.push(`/records/${submissionId}/reject?mode=correction`)} />
            <DestructiveButton
              label="Rejeter"
              icon="cancel"
              onPress={() => router.push(`/records/${submissionId}/reject`)}
              className="flex-1"
              fullWidth={false}
            />
          </View>
        </View>
      ) : (
        <View className="border-t border-border px-page-margin pb-4 pt-4">
          <LabelText className="text-center">
            Ce dossier a déjà été {activeSubmission.status === 'validated' ? 'validé' : 'traité'}.
          </LabelText>
        </View>
      )}
    </SafeAreaView>
  );
}
