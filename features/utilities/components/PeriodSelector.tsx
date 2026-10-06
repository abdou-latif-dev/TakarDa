import { View } from 'react-native';
import { Chip } from '@/components/ui/Chip';
import { IconButton } from '@/components/ui/Button';
import { SectionTitleText } from '@/components/ui/Typography';
import { shiftMonth } from '../meta';

const MOIS_COURTS = ['Jan', 'Fév', 'Mars', 'Avr', 'Mai', 'Juin', 'Juil', 'Août', 'Sept', 'Oct', 'Nov', 'Déc'];

/** Choix direct de la période : année (‹ ›) puis un des 12 mois. La valeur reste
 * au format métier AAAA-MM. Plus rapide que d'avancer mois par mois. */
export function PeriodSelector({ value, onChange }: { value: string; onChange: (periode: string) => void }) {
  const [year, month] = value.split('-').map(Number);
  return (
    <View className="gap-3">
      <View className="flex-row items-center justify-between gap-3">
        <IconButton icon="chevron-left" accessibilityLabel="Année précédente" onPress={() => onChange(shiftMonth(value, -12))} />
        <SectionTitleText className="flex-1 text-center text-lg">{year}</SectionTitleText>
        <IconButton icon="chevron-right" accessibilityLabel="Année suivante" onPress={() => onChange(shiftMonth(value, 12))} />
      </View>
      <View className="flex-row flex-wrap justify-center gap-2">
        {MOIS_COURTS.map((label, i) => (
          <Chip key={label} label={label} active={month === i + 1} onPress={() => onChange(`${year}-${String(i + 1).padStart(2, '0')}`)} />
        ))}
      </View>
    </View>
  );
}
