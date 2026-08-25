import { View } from 'react-native';
import QRCodeSVG from 'react-native-qrcode-svg';
import { MaterialIcons } from '@expo/vector-icons';
import { HeadlineText, LabelText, BodyMdText } from './Typography';
import { Colors } from '@/constants/theme';

interface QRCardProps {
  token: string;
  dossierLabel: string;
  validityLabel: string;
}

/** Secure QR display — dashed corner frame, security badge, expiry footer. Encodes only the token, never PII. */
export function QRCard({ token, dossierLabel, validityLabel }: QRCardProps) {
  return (
    <View className="items-center gap-5 rounded-xl border border-border bg-surface p-6 shadow-soft">
      <View className="flex-row items-center gap-1.5">
        <MaterialIcons name="verified-user" size={16} color={Colors.primary} />
        <LabelText className="font-inter-semibold uppercase tracking-wide text-primary">QR code sécurisé</LabelText>
      </View>

      <View className="items-center justify-center rounded-lg border-2 border-dashed border-primary/40 p-4">
        <QRCodeSVG value={token} size={192} color={Colors.textPrimary} backgroundColor="transparent" />
      </View>

      <View className="items-center gap-1">
        <HeadlineText className="text-xl">{dossierLabel}</HeadlineText>
        <BodyMdText>Présentez ce QR code à l&apos;agent.</BodyMdText>
      </View>

      <View className="w-full flex-row items-center justify-center gap-1.5 border-t border-border pt-4">
        <MaterialIcons name="timer" size={16} color={Colors.textMuted} />
        <LabelText>{validityLabel}</LabelText>
      </View>
    </View>
  );
}
