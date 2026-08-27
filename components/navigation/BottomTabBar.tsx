import { Pressable, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { MaterialIcons } from '@expo/vector-icons';
import type { BottomTabBarProps } from '@react-navigation/bottom-tabs';
import { LabelText } from '@/components/ui/Typography';
import { Colors } from '@/constants/theme';

const TAB_META: Record<string, { label: string; icon: keyof typeof MaterialIcons.glyphMap }> = {
  index: { label: 'Accueil', icon: 'home' },
  modeles: { label: 'Mes modèles', icon: 'dashboard-customize' },
  create: { label: 'Créer', icon: 'add' },
  statistiques: { label: 'Statistiques', icon: 'bar-chart' },
  profile: { label: 'Profil', icon: 'person' },
};

/** Custom 5-tab bar: Accueil / Mes modèles / Créer (elevated FAB) / Statistiques / Profil. */
export function BottomTabBar({ state, navigation }: BottomTabBarProps) {
  const insets = useSafeAreaInsets();

  return (
    <View
      className="flex-row border-t border-border bg-white/95"
      style={{ paddingBottom: Math.max(insets.bottom, 10), paddingTop: 10 }}>
      {state.routes.map((route, index) => {
        const meta = TAB_META[route.name];
        if (!meta) return null;
        const isFocused = state.index === index;
        const isCreate = route.name === 'create';

        const onPress = () => {
          if (isCreate) {
            router.push('/modals/create-menu');
            return;
          }
          const event = navigation.emit({ type: 'tabPress', target: route.key, canPreventDefault: true });
          if (!isFocused && !event.defaultPrevented) navigation.navigate(route.name);
        };

        if (isCreate) {
          return (
            <View key={route.key} className="flex-1 items-center">
              <Pressable
                onPress={onPress}
                className="-mt-7 h-14 w-14 items-center justify-center rounded-full bg-primary shadow-soft-primary active:scale-95">
                <MaterialIcons name="add" size={28} color="#FFFFFF" />
              </Pressable>
            </View>
          );
        }

        return (
          <Pressable key={route.key} onPress={onPress} className="flex-1 items-center gap-1">
            <MaterialIcons name={meta.icon} size={24} color={isFocused ? Colors.primary : Colors.textMuted} />
            <LabelText className={isFocused ? 'font-inter-semibold text-primary' : undefined}>{meta.label}</LabelText>
          </Pressable>
        );
      })}
    </View>
  );
}
