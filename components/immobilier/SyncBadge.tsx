import { View } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { LabelText } from '@/components/ui/Typography';
import { Colors } from '@/constants/theme';
import { useCloudStore } from '@/store/cloudStore';
import { useSyncEngineStore } from '@/store/syncEngineStore';
import { badgeStateFor } from '@/services/syncDisplay';
import { badgeState, type BadgeState } from '@/services/cloudSyncService';

const META: Record<BadgeState, { label: string; icon: keyof typeof MaterialIcons.glyphMap }> = {
  local: { label: 'Local', icon: 'smartphone' },
  pending: { label: 'En attente', icon: 'cloud-upload' },
  syncing: { label: 'Synchronisation…', icon: 'sync' },
  synced: { label: 'Synchronisé', icon: 'cloud-done' },
  conflict: { label: 'Conflit', icon: 'sync-problem' },
  error: { label: 'Erreur', icon: 'error-outline' },
};

/** État de synchronisation d’un bien ou d’un logement. Affiché seulement quand la synchronisation est activée : sans
 * compte, rien ne change à l’écran. « Synchronisé » = confirmé par le cloud (jamais avant). */
export function SyncBadge({ recordId }: { recordId: string }) {
  const enabled = useCloudStore((s) => s.syncEnabled);
  const state = useCloudStore((s) => s.states[recordId]);
  const syncing = useCloudStore((s) => s.syncing);
  // moteur de synchronisation (phase 6) : états RÉELS ; inactif tant qu'il n'est pas démarré (drapeau fermé) → comportement actuel inchangé
  const engineActive = useSyncEngineStore((s) => s.active);
  const engineState = useSyncEngineStore((s) => s.summary?.states[recordId]);
  const cycle = useSyncEngineStore((s) => s.cycle);
  if (!engineActive && !enabled) return null;
  const key: BadgeState = engineActive ? badgeStateFor(engineState, cycle) : badgeState(state ?? 'local', syncing);
  const meta = META[key];
  const color = key === 'synced' ? Colors.success : key === 'pending' ? Colors.warning : key === 'syncing' ? Colors.primary : key === 'local' ? Colors.textMuted : Colors.error;
  return (
    <View className="flex-row items-center gap-1 self-start" accessibilityLabel={`Synchronisation : ${meta.label}`}>
      <MaterialIcons name={meta.icon} size={14} color={color} />
      <LabelText style={{ color }} className="font-inter-semibold">{meta.label}</LabelText>
    </View>
  );
}
