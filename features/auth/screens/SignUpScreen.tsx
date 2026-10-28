import { useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { router } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { DisplayText, BodyLgText, LabelText } from '@/components/ui/Typography';
import { TextField } from '@/components/ui/TextField';
import { IconButton, PrimaryButton } from '@/components/ui/Button';
import { Checkbox } from '@/components/ui/Checkbox';
import { SIGNUP_CONSENT_TEXT } from '@/services/privacyNotice';
import { Colors } from '@/constants/theme';
import { checkEmailPassword } from '@/services/cloudAuthErrors';
import { useAuthStore } from '@/store/authStore';
import { useCloudStore } from '@/store/cloudStore';

/** Création d’un compte cloud (Firebase, e-mail et mot de passe). Le nom saisi complète le profil LOCAL ; aucune donnée
 * n’est envoyée ni migrée par l’inscription. */
export function SignUpScreen() {
  const signUp = useCloudStore((s) => s.signUp);
  const busy = useCloudStore((s) => s.busy);
  const storeError = useCloudStore((s) => s.error);
  const clearMessages = useCloudStore((s) => s.clearMessages);
  const updateProfile = useAuthStore((s) => s.updateProfile);
  const localUser = useAuthStore((s) => s.user);
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [localError, setLocalError] = useState<string | null>(null);
  const [informed, setInformed] = useState(false);

  const onSubmit = async () => {
    clearMessages();
    if (!informed) {
      setLocalError('Cochez la case après avoir pris connaissance de l’information sur vos données.');
      return;
    }
    const check = checkEmailPassword(email, password, { confirm });
    setLocalError(check.message);
    if (!check.ok) return;
    try {
      await signUp(email, password);
      // Le nom ne remplace jamais un profil local déjà personnalisé.
      if (fullName.trim() && (!localUser?.name || localUser.name === 'Utilisateur')) await updateProfile({ name: fullName.trim() });
      router.replace('/account/cloud' as never);
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
      <ScrollView contentContainerClassName="px-page-margin pb-8 pt-4" keyboardShouldPersistTaps="handled">
        <DisplayText className="text-[28px]">Créer un compte</DisplayText>
        <BodyLgText className="mt-2 text-text-secondary">Facultatif : pour retrouver vos données Immobilier (biens, logements, contrats, loyers) sur un autre téléphone.</BodyLgText>

        <View className="mt-8 gap-4">
          <TextField label="Nom (facultatif)" icon="person-outline" placeholder="Ex : Jean Dupont" autoCapitalize="words" value={fullName} onChangeText={setFullName} />
          <TextField label="Adresse e-mail" icon="mail-outline" placeholder="vous@exemple.com" autoCapitalize="none" autoCorrect={false} keyboardType="email-address" value={email} onChangeText={setEmail} />
          <TextField label="Mot de passe (8 caractères minimum, avec une lettre et un chiffre)" icon="lock-outline" secureToggle value={password} onChangeText={setPassword} />
          <TextField label="Confirmer le mot de passe" icon="lock-outline" secureToggle value={confirm} onChangeText={setConfirm} />
          {error ? <LabelText className="font-inter-semibold" style={{ color: Colors.error }}>{error}</LabelText> : null}

          <View className="flex-row items-start gap-3">
            <Checkbox checked={informed} onValueChange={setInformed} />
            <View className="flex-1 gap-1">
              <LabelText className="leading-5">{SIGNUP_CONSENT_TEXT}</LabelText>
              <Pressable accessibilityRole="link" onPress={() => router.push('/privacy' as never)}>
                <LabelText className="font-inter-semibold" style={{ color: Colors.primary }}>Lire l’information « Mes données »</LabelText>
              </Pressable>
            </View>
          </View>

          <PrimaryButton label="Créer mon compte" loading={busy} disabled={!informed} onPress={onSubmit} className="mt-2" />

          <LabelText className="mt-2 text-center leading-5">
            Un e-mail de vérification vous sera envoyé. Créer un compte n’envoie aucune donnée et ne modifie pas vos données locales : la synchronisation se choisit ensuite, dans Profil › Compte et synchronisation, une fois votre adresse vérifiée.
          </LabelText>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}
