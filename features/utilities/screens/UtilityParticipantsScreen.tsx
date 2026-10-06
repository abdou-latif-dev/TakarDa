import { useCallback, useRef, useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, View } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { AppHeader } from '@/components/ui/AppHeader';
import { Card } from '@/components/ui/Card';
import { Chip } from '@/components/ui/Chip';
import { PrimaryButton, SecondaryButton } from '@/components/ui/Button';
import { TextField } from '@/components/ui/TextField';
import { ErrorState, LoadingState } from '@/components/ui/States';
import { BodyMdText, LabelText, SectionTitleText } from '@/components/ui/Typography';
import {
  addContratParticipant,
  addExistingContact,
  addParticipant,
  archiveParticipation,
  listImmobilierCandidates,
  listKnownContacts,
  listParticipations,
  restoreParticipation,
  type ImmobilierCandidate,
  type KnownContact,
  type UtilityModule,
  type UtilityParticipation,
} from '@/services/utilityParticipantsService';
import { friendlyMessage } from '../errors';
import { InlineNotice, type NoticeTone } from '../components/InlineNotice';
import { MODULE_META } from '../meta';

type AddMode = 'new' | 'known';

/** Participants d'un module (CEET ou TDE).
 *
 * Une PERSONNE (ExternalContact) est unique ; sa PARTICIPATION à CEET ou à TDE
 * est un lien distinct. On peut donc créer une nouvelle personne OU ajouter une
 * personne déjà connue (jamais dupliquée). Le nom affiché est toujours le nom
 * actuel de la personne. Retirer un participant l'archive : ses relevés et son
 * historique restent. Les messages s'affichent dans l'écran (mobile et web). */
export function UtilityParticipantsScreen({ module }: { module: UtilityModule }) {
  const meta = MODULE_META[module];
  const [active, setActive] = useState<UtilityParticipation[]>([]);
  const [archived, setArchived] = useState<UtilityParticipation[]>([]);
  const [known, setKnown] = useState<KnownContact[]>([]);
  const [candidates, setCandidates] = useState<ImmobilierCandidate[]>([]);
  const [mode, setMode] = useState<AddMode>('new');
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ tone: NoticeTone; text: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const scrollRef = useRef<ScrollView>(null);
  // Le message est en haut de l'écran : on y remonte pour qu'il soit toujours vu.
  const showNotice = (n: { tone: NoticeTone; text: string }) => {
    setNotice(n);
    scrollRef.current?.scrollTo({ y: 0, animated: true });
  };

  const load = useCallback(async () => {
    try {
      const [all, people, immo] = await Promise.all([listParticipations(module, { includeArchived: true }), listKnownContacts(module), listImmobilierCandidates(module)]);
      setActive(all.filter((p) => !p.archived));
      setArchived(all.filter((p) => p.archived));
      setKnown(people);
      setCandidates(immo);
      setError(false);
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, [module]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const run = async (action: () => Promise<string | void>, onDone?: () => void) => {
    setSaving(true);
    setNotice(null);
    try {
      const success = await action();
      onDone?.();
      if (success) showNotice({ tone: 'success', text: success });
      await load();
    } catch (e) {
      showNotice({ tone: 'error', text: friendlyMessage(e) });
    } finally {
      setSaving(false);
    }
  };

  const onAddNew = () =>
    run(
      async () => {
        const p = await addParticipant(module, { name, phone });
        return `${p.displayName} participe maintenant à ${meta.label}.`;
      },
      () => {
        setName('');
        setPhone('');
      },
    );

  const secondary = (p: { phone: string | null }, extra?: string) => [p.phone, extra].filter(Boolean).join(' · ');

  return (
    <SafeAreaView className="flex-1 bg-background" edges={['top', 'bottom']}>
      <AppHeader title={`Participants ${meta.label}`} showBack />
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} className="flex-1">
        <ScrollView ref={scrollRef} contentContainerClassName="w-full max-w-3xl gap-5 self-center px-page-margin pb-10" keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
          {notice && <InlineNotice tone={notice.tone}>{notice.text}</InlineNotice>}
          {error ? (
            <ErrorState onRetry={load} />
          ) : loading ? (
            <LoadingState />
          ) : (
            <>
              <View className="gap-3">
                <SectionTitleText className="text-base">Participants ({active.length})</SectionTitleText>
                {active.length === 0 ? (
                  <BodyMdText>Aucun participant pour l&apos;instant. Ajoutez les personnes concernées par la facture {meta.label}.</BodyMdText>
                ) : (
                  <Card className="gap-0 p-0">
                    {active.map((p, i) => (
                      <View key={p.record.id}>
                        {i > 0 && <View className="h-px bg-border" />}
                        {confirmId === p.record.id ? (
                          <View className="gap-3 p-gutter-card">
                            <BodyMdText className="text-text-primary">
                              Retirer {p.displayName} de {meta.label} ? Ses relevés et son historique sont conservés.
                            </BodyMdText>
                            <View className="flex-row gap-3">
                              <View className="flex-1"><SecondaryButton label="Annuler" onPress={() => setConfirmId(null)} /></View>
                              <View className="flex-1">
                                <PrimaryButton label="Retirer" loading={saving} onPress={() => run(async () => { await archiveParticipation(p.record.id); return `${p.displayName} ne participe plus à ${meta.label}.`; }, () => setConfirmId(null))} />
                              </View>
                            </View>
                          </View>
                        ) : (
                          <View className="flex-row items-center gap-3 p-gutter-card">
                            <View className="flex-1">
                              <SectionTitleText className="text-base" numberOfLines={1}>{p.displayName}</SectionTitleText>
                              <LabelText numberOfLines={1}>{secondary(p, p.source === 'immobilier' ? 'Locataire (Immobilier)' : undefined) || 'Participant'}</LabelText>
                            </View>
                            <SecondaryButton label="Retirer" icon="close" fullWidth={false} className="px-3" disabled={saving} onPress={() => setConfirmId(p.record.id)} />
                          </View>
                        )}
                      </View>
                    ))}
                  </Card>
                )}
              </View>

              <Card className="gap-4">
                <SectionTitleText className="text-base">Ajouter une personne</SectionTitleText>
                <View className="flex-row flex-wrap gap-2">
                  <Chip label="Nouvelle personne" active={mode === 'new'} onPress={() => setMode('new')} />
                  <Chip label={`Personne déjà connue (${known.length})`} active={mode === 'known'} onPress={() => setMode('known')} />
                </View>
                {mode === 'new' ? (
                  <>
                    <TextField label="Nom et prénom" value={name} onChangeText={setName} autoCapitalize="words" />
                    <TextField label="Téléphone (facultatif)" value={phone} onChangeText={setPhone} keyboardType="phone-pad" />
                    <PrimaryButton label="Ajouter" disabled={!name.trim()} loading={saving} onPress={onAddNew} />
                  </>
                ) : known.length === 0 ? (
                  <BodyMdText>Aucune autre personne connue pour l&apos;instant : toutes participent déjà à {meta.label}.</BodyMdText>
                ) : (
                  <View className="gap-0">
                    <LabelText className="pb-2">Une même personne peut participer à CEET et à TDE : elle n&apos;est pas recréée.</LabelText>
                    {known.map((c, i) => (
                      <View key={c.id}>
                        {i > 0 && <View className="h-px bg-border" />}
                        <View className="flex-row items-center gap-3 py-3">
                          <View className="flex-1">
                            <SectionTitleText className="text-base" numberOfLines={1}>{c.name}</SectionTitleText>
                            {c.phone ? <LabelText numberOfLines={1}>{c.phone}</LabelText> : null}
                          </View>
                          <SecondaryButton
                            label="Ajouter"
                            icon="add"
                            fullWidth={false}
                            className="px-3"
                            disabled={saving}
                            onPress={() => run(async () => { const p = await addExistingContact(module, c.id); return `${p.displayName} participe maintenant à ${meta.label}.`; })}
                          />
                        </View>
                      </View>
                    ))}
                  </View>
                )}
              </Card>

              {candidates.length > 0 && (
                <View className="gap-3">
                  <SectionTitleText className="text-base">Depuis Immobilier</SectionTitleText>
                  <LabelText>Locataires actuels : aucune ressaisie.</LabelText>
                  <Card className="gap-0 p-0">
                    {candidates.map((c, i) => (
                      <View key={c.contratId}>
                        {i > 0 && <View className="h-px bg-border" />}
                        <View className="flex-row items-center gap-3 p-gutter-card">
                          <SectionTitleText className="flex-1 text-base" numberOfLines={1}>{c.label}</SectionTitleText>
                          <SecondaryButton
                            label="Ajouter"
                            icon="add"
                            fullWidth={false}
                            className="px-3"
                            disabled={saving}
                            onPress={() => run(async () => { const p = await addContratParticipant(module, c.contratId); return `${p.displayName} participe maintenant à ${meta.label}.`; })}
                          />
                        </View>
                      </View>
                    ))}
                  </Card>
                </View>
              )}

              {archived.length > 0 && (
                <View className="gap-3">
                  <SectionTitleText className="text-base">Retirés</SectionTitleText>
                  <Card className="gap-0 p-0">
                    {archived.map((p, i) => (
                      <View key={p.record.id}>
                        {i > 0 && <View className="h-px bg-border" />}
                        <View className="flex-row items-center gap-3 p-gutter-card">
                          <View className="flex-1">
                            <SectionTitleText className="text-base" numberOfLines={1}>{p.displayName}</SectionTitleText>
                            {p.phone ? <LabelText numberOfLines={1}>{p.phone}</LabelText> : null}
                          </View>
                          <SecondaryButton label="Rétablir" fullWidth={false} className="px-3" disabled={saving} onPress={() => run(async () => { await restoreParticipation(p.record.id); return `${p.displayName} participe de nouveau à ${meta.label}.`; })} />
                        </View>
                      </View>
                    ))}
                  </Card>
                </View>
              )}

              {/* Navigation entre sœurs : on remplace l'écran au lieu d'empiler. */}
              <SecondaryButton label={`Index ${meta.label}`} icon={meta.icon} onPress={() => router.replace(`/${module}/releves` as never)} />
            </>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
