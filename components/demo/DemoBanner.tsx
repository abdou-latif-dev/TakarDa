import { Pressable, View } from 'react-native';
import { router } from 'expo-router';
import { MaterialIcons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LabelText } from '@/components/ui/Typography';
import { Colors } from '@/constants/theme';
import { useDemoStore } from '@/store/demoStore';

/**
 * Bandeau de l'espace de démonstration. Il n'apparaît QUE dans deux cas :
 *  - un changement d'espace a échoué (message d'erreur) ;
 *  - l'on est dans la démonstration alors que des données personnelles existent : le lien de retour est alors le seul moyen de
 *    les retrouver, il ne doit jamais disparaître.
 * Sur une installation neuve (rien à retrouver) aucun bandeau n'est affiché : les exemples portent « (démo) » dans leur nom.
 */
export function DemoBanner() {
  const active = useDemoStore((s) => s.active);
  const canReturn = useDemoStore((s) => s.canReturn);
  const busy = useDemoStore((s) => s.busy);
  const error = useDemoStore((s) => s.error);
  const requestPersonal = useDemoStore((s) => s.requestPersonal);
  const insets = useSafeAreaInsets();

  const showReturn = active && canReturn;
  if (!showReturn && !error) return null;

  const goPersonal = async () => {
    const result = await requestPersonal();
    if (result === 'left') router.replace('/(tabs)' as never);
  };

  return (
    <View style={{ paddingTop: insets.top + 4, backgroundColor: Colors.warning }} className="gap-1 px-4 pb-2">
      <View className="flex-row items-center gap-2">
        <MaterialIcons name="science" size={16} color="#000" />
        <LabelText className="flex-1 font-inter-semibold" style={{ color: '#000' }} numberOfLines={2}>
          {error ?? 'MODE DÉMONSTRATION · exemples séparés de vos données personnelles'}
        </LabelText>
      </View>
      {showReturn ? (
        <View className="flex-row gap-4">
          <Pressable accessibilityRole="button" disabled={busy} onPress={() => void goPersonal()} hitSlop={8}>
            <LabelText className="font-inter-semibold" style={{ color: '#000', textDecorationLine: 'underline' }}>Retrouver mes données personnelles</LabelText>
          </Pressable>
        </View>
      ) : null}
    </View>
  );
}
