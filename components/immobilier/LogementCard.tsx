import { Pressable, View } from 'react-native';
import { LabelText, SectionTitleText } from '@/components/ui/Typography';
import { OccupancyBadge } from './OccupancyBadge';
import { Colors } from '@/constants/theme';
import { formatFcfa } from '@/utils/format';
import type { LogementView } from '@/services/immobilierService';

/** Une ligne « logement » d'un bien : nom, locataire, loyer, Occupé/Vacant.
 * Disposition verticale : chaque ligne est `flex-1` + `numberOfLines`, aucune
 * largeur fixe — un nom de logement ou de locataire très long se tronque au
 * lieu de pousser le badge hors de l'écran. */
export function LogementCard({ view, onPress }: { view: LogementView; onPress: () => void }) {
  const late = view.occupied && view.lateness?.key === 'retard';
  const loyerText =
    view.loyer === null ? '—' : view.occupied ? `${formatFcfa(view.loyer)} / mois` : `${formatFcfa(view.loyer)} (réf.)`;
  return (
    <Pressable
      onPress={onPress}
      className="gap-1.5 rounded-xl border border-border bg-surface p-gutter-card shadow-soft active:opacity-90">
      <View className="flex-row items-center gap-2">
        <SectionTitleText className="flex-1 text-base" numberOfLines={2} ellipsizeMode="tail">
          {String(view.logement.values.nom ?? 'Logement')}
        </SectionTitleText>
        <OccupancyBadge occupied={view.occupied} />
      </View>
      {typeof view.logement.values.type === 'string' && view.logement.values.type ? (
        <LabelText numberOfLines={1} ellipsizeMode="tail">
          {view.logement.values.type}
        </LabelText>
      ) : null}
      <LabelText numberOfLines={2} ellipsizeMode="tail" className="text-text-primary">
        {view.occupied ? (view.locataire?.name ?? 'Locataire') : 'Aucun locataire'}
      </LabelText>
      <View className="flex-row items-center gap-2">
        <LabelText className="flex-1 font-inter-semibold text-text-primary" numberOfLines={1}>
          {loyerText}
        </LabelText>
        {late && (
          <LabelText className="font-inter-semibold" style={{ color: Colors.error }} numberOfLines={1}>
            En retard ({view.lateness!.lateMonths} mois)
          </LabelText>
        )}
      </View>
    </Pressable>
  );
}
