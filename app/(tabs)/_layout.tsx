import { Tabs } from 'expo-router';
import { BottomTabBar } from '@/components/navigation/BottomTabBar';

/** Navigation principale V1 : Accueil · Mes Outils · Activités · Profil. L'ordre de déclaration
 * est l'ordre de la barre. Les routes ci-dessous marquées `href: null` restent routables (leurs
 * fichiers et leurs liens internes existent encore) mais ne sont plus dans la barre. */
export default function TabsLayout() {
  return (
    <Tabs tabBar={(props) => <BottomTabBar {...props} />} screenOptions={{ headerShown: false }}>
      <Tabs.Screen name="index" />
      <Tabs.Screen name="outils" />
      <Tabs.Screen name="activity" />
      <Tabs.Screen name="profile" />
      {/* Anciennes entrées, conservées hors navigation : Modèles (remplacé par Mes Outils), « + » central
          (devenu le bouton de Mes Outils), Statistiques globales (désormais par module), Tontines (→ /tontine), Formulaires. */}
      <Tabs.Screen name="modeles" options={{ href: null }} />
      <Tabs.Screen name="create" options={{ href: null }} />
      <Tabs.Screen name="statistiques" options={{ href: null }} />
      <Tabs.Screen name="tontines" options={{ href: null }} />
      <Tabs.Screen name="forms" options={{ href: null }} />
    </Tabs>
  );
}
