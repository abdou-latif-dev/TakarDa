import { useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { router } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { MaterialIcons } from '@expo/vector-icons';
import { DisplayText, BodyLgText, LabelText, ButtonLabelText } from '@/components/ui/Typography';
import { TextField } from '@/components/ui/TextField';
import { PrimaryButton, SecondaryButton } from '@/components/ui/Button';
import { Colors } from '@/constants/theme';
import { checkEmailPassword } from '@/services/cloudAuthErrors';
import { useCloudStore } from '@/store/cloudStore';

/** Connexion au compte cloud (Firebase, e-mail et mot de passe). Facultatif : TakarDa fonctionne sans compte, et se
 * connecter ne synchronise ni ne migre aucune donnée. */
export function LoginScreen() {
  const signIn = useCloudStore((s) => s.signIn);
  const busy = useCloudStore((s) => s.busy);
  const storeError = useCloudStore((s) => s.error);
  const clearMessages = useCloudStore((s) => s.clearMessages);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [localError, setLocalError] = useState<string | null>(null);

  const onSubmit = async () => {
    clearMessages();
    const check = checkEmailPassword(email, password);
    setLocalError(check.message);
    if (!check.ok) return;
    try {
      await signIn(email, password);
      router.replace('/account/cloud' as never);
    } catch {
      // le message est dans le store
    }
  };

  const error = localError ?? storeError;

  return (
    <SafeAreaView className="flex-1 bg-background">
      <ScrollView contentContainerClassName="flex-grow justify-center px-page-margin py-8" keyboardShouldPersistTaps="handled">
        <View className="items-center gap-3">
          <View className="h-16 w-16 items-center justify-center rounded-lg bg-background-secondary">
            <MaterialIcons name="cloud-queue" size={28} color={Colors.primary} />
          </View>
          <DisplayText className="text-[26px]">Connexion</DisplayText>
          <BodyLgText className="text-center text-text-secondary">
            Un compte est facultatif. Il permet de retrouver vos biens et logements sur un autre téléphone. Sans compte, TakarDa fonctionne comme avant.
          </BodyLgText>
        </View>

        <View className="mt-8 gap-4">
          <TextField label="Adresse e-mail" placeholder="vous@exemple.com" autoCapitalize="none" autoCorrect={false} keyboardType="email-address" value={email} onChangeText={setEmail} />
          <TextField label="Mot de passe" secureToggle value={password} onChangeText={setPassword} />
          {error ? <LabelText className="font-inter-semibold" style={{ color: Colors.error }}>{error}</LabelText> : null}

          <Pressable onPress={() => router.push('/(auth)/forgot-password')} hitSlop={8} className="self-end">
            <LabelText className="font-inter-semibold text-primary">Mot de passe oublié ?</LabelText>
          </Pressable>

          <PrimaryButton label="Se connecter" loading={busy} onPress={onSubmit} className="mt-2" />
          <SecondaryButton label="Continuer sans compte" onPress={() => router.replace('/(tabs)')} />
        </View>

        <View className="mt-8 flex-row justify-center gap-1">
          <ButtonLabelText className="text-text-secondary">Pas encore de compte ?</ButtonLabelText>
          <Pressable onPress={() => router.push('/(auth)/sign-up')} hitSlop={8}>
            <ButtonLabelText className="text-primary underline">Créer un compte</ButtonLabelText>
          </Pressable>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}
