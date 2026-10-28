import { Redirect } from 'expo-router';
import { CLOUD_ACCOUNT_ENABLED } from '@/constants/features';
import { SharedModulesScreen } from '@/features/profile/screens/SharedModulesScreen';

/** Comptes fermés (constants/features.ts) : aucun écran d'espaces partagés, même par lien profond. */
export default function Route() {
  return CLOUD_ACCOUNT_ENABLED ? <SharedModulesScreen /> : <Redirect href="/(tabs)" />;
}
