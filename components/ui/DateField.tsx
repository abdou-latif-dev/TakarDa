import { useEffect, useState } from 'react';
import { View } from 'react-native';
import { TextField } from './TextField';
import { LabelText } from './Typography';

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}

function daysInMonth(year: number, month1to12: number): number {
  return new Date(year, month1to12, 0).getDate();
}

/**
 * Minimal Jour/Mois/Année date picker — no new native dependency (checked:
 * no date picker exists anywhere in package.json, and adding an unverified
 * native module mid-change carries more risk than three numeric fields;
 * Tour/Boucle audit, 2026-09-30, §15). Clamps the day to the target month's
 * real length so typing "31" then switching to a 30-day month doesn't
 * produce an invalid date.
 */
export function DateField({ label, value, onChange }: { label?: string; value: Date; onChange: (date: Date) => void }) {
  const [day, setDay] = useState(String(value.getDate()));
  const [month, setMonth] = useState(String(value.getMonth() + 1));
  const [year, setYear] = useState(String(value.getFullYear()));

  useEffect(() => {
    setDay(String(value.getDate()));
    setMonth(String(value.getMonth() + 1));
    setYear(String(value.getFullYear()));
  }, [value]);

  const commit = (d: string, m: string, y: string) => {
    const yearNum = y.length === 4 ? clamp(parseInt(y, 10) || value.getFullYear(), 2000, 2100) : null;
    const monthNum = clamp(parseInt(m, 10) || 1, 1, 12);
    if (yearNum === null) return; // wait for a full 4-digit year before recomputing
    const dayNum = clamp(parseInt(d, 10) || 1, 1, daysInMonth(yearNum, monthNum));
    onChange(new Date(yearNum, monthNum - 1, dayNum));
  };

  return (
    <View className="gap-2">
      {label && <LabelText className="text-text-secondary">{label}</LabelText>}
      <View className="flex-row gap-2">
        <TextField
          containerClassName="w-16"
          value={day}
          keyboardType="numeric"
          textAlign="center"
          placeholder="JJ"
          onChangeText={(v) => {
            setDay(v);
            commit(v, month, year);
          }}
        />
        <TextField
          containerClassName="w-16"
          value={month}
          keyboardType="numeric"
          textAlign="center"
          placeholder="MM"
          onChangeText={(v) => {
            setMonth(v);
            commit(day, v, year);
          }}
        />
        <TextField
          containerClassName="flex-1"
          value={year}
          keyboardType="numeric"
          textAlign="center"
          placeholder="AAAA"
          onChangeText={(v) => {
            setYear(v);
            commit(day, month, v);
          }}
        />
      </View>
    </View>
  );
}
