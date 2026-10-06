import type { ComponentProps } from 'react';
import type { MaterialIcons } from '@expo/vector-icons';
import type { UtilityModule } from '@/services/utilityParticipantsService';

/** Identité visible des deux outils : CEET (électricité) et TDE (eau). Même
 * moteur interne, deux entrées distinctes pour l'utilisateur. */
export const MODULE_META: Record<UtilityModule, { label: string; subtitle: string; icon: ComponentProps<typeof MaterialIcons>['name']; unit: string }> = {
  ceet: { label: 'CEET', subtitle: 'Répartition de l’électricité', icon: 'bolt', unit: 'kWh' },
  tde: { label: 'TDE', subtitle: 'Répartition de l’eau', icon: 'water-drop', unit: 'm³' },
};

/** Mois courant au format AAAA-MM. */
export function currentMonth(now = new Date()): string {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

/** Décale un mois AAAA-MM de `delta` mois. */
export function shiftMonth(value: string, delta: number): string {
  const [y, m] = value.split('-').map(Number);
  const index = y * 12 + (m - 1) + delta;
  return `${Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, '0')}`;
}
