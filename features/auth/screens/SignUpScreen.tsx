import { Alert, ScrollView, View } from 'react-native';
import { router } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Controller, useForm } from 'react-hook-form';
import { DisplayText, BodyLgText, LabelText } from '@/components/ui/Typography';
import { TextField } from '@/components/ui/TextField';
import { PrimaryButton, IconButton } from '@/components/ui/Button';
import { useAuthStore } from '@/store/authStore';

interface SignUpForm {
  fullName: string;
  identifier: string;
  password: string;
}

export function SignUpScreen() {
  const signUp = useAuthStore((s) => s.signUp);
  const status = useAuthStore((s) => s.status);
  const {
    control,
    handleSubmit,
    formState: { errors },
  } = useForm<SignUpForm>({ defaultValues: { fullName: '', identifier: '', password: '' } });

  const onSubmit = async (values: SignUpForm) => {
    try {
      await signUp(values);
      router.replace('/(tabs)');
    } catch (e) {
      Alert.alert('Inscription impossible', e instanceof Error ? e.message : 'Réessayez.');
    }
  };

  return (
    <SafeAreaView className="flex-1 bg-white">
      <View className="px-page-margin pt-2">
        <IconButton icon="arrow-back" onPress={() => router.back()} />
      </View>
      <ScrollView contentContainerClassName="px-page-margin pb-8 pt-4" keyboardShouldPersistTaps="handled">
        <DisplayText className="text-[28px]">Créer votre compte</DisplayText>
        <BodyLgText className="mt-2 text-text-secondary">Prêt à commencer l&apos;expérience ?</BodyLgText>

        <View className="mt-8 gap-4">
          <Controller
            control={control}
            name="fullName"
            rules={{ required: 'Champ requis' }}
            render={({ field }) => (
              <TextField
                label="Nom complet"
                icon="person-outline"
                placeholder="Ex: Jean Dupont"
                value={field.value}
                onChangeText={field.onChange}
                error={errors.fullName?.message}
              />
            )}
          />
          <Controller
            control={control}
            name="identifier"
            rules={{ required: 'Champ requis' }}
            render={({ field }) => (
              <TextField
                label="Téléphone ou email"
                icon="mail-outline"
                autoCapitalize="none"
                value={field.value}
                onChangeText={field.onChange}
                error={errors.identifier?.message}
              />
            )}
          />
          <Controller
            control={control}
            name="password"
            rules={{ required: 'Champ requis', minLength: { value: 6, message: 'Au moins 6 caractères' } }}
            render={({ field }) => (
              <TextField
                label="Mot de passe"
                icon="lock-outline"
                secureToggle
                value={field.value}
                onChangeText={field.onChange}
                error={errors.password?.message}
              />
            )}
          />

          <PrimaryButton
            label="Créer mon compte"
            loading={status === 'authenticating'}
            onPress={handleSubmit(onSubmit)}
            className="mt-2"
          />

          <LabelText className="mt-2 text-center leading-5">
            En vous inscrivant, vous acceptez nos Conditions et la Politique de confidentialité.
          </LabelText>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}
