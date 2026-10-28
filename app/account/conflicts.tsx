import { Redirect } from 'expo-router';
import { CLOUD_ACCOUNT_ENABLED } from '@/constants/features';
import { SyncConflictsScreen } from '@/features/profile/screens/SyncConflictsScreen';

/** Comptes fermés (constants/features.ts) : aucun écran de conflit, même par lien profond. */
export default function Route() {
  return CLOUD_ACCOUNT_ENABLED ? <SyncConflictsScreen /> : <Redirect href="/(tabs)" />;
}
