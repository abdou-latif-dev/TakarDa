import { Tabs } from 'expo-router';
import { BottomTabBar } from '@/components/navigation/BottomTabBar';

export default function TabsLayout() {
  return (
    <Tabs tabBar={(props) => <BottomTabBar {...props} />} screenOptions={{ headerShown: false }}>
      <Tabs.Screen name="index" />
      <Tabs.Screen name="activity" />
      <Tabs.Screen name="create" />
      <Tabs.Screen name="groups" />
      <Tabs.Screen name="profile" />
    </Tabs>
  );
}
