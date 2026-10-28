import { Pressable, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { MaterialIcons } from '@expo/vector-icons';
import type { BottomTabBarProps } from '@react-navigation/bottom-tabs';
import { LabelText } from '@/components/ui/Typography';
import { Colors } from '@/constants/theme';

export const TAB_META: Record<string, { label: string; icon: keyof typeof MaterialIcons.glyphMap }> = {
  index: { label: 'Accueil', icon: 'home' },
  outils: { label: 'Mes Outils', icon: 'dashboard-customize' },
  activity: { label: 'Activités', icon: 'history' },
  profile: { label: 'Profil', icon: 'person' },
};

/** Barre à 4 onglets : Accueil / Mes Outils / Activités / Profil. Une route sans entrée dans TAB_META
 * (ancienne entrée masquée) n'y apparaît pas. Créer quelque chose se fait depuis l'espace du module. */
export function BottomTabBar({ state, navigation }: BottomTabBarProps) {
  const insets = useSafeAreaInsets();

  return (
    <View
      className="flex-row border-t border-border bg-surface"
      style={{ paddingBottom: Math.max(insets.bottom, 10), paddingTop: 10 }}>
      {state.routes.map((route, index) => {
        const meta = TAB_META[route.name];
        if (!meta) return null;
        const isFocused = state.index === index;

        const onPress = () => {
          const event = navigation.emit({ type: 'tabPress', target: route.key, canPreventDefault: true });
          if (!isFocused && !event.defaultPrevented) navigation.navigate(route.name);
        };

        return (
          <Pressable key={route.key} accessibilityRole="button" onPress={onPress} className="flex-1 items-center gap-1">
            <MaterialIcons name={meta.icon} size={24} color={isFocused ? Colors.primary : Colors.textMuted} />
            <LabelText numberOfLines={1} className={isFocused ? 'font-inter-semibold text-[11px] text-primary' : 'text-[11px]'}>
              {meta.label}
            </LabelText>
          </Pressable>
        );
      })}
    </View>
  );
}
