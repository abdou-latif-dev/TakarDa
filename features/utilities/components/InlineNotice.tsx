import { View } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { LabelText } from '@/components/ui/Typography';
import { Colors } from '@/constants/theme';

export type NoticeTone = 'error' | 'warning' | 'success';

const TONES: Record<NoticeTone, { icon: 'error-outline' | 'warning-amber' | 'check-circle-outline'; color: () => string; bg: () => string }> = {
  error: { icon: 'error-outline', color: () => Colors.error, bg: () => Colors.errorContainer },
  warning: { icon: 'warning-amber', color: () => Colors.warning, bg: () => Colors.warningContainer },
  success: { icon: 'check-circle-outline', color: () => Colors.success, bg: () => Colors.successContainer },
};

/** Message affiché DANS l'écran (mobile et web) — remplace `Alert.alert`, invisible
 * sur le web. Texte lisible par un utilisateur non technique. */
export function InlineNotice({ tone, children }: { tone: NoticeTone; children: string | string[] }) {
  const t = TONES[tone];
  return (
    <View accessibilityRole="alert" className="flex-row items-start gap-2 rounded-md p-3" style={{ backgroundColor: t.bg() }}>
      <MaterialIcons name={t.icon} size={18} color={t.color()} style={{ marginTop: 1 }} />
      <LabelText className="flex-1" style={{ color: t.color() }}>{children}</LabelText>
    </View>
  );
}
