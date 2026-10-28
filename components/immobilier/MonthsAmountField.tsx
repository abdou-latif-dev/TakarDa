import { useEffect, useRef, useState } from 'react';
import { View } from 'react-native';
import { Chip } from '@/components/ui/Chip';
import { TextField } from '@/components/ui/TextField';
import { LabelText } from '@/components/ui/Typography';
import { Colors } from '@/constants/theme';
import { describeMonths, monthsToAmount, parseMonths } from '@/services/rentTermsService';
import { formatFcfa } from '@/utils/format';

interface Props {
  label: string;
  /** Montant en FCFA (texte saisi) — la seule valeur enregistrée par le parent. */
  value: string;
  onChange: (amount: string) => void;
  /** Loyer mensuel de référence ; null tant qu'il n'est pas saisi. */
  monthlyRent: number | null;
}

const amountOf = (text: string): number | null => {
  const digits = text.replace(/\s/g, '');
  return /^\d+$/.test(digits) ? Number(digits) : null;
};

/** Avance / caution : saisie en nombre de mois OU en montant, l'autre valeur est recalculée tout de suite.
 * Le parent ne reçoit toujours qu'un montant entier ; le nombre de mois n'est qu'une aide, jamais enregistrée. */
export function MonthsAmountField({ label, value, onChange, monthlyRent }: Props) {
  const [mode, setMode] = useState<'months' | 'amount'>('amount');
  const [monthsText, setMonthsText] = useState('');
  const valueRef = useRef(value);
  valueRef.current = value;

  // Le loyer change pendant une saisie en mois : le montant suit (une seule fois par changement de loyer, jamais en boucle).
  useEffect(() => {
    if (mode !== 'months' || !monthlyRent) return;
    const months = parseMonths(monthsText);
    if (months === null) return;
    const next = String(monthsToAmount(months, monthlyRent));
    if (next !== valueRef.current) onChange(next);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- seulement quand le loyer change
  }, [monthlyRent]);

  const onMonths = (text: string) => {
    setMonthsText(text);
    const months = parseMonths(text);
    if (months === null || !monthlyRent) {
      if (!text.trim()) onChange('');
      return;
    }
    onChange(String(monthsToAmount(months, monthlyRent)));
  };

  const amount = amountOf(value);
  let hint: string | null = null;
  if (mode === 'months') {
    if (!monthlyRent) hint = 'Indiquez d’abord le loyer mensuel.';
    else if (amount !== null && parseMonths(monthsText) !== null) hint = `= ${formatFcfa(amount)}`;
    else if (monthsText.trim()) hint = 'Entrez un nombre de mois (ex. 3 ou 2,5).';
  } else if (amount !== null && monthlyRent) {
    const eq = describeMonths(amount, monthlyRent);
    hint = eq ? `≈ ${eq} de loyer` : null;
  }

  return (
    <View className="gap-2">
      <View className="flex-row items-center justify-between gap-2">
        <LabelText className="flex-1 text-text-secondary">{label}</LabelText>
        <View className="flex-row gap-2">
          <Chip label="En mois" active={mode === 'months'} onPress={() => setMode('months')} />
          <Chip label="En montant" active={mode === 'amount'} onPress={() => setMode('amount')} />
        </View>
      </View>
      {mode === 'months' ? (
        <TextField value={monthsText} onChangeText={onMonths} keyboardType="decimal-pad" icon="event" placeholder="Nombre de mois" accessibilityLabel={`${label} en mois`} />
      ) : (
        <TextField value={value} onChangeText={onChange} keyboardType="numeric" icon="payments" placeholder="Montant en FCFA" accessibilityLabel={`${label} en FCFA`} />
      )}
      {hint && <LabelText style={{ color: Colors.textSecondary }}>{hint}</LabelText>}
    </View>
  );
}
