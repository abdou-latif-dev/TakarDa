import { Redirect } from 'expo-router';
import { CLOUD_ACCOUNT_ENABLED } from '@/constants/features';
import { ForgotPasswordScreen } from '@/features/auth/screens/ForgotPasswordScreen';

/** Comptes fermés (constants/features.ts) : aucun écran de compte, même par lien profond. */
export default function Route() {
  return CLOUD_ACCOUNT_ENABLED ? <ForgotPasswordScreen /> : <Redirect href="/(tabs)" />;
}
