import { useEffect, useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { AppHeader } from '@/components/ui/AppHeader';
import { Chip } from '@/components/ui/Chip';
import { PrimaryButton } from '@/components/ui/Button';
import { TextField } from '@/components/ui/TextField';
import { LoadingState } from '@/components/ui/States';
import { LabelText } from '@/components/ui/Typography';
import { Colors } from '@/constants/theme';
import { coreService } from '@/services/coreService';
import { createLogement, CUISINE_OPTIONS, LOGEMENT_TYPES, parseAmount, updateLogement, WC_OPTIONS } from '@/services/immobilierService';

function ChoiceRow({ label, options, value, onChange }: { label: string; options: readonly string[]; value: string | null; onChange: (value: string | null) => void }) {
  return (
    <View className="gap-2">
      <LabelText className="text-text-secondary">{label}</LabelText>
      <View className="flex-row flex-wrap gap-2">
        {options.map((option) => (
          <Chip key={option} label={option} active={value === option} onPress={() => onChange(value === option ? null : option)} />
        ))}
      </View>
    </View>
  );
}

/** Création (`bienId` dans la route) ou modification (`logementId`) d'un
 * logement : nom libre (« Chambre 1 », « A », « Studio Gauche »…), type,
 * cuisine, WC, loyer de référence facultatif. Ces caractéristiques
 * appartiennent au logement, pas au locataire. Le logement existe même sans locataire. */
export function LogementFormScreen() {
  const { bienId, logementId } = useLocalSearchParams<{ bienId?: string; logementId?: string }>();
  const isEditing = !!logementId;
  const [loading, setLoading] = useState(isEditing);
  const [nom, setNom] = useState('');
  const [type, setType] = useState<string | null>('Chambre simple');
  const [cuisine, setCuisine] = useState<string | null>(null);
  const [wc, setWc] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loyer, setLoyer] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!logementId) return;
    coreService.getRecord(logementId).then((record) => {
      if (record) {
        setNom(String(record.values.nom ?? ''));
        setType(typeof record.values.type === 'string' && record.values.type ? record.values.type : null);
        setCuisine(typeof record.values.cuisine === 'string' && record.values.cuisine ? record.values.cuisine : null);
        setWc(typeof record.values.wc === 'string' && record.values.wc ? record.values.wc : null);
        setLoyer(typeof record.values.loyer_reference === 'number' ? String(record.values.loyer_reference) : '');
      }
      setLoading(false);
    });
  }, [logementId]);

  const onSave = async () => {
    setError(null);
    if (!nom.trim()) {
      setError('Donnez un nom au logement (ex. Chambre 1).');
      return;
    }
    setSaving(true);
    try {
      if (isEditing && logementId) {
        await updateLogement(logementId, { nom, type, cuisine, wc, loyerReference: parseAmount(loyer) });
      } else if (bienId) {
        await createLogement({ bienId, nom, type, cuisine, wc, loyerReference: parseAmount(loyer) });
      }
      router.back();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Une erreur est survenue.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <SafeAreaView className="flex-1 bg-background" edges={['top', 'bottom']}>
      <AppHeader title={isEditing ? 'Modifier le logement' : 'Nouveau logement'} showBack />
      {loading ? (
        <View className="px-page-margin">
          <LoadingState />
        </View>
      ) : (
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} className="flex-1">
          <ScrollView contentContainerClassName="w-full max-w-3xl gap-4 self-center px-page-margin pb-6" keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag">
            <TextField label="Nom du logement *" placeholder="Ex. Chambre 1, Appartement A…" value={nom} onChangeText={setNom} />
            <ChoiceRow label="Type de logement" options={LOGEMENT_TYPES} value={type} onChange={setType} />
            <ChoiceRow label="Cuisine" options={CUISINE_OPTIONS} value={cuisine} onChange={setCuisine} />
            <ChoiceRow label="WC" options={WC_OPTIONS} value={wc} onChange={setWc} />
            <TextField
              label="Loyer de référence (facultatif)"
              placeholder="25000"
              value={loyer}
              onChangeText={setLoyer}
              keyboardType="numeric"
              icon="payments"
            />
          </ScrollView>
          <View className="mx-auto w-full max-w-3xl gap-2 border-t border-border px-page-margin pb-4 pt-3">
            {error && (
              <LabelText className="font-inter-semibold" style={{ color: Colors.error }}>
                {error}
              </LabelText>
            )}
            <PrimaryButton label="Enregistrer" loading={saving} onPress={onSave} />
          </View>
        </KeyboardAvoidingView>
      )}
    </SafeAreaView>
  );
}
