import { useCallback, useEffect, useState } from 'react';
import { View } from 'react-native';
import { Card } from '@/components/ui/Card';
import { Dialog } from '@/components/ui/Dialog';
import { SecondaryButton } from '@/components/ui/Button';
import { BodyMdText, LabelText, SectionTitleText } from '@/components/ui/Typography';
import { Colors } from '@/constants/theme';
import { adoptLegacyData, previewLegacyAdoption, type AdoptionPreview } from '@/services/syncDisplay';

const plural = (n: number, one: string, many: string) => `${n} ${n > 1 ? many : one}`;

/** Envoi VOLONTAIRE des anciennes données d'Immobilier (créées avant l'activation du compte). Jamais automatique : un aperçu, une confirmation,
 * une sauvegarde de sécurité, puis l'envoi par la synchronisation habituelle. */
export function LegacyAdoptionCard() {
  const [preview, setPreview] = useState<AdoptionPreview | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async (isAlive: () => boolean = () => true) => {
    try {
      const next = await previewLegacyAdoption();
      if (isAlive()) setPreview(next);
    } catch {
      if (isAlive()) setPreview(null); // aperçu indisponible (activation pas encore faite, espace de démonstration…) : la carte n'offre rien
    } finally {
      if (isAlive()) setLoaded(true);
    }
  }, []);

  useEffect(() => {
    let alive = true;
    void refresh(() => alive);
    return () => {
      alive = false;
    };
  }, [refresh]);

  const send = async () => {
    setBusy(true);
    setError(null);
    try {
      const result = await adoptLegacyData({ confirmed: true });
      setOpen(false);
      setMessage(
        result.adopted === 0
          ? 'Rien à envoyer pour le moment.'
          : `Une sauvegarde de sécurité a été enregistrée. ${plural(result.willSend, 'élément va être envoyé', 'éléments vont être envoyés')} à votre espace personnel ; l’état de chaque enregistrement s’affiche au fil de l’envoi.`,
      );
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Envoi impossible. Vos données n’ont pas été modifiées.');
    } finally {
      setBusy(false);
    }
  };

  if (!loaded || !preview) return null;
  if (preview.total === 0 && preview.incomplete === 0 && !message) return null;

  return (
    <Card className="gap-3">
      <SectionTitleText className="text-base">Mes anciennes données Immobilier</SectionTitleText>
      {preview.total > 0 ? (
        <>
          <BodyMdText>
            {plural(preview.total, 'élément créé avant l’activation est resté', 'éléments créés avant l’activation sont restés')} sur cet appareil. Vous pouvez choisir de les envoyer à votre espace personnel : rien ne part sans votre confirmation.
          </BodyMdText>
          <SecondaryButton label="Voir ce qui serait envoyé" icon="cloud-upload" onPress={() => { setError(null); setOpen(true); }} />
        </>
      ) : null}
      {preview.incomplete > 0 ? (
        <LabelText>
          {plural(preview.incomplete, 'ancienne donnée est incomplète', 'anciennes données sont incomplètes')} (par exemple un contrat sans locataire enregistré) : elle reste sur cet appareil et ne peut pas être envoyée.
        </LabelText>
      ) : null}
      {message ? <LabelText style={{ color: Colors.success }}>{message}</LabelText> : null}
      <Dialog
        visible={open}
        onClose={busy ? undefined : () => setOpen(false)}
        title="Envoyer mes anciennes données ?"
        message="Une sauvegarde de vos données est d’abord enregistrée sur cet appareil et vérifiée. Si elle échoue, rien n’est envoyé. Rien n’est supprimé ni modifié sur l’appareil."
        actions={[
          { label: 'Envoyer ces données', loading: busy, onPress: () => void send() },
          { label: 'Annuler', variant: 'secondary', onPress: () => (busy ? undefined : setOpen(false)) },
        ]}>
        <View className="gap-1.5">
          {preview.byKind.map((line) => (
            <View key={line.kind} className="flex-row justify-between gap-3">
              <BodyMdText className="flex-1">{line.label}</BodyMdText>
              <BodyMdText className="font-inter-semibold text-text-primary">{line.count}</BodyMdText>
            </View>
          ))}
          <LabelText>Total : {plural(preview.total, 'élément', 'éléments')}. L’envoi se fait en plusieurs étapes et reprend tout seul après une coupure.</LabelText>
        </View>
        {error ? <LabelText style={{ color: Colors.error }}>{error}</LabelText> : null}
      </Dialog>
    </Card>
  );
}
