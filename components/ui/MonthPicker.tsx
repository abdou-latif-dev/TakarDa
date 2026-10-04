import { Pressable, View } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { Chip } from './Chip';
import { LabelText } from './Typography';
import { Colors } from '@/constants/theme';

const MOIS = ['Janvier', 'Février', 'Mars', 'Avril', 'Mai', 'Juin', 'Juillet', 'Août', 'Septembre', 'Octobre', 'Novembre', 'Décembre'];

/** `AAAA-MM` → « Septembre 2026 ». */
export function formatMonth(value: string | null): string {
  if (!value) return 'Aucun';
  const [y, m] = value.split('-').map(Number);
  return `${MOIS[m - 1] ?? '?'} ${y}`;
}

function shift(value: string, delta: number): string {
  const [y, m] = value.split('-').map(Number);
  const index = y * 12 + (m - 1) + delta;
  return `${Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, '0')}`;
}

const monthOf = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;

/** Sélecteur de période (mois + année) sans saisie libre : la valeur est
 * toujours `AAAA-MM` valide ou `null`, donc jamais un texte mal formé qui
 * ferait passer un locataire pour « à jour ». Aucune dépendance native. */
export function MonthPicker({ label, value, onChange, allowNone = true }: { label?: string; value: string | null; onChange: (value: string | null) => void; allowNone?: boolean }) {
  const now = new Date();
  const thisMonth = monthOf(now);
  const lastMonth = shift(thisMonth, -1);
  const step = (delta: number) => onChange(shift(value ?? lastMonth, value ? delta : 0));

  return (
    <View className="gap-2">
      {label && <LabelText className="text-text-secondary">{label}</LabelText>}
      <View className="flex-row items-center gap-2">
        <Pressable
          onPress={() => step(-1)}
          disabled={!value}
          hitSlop={6}
          accessibilityLabel="Mois précédent"
          className="h-11 w-11 items-center justify-center rounded-md border border-border bg-surface active:opacity-80">
          <MaterialIcons name="chevron-left" size={22} color={value ? Colors.primary : Colors.textMuted} />
        </Pressable>
        <View className="h-11 flex-1 items-center justify-center rounded-md border border-border bg-surface px-3">
          <LabelText className="font-inter-semibold text-text-primary" numberOfLines={1}>{formatMonth(value)}</LabelText>
        </View>
        <Pressable
          onPress={() => step(1)}
          disabled={!value}
          hitSlop={6}
          accessibilityLabel="Mois suivant"
          className="h-11 w-11 items-center justify-center rounded-md border border-border bg-surface active:opacity-80">
          <MaterialIcons name="chevron-right" size={22} color={value ? Colors.primary : Colors.textMuted} />
        </Pressable>
      </View>
      <View className="flex-row flex-wrap gap-2">
        {allowNone && <Chip label="Aucun" active={value === null} onPress={() => onChange(null)} />}
        <Chip label="Mois dernier" active={value === lastMonth} onPress={() => onChange(lastMonth)} />
        <Chip label="Ce mois-ci" active={value === thisMonth} onPress={() => onChange(thisMonth)} />
      </View>
    </View>
  );
}
