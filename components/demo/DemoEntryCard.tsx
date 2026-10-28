import { useState } from 'react';
import { View } from 'react-native';
import { router } from 'expo-router';
import { Card } from '@/components/ui/Card';
import { SecondaryButton } from '@/components/ui/Button';
import { Dialog } from '@/components/ui/Dialog';
import { BodyMdText, SectionTitleText } from '@/components/ui/Typography';
import { useDemoStore } from '@/store/demoStore';

/** Profil : accès FACULTATIF à la démonstration (espace d'exemples séparé des données personnelles). Masqué quand on y est déjà.
 * Aucun parcours imposé : l'accueil n'y mène pas, c'est un choix de l'utilisateur. */
export function DemoEntryCard() {
  const active = useDemoStore((s) => s.active);
  const busy = useDemoStore((s) => s.busy);
  const enter = useDemoStore((s) => s.enter);
  const [confirm, setConfirm] = useState(false);

  if (active) return null;

  const start = async () => {
    setConfirm(false);
    if (await enter()) router.replace('/(tabs)' as never);
  };

  return (
    <>
      <Card className="gap-2">
        <SectionTitleText className="text-base">Mode démonstration</SectionTitleText>
        <BodyMdText>Un espace d’exemples, séparé de vos données personnelles, pour essayer les modules sans rien modifier chez vous.</BodyMdText>
        <View>
          <SecondaryButton label="Ouvrir la démonstration" icon="auto-awesome" loading={busy} onPress={() => setConfirm(true)} />
        </View>
      </Card>
      <Dialog
        visible={confirm}
        onClose={() => setConfirm(false)}
        title="Ouvrir la démonstration ?"
        message="TakarDa s’ouvre dans un espace de démonstration, séparé de vos données personnelles, qui ne sont ni modifiées ni supprimées. Vous pourrez revenir à vos données à tout moment."
        actions={[
          { label: 'Ouvrir la démonstration', onPress: () => void start() },
          { label: 'Annuler', variant: 'secondary', onPress: () => setConfirm(false) },
        ]}
      />
    </>
  );
}
