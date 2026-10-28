import { useCallback, useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import { MaterialIcons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Card } from '@/components/ui/Card';
import { QuickActionCard } from '@/components/ui/QuickActionCard';
import { SectionHeader } from '@/components/ui/SectionHeader';
import { ActivityItem } from '@/components/ui/ActivityItem';
import { EmptyState, LoadingState } from '@/components/ui/States';
import { LabelText, SectionTitleText } from '@/components/ui/Typography';
import { IconButton, SecondaryButton } from '@/components/ui/Button';
import { Colors } from '@/constants/theme';
import { HomeAccountPrompt } from '@/components/account/HomeAccountPrompt';
import { HomeHeader } from '../components/HomeHeader';
import { dismissAnnouncement, loadHomeFeed, type AlertSeverity, type HomeAlert, type HomeFeed } from '@/services/homeService';

const ALERT_ICON: Record<AlertSeverity, keyof typeof MaterialIcons.glyphMap> = { late: 'error-outline', pending: 'payments', info: 'event' };

function AlertRow({ alert }: { alert: HomeAlert }) {
  // Lues ici (pas au niveau du module) : `Colors` est mutable et doit être relu à chaque rendu.
  const tint = alert.severity === 'late' ? Colors.error : alert.severity === 'pending' ? Colors.warning : Colors.primary;
  return (
    <Pressable
      accessibilityRole="button"
      onPress={() => router.push(alert.route as never)}
      className="flex-row items-center gap-3 rounded-xl border border-border bg-surface p-gutter-card active:opacity-90">
      <View className="h-10 w-10 items-center justify-center rounded-full bg-surface-container">
        <MaterialIcons name={ALERT_ICON[alert.severity]} size={20} color={tint} />
      </View>
      <View className="flex-1">
        <SectionTitleText className="text-base" numberOfLines={1}>{alert.title}</SectionTitleText>
        <LabelText numberOfLines={2}>{alert.detail}</LabelText>
      </View>
      <MaterialIcons name="chevron-right" size={20} color={Colors.emptyIcon} />
    </Pressable>
  );
}

/** Accueil : bienvenue, mes outils récents, à surveiller, activités récentes et annonce locale. Tout est
 * calculé par services/homeService (lecture seule) ; ouvrir l'accueil n'enregistre aucune activité. */
export function HomeScreen() {
  const [feed, setFeed] = useState<HomeFeed | null>(null);

  const load = useCallback(async () => {
    setFeed(await loadHomeFeed());
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const onDismiss = async (id: string) => {
    await dismissAnnouncement(id);
    await load();
  };

  return (
    <SafeAreaView className="flex-1 bg-background" edges={['top']}>
      <ScrollView contentContainerClassName="gap-6 px-page-margin pb-10 pt-2" showsVerticalScrollIndicator={false}>
        {/* 1. Bienvenue — identité locale, aucune connexion requise */}
        <HomeHeader />

        {/* Inscription / connexion : facultatives, juste sous l'en-tête ; le bloc disparaît une fois connecté */}
        <HomeAccountPrompt />

        {!feed ? (
          <LoadingState />
        ) : (
          <>
            {/* 2. Mes outils récents */}
            <View className="gap-3">
              <SectionHeader title="Mes outils récents" />
              {feed.tools.length === 0 ? (
                <EmptyState
                  compact
                  icon="dashboard-customize"
                  title="Aucun outil pour l'instant"
                  description="Ajoutez Immobilier, Tontine, CEET ou TDE depuis le catalogue."
                  actionLabel="Ouvrir le catalogue"
                  onAction={() => router.push('/mes-outils/catalogue' as never)}
                />
              ) : (
                <View className="flex-row flex-wrap gap-3">
                  {feed.tools.map((item) => (
                    <QuickActionCard
                      key={item.tool.id}
                      icon={item.model.icon}
                      title={item.model.title}
                      subtitle={item.model.description}
                      onPress={() => router.push(item.route as never)}
                    />
                  ))}
                </View>
              )}
            </View>

            {/* 3. À surveiller — uniquement des situations réelles des outils installés */}
            {feed.tools.length > 0 && (
              <View className="gap-3">
                <SectionHeader title="À surveiller" />
                {feed.alerts.length === 0 ? (
                  <Card><LabelText>Rien à signaler pour le moment.</LabelText></Card>
                ) : (
                  feed.alerts.map((alert) => <AlertRow key={alert.id} alert={alert} />)
                )}
              </View>
            )}

            {/* 4. Activités récentes et annonce locale */}
            <View className="gap-3">
              <SectionHeader title="Activités récentes" action="Voir tout" onAction={() => router.push('/(tabs)/activity')} />
              {feed.activities.length === 0 ? (
                <EmptyState compact icon="history" title="Pas encore d'activité" description="Vos actions apparaîtront ici." />
              ) : (
                <View className="rounded-xl border border-border bg-surface p-gutter-card shadow-soft">
                  {feed.activities.map((event, i) => (
                    <ActivityItem key={event.id} event={event} isLast={i === feed.activities.length - 1} />
                  ))}
                </View>
              )}
            </View>

            {feed.announcement && (
              <Card className="gap-3">
                <View className="flex-row items-start gap-3">
                  <View className="h-10 w-10 items-center justify-center rounded-full bg-primary-soft">
                    <MaterialIcons name={feed.announcement.icon} size={20} color={Colors.primary} />
                  </View>
                  <View className="flex-1 gap-1">
                    <View className="self-start rounded-full bg-surface-container px-2.5 py-0.5">
                      <LabelText className="font-inter-semibold">Annonce</LabelText>
                    </View>
                    <SectionTitleText className="text-base">{feed.announcement.title}</SectionTitleText>
                    <LabelText>{feed.announcement.description}</LabelText>
                  </View>
                  <IconButton icon="close" size={16} onPress={() => onDismiss(feed.announcement!.id)} />
                </View>
                {feed.announcement.action && (
                  <SecondaryButton label={feed.announcement.action.label} fullWidth={false} className="self-start" onPress={() => router.push(feed.announcement!.action!.route as never)} />
                )}
              </Card>
            )}
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}
