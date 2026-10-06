import { useCallback, useRef, useState } from 'react';
import { ScrollView, View } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { router, useFocusEffect } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { AppHeader } from '@/components/ui/AppHeader';
import { Card } from '@/components/ui/Card';
import { PrimaryButton, SecondaryButton } from '@/components/ui/Button';
import { EmptyState, ErrorState, LoadingState } from '@/components/ui/States';
import { BodyMdText, LabelText, SectionTitleText } from '@/components/ui/Typography';
import { Colors } from '@/constants/theme';
import { periodeLabel } from '@/services/utilityBillingService';
import { attachLegacyGroup, listLegacyGroups, type AttachTarget, type LegacyGroup } from '@/services/utilityLegacyService';
import { listKnownContacts, listParticipations, type KnownContact, type UtilityModule, type UtilityParticipation } from '@/services/utilityParticipantsService';
import { friendlyMessage } from '../errors';
import { InlineNotice, type NoticeTone } from '../components/InlineNotice';
import { MODULE_META } from '../meta';

type Choice = { groupKey: string; target: AttachTarget; targetLabel: string };

/** Anciens relevés « saisie libre » d'un module : on les rattache, explicitement, à
 * une vraie personne. Rien n'est automatique et rien n'est fait par ressemblance de
 * nom. Un groupe dont un relevé est déjà utilisé par une facture validée ne peut pas
 * être rattaché (son historique reste intact). */
export function UtilityLegacyRelevesScreen({ module }: { module: UtilityModule }) {
  const meta = MODULE_META[module];
  const [groups, setGroups] = useState<LegacyGroup[] | null>(null);
  const [participants, setParticipants] = useState<UtilityParticipation[]>([]);
  const [known, setKnown] = useState<KnownContact[]>([]);
  const [open, setOpen] = useState<string | null>(null);
  const [choice, setChoice] = useState<Choice | null>(null);
  const [notice, setNotice] = useState<{ tone: NoticeTone; text: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(false);
  const scrollRef = useRef<ScrollView>(null);

  const load = useCallback(async () => {
    try {
      const [g, p, k] = await Promise.all([listLegacyGroups(module), listParticipations(module), listKnownContacts(module)]);
      setGroups(g);
      setParticipants(p);
      setKnown(k);
      setError(false);
    } catch {
      setError(true);
    }
  }, [module]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const showNotice = (n: { tone: NoticeTone; text: string }) => {
    setNotice(n);
    scrollRef.current?.scrollTo({ y: 0, animated: true });
  };

  const confirm = async () => {
    if (!choice) return;
    setSaving(true);
    try {
      const result = await attachLegacyGroup({ fournisseur: module, groupKey: choice.groupKey, target: choice.target });
      showNotice({ tone: 'success', text: `${result.attached} relevé${result.attached > 1 ? 's' : ''} rattaché${result.attached > 1 ? 's' : ''} à ${result.participation.displayName}.` });
      setChoice(null);
      setOpen(null);
    } catch (e) {
      showNotice({ tone: 'error', text: friendlyMessage(e) });
      setChoice(null);
    } finally {
      await load();
      setSaving(false);
    }
  };

  return (
    <SafeAreaView className="flex-1 bg-background" edges={['top', 'bottom']}>
      <AppHeader title={`Anciens relevés ${meta.label}`} showBack trailing={<MaterialIcons name={meta.icon} size={22} color={Colors.primary} />} />
      <ScrollView ref={scrollRef} contentContainerClassName="w-full max-w-3xl gap-4 self-center px-page-margin pb-10" showsVerticalScrollIndicator={false}>
        <LabelText>Ces relevés ont été saisis avec un simple nom. Rattachez-les à une personne pour les retrouver dans l&apos;écran Index et dans les calculs.</LabelText>
        {notice && <InlineNotice tone={notice.tone}>{notice.text}</InlineNotice>}

        {error ? (
          <ErrorState onRetry={load} />
        ) : !groups ? (
          <LoadingState />
        ) : groups.length === 0 ? (
          <EmptyState icon="task-alt" title="Rien à rattacher" description={`Aucun ancien relevé ${meta.label} en attente.`} compact />
        ) : (
          groups.map((g) => {
            const verrouille = g.lockedCount > 0;
            const doublon = g.doublons.length > 0;
            const isOpen = open === g.key;
            return (
              <Card key={g.key} className="gap-3">
                <View>
                  <SectionTitleText className="text-base" numberOfLines={2}>{g.label}</SectionTitleText>
                  <LabelText>
                    {g.releves.length} relevé{g.releves.length > 1 ? 's' : ''} · {g.periodes.map(periodeLabel).join(', ')}
                  </LabelText>
                </View>

                {verrouille ? (
                  <View className="flex-row items-start gap-2">
                    <MaterialIcons name="lock-outline" size={16} color={Colors.textMuted} style={{ marginTop: 1 }} />
                    <LabelText className="flex-1">
                      {g.lockedCount === g.releves.length ? 'Ces relevés ont' : `${g.lockedCount} de ces relevés ont`} déjà été utilisé{g.lockedCount > 1 ? 's' : ''} dans une facture validée : ils ne peuvent plus être modifiés ni rattachés.
                    </LabelText>
                  </View>
                ) : doublon ? (
                  <View className="flex-row items-start gap-2">
                    <MaterialIcons name="warning-amber" size={16} color={Colors.warning} style={{ marginTop: 1 }} />
                    <LabelText className="flex-1">Ce nom a deux saisies pour {g.doublons.map(periodeLabel).join(', ')} : impossible de les rattacher sans créer un doublon. Rien n’est modifié.</LabelText>
                  </View>
                ) : choice && choice.groupKey === g.key ? (
                  <View className="gap-3">
                    <BodyMdText className="text-text-primary">
                      Rattacher {g.releves.length} relevé{g.releves.length > 1 ? 's' : ''} à {choice.targetLabel} ? Ils seront désormais comptés pour cette personne.
                    </BodyMdText>
                    <View className="flex-row gap-3">
                      <View className="flex-1"><SecondaryButton label="Annuler" disabled={saving} onPress={() => setChoice(null)} /></View>
                      <View className="flex-1"><PrimaryButton label="Rattacher" loading={saving} onPress={confirm} /></View>
                    </View>
                  </View>
                ) : (
                  <>
                    <SecondaryButton label={isOpen ? 'Fermer' : 'Rattacher à une personne'} icon="link" onPress={() => setOpen(isOpen ? null : g.key)} />
                    {isOpen && (
                      <View className="gap-3">
                        <SecondaryButton
                          label={`Créer « ${g.label} » comme nouvelle personne`}
                          icon="person-add"
                          onPress={() => setChoice({ groupKey: g.key, target: { type: 'nouvelle' }, targetLabel: `une nouvelle personne « ${g.label} »` })}
                        />
                        {participants.length > 0 && <LabelText className="font-inter-semibold text-text-primary">Participants {meta.label}</LabelText>}
                        {participants.map((p) => (
                          <SecondaryButton
                            key={p.record.id}
                            label={p.phone ? `${p.displayName} · ${p.phone}` : p.displayName}
                            onPress={() => setChoice({ groupKey: g.key, target: { type: 'participation', participationId: p.record.id }, targetLabel: p.displayName })}
                          />
                        ))}
                        {known.length > 0 && <LabelText className="font-inter-semibold text-text-primary">Autres personnes connues</LabelText>}
                        {known.map((c) => (
                          <SecondaryButton
                            key={c.id}
                            label={c.phone ? `${c.name} · ${c.phone}` : c.name}
                            onPress={() => setChoice({ groupKey: g.key, target: { type: 'contact', contactId: c.id }, targetLabel: c.name })}
                          />
                        ))}
                      </View>
                    )}
                  </>
                )}
              </Card>
            );
          })
        )}

        <SecondaryButton label={`Index ${meta.label}`} icon={meta.icon} onPress={() => router.replace(`/${module}/releves` as never)} />
      </ScrollView>
    </SafeAreaView>
  );
}
