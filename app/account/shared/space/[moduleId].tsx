import { Redirect } from 'expo-router';
import { CLOUD_ACCOUNT_ENABLED } from '@/constants/features';
import { TenantSpaceScreen } from '@/features/profile/screens/TenantSpaceScreen';

/** Comptes fermés (constants/features.ts) : aucun écran d'espace locataire, même par lien profond. */
export default function Route() {
  return CLOUD_ACCOUNT_ENABLED ? <TenantSpaceScreen /> : <Redirect href="/(tabs)" />;
}
