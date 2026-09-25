import { useState } from 'react';
import { Alert, View } from 'react-native';
import { router } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { DisplayText, BodyLgText } from '@/components/ui/Typography';
import { TextField } from '@/components/ui/TextField';
import { PrimaryButton, IconButton } from '@/components/ui/Button';
import { authService } from '@/services/authService';

export function ForgotPasswordScreen() {
  const [identifier, setIdentifier] = useState('');
  const [loading, setLoading] = useState(false);

  const onSubmit = async () => {
    if (!identifier) return;
    setLoading(true);
    try {
      await authService.requestPasswordReset(identifier);
      Alert.alert('Email envoyé', 'Vérifiez votre boîte de réception pour réinitialiser votre mot de passe.', [
        { text: 'OK', onPress: () => router.back() },
      ]);
    } finally {
      setLoading(false);
    }
  };

  return (
    <SafeAreaView className="flex-1 bg-background">
      <View className="px-page-margin pt-2">
        <IconButton icon="arrow-back" onPress={() => router.back()} />
      </View>
      <View className="px-page-margin pt-6">
        <DisplayText className="text-[26px]">Mot de passe oublié</DisplayText>
        <BodyLgText className="mt-2 text-text-secondary">
          Indiquez votre email ou téléphone, nous vous enverrons un lien de réinitialisation.
        </BodyLgText>

        <View className="mt-8 gap-4">
          <TextField
            placeholder="Email ou téléphone"
            autoCapitalize="none"
            value={identifier}
            onChangeText={setIdentifier}
          />
          <PrimaryButton label="Envoyer le lien" loading={loading} onPress={onSubmit} />
        </View>
      </View>
    </SafeAreaView>
  );
}
