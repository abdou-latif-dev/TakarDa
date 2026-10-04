import { View } from 'react-native';
import { LabelText } from '@/components/ui/Typography';
import { cn } from '@/utils/cn';

/** « Occupé » / « Vacant » — déduit du contrat actif, jamais stocké. Neutre
 * (pas de couleur décorative) : occupé = rempli gris, vacant = contour seul. */
export function OccupancyBadge({ occupied }: { occupied: boolean }) {
  return (
    <View className={cn('self-start rounded-full px-3 py-1', occupied ? 'bg-surface-container' : 'border border-border bg-surface')}>
      <LabelText className={cn('font-inter-semibold', occupied ? 'text-text-primary' : 'text-text-secondary')}>
        {occupied ? 'Occupé' : 'Vacant'}
      </LabelText>
    </View>
  );
}
