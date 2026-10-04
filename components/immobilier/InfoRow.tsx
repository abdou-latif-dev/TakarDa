import { View } from 'react-native';
import { BodyMdText, LabelText } from '@/components/ui/Typography';

/** Ligne « libellé : valeur » sans largeur fixe — le libellé reste lisible, la
 * valeur prend le reste (`flex-1`, alignée à droite) et se tronque proprement. */
export function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <View className="flex-row items-center gap-3 p-gutter-card">
      <LabelText className="shrink-0 max-w-[45%]" numberOfLines={1}>
        {label}
      </LabelText>
      <BodyMdText className="flex-1 text-right text-text-primary" numberOfLines={2} ellipsizeMode="tail">
        {value}
      </BodyMdText>
    </View>
  );
}
