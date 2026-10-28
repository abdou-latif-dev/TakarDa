import { Redirect } from 'expo-router';

/** Ancienne liste des tontines (onglet masqué) : l'entrée de la Tontine est désormais son espace. */
export default function LegacyTontinesRoute() {
  return <Redirect href={'/tontine' as never} />;
}
