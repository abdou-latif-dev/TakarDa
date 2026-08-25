import { Alert, Pressable, ScrollView, View } from 'react-native';
import { router } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Controller, useForm } from 'react-hook-form';
import { MaterialIcons } from '@expo/vector-icons';
import { DisplayText, BodyLgText, LabelText, ButtonLabelText } from '@/components/ui/Typography';
import { TextField } from '@/components/ui/TextField';
import { PrimaryButton, SecondaryButton } from '@/components/ui/Button';
import { Colors } from '@/constants/theme';
import { useAuthStore } from '@/store/authStore';

interface LoginForm {
  identifier: string;
  password: string;
}

export function LoginScreen() {
  const login = useAuthStore((s) => s.login);
  const status = useAuthStore((s) => s.status);
  const { control, handleSubmit } = useForm<LoginForm>({ defaultValues: { identifier: '', password: '' } });

  const onSubmit = async (values: LoginForm) => {
    try {
      await login(values);
      router.replace('/(tabs)');
    } catch (e) {
      Alert.alert('Connexion impossible', e instanceof Error ? e.message : 'Réessayez.');
    }
  };

  return (
    <SafeAreaView className="flex-1 bg-white">
      <ScrollView contentContainerClassName="flex-grow justify-center px-page-margin py-8" keyboardShouldPersistTaps="handled">
        <View className="items-center gap-3">
          <View className="h-16 w-16 items-center justify-center rounded-lg bg-background-secondary">
            <MaterialIcons name="description" size={28} color={Colors.primary} />
          </View>
          <DisplayText className="text-[26px]">Bienvenue sur FormEase</DisplayText>
          <BodyLgText className="text-text-secondary">Connectez-vous pour continuer</BodyLgText>
        </View>

        <View className="mt-8 gap-4">
          <Controller
            control={control}
            name="identifier"
            render={({ field }) => (
              <TextField
                placeholder="Email ou téléphone (optionnel)"
                autoCapitalize="none"
                keyboardType="email-address"
                value={field.value}
                onChangeText={field.onChange}
              />
            )}
          />
          <Controller
            control={control}
            name="password"
            render={({ field }) => (
              <TextField
                placeholder="Mot de passe (optionnel)"
                secureToggle
                value={field.value}
                onChangeText={field.onChange}
              />
            )}
          />

          <Pressable onPress={() => router.push('/(auth)/forgot-password')} hitSlop={8} className="self-end">
            <LabelText className="font-inter-semibold text-primary">Mot de passe oublié ?</LabelText>
          </Pressable>

          <PrimaryButton
            label="Se connecter"
            loading={status === 'authenticating'}
            onPress={handleSubmit(onSubmit)}
            className="mt-2"
          />

          <View className="my-2 flex-row items-center gap-3">
            <View className="h-px flex-1 bg-border" />
            <LabelText>ou</LabelText>
            <View className="h-px flex-1 bg-border" />
          </View>

          <SecondaryButton
            label="Continuer avec Google"
            icon="alternate-email"
            onPress={() => Alert.alert('Connexion Google', 'Bientôt disponible.')}
          />
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
