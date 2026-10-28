import { useCallback, useState } from 'react';
import { Pressable, ScrollView, Share, View } from 'react-native';
import { useFocusEffect, useLocalSearchParams } from 'expo-router';
import { MaterialIcons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import { AppHeader } from '@/components/ui/AppHeader';
import { SecondaryButton } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { BodyMdText, LabelText, SectionTitleText } from '@/components/ui/Typography';
import { Colors } from '@/constants/theme';
import { ACCESS_STATUS_LABEL } from '@/services/sharedModules/moduleFlows';
import { EVENT_LABEL, buildTenantReceiptText, formatViewAmount, formatViewDay, monthLabel, type TenantPayment } from '@/services/sharedModules/tenantViewModel';
import { sharedModules, type ViewState } from '@/services/sharedModulesService';
import { useCloudStore } from '@/store/cloudStore';

const PAYMENT_LABEL: Record<TenantPayment['statut'], { text: string; color: string; icon: 'check-circle' | 'schedule' | 'cancel' | 'savings' }> = {
  paye: { text: 'Payé', color: Colors.success, icon: 'check-circle' },
  en_attente: { text: 'En attente', color: Colors.warning, icon: 'schedule' },
  rejete: { text: 'Rejeté', color: Colors.error, icon: 'cancel' },
  couvert: { text: 'Couvert par l’avance', color: Colors.primary, icon: 'savings' },
};

const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' }) : '—');
const money = (n: number | null) => (n === null ? '—' : formatViewAmount(n));

function Row({ label, value }: { label: string; value: string | null }) {
  if (!value) return null;
  return (
    <View className="flex-row items-center justify-between gap-3">
      <LabelText>{label}</LabelText>
      <LabelText className="flex-1 text-right font-inter-semibold text-text-primary" numberOfLines={2}>{value}</LabelText>
    </View>
  );
}

/** Mon espace de locataire : MES informations, en LECTURE SEULE, publiées par mon propriétaire. Rien ne s'écrit d'ici. La copie est gardée sur cet appareil
 * tant que mon accès est actif ; elle disparaît quand il est retiré ou arrive à son terme. */
export function TenantSpaceScreen() {
  const { moduleId } = useLocalSearchParams<{ moduleId: string }>();
  const uid = useCloudStore((s) => s.user?.uid ?? null);
  const [view, setView] = useState<ViewState | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const showLocal = useCallback(async () => {
    if (!uid || !moduleId) return;
    const result = await sharedModules.viewCopy(uid, moduleId);
    if (result.ok) setView(result.value);
    else setMessage(result.message);
  }, [uid, moduleId]);
  useFocusEffect(
    useCallback(() => {
      void showLocal();
    }, [showLocal]),
  );

  if (!uid || !moduleId) return null;

  const refresh = async () => {
    setBusy(true);
    setMessage(null);
    const result = await sharedModules.refreshMyView(uid, moduleId);
    if (result.ok) setView(result.value);
    else setMessage(result.message);
    setBusy(false);
  };

  const model = view?.state === 'ok' ? view.model : null;
  const copy = view?.state === 'ok' ? view.copy : null;

  return (
    <SafeAreaView className="flex-1 bg-background" edges={['top', 'bottom']}>
      <AppHeader title={copy?.moduleName ?? 'Mon espace'} showBack />
      <ScrollView contentContainerClassName="w-full max-w-3xl gap-5 self-center px-page-margin pb-10">
        <Card className="gap-2">
          <LabelText>Lecture seule : ces informations viennent de votre propriétaire, vous ne pouvez rien y modifier.</LabelText>
          {copy ? <LabelText>Mis à jour le {when(copy.fetchedAt)}{copy.accessUntil ? ` · votre accès se termine le ${formatViewDay(copy.accessUntil)}` : ''}</LabelText> : null}
          {message ? <LabelText style={{ color: Colors.error }}>{message}</LabelText> : null}
          <SecondaryButton label="Actualiser" icon="sync" loading={busy} onPress={() => void refresh()} />
        </Card>

        {view?.state === 'none' ? <BodyMdText>Aucune information enregistrée sur cet appareil. Touchez « Actualiser » (connexion nécessaire).</BodyMdText> : null}
        {view?.state === 'expired' ? <BodyMdText>Votre accès à cet espace est terminé : les informations ont été retirées de cet appareil.</BodyMdText> : null}
        {view?.state === 'unavailable' ? <BodyMdText>{ACCESS_STATUS_LABEL[view.status]}. Les informations ne sont plus disponibles et ont été retirées de cet appareil.</BodyMdText> : null}

        {model ? (
          <>
            <Card className="gap-3">
              <SectionTitleText className="text-base">Mon contrat</SectionTitleText>
              {model.contrat ? (
                <>
                  <Row label="Statut" value={model.contrat.statut === 'actif' ? 'En cours' : model.contrat.statut === 'termine' ? 'Terminé' : model.contrat.statut === 'archive' ? 'Archivé' : null} />
                  <Row label="Locataire" value={model.contrat.locataireNom} />
                  <Row label="Téléphone" value={model.contrat.locataireTelephone} />
                  <Row label="E-mail" value={model.contrat.locataireEmail} />
                  <Row label="Note" value={model.contrat.locataireNote} />
                  <Row label="Propriétaire" value={model.contrat.proprietaireNom} />
                  <Row label="Loyer mensuel" value={model.contrat.loyerMensuel !== null ? `${money(model.contrat.loyerMensuel)} / mois` : null} />
                  <Row label="Entrée" value={model.contrat.dateEntree ? formatViewDay(model.contrat.dateEntree) : null} />
                  <Row label="Sortie" value={model.contrat.dateSortie ? formatViewDay(model.contrat.dateSortie) : null} />
                  <Row label="Jour de paiement" value={model.contrat.jourEcheance !== null ? `le ${model.contrat.jourEcheance} du mois` : null} />
                  <Row label="Dernier loyer payé" value={model.contrat.dernierLoyerPaye ? monthLabel(model.contrat.dernierLoyerPaye) : null} />
                  <Row label="Caution" value={model.contrat.caution !== null ? money(model.contrat.caution) : null} />
                  <Row label="Avance" value={model.contrat.avance !== null ? money(model.contrat.avance) : null} />
                </>
              ) : (
                <LabelText>Information non disponible.</LabelText>
              )}
            </Card>

            <Card className="gap-3">
              <SectionTitleText className="text-base">Mon logement</SectionTitleText>
              {model.logement ? (
                <>
                  <Row label="Bien" value={model.logement.nomBien} />
                  <Row label="Logement" value={model.logement.nom} />
                  <Row label="Type" value={model.logement.type} />
                  <Row label="Cuisine" value={model.logement.cuisine} />
                  <Row label="WC" value={model.logement.wc} />
                  <Row label="Adresse" value={model.logement.adresse} />
                  <Row label="Loyer de référence" value={model.logement.loyerReference !== null ? money(model.logement.loyerReference) : null} />
                </>
              ) : (
                <LabelText>Information non disponible.</LabelText>
              )}
            </Card>

            <Card className="gap-3">
              <SectionTitleText className="text-base">Mes loyers en retard</SectionTitleText>
              {model.retards?.fiable ? (
                model.retards.mois.length === 0 ? (
                  <BodyMdText>Aucun loyer en retard.</BodyMdText>
                ) : (
                  <>
                    <BodyMdText>{model.retards.mois.length} mois en retard : {model.retards.mois.map(monthLabel).join(', ')}.</BodyMdText>
                    <LabelText>Calcul fait le {model.retards.calculeLe ? formatViewDay(model.retards.calculeLe) : '—'}{model.retards.jourEcheance !== null ? ` : un loyer est attendu le ${model.retards.jourEcheance} du mois et en retard une fois le mois écoulé.` : '.'}</LabelText>
                  </>
                )
              ) : (
                <LabelText>Les retards ne peuvent pas être calculés de façon fiable pour ce contrat : ils ne sont pas affichés.</LabelText>
              )}
            </Card>

            {model.avance ? (
              <Card className="gap-3">
                <SectionTitleText className="text-base">Mon avance</SectionTitleText>
                <Row label="Avance enregistrée" value={money(model.avance.montant)} />
                <Row label="Consommée" value={money(model.avance.consomme)} />
                <Row label="Disponible" value={money(model.avance.disponible)} />
                {model.avance.moisCouverts.length > 0 ? <LabelText>Mois couverts : {model.avance.moisCouverts.map(monthLabel).join(', ')}</LabelText> : null}
              </Card>
            ) : null}

            <View className="gap-3">
              <SectionTitleText className="text-base">Mes paiements</SectionTitleText>
              {model.paiements.length === 0 ? <BodyMdText>Aucun paiement enregistré.</BodyMdText> : null}
              <Card className="gap-0 p-0">
                {model.paiements.map((p, i) => {
                  const label = PAYMENT_LABEL[p.statut];
                  const receipt = buildTenantReceiptText(model, p);
                  return (
                    <View key={p.id}>
                      {i > 0 && <View className="h-px bg-border" />}
                      <Pressable disabled={!receipt} onPress={() => receipt && void Share.share({ title: 'Reçu de paiement de loyer', message: receipt })} accessibilityRole={receipt ? 'button' : undefined} className="flex-row items-center gap-3 p-gutter-card active:bg-background-secondary">
                        <MaterialIcons name={label.icon} size={22} color={label.color} />
                        <View className="flex-1">
                          <SectionTitleText className="text-base" numberOfLines={1}>{monthLabel(p.mois)}</SectionTitleText>
                          <LabelText style={{ color: label.color }}>{label.text}{p.modePaiement ? ` · ${p.modePaiement}` : ''}{receipt ? ' · toucher pour partager le reçu' : ''}</LabelText>
                        </View>
                        <LabelText className="font-inter-semibold text-text-primary">{p.montant !== null ? money(p.montant) : ''}</LabelText>
                      </Pressable>
                    </View>
                  );
                })}
              </Card>
            </View>

            <View className="gap-3">
              <SectionTitleText className="text-base">Historique de mon contrat</SectionTitleText>
              {model.evenements.length === 0 ? <BodyMdText>Aucun événement.</BodyMdText> : null}
              {model.evenements.map((e) => (
                <View key={e.id} className="gap-0.5">
                  <BodyMdText className="text-text-primary">{EVENT_LABEL[e.type]}{e.mois ? ` (${monthLabel(e.mois)})` : ''}</BodyMdText>
                  <LabelText>{formatViewDay(e.date)}</LabelText>
                </View>
              ))}
            </View>
          </>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}
