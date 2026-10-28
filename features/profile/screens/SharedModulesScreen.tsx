import { useCallback, useState } from 'react';
import { ScrollView, View } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { AppHeader } from '@/components/ui/AppHeader';
import { PrimaryButton, SecondaryButton } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Dialog } from '@/components/ui/Dialog';
import { TextField } from '@/components/ui/TextField';
import { BodyMdText, LabelText, SectionTitleText } from '@/components/ui/Typography';
import { Colors } from '@/constants/theme';
import { ACCESS_STATUS_LABEL } from '@/services/sharedModules/moduleFlows';
import type { LocalModulesData } from '@/services/sharedModules/localModules';
import { sharedModules } from '@/services/sharedModulesService';
import { useCloudStore } from '@/store/cloudStore';

const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' }) : '—');
const TONE: Record<string, string> = { active: Colors.success, pending: Colors.warning, approved_waiting: Colors.warning };

/** Espaces partagés : ceux que je gère (je suis le propriétaire et l'administrateur) et ceux que j'ai demandé à rejoindre (locataire, lecture seule).
 * Un identifiant d'espace est une adresse : il ne donne jamais accès, le propriétaire doit approuver la demande. */
export function SharedModulesScreen() {
  const user = useCloudStore((s) => s.user);
  const uid = user?.uid ?? null;
  const [data, setData] = useState<LocalModulesData>({ schemaVersion: 1, owned: [], joined: [] });
  const [name, setName] = useState('');
  const [moduleId, setModuleId] = useState('');
  const [label, setLabel] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<{ text: string; ok: boolean } | null>(null);
  const [confirmLeave, setConfirmLeave] = useState<string | null>(null);

  const reload = useCallback(async () => {
    try {
      setData(await sharedModules.listLocal());
    } catch {
      setMessage({ text: 'Vos espaces partagés enregistrés sur cet appareil sont illisibles.', ok: false });
    }
  }, []);
  useFocusEffect(
    useCallback(() => {
      void reload();
    }, [reload]),
  );

  if (!uid) return null;

  const run = async (key: string, work: () => Promise<{ ok: boolean; message?: string }>, success: string) => {
    setBusy(key);
    setMessage(null);
    const result = await work();
    setMessage({ text: result.ok ? success : (result.message ?? 'Action impossible.'), ok: result.ok });
    await reload();
    setBusy(null);
  };

  const create = () =>
    run('create', async () => {
      const result = await sharedModules.createModule(uid, name);
      if (result.ok) setName('');
      return result;
    }, 'Espace créé. Ouvrez-le pour copier son identifiant et le donner à votre locataire.');

  const join = () =>
    run('join', async () => {
      const result = await sharedModules.requestAccess(uid, moduleId, label);
      if (result.ok) {
        setModuleId('');
        setLabel('');
      }
      return result;
    }, 'Demande envoyée. Le propriétaire doit l’approuver : revenez ici et touchez « Actualiser ».');

  const refresh = () =>
    run('refresh', async () => {
      const result = await sharedModules.refreshJoined(uid);
      return result.ok && result.value.failed > 0 ? { ok: false, message: 'Certains espaces n’ont pas pu être actualisés (connexion ?).' } : result;
    }, 'États actualisés.');

  return (
    <SafeAreaView className="flex-1 bg-background" edges={['top', 'bottom']}>
      <AppHeader title="Espaces partagés" showBack />
      <ScrollView contentContainerClassName="w-full max-w-3xl gap-5 self-center px-page-margin pb-10" keyboardShouldPersistTaps="handled">
        {message ? <LabelText style={{ color: message.ok ? Colors.success : Colors.error }}>{message.text}</LabelText> : null}

        <Card className="gap-3">
          <SectionTitleText className="text-base">Mes espaces partagés</SectionTitleText>
          <BodyMdText>Un espace partagé permet à vos locataires de consulter leurs propres informations en lecture seule. Vous en êtes le propriétaire et l’administrateur.</BodyMdText>
          <LabelText>Chaque locataire approuvé voit son contrat, son logement, ses paiements, son avance et ses retards (liste complète : Profil › Mes données). Prévenez vos locataires que vous utilisez TakarDa et ce partage.</LabelText>
          {data.owned.length === 0 ? <LabelText>Aucun espace créé.</LabelText> : null}
          {data.owned.map((o) => (
            <SecondaryButton key={o.moduleId} label={o.name} icon="groups" onPress={() => router.push(`/account/shared/${o.moduleId}` as never)} />
          ))}
          <TextField label="Nom du nouvel espace" value={name} onChangeText={setName} maxLength={100} />
          <PrimaryButton label="Créer un espace partagé" icon="add" loading={busy === 'create'} onPress={() => void create()} />
        </Card>

        <Card className="gap-3">
          <SectionTitleText className="text-base">Rejoindre un espace</SectionTitleText>
          <BodyMdText>Saisissez l’identifiant donné par votre propriétaire. Il ne donne pas accès à lui seul : le propriétaire doit approuver votre demande.</BodyMdText>
          <LabelText>Le propriétaire verra l’identifiant de votre compte et le nom que vous saisissez ci-dessous, rien d’autre. Vous pourrez quitter l’espace à tout moment, ce qui retire aussi ce nom.</LabelText>
          <TextField label="Identifiant de l’espace" value={moduleId} onChangeText={setModuleId} autoCapitalize="none" autoCorrect={false} placeholder="mod_…" />
          <TextField label="Votre nom (facultatif, visible du propriétaire)" value={label} onChangeText={setLabel} maxLength={60} />
          <PrimaryButton label="Envoyer la demande" icon="send" loading={busy === 'join'} onPress={() => void join()} />
        </Card>

        <Card className="gap-3">
          <SectionTitleText className="text-base">Espaces que j’ai demandé à rejoindre</SectionTitleText>
          {data.joined.length === 0 ? <LabelText>Aucune demande.</LabelText> : null}
          {data.joined.map((j) => (
            <View key={j.moduleId} className="gap-2 rounded-md border border-border p-3">
              <BodyMdText className="text-text-primary" numberOfLines={1}>{j.moduleName ?? j.label ?? j.moduleId}</BodyMdText>
              <LabelText style={{ color: TONE[j.status] ?? Colors.textMuted }}>{ACCESS_STATUS_LABEL[j.status]}</LabelText>
              <LabelText>Demandé le {when(j.requestedAt)} · vérifié le {when(j.checkedAt)}</LabelText>
              {j.status === 'pending' ? <SecondaryButton label="Annuler la demande" loading={busy === `c${j.moduleId}`} onPress={() => void run(`c${j.moduleId}`, () => sharedModules.cancelRequest(uid, j.moduleId), 'Demande annulée.')} /> : null}
              {j.status === 'active' ? <PrimaryButton label="Voir mon espace" icon="home" onPress={() => router.push(`/account/shared/space/${j.moduleId}` as never)} /> : null}
              {j.status === 'active' ? <SecondaryButton label="Quitter cet espace" icon="logout" onPress={() => setConfirmLeave(j.moduleId)} /> : null}
              {j.status !== 'pending' && j.status !== 'active' ? <SecondaryButton label="Retirer de la liste" onPress={() => void run(`f${j.moduleId}`, async () => (await sharedModules.forgetJoined(j.moduleId), { ok: true }), 'Retiré de la liste.')} /> : null}
            </View>
          ))}
          {data.joined.length > 0 ? <SecondaryButton label="Actualiser" icon="sync" loading={busy === 'refresh'} onPress={() => void refresh()} /> : null}
        </Card>
      </ScrollView>

      <Dialog
        visible={confirmLeave !== null}
        onClose={() => setConfirmLeave(null)}
        title="Quitter cet espace ?"
        message="Votre accès sera coupé immédiatement. Le propriétaire conserve son historique ; seul lui pourra rétablir votre accès."
        actions={[
          { label: 'Quitter', variant: 'destructive', onPress: () => { const id = confirmLeave; setConfirmLeave(null); if (id) void run(`l${id}`, () => sharedModules.leave(uid, id), 'Vous avez quitté l’espace.'); } },
          { label: 'Annuler', variant: 'secondary', onPress: () => setConfirmLeave(null) },
        ]}
      />
    </SafeAreaView>
  );
}
