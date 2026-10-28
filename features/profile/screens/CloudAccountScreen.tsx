import { useEffect, useState } from 'react';
import { ScrollView, View } from 'react-native';
import { router } from 'expo-router';
import { MaterialIcons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import { AppHeader } from '@/components/ui/AppHeader';
import { DestructiveButton, PrimaryButton, SecondaryButton } from '@/components/ui/Button';
import { TextField } from '@/components/ui/TextField';
import { Card } from '@/components/ui/Card';
import { Dialog } from '@/components/ui/Dialog';
import { BodyMdText, LabelText, SectionTitleText } from '@/components/ui/Typography';
import { Colors } from '@/constants/theme';
import { coreService } from '@/services/coreService';
import { describeRecovery } from '@/services/accountDeletionRecovery';
import { hiddenOwnerSummary } from '@/services/cloudSyncService';
import { useCloudStore } from '@/store/cloudStore';
import { LegacyAdoptionCard } from '../components/LegacyAdoptionCard';
import { activateEngine, engineActivationState, type EngineActivationState } from '@/services/syncLifecycle';

function Row({ label, value }: { label: string; value: string }) {
  return (
    <View className="flex-row items-center justify-between gap-3">
      <LabelText>{label}</LabelText>
      <LabelText className="flex-1 text-right font-inter-semibold text-text-primary" numberOfLines={2}>{value}</LabelText>
    </View>
  );
}

const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' }) : 'Jamais');

/** Compte cloud facultatif et synchronisation des biens et logements. Les paiements, avances, reçus, CEET, TDE et
 * tontines ne sont pas concernés. Rien n’est envoyé sans une action de votre part. */
export function CloudAccountScreen() {
  const s = useCloudStore();
  const [confirmEnable, setConfirmEnable] = useState(false);
  const [confirmSignOut, setConfirmSignOut] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [password, setPassword] = useState('');
  const [confirmRelease, setConfirmRelease] = useState(false);
  // Nouveau moteur de synchronisation : état local (choix persistant, V1 active ?) et activation explicite.
  const [engine, setEngine] = useState<EngineActivationState | null>(null);
  const [confirmEngine, setConfirmEngine] = useState(false);
  const [engineBusy, setEngineBusy] = useState(false);
  const [engineMessage, setEngineMessage] = useState<string | null>(null);
  const uid = s.user?.uid ?? null;
  useEffect(() => {
    let alive = true;
    setEngine(null);
    if (uid) void engineActivationState(uid).then((state) => alive && setEngine(state)).catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [uid, s.syncEnabled]);
  const runEngineActivation = async () => {
    if (!uid) return;
    setConfirmEngine(false);
    setEngineBusy(true);
    const result = await activateEngine(uid);
    setEngineMessage(result.ok ? 'Nouveau moteur activé. Vos anciennes données n’ont pas été envoyées.' : result.message);
    setEngine(await engineActivationState(uid).catch(() => null));
    setEngineBusy(false);
  };
  // Enregistrements masqués parce qu'ils appartiennent à un autre compte (ex. compte supprimé depuis un autre appareil).
  const hidden = hiddenOwnerSummary(s.user?.uid ?? null); // recalculé à chaque affichage (parcours local, sans réseau)
  const outcome = s.deletion;
  const outcomeColor = outcome?.status === 'completed' ? Colors.success : Colors.warning;
  const recovery = s.deletionMarker ? describeRecovery(s.deletionMarker) : null;
  const canRetry = outcome && outcome.status !== 'completed' && s.authStatus === 'signedIn';

  const runDelete = async () => {
    const pwd = password;
    setPassword(''); // le mot de passe n'est conservé nulle part
    setConfirmDelete(false);
    await s.deleteAccount(pwd);
  };
  const [names, setNames] = useState<Record<string, string>>({});

  // Noms des enregistrements en conflit (pour que l’utilisateur sache de quoi il s’agit).
  const conflictKey = s.conflicts.join(',');
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const entries: Record<string, string> = {};
      for (const id of s.conflicts) {
        const record = await coreService.getRecord(id);
        entries[id] = String(record?.values.nom ?? 'Enregistrement');
      }
      if (!cancelled) setNames(entries);
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- recalculé quand la liste des conflits change
  }, [conflictKey]);

  return (
    <SafeAreaView className="flex-1 bg-background" edges={['top', 'bottom']}>
      <AppHeader title="Compte et synchronisation" showBack />
      <ScrollView contentContainerClassName="w-full max-w-3xl gap-4 self-center px-page-margin pb-10" showsVerticalScrollIndicator={false}>
        <Card className="gap-2">
          <View className="flex-row items-center gap-2">
            <MaterialIcons name="info-outline" size={18} color={Colors.primary} />
            <SectionTitleText className="text-base">Un compte est facultatif</SectionTitleText>
          </View>
          <BodyMdText>
            TakarDa fonctionne sans compte : vos données restent sur cet appareil. Avec un compte vérifié, les données d’Immobilier créées après l’activation (biens, logements, contrats, locataires, paiements, dépenses) peuvent être retrouvées sur un autre téléphone.
            Les tontines, formulaires et factures CEET/TDE ne sont pas synchronisés.
          </BodyMdText>
        </Card>

        {s.error ? <LabelText className="font-inter-semibold" style={{ color: Colors.error }}>{s.error}</LabelText> : null}
        {s.notice ? <LabelText className="font-inter-semibold" style={{ color: Colors.success }}>{s.notice}</LabelText> : null}

        {outcome ? (
          <Card className="gap-2">
            <SectionTitleText className="text-base">{outcome.status === 'completed' ? 'Compte supprimé' : 'Suppression du compte'}</SectionTitleText>
            <LabelText className="font-inter-semibold" style={{ color: outcomeColor }}>{outcome.message}</LabelText>
            {canRetry ? <SecondaryButton label="Réessayer la suppression" icon="refresh" onPress={() => setConfirmDelete(true)} /> : null}
          </Card>
        ) : null}

        {/* Reprise après redémarrage : le journal local (persistant) subsiste alors que le résultat en mémoire a disparu. */}
        {!outcome && s.deletionMarker && s.authStatus === 'signedIn' ? (
          <Card className="gap-2">
            <SectionTitleText className="text-base">{recovery?.title}</SectionTitleText>
            <LabelText className="font-inter-semibold" style={{ color: Colors.warning }}>{recovery?.message}</LabelText>
            <SecondaryButton label="Reprendre la suppression" icon="refresh" loading={s.deleting} onPress={() => setConfirmDelete(true)} />
          </Card>
        ) : null}

        {s.authStatus === 'initializing' && <BodyMdText>Vérification de la session…</BodyMdText>}

        {s.authStatus === 'signedOut' && (
          <Card className="gap-3">
            <SectionTitleText className="text-base">Vous n’êtes pas connecté</SectionTitleText>
            <PrimaryButton label="Se connecter" icon="login" onPress={() => router.push('/(auth)/login')} />
            <SecondaryButton label="Créer un compte" icon="person-add" onPress={() => router.push('/(auth)/sign-up')} />
          </Card>
        )}

        {s.authStatus === 'signedIn' && s.user && (
          <>
            <Card className="gap-3">
              <SectionTitleText className="text-base">Compte</SectionTitleText>
              <Row label="Adresse e-mail" value={`${s.user.email ?? '—'} (${s.user.emailVerified ? 'vérifiée' : 'non vérifiée'})`} />
              <SecondaryButton label="Se déconnecter" icon="logout" loading={s.busy} onPress={() => setConfirmSignOut(true)} />
            </Card>

            {!s.user.emailVerified ? (
              <Card className="gap-3">
                <SectionTitleText className="text-base">Vérifiez votre adresse e-mail</SectionTitleText>
                <BodyMdText>
                  Votre adresse n’est pas encore vérifiée. Ouvrez le lien de confirmation envoyé à {s.user.email ?? 'votre adresse'}. La synchronisation reste indisponible tant que ce n’est pas fait.
                </BodyMdText>
                {s.verificationMessage ? <LabelText>{s.verificationMessage}</LabelText> : null}
                <PrimaryButton label="J’ai vérifié mon adresse" icon="check" loading={s.busy} onPress={() => void s.refreshVerification()} />
                <SecondaryButton label="Renvoyer l’e-mail" icon="mail-outline" disabled={s.busy} onPress={() => void s.resendVerification()} />
              </Card>
            ) : null}

            <Card className="gap-3">
              <SectionTitleText className="text-base">Synchronisation de mes données</SectionTitleText>
              {engine?.chosen ? (
                <BodyMdText>Activée pour ce compte. Seules les données d’Immobilier créées à partir de l’activation sont envoyées automatiquement ; vos anciennes données restent sur cet appareil tant que vous ne choisissez pas de les envoyer (carte ci-dessous).</BodyMdText>
              ) : engine?.v1Active ? (
                <BodyMdText>L’ancienne synchronisation (biens et logements) est active pour ce compte : le nouveau moteur n’est pas disponible tant qu’elle l’est.</BodyMdText>
              ) : (
                <>
                  <BodyMdText>Rien n’est envoyé tant que vous ne l’activez pas. À l’activation, vos anciennes données ne sont PAS envoyées automatiquement.</BodyMdText>
                  <PrimaryButton label="Activer le nouveau moteur" icon="cloud-sync" loading={engineBusy} disabled={!engine || !s.user.emailVerified} onPress={() => setConfirmEngine(true)} />
                  {!s.user.emailVerified ? <LabelText>Disponible une fois votre adresse e-mail vérifiée.</LabelText> : null}
                </>
              )}
              {engineMessage ? <LabelText>{engineMessage}</LabelText> : null}
            </Card>

            {engine?.chosen ? <LegacyAdoptionCard /> : null}

            {s.user.emailVerified ? (
              <Card className="gap-3">
                <SectionTitleText className="text-base">Espaces partagés</SectionTitleText>
                <BodyMdText>Partagez en lecture seule les informations d’un locataire avec lui, ou rejoignez l’espace de votre propriétaire. Rien ne s’ouvre sans l’approbation du propriétaire.</BodyMdText>
                <SecondaryButton label="Espaces partagés" icon="groups" onPress={() => router.push('/account/shared' as never)} />
              </Card>
            ) : null}

            {/* Ancienne synchronisation (biens et logements) : proposée UNIQUEMENT aux comptes qui l'utilisent déjà ; jamais à un nouveau compte (moteur unique). */}
            {s.syncEnabled ? (
            <Card className="gap-3">
              <SectionTitleText className="text-base">Biens et logements (ancienne synchronisation)</SectionTitleText>
              {(
                <>
                  <Row label="En attente d’envoi" value={String(s.pending)} />
                  <Row label="Conflits" value={String(s.conflicts.length)} />
                  <Row label="Dernière synchronisation" value={when(s.lastSyncAt)} />
                  {s.syncMessage ? <LabelText>{s.syncMessage}</LabelText> : null}
                  <PrimaryButton label="Synchroniser maintenant" icon="sync" loading={s.syncing} onPress={() => void s.syncNow()} />
                  <LabelText>
                    Un enregistrement est « Synchronisé » seulement après confirmation du cloud. Hors ligne, il reste « En attente » et repart tout seul.
                  </LabelText>
                </>
              )}
            </Card>
            ) : null}

            <Card className="gap-3">
              <SectionTitleText className="text-base">Supprimer mon compte</SectionTitleText>
              <BodyMdText>
                Supprime votre compte et vos données cloud (biens, logements, espace personnel). C’est irréversible. Vos données sur cet appareil sont conservées.
              </BodyMdText>
              <DestructiveButton label="Supprimer mon compte" icon="delete-forever" loading={s.deleting} onPress={() => setConfirmDelete(true)} />
            </Card>

            {s.syncEnabled && s.conflicts.length > 0 && (
              <Card className="gap-3">
                <SectionTitleText className="text-base">Conflits à résoudre</SectionTitleText>
                <BodyMdText>Ces enregistrements ont été modifiés ici et ailleurs. Choisissez la version à garder.</BodyMdText>
                {s.conflicts.map((id) => (
                  <View key={id} className="gap-2 border-t border-border pt-3">
                    <LabelText className="font-inter-semibold text-text-primary">{names[id] ?? 'Enregistrement'}</LabelText>
                    <SecondaryButton label="Garder la version du cloud" onPress={() => void s.resolve(id, 'cloud')} />
                    <SecondaryButton label="Garder ma version (remplace celle du cloud)" onPress={() => void s.resolve(id, 'local')} />
                  </View>
                ))}
              </Card>
            )}

            {s.syncEnabled && (
              <Card className="gap-3">
                <SectionTitleText className="text-base">Mes anciennes données</SectionTitleText>
                <BodyMdText>
                  Les biens et logements créés avant l’activation restent sur cet appareil. Vous pouvez les envoyer volontairement : un aperçu, une sauvegarde locale puis votre confirmation sont nécessaires.
                </BodyMdText>
                <SecondaryButton label="Voir ce qui peut être envoyé" icon="cloud-upload" onPress={() => void s.previewImport()} />
              </Card>
            )}
          </>
        )}

        {hidden.total > 0 && (
          <Card className="gap-3">
            <SectionTitleText className="text-base">Données d’un autre compte</SectionTitleText>
            <BodyMdText>
              {hidden.total} enregistrement(s) sur cet appareil appartiennent à un autre compte et sont masqués. Rien n’est supprimé : vous pouvez les rendre de nouveau locaux et visibles ici.
            </BodyMdText>
            <SecondaryButton label="Les rendre locaux" icon="visibility" onPress={() => setConfirmRelease(true)} />
          </Card>
        )}
      </ScrollView>

      <Dialog
        visible={confirmDelete}
        onClose={() => { setConfirmDelete(false); setPassword(''); }}
        title="Supprimer définitivement mon compte ?"
        message="Seront supprimés dans le cloud : votre compte (e-mail et connexion), votre espace personnel et vos données synchronisées. Vos espaces partagés sont supprimés avec eux : vos locataires perdent immédiatement l’accès à leurs informations, et vos demandes d’accès à des espaces d’autres personnes ne sont pas concernées. Cette suppression est irréversible. Seront conservées : toutes vos données sur cet appareil, qui resteront ici sans compte. Sur vos autres appareils, rien n’est effacé à distance : leurs données locales y restent (elles pourront être rendues visibles depuis cet écran). Pour confirmer, saisissez votre mot de passe."
        actions={[
          { label: 'Supprimer définitivement', variant: 'destructive', loading: s.deleting, onPress: () => { if (password) void runDelete(); } },
          { label: 'Annuler', variant: 'secondary', onPress: () => { setConfirmDelete(false); setPassword(''); } },
        ]}
      >
        <TextField label="Mot de passe" secureToggle value={password} onChangeText={setPassword} autoCapitalize="none" autoCorrect={false} />
      </Dialog>
      <Dialog
        visible={confirmRelease}
        onClose={() => setConfirmRelease(false)}
        title="Rendre ces données locales ?"
        message="Ces enregistrements deviendront de simples données locales, visibles par toute personne qui utilise cet appareil. Rien n’est supprimé et rien n’est envoyé dans le cloud."
        actions={[
          { label: 'Rendre locaux', onPress: () => { setConfirmRelease(false); void s.releaseHiddenData(); } },
          { label: 'Annuler', variant: 'secondary', onPress: () => setConfirmRelease(false) },
        ]}
      />
      <Dialog
        visible={confirmEngine}
        onClose={() => setConfirmEngine(false)}
        title="Activer le nouveau moteur ?"
        message="Seules les données d’Immobilier créées à partir de maintenant seront envoyées à votre espace personnel. Vos anciennes données ne seront PAS envoyées automatiquement : elles restent sur cet appareil. Ce choix désactive l’ancienne synchronisation pour ce compte."
        actions={[
          { label: 'Activer', onPress: () => void runEngineActivation() },
          { label: 'Annuler', variant: 'secondary', onPress: () => setConfirmEngine(false) },
        ]}
      />
      <Dialog
        visible={confirmEnable}
        onClose={() => setConfirmEnable(false)}
        title="Activer la synchronisation ?"
        message="Vos biens et logements créés à partir de maintenant seront envoyés à votre espace personnel dans le cloud. Vos anciennes données restent sur cet appareil jusqu’à un envoi volontaire de votre part. Rien d’autre n’est synchronisé."
        actions={[
          { label: 'Activer', onPress: () => { setConfirmEnable(false); void s.enableSync(); } },
          { label: 'Annuler', variant: 'secondary', onPress: () => setConfirmEnable(false) },
        ]}
      />
      <Dialog
        visible={confirmSignOut}
        onClose={() => setConfirmSignOut(false)}
        title="Se déconnecter ?"
        message="Vos données restent sur cet appareil. La synchronisation s’arrête jusqu’à votre prochaine connexion."
        actions={[
          { label: 'Se déconnecter', onPress: () => { setConfirmSignOut(false); void s.signOut(); } },
          { label: 'Annuler', variant: 'secondary', onPress: () => setConfirmSignOut(false) },
        ]}
      />
      <Dialog
        visible={s.importPreview !== null}
        onClose={s.cancelImport}
        title="Envoyer mes anciennes données ?"
        message={
          s.importPreview && s.importPreview.ids.length > 0
            ? `${s.importPreview.biens} bien(s) et ${s.importPreview.logements} logement(s) seront envoyés à votre espace cloud. Une sauvegarde locale datée est créée avant l’envoi, et rien n’est modifié ni supprimé ici. Les contrats, paiements, avances et reçus ne sont pas envoyés.`
            : 'Il n’y a rien à envoyer : tous vos biens et logements sont déjà suivis.'
        }
        actions={
          s.importPreview && s.importPreview.ids.length > 0
            ? [
                { label: 'Envoyer', onPress: () => void s.confirmImport(), loading: s.busy },
                { label: 'Annuler', variant: 'secondary', onPress: s.cancelImport },
              ]
            : [{ label: 'Fermer', variant: 'secondary', onPress: s.cancelImport }]
        }
      />
    </SafeAreaView>
  );
}
