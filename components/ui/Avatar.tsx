import { Image, View } from 'react-native';
import { LabelText } from './Typography';
import { cn } from '@/utils/cn';
import { initials } from '@/utils/format';

interface AvatarProps {
  name: string;
  uri?: string;
  size?: number;
  className?: string;
}

/** Circular avatar — photo when available, otherwise initials on a soft orange tint. */
export function Avatar({ name, uri, size = 48, className }: AvatarProps) {
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
      className={cn('items-center justify-center bg-primary-soft', className)}>
      <LabelText
        className="text-primary-dark font-inter-semibold"
        style={{ fontSize: size * 0.36, lineHeight: size * 0.4 }}>
        {initials(name)}
      </LabelText>
    </View>
  );
}
