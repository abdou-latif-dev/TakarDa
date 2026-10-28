import { useCallback, useState } from 'react';
import { ScrollView, View } from 'react-native';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import * as Clipboard from 'expo-clipboard';
import { SafeAreaView } from 'react-native-safe-area-context';
import { AppHeader } from '@/components/ui/AppHeader';
import { DestructiveButton, PrimaryButton, SecondaryButton } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Dialog } from '@/components/ui/Dialog';
import { LoadingState } from '@/components/ui/States';
import { BodyMdText, LabelText, SectionTitleText } from '@/components/ui/Typography';
import { Colors } from '@/constants/theme';
import { isTenantAccessActive, type MemberDoc, type RequestDoc } from '@/services/sharedModules/model';
import { sharedModules, type ContractChoice, type OwnerView } from '@/services/sharedModulesService';
import { useCloudStore } from '@/store/cloudStore';
import { ContractPickerDialog } from '../components/ContractPickerDialog';

const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' }) : '—');
const day = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString('fr-FR') : 'sans date de fin');

function memberStatus(m: MemberDoc, nowDate: Date): { text: string; color: string } {
  if (m.state === 'revoked') return { text: 'Accès retiré', color: Colors.error };
  if (m.state === 'left') return { text: 'A quitté l’espace', color: Colors.textMuted };
  return isTenantAccessActive(m, nowDate) ? { text: 'Accès actif', color: Colors.success } : { text: 'Accès expiré', color: Colors.warning };
}

type Picker = { kind: 'approve'; request: RequestDoc } | { kind: 'contract'; member: MemberDoc } | null;

/** Espace dont je suis le propriétaire : identifiant à donner, demandes à traiter, membres (locataires) et fins d'accès. */
export function SharedModuleOwnerScreen() {
  const { moduleId } = useLocalSearchParams<{ moduleId: string }>();
  const uid = useCloudStore((s) => s.user?.uid ?? null);
  const [name, setName] = useState<string | null>(null);
  const [view, setView] = useState<OwnerView | null>(null);
  const [contracts, setContracts] = useState<ContractChoice[]>([]);
  const [message, setMessage] = useState<{ text: string; ok: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  const [picker, setPicker] = useState<Picker>(null);
  const [confirmRevoke, setConfirmRevoke] = useState<MemberDoc | null>(null);
  const [confirmDeleteSpace, setConfirmDeleteSpace] = useState(false);

  const load = useCallback(async () => {
    if (!uid || !moduleId) return;
    const [local, choices] = await Promise.all([sharedModules.listLocal().catch(() => null), sharedModules.contracts().catch(() => [] as ContractChoice[])]);
    setName(local?.owned.find((o) => o.moduleId === moduleId)?.name ?? null);
    setContracts(choices);
    await sharedModules.reconcileAccessEnds(uid, moduleId); // pose la fin d'accès (fin de contrat + 90 jours) des contrats terminés ; meilleur effort
    const result = await sharedModules.ownerView(uid, moduleId);
    if (result.ok) setView(result.value);
    else setMessage({ text: result.message, ok: false });
    // met à jour la vue de chaque locataire (seulement ce qui a changé) et retire celle des accès terminés ; un échec est signalé, jamais passé sous silence
    const published = await sharedModules.publishViews(uid, moduleId);
    if (!published.ok) setMessage({ text: published.message, ok: false });
    else if (published.value.failed > 0) setMessage({ text: `La vue de ${published.value.failed} locataire(s) n’a pas pu être mise à jour : touchez « Mettre à jour la vue des locataires ».`, ok: false });
  }, [uid, moduleId]);
  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  if (!uid || !moduleId) return null;
  const labelOf = (memberUid: string): string => view?.requests.find((r) => r.uid === memberUid)?.label ?? 'Locataire sans nom';
  const contractLabel = (id: string | null): string => (id ? (contracts.find((c) => c.id === id)?.label ?? 'Contrat introuvable') : 'Aucun contrat');

  const act = async (work: () => Promise<{ ok: boolean; message?: string }>, success: string) => {
    setBusy(true);
    setMessage(null);
    const result = await work();
    setMessage({ text: result.ok ? success : (result.message ?? 'Action impossible.'), ok: result.ok });
    await load();
    setBusy(false);
  };

  const onPick = async (contract: ContractChoice) => {
    const current = picker;
    setPicker(null);
    if (!current) return;
    if (current.kind === 'approve') await act(() => sharedModules.approve(uid, moduleId, current.request.uid, contract.id), 'Demande approuvée : le locataire a maintenant accès à son espace en lecture seule.');
    else await act(() => sharedModules.setContract(uid, moduleId, current.member.uid, contract.id), 'Contrat mis à jour.');
  };

  const nowDate = new Date();
  const pending = view?.requests.filter((r) => r.state === 'pending') ?? [];
  const refused = view?.requests.filter((r) => r.state === 'refused') ?? [];

  return (
    <SafeAreaView className="flex-1 bg-background" edges={['top', 'bottom']}>
      <AppHeader title={name ?? 'Espace partagé'} showBack />
      <ScrollView contentContainerClassName="w-full max-w-3xl gap-5 self-center px-page-margin pb-10">
        {message ? <LabelText style={{ color: message.ok ? Colors.success : Colors.error }}>{message.text}</LabelText> : null}

        <Card className="gap-3">
          <SectionTitleText className="text-base">Identifiant de l’espace</SectionTitleText>
          <BodyMdText selectable>{moduleId}</BodyMdText>
          <LabelText>Donnez cet identifiant à votre locataire : il lui permet de faire une demande, jamais d’entrer sans votre accord.</LabelText>
          <SecondaryButton label="Copier l’identifiant" icon="content-copy" onPress={() => void Clipboard.setStringAsync(moduleId).then(() => setMessage({ text: 'Identifiant copié.', ok: true }))} />
        </Card>

        {!view ? <LoadingState /> : null}

        {view ? (
          <>
            <Card className="gap-3">
              <SectionTitleText className="text-base">Demandes en attente</SectionTitleText>
              {pending.length === 0 ? <LabelText>Aucune demande en attente.</LabelText> : null}
              {pending.map((r) => (
                <View key={r.uid} className="gap-2 rounded-md border border-border p-3">
                  <BodyMdText className="text-text-primary">{r.label ?? 'Personne sans nom'}</BodyMdText>
                  <LabelText>Demande du {when(r.createdAt)}. Vérifiez que vous connaissez cette personne avant d’approuver.</LabelText>
                  <PrimaryButton label="Approuver…" icon="check" disabled={busy} onPress={() => setPicker({ kind: 'approve', request: r })} />
                  <SecondaryButton label="Refuser" disabled={busy} onPress={() => void act(() => sharedModules.refuse(uid, moduleId, r.uid), 'Demande refusée.')} />
                </View>
              ))}
              {refused.map((r) => (
                <View key={r.uid} className="gap-2 rounded-md border border-border p-3">
                  <BodyMdText className="text-text-primary">{r.label ?? 'Personne sans nom'}</BodyMdText>
                  <LabelText>Demande refusée. Cette personne ne peut pas redemander tant que vous n’effacez pas la demande.</LabelText>
                  <SecondaryButton label="Effacer (permet de redemander)" disabled={busy} onPress={() => void act(() => sharedModules.clearRequest(uid, moduleId, r.uid), 'Demande effacée.')} />
                </View>
              ))}
            </Card>

            <Card className="gap-3">
              <SectionTitleText className="text-base">Locataires de cet espace</SectionTitleText>
              {view.members.length === 0 ? <LabelText>Aucun locataire.</LabelText> : null}
              {view.members.map((m) => {
                const status = memberStatus(m, nowDate);
                return (
                  <View key={m.uid} className="gap-2 rounded-md border border-border p-3">
                    <BodyMdText className="text-text-primary">{labelOf(m.uid)}</BodyMdText>
                    <LabelText style={{ color: status.color }}>{status.text}</LabelText>
                    <LabelText>Contrat : {contractLabel(m.contractId)} · fin d’accès : {day(m.accessUntil)}</LabelText>
                    {m.state === 'active' ? (
                      <>
                        <SecondaryButton label="Changer de contrat" disabled={busy} onPress={() => setPicker({ kind: 'contract', member: m })} />
                        <SecondaryButton label="Retirer l’accès" icon="block" disabled={busy} onPress={() => setConfirmRevoke(m)} />
                      </>
                    ) : (
                      <SecondaryButton label="Rétablir l’accès" disabled={busy} onPress={() => void act(() => sharedModules.reactivate(uid, moduleId, m), 'Accès rétabli.')} />
                    )}
                  </View>
                );
              })}
              <SecondaryButton label="Mettre à jour la vue des locataires" icon="sync" disabled={busy} onPress={() => void act(() => sharedModules.publishViews(uid, moduleId), 'Vue des locataires mise à jour.')} />
              <LabelText>Chaque locataire ne voit que SES informations (contrat, logement, paiements, avance, reçus), en lecture seule. Vos notes, dépenses, statistiques et autres locataires ne sont jamais publiés. La vue est mise à jour à l’ouverture de cet écran et après chaque action ici ; sans ouverture, elle reste celle de la dernière mise à jour.</LabelText>
              <LabelText>La fin d’accès est posée à l’ouverture de cet écran : fin du contrat + 90 jours. Retirer l’accès ne supprime jamais vos paiements ni votre historique.</LabelText>
            </Card>

            <Card className="gap-3">
              <SectionTitleText className="text-base">Supprimer cet espace</SectionTitleText>
              <BodyMdText>Vos locataires perdent aussitôt l’accès et toutes les informations de cet espace sont supprimées du cloud. Vos données dans l’application, sur ce téléphone, ne sont pas touchées.</BodyMdText>
              <DestructiveButton label="Supprimer cet espace" icon="delete-outline" disabled={busy} onPress={() => setConfirmDeleteSpace(true)} />
            </Card>
          </>
        ) : null}
      </ScrollView>

      <ContractPickerDialog
        visible={picker !== null}
        title={picker?.kind === 'approve' ? 'Approuver la demande' : 'Changer de contrat'}
        message={picker?.kind === 'approve' ? 'Choisissez le contrat de ce locataire : il ne verra que les informations de ce contrat, en lecture seule.' : 'Choisissez le nouveau contrat de ce locataire.'}
        choices={contracts}
        confirmLabel={picker?.kind === 'approve' ? 'Approuver' : 'Enregistrer'}
        busy={busy}
        onConfirm={(contract) => void onPick(contract)}
        onClose={() => setPicker(null)}
      />
      <Dialog
        visible={confirmDeleteSpace}
        onClose={() => setConfirmDeleteSpace(false)}
        title="Supprimer définitivement cet espace ?"
        message="L’espace est verrouillé puis supprimé : demandes, locataires, informations publiées. Vos locataires n’y ont plus accès. Cette suppression est irréversible. Vos contrats, paiements et autres données de l’application ne sont pas supprimés."
        actions={[
          {
            label: 'Supprimer définitivement',
            variant: 'destructive',
            onPress: () => {
              setConfirmDeleteSpace(false);
              void (async () => {
                setBusy(true);
                const result = await sharedModules.deleteModule(uid, moduleId);
                setBusy(false);
                if (result.ok) router.back();
                else setMessage({ text: result.message, ok: false });
              })();
            },
          },
          { label: 'Annuler', variant: 'secondary', onPress: () => setConfirmDeleteSpace(false) },
        ]}
      />
      <Dialog
        visible={confirmRevoke !== null}
        onClose={() => setConfirmRevoke(null)}
        title="Retirer l’accès ?"
        message="Le locataire perd immédiatement l’accès à son espace. Vos paiements et votre historique ne sont pas touchés ; vous pourrez rétablir l’accès."
        actions={[
          { label: 'Retirer l’accès', variant: 'destructive', onPress: () => { const m = confirmRevoke; setConfirmRevoke(null); if (m) void act(() => sharedModules.revoke(uid, moduleId, m.uid), 'Accès retiré.'); } },
          { label: 'Annuler', variant: 'secondary', onPress: () => setConfirmRevoke(null) },
        ]}
      />
    </SafeAreaView>
  );
}
