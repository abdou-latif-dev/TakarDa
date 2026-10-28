import { Redirect } from 'expo-router';
import { CLOUD_ACCOUNT_ENABLED } from '@/constants/features';
import { CloudAccountScreen } from '@/features/profile/screens/CloudAccountScreen';

/** Comptes fermés (constants/features.ts) : aucun écran de compte, même par lien profond. */
export default function Route() {
  return CLOUD_ACCOUNT_ENABLED ? <CloudAccountScreen /> : <Redirect href="/(tabs)" />;
}
