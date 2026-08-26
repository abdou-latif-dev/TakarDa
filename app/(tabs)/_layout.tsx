import { Tabs } from 'expo-router';
import { BottomTabBar } from '@/components/navigation/BottomTabBar';

export default function TabsLayout() {
  return (
    <Tabs tabBar={(props) => <BottomTabBar {...props} />} screenOptions={{ headerShown: false }}>
      <Tabs.Screen name="index" />
      <Tabs.Screen name="tontines" />
      <Tabs.Screen name="create" />
      <Tabs.Screen name="forms" />
      <Tabs.Screen name="profile" />
      {/* Routable, but not shown in the tab bar — reached via "Voir tout" on Home. */}
      <Tabs.Screen name="activity" options={{ href: null }} />
    </Tabs>
  );
}
