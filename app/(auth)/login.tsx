import { Redirect } from 'expo-router';
import { CLOUD_ACCOUNT_ENABLED } from '@/constants/features';
import { LoginScreen } from '@/features/auth/screens/LoginScreen';

/** Comptes fermés (constants/features.ts) : aucun écran de compte, même par lien profond. */
export default function Route() {
  return CLOUD_ACCOUNT_ENABLED ? <LoginScreen /> : <Redirect href="/(tabs)" />;
}
