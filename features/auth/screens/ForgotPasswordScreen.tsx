import { useState } from 'react';
import { View } from 'react-native';
import { router } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { DisplayText, BodyLgText, LabelText } from '@/components/ui/Typography';
import { TextField } from '@/components/ui/TextField';
import { IconButton, PrimaryButton } from '@/components/ui/Button';
import { Colors } from '@/constants/theme';
import { AUTH_MESSAGES } from '@/services/cloudAuthErrors';
import { useCloudStore } from '@/store/cloudStore';

/** Réinitialisation du mot de passe du compte cloud : Firebase envoie le lien par e-mail. */
export function ForgotPasswordScreen() {
  const resetPassword = useCloudStore((s) => s.resetPassword);
  const busy = useCloudStore((s) => s.busy);
  const storeError = useCloudStore((s) => s.error);
  const clearMessages = useCloudStore((s) => s.clearMessages);
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);

  const onSubmit = async () => {
    clearMessages();
    if (!email.trim()) return setLocalError(AUTH_MESSAGES['auth/missing-email']);
    setLocalError(null);
    try {
      await resetPassword(email);
      setSent(true);
    } catch {
      // le message est dans le store
    }
  };

  const error = localError ?? storeError;

  return (
    <SafeAreaView className="flex-1 bg-background">
      <View className="px-page-margin pt-2">
        <IconButton icon="arrow-back" onPress={() => router.back()} />
      </View>
      <View className="px-page-margin pt-6">
        <DisplayText className="text-[26px]">Mot de passe oublié</DisplayText>
        <BodyLgText className="mt-2 text-text-secondary">Indiquez l’adresse e-mail de votre compte : vous recevrez un lien pour choisir un nouveau mot de passe.</BodyLgText>

        <View className="mt-8 gap-4">
          <TextField label="Adresse e-mail" placeholder="vous@exemple.com" autoCapitalize="none" autoCorrect={false} keyboardType="email-address" value={email} onChangeText={setEmail} />
          {error ? <LabelText className="font-inter-semibold" style={{ color: Colors.error }}>{error}</LabelText> : null}
          {sent ? <LabelText className="font-inter-semibold" style={{ color: Colors.success }}>Si un compte existe avec cette adresse, un e-mail vient d’être envoyé. Pensez à vérifier vos courriers indésirables.</LabelText> : null}
          <PrimaryButton label="Envoyer le lien" loading={busy} onPress={onSubmit} />
        </View>
      </View>
    </SafeAreaView>
  );
}
