import { Redirect } from 'expo-router';

/** Mes Outils est maintenant un onglet : l'ancienne route pointe vers lui. */
export default function MesOutilsRoute() {
  return <Redirect href={'/(tabs)/outils' as never} />;
}
