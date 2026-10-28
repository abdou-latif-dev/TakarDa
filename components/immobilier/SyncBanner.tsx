import { Pressable, View } from 'react-native';
import { router } from 'expo-router';
import { MaterialIcons } from '@expo/vector-icons';
import { SecondaryButton } from '@/components/ui/Button';
import { LabelText } from '@/components/ui/Typography';
import { Colors } from '@/constants/theme';
import { CLOUD_ACCOUNT_ENABLED } from '@/constants/features';
import { useCloudStore } from '@/store/cloudStore';
import { useSyncEngineStore } from '@/store/syncEngineStore';

/** Bandeau de synchronisation d’Immobilier : visible seulement avec un compte connecté. Sans compte : rien. */
export function SyncBanner() {
  const authStatus = useCloudStore((s) => s.authStatus);
  const enabled = useCloudStore((s) => s.syncEnabled);
  const pending = useCloudStore((s) => s.pending);
  const conflicts = useCloudStore((s) => s.conflicts.length);
  const syncing = useCloudStore((s) => s.syncing);
  const message = useCloudStore((s) => s.syncMessage);
  const syncNow = useCloudStore((s) => s.syncNow);
  const engineActive = useSyncEngineStore((s) => s.active);
  const engineBanner = useSyncEngineStore((s) => s.banner);
  const cycle = useSyncEngineStore((s) => s.cycle);
  const engineSyncNow = useSyncEngineStore((s) => s.syncNow);

  if (!CLOUD_ACCOUNT_ENABLED || authStatus !== 'signedIn') return null;
  if (engineActive && engineBanner) {
    // états RÉELS du moteur (phase 6) : en attente, conflit, erreur, pause (hors ligne, limite, échecs) ; jamais « synchronisé » avant confirmation
    const attention = engineBanner.tone === 'attention';
    return (
      <View className="gap-2 rounded-xl bg-primary-soft p-gutter-card">
        <View className="flex-row items-center gap-2">
          <MaterialIcons name={engineBanner.tone === 'ok' ? 'cloud-done' : attention ? 'sync-problem' : engineBanner.tone === 'paused' ? 'cloud-off' : 'cloud-upload'} size={20} color={attention ? Colors.error : Colors.primary} />
          <LabelText className="flex-1 font-inter-semibold" style={{ color: attention ? Colors.error : Colors.primary }}>{engineBanner.summary}</LabelText>
        </View>
        {engineBanner.conflicts > 0 || engineBanner.recoverable > 0 ? <SecondaryButton label="Voir les conflits" icon="sync-problem" onPress={() => router.push('/account/conflicts' as never)} /> : null}
        <SecondaryButton label="Synchroniser maintenant" icon="sync" loading={cycle === 'running'} onPress={() => void engineSyncNow()} />
      </View>
    );
  }
  if (!enabled) {
    return (
      <Pressable onPress={() => router.push('/account/cloud' as never)} accessibilityRole="button" className="flex-row items-center gap-2 rounded-xl bg-primary-soft p-gutter-card">
        <MaterialIcons name="cloud-queue" size={20} color={Colors.primary} />
        <LabelText className="flex-1" style={{ color: Colors.primary }}>Compte connecté. Activez la synchronisation pour retrouver vos biens sur un autre téléphone.</LabelText>
        <MaterialIcons name="chevron-right" size={20} color={Colors.primary} />
      </Pressable>
    );
  }
  const summary = syncing ? 'Synchronisation…' : conflicts > 0 ? `${conflicts} conflit(s) à résoudre (Profil › Compte et synchronisation)` : pending > 0 ? `${pending} en attente d’envoi` : 'Tout est synchronisé';
  return (
    <View className="gap-2 rounded-xl bg-primary-soft p-gutter-card">
      <View className="flex-row items-center gap-2">
        <MaterialIcons name={pending > 0 || conflicts > 0 ? 'cloud-upload' : 'cloud-done'} size={20} color={Colors.primary} />
        <LabelText className="flex-1 font-inter-semibold" style={{ color: Colors.primary }}>{summary}</LabelText>
      </View>
      {message && !syncing ? <LabelText>{message}</LabelText> : null}
      <SecondaryButton label="Synchroniser maintenant" icon="sync" loading={syncing} onPress={() => void syncNow()} />
    </View>
  );
}
