import { Tabs } from 'expo-router';
import { BottomTabBar } from '@/components/navigation/BottomTabBar';

export default function TabsLayout() {
  return (
    <Tabs tabBar={(props) => <BottomTabBar {...props} />} screenOptions={{ headerShown: false }}>
      <Tabs.Screen name="index" />
      <Tabs.Screen name="modeles" />
      <Tabs.Screen name="create" />
      <Tabs.Screen name="statistiques" />
      <Tabs.Screen name="profile" />
      {/* Routable, but not shown in the tab bar — reached via "Voir tout" on Home. */}
      <Tabs.Screen name="activity" options={{ href: null }} />
      {/* Superseded by "modeles" (merges Tontines + Formulaires) — kept routable in case anything still deep-links here. */}
      <Tabs.Screen name="tontines" options={{ href: null }} />
      <Tabs.Screen name="forms" options={{ href: null }} />
    </Tabs>
  );
}
