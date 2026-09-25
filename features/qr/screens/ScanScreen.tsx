import { useState } from 'react';
import { Pressable, View } from 'react-native';
import { router } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { MaterialIcons } from '@expo/vector-icons';
import { ScanFrame } from '@/components/ui/ScanFrame';
import { PrimaryButton, SecondaryButton } from '@/components/ui/Button';
import { BodyLgText, HeadlineText, BodyMdText } from '@/components/ui/Typography';
import { useSubmissionStore } from '@/store/submissionStore';

export function ScanScreen() {
  const [permission, requestPermission] = useCameraPermissions();
  const [torch, setTorch] = useState(false);
  const [locked, setLocked] = useState(false);
  const [notice, setNotice] = useState<{ title: string; description: string } | null>(null);
  const scan = useSubmissionStore((s) => s.scan);

  const onScanned = async (result: { data: string }) => {
    if (locked) return;
    setLocked(true);

    const outcome = await scan(result.data);

    if (outcome.kind === 'found') {
      router.replace(`/records/${outcome.submission.id}`);
      return;
    }
    if (outcome.kind === 'not_found') {
      setNotice({ title: 'QR code invalide', description: "Ce code ne correspond à aucun dossier FormEase." });
    } else if (outcome.kind === 'expired') {
      setNotice({ title: 'QR code expiré', description: 'Ce dossier a expiré. Demandez un nouveau code au client.' });
    } else {
      setNotice({ title: 'Dossier déjà traité', description: `Ce dossier a déjà été ${outcome.submission.status === 'validated' ? 'validé' : 'traité'}.` });
    }
  };

  if (!permission) return <View className="flex-1 bg-black" />;

  if (!permission.granted) {
    return (
      <SafeAreaView className="flex-1 items-center justify-center gap-4 bg-black px-page-margin">
        <MaterialIcons name="camera-alt" size={40} color="#FFFFFF" />
        <HeadlineText className="text-center text-white">Accès caméra requis</HeadlineText>
        <BodyMdText className="text-center text-white/70">
          FormEase a besoin de la caméra pour scanner les QR codes des dossiers clients.
        </BodyMdText>
        <PrimaryButton label="Autoriser la caméra" onPress={requestPermission} />
        <SecondaryButton label="Retour" onPress={() => router.back()} />
      </SafeAreaView>
    );
  }

  return (
    <View className="flex-1 bg-black">
      <CameraView
        style={{ flex: 1 }}
        facing="back"
        enableTorch={torch}
        barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
        onBarcodeScanned={locked ? undefined : onScanned}
      />
      <View className="absolute inset-0 items-center justify-center">
        <View className="absolute inset-0 bg-black/50" />
        <View className="items-center gap-6">
          <ScanFrame />
        </View>
      </View>

      <SafeAreaView className="absolute inset-0" style={{ pointerEvents: 'box-none' }}>
        <View className="flex-row items-center justify-between px-page-margin pt-2">
          <Pressable onPress={() => router.back()} className="h-11 w-11 items-center justify-center rounded-full bg-black/40">
            <MaterialIcons name="arrow-back" size={20} color="#FFFFFF" />
          </Pressable>
          <BodyLgText className="font-manrope-bold text-white">FormEase</BodyLgText>
          <Pressable onPress={() => setTorch((t) => !t)} className="h-11 w-11 items-center justify-center rounded-full bg-black/40">
            <MaterialIcons name={torch ? 'flash-on' : 'flash-off'} size={20} color="#FFFFFF" />
          </Pressable>
        </View>

        <View className="mt-24 items-center gap-1 px-page-margin">
          <BodyLgText className="font-inter-semibold text-white">Scannez le QR code</BodyLgText>
          <BodyMdText className="text-white/70">Placez le QR code dans le cadre</BodyMdText>
        </View>

        {notice && (
          <View className="absolute bottom-10 left-page-margin right-page-margin gap-3 rounded-lg bg-background p-gutter-card shadow-soft">
            <View className="flex-row items-center gap-2">
              <MaterialIcons name="error-outline" size={20} color="#BA1A1A" />
              <BodyLgText className="font-inter-semibold">{notice.title}</BodyLgText>
            </View>
            <BodyMdText>{notice.description}</BodyMdText>
            <SecondaryButton
              label="Réessayer"
              onPress={() => {
                setNotice(null);
                setLocked(false);
              }}
            />
          </View>
        )}
      </SafeAreaView>
    </View>
  );
}
