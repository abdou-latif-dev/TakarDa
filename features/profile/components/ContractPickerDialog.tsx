import { useEffect, useState } from 'react';
import { Pressable, View } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { Dialog } from '@/components/ui/Dialog';
import { BodyMdText, LabelText } from '@/components/ui/Typography';
import { Colors } from '@/constants/theme';
import type { ContractChoice } from '@/services/sharedModulesService';

interface Props {
  visible: boolean;
  title: string;
  message?: string;
  choices: ContractChoice[];
  confirmLabel: string;
  busy?: boolean;
  onConfirm: (contract: ContractChoice) => void;
  onClose: () => void;
}

/** Choix du contrat auquel un accès de locataire est lié. Rien n'est validé tant que l'on n'a pas choisi un contrat. */
export function ContractPickerDialog({ visible, title, message, choices, confirmLabel, busy, onConfirm, onClose }: Props) {
  const [selected, setSelected] = useState<string | null>(null);
  useEffect(() => {
    if (visible) setSelected(null);
  }, [visible]);
  const chosen = choices.find((c) => c.id === selected) ?? null;
  return (
    <Dialog
      visible={visible}
      onClose={busy ? undefined : onClose}
      title={title}
      message={message}
      actions={[
        ...(chosen ? [{ label: confirmLabel, loading: busy, onPress: () => onConfirm(chosen) }] : []),
        { label: 'Annuler', variant: 'secondary' as const, onPress: () => (busy ? undefined : onClose()) },
      ]}>
      {choices.length === 0 ? (
        <BodyMdText>Aucun contrat n’est enregistré dans Immobilier : créez d’abord le contrat du locataire.</BodyMdText>
      ) : (
        <View className="gap-1">
          {choices.map((c) => (
            <Pressable key={c.id} onPress={() => setSelected(c.id)} accessibilityRole="radio" accessibilityState={{ selected: selected === c.id }} className="flex-row items-center gap-3 rounded-md border border-border p-3 active:bg-background-secondary">
              <MaterialIcons name={selected === c.id ? 'radio-button-checked' : 'radio-button-unchecked'} size={22} color={selected === c.id ? Colors.primary : Colors.textMuted} />
              <View className="flex-1">
                <BodyMdText className="text-text-primary" numberOfLines={1}>{c.label}</BodyMdText>
                <LabelText>{c.statusKey === 'actif' ? 'Contrat en cours' : c.endDay ? `Terminé le ${c.endDay} : accès pendant 90 jours` : 'Contrat terminé'}</LabelText>
              </View>
            </Pressable>
          ))}
        </View>
      )}
    </Dialog>
  );
}
