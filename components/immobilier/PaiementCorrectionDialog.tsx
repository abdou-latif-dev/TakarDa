import { useEffect, useState } from 'react';
import { View } from 'react-native';
import { Dialog } from '@/components/ui/Dialog';
import { TextField } from '@/components/ui/TextField';
import { BodyMdText, LabelText } from '@/components/ui/Typography';
import { Colors } from '@/constants/theme';
import { formatFcfa } from '@/utils/format';
import { REASON_MAX_LENGTH, submitPaymentCorrection, type CorrectionType } from '@/services/paymentCorrectionService';
import type { RecordItem } from '@/types/entities';

interface Props {
  visible: boolean;
  paiement: RecordItem | null;
  /** Montant actuellement effectif du paiement. */
  currentAmount: number | null;
  onClose: () => void;
  /** Appelé après l'enregistrement, pour recharger l'écran. */
  onDone: () => void | Promise<void>;
}

type Step = 'choice' | CorrectionType;

/** Correction ou annulation d'un paiement déjà confirmé dans le cloud. Le paiement initial n'est jamais modifié : un nouveau fait, avec son motif,
 * est ajouté à l'historique. */
export function PaiementCorrectionDialog({ visible, paiement, currentAmount, onClose, onDone }: Props) {
  const [step, setStep] = useState<Step>('choice');
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!visible) return;
    setStep('choice');
    setAmount('');
    setReason('');
    setError(null);
    setSaving(false);
  }, [visible, paiement?.id]);

  const submit = async (type: CorrectionType) => {
    if (!paiement) return;
    setSaving(true);
    setError(null);
    const result = await submitPaymentCorrection({ paymentId: paiement.id, type, reason, amountText: amount, currentAmount });
    setSaving(false);
    if (!result.ok) {
      setError(result.message);
      return;
    }
    onClose();
    await onDone();
  };

  const inputs = (
    <View className="gap-3">
      {step === 'correction' ? <TextField label="Nouveau montant (FCFA)" value={amount} onChangeText={setAmount} keyboardType="numeric" icon="payments" /> : null}
      <TextField label="Motif (obligatoire)" value={reason} onChangeText={setReason} maxLength={REASON_MAX_LENGTH} multiline={false} />
      {error ? <LabelText style={{ color: Colors.error }}>{error}</LabelText> : null}
    </View>
  );

  if (step === 'choice') {
    return (
      <Dialog
        visible={visible}
        onClose={onClose}
        title="Corriger ou annuler ce paiement"
        message={`Ce paiement est déjà enregistré dans votre compte${currentAmount !== null ? ` (${formatFcfa(currentAmount)})` : ''} : il ne peut pas être modifié ni supprimé. Vous ajoutez une correction ou une annulation, avec son motif ; le paiement initial reste visible dans l’historique.`}
        actions={[
          { label: 'Corriger le montant', onPress: () => setStep('correction') },
          { label: 'Annuler le paiement', variant: 'destructive', onPress: () => setStep('annulation') },
          { label: 'Fermer', variant: 'secondary', onPress: onClose },
        ]}
      />
    );
  }

  return (
    <Dialog
      visible={visible}
      onClose={saving ? undefined : onClose}
      title={step === 'correction' ? 'Corriger le montant' : 'Annuler le paiement'}
      message={step === 'annulation' ? 'Le paiement n’aura plus d’effet (montant compté : 0) et le mois redeviendra à payer. Une annulation est définitive.' : undefined}
      actions={[
        { label: step === 'correction' ? 'Enregistrer la correction' : 'Confirmer l’annulation', variant: step === 'annulation' ? 'destructive' : 'primary', loading: saving, onPress: () => void submit(step) },
        { label: 'Retour', variant: 'secondary', onPress: () => (saving ? undefined : setStep('choice')) },
      ]}>
      {inputs}
      <BodyMdText className="text-text-muted">Le motif et la date resteront dans l’historique.</BodyMdText>
    </Dialog>
  );
}
