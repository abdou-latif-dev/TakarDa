import { useState } from 'react';
import { Alert, KeyboardAvoidingView, Platform, Pressable, ScrollView, View } from 'react-native';
import { router } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { MaterialIcons } from '@expo/vector-icons';
import { AppHeader } from '@/components/ui/AppHeader';
import { Card } from '@/components/ui/Card';
import { TextField } from '@/components/ui/TextField';
import { PrimaryButton } from '@/components/ui/Button';
import { SectionTitleText, LabelText, BodyMdText } from '@/components/ui/Typography';
import { Colors } from '@/constants/theme';
import { useGroupStore } from '@/store/groupStore';
import { formatLongDate } from '@/utils/format';
import type { TontineFrequency, TontineOrderMethod } from '@/types/entities';

const FREQUENCIES: { value: TontineFrequency; label: string }[] = [
  { value: 'daily', label: 'Quotidien' },
  { value: 'weekly', label: 'Hebdomadaire' },
  { value: 'monthly', label: 'Mensuel' },
  { value: 'custom', label: 'Autre' },
];

const ORDER_METHODS: { value: TontineOrderMethod; label: string; description: string; icon: keyof typeof MaterialIcons.glyphMap }[] = [
  { value: 'join_order', label: "Ordre d'inscription", description: 'Premier arrivé, premier servi.', icon: 'format-list-numbered' },
  { value: 'draw', label: 'Tirage au sort', description: "L'ordre est généré aléatoirement.", icon: 'casino' },
  { value: 'manual', label: 'Définition manuelle', description: "Vous choisissez l'ordre vous-même, plus tard.", icon: 'drag-indicator' },
];

function RadioRow<T extends string>({
  selected,
  label,
  description,
  icon,
  onPress,
}: {
  selected: boolean;
  label: string;
  description?: string;
  icon?: keyof typeof MaterialIcons.glyphMap;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      className="flex-row items-center gap-3 rounded-md border p-3"
      style={{
        borderColor: selected ? Colors.primary : Colors.border,
        backgroundColor: selected ? Colors.primarySoft : Colors.surface,
      }}>
      {icon && <MaterialIcons name={icon} size={20} color={selected ? Colors.primary : Colors.textSecondary} />}
      <View className="flex-1">
        <LabelText className={selected ? 'font-inter-semibold text-primary-dark' : 'font-inter-semibold text-text-primary'}>
          {label}
        </LabelText>
        {description && <LabelText>{description}</LabelText>}
      </View>
      <View
        className="h-5 w-5 items-center justify-center rounded-full border-2"
        style={{ borderColor: selected ? Colors.primary : Colors.border }}>
        {selected && <View className="h-2.5 w-2.5 rounded-full bg-primary" />}
      </View>
    </Pressable>
  );
}

export function CreateTontineScreen() {
  const createTontine = useGroupStore((s) => s.createTontine);
  const [name, setName] = useState('');
  const [amount, setAmount] = useState('10000');
  const [frequency, setFrequency] = useState<TontineFrequency>('weekly');
  const [startDate] = useState(new Date());
  const [orderMethod, setOrderMethod] = useState<TontineOrderMethod>('draw');
  const [submitting, setSubmitting] = useState(false);

  const onSubmit = async () => {
    if (!name.trim()) {
      Alert.alert('Nom requis', 'Donnez un nom à votre tontine.');
      return;
    }
    setSubmitting(true);
    try {
      const group = await createTontine({
        name: name.trim(),
        contributionAmount: Number(amount) || 0,
        frequency,
        startDate: startDate.toISOString(),
        orderMethod,
      });
      router.replace(`/group/${group.id}/tontine`);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <SafeAreaView className="flex-1 bg-white" edges={['top', 'bottom']}>
      <AppHeader title="Créer une Tontine" showBack />
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} className="flex-1">
        <ScrollView contentContainerClassName="gap-6 px-page-margin pb-6 pt-2" keyboardShouldPersistTaps="handled">
          <BodyMdText>Configurez les détails de votre nouvelle tontine.</BodyMdText>

          <Card className="gap-4">
            <SectionTitleText className="text-base">Informations générales</SectionTitleText>
            <TextField label="Nom de la tontine" placeholder="Ex: Tontine Famille 2024" value={name} onChangeText={setName} />
            <TextField
              label="Montant de la cotisation"
              placeholder="10000"
              value={amount}
              onChangeText={setAmount}
              keyboardType="numeric"
              icon="payments"
            />
          </Card>

          <Card className="gap-4">
            <SectionTitleText className="text-base">Planification</SectionTitleText>
            <View className="gap-2">
              <LabelText className="text-text-secondary">Fréquence de cotisation</LabelText>
              <View className="flex-row flex-wrap gap-2">
                {FREQUENCIES.map((f) => (
                  <Pressable
                    key={f.value}
                    onPress={() => setFrequency(f.value)}
                    className="rounded-full border px-4 py-2"
                    style={{
                      borderColor: frequency === f.value ? Colors.primary : Colors.border,
                      backgroundColor: frequency === f.value ? Colors.primary : Colors.surface,
                    }}>
                    <LabelText className={frequency === f.value ? 'font-inter-semibold text-white' : 'font-inter-semibold text-text-primary'}>
                      {f.label}
                    </LabelText>
                  </Pressable>
                ))}
              </View>
            </View>
            <View className="flex-row items-center gap-3 rounded-md border border-border bg-background-secondary p-3">
              <MaterialIcons name="event" size={18} color={Colors.textSecondary} />
              <LabelText className="text-text-primary">Début : {formatLongDate(startDate)}</LabelText>
            </View>
          </Card>

          <View className="gap-3">
            <View>
              <SectionTitleText className="text-base">Ordre de ramassage</SectionTitleText>
              <LabelText>Comment l&apos;ordre de réception sera-t-il défini ?</LabelText>
            </View>
            <View className="gap-2">
              {ORDER_METHODS.map((m) => (
                <RadioRow
                  key={m.value}
                  selected={orderMethod === m.value}
                  label={m.label}
                  description={m.description}
                  icon={m.icon}
                  onPress={() => setOrderMethod(m.value)}
                />
              ))}
            </View>
          </View>
        </ScrollView>

        <View className="border-t border-border px-page-margin pb-4 pt-4">
          <PrimaryButton label="Créer la tontine" icon="add-circle" iconPosition="left" loading={submitting} onPress={onSubmit} />
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
