import { Redirect } from 'expo-router';
import { CLOUD_ACCOUNT_ENABLED } from '@/constants/features';
import { SharedModuleOwnerScreen } from '@/features/profile/screens/SharedModuleOwnerScreen';

/** Comptes fermés (constants/features.ts) : aucun écran d'espace partagé, même par lien profond. */
export default function Route() {
  return CLOUD_ACCOUNT_ENABLED ? <SharedModuleOwnerScreen /> : <Redirect href="/(tabs)" />;
}
