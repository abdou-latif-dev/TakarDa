import { Image, View } from 'react-native';
import { LabelText } from './Typography';
import { Colors } from '@/constants/theme';
import { cn } from '@/utils/cn';
import { initials } from '@/utils/format';

interface AvatarProps {
  name: string;
  uri?: string;
  size?: number;
  className?: string;
  /** Initiales blanches sur fond violet plein (en-tête d'accueil, profil) ; sinon teinte douce, pour les listes. */
  solid?: boolean;
}

/** Circular avatar — photo when available, otherwise initials (soft tint, or solid primary with `solid`). */
export function Avatar({ name, uri, size = 48, className, solid }: AvatarProps) {
  if (uri) {
    return (
      <Image
        source={{ uri }}
        style={{ width: size, height: size, borderRadius: size / 2 }}
        className={cn('border border-border', className)}
      />
    );
  }
  return (
    <View
      style={{ width: size, height: size, borderRadius: size / 2 }}
      className={cn('items-center justify-center', solid ? 'bg-primary' : 'bg-primary-soft', className)}>
      <LabelText
        className="font-inter-semibold"
        style={{ fontSize: size * 0.36, lineHeight: size * 0.4, color: solid ? Colors.textOnPrimary : Colors.primaryDark }}>
        {initials(name)}
      </LabelText>
    </View>
  );
}
