import { Redirect } from 'expo-router';
import { CLOUD_ACCOUNT_ENABLED } from '@/constants/features';
import { SignUpScreen } from '@/features/auth/screens/SignUpScreen';

/** Comptes fermés (constants/features.ts) : aucun écran de compte, même par lien profond. */
export default function Route() {
  return CLOUD_ACCOUNT_ENABLED ? <SignUpScreen /> : <Redirect href="/(tabs)" />;
}
