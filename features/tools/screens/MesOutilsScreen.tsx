import { useCallback, useState } from 'react';
import { ScrollView, View } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { AppHeader } from '@/components/ui/AppHeader';
import { IconButton, PrimaryButton, SecondaryButton } from '@/components/ui/Button';
import { EmptyState, ErrorState, LoadingState } from '@/components/ui/States';
import { BodyMdText, LabelText, SectionTitleText } from '@/components/ui/Typography';
import { ensureInstalledTools, getMyTools, hideTool, restoreTool, type MyTools } from '@/services/toolRegistryService';
import { InlineNotice, type NoticeTone } from '@/features/utilities/components/InlineNotice';
import { ToolTile } from '../components/ToolTile';

/** Mes Outils : ce que j'utilise (« Mes outils »), puis, seulement s'il y en a, ce qui est
 * partagé avec moi (vide tant que le partage n'existe pas) et les outils retirés. Retirer un
 * outil le masque : ses données restent entièrement conservées. */
export function MesOutilsScreen({ variant = 'stack' }: { variant?: 'tab' | 'stack' }) {
  const isTab = variant === 'tab';
  const [data, setData] = useState<MyTools | null>(null);
  const [error, setError] = useState(false);
  const [notice, setNotice] = useState<{ tone: NoticeTone; text: string } | null>(null);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      await ensureInstalledTools(); // une installation existante retrouve ses outils
      setData(await getMyTools());
      setError(false);
    } catch {
      setError(true);
    }
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const run = async (action: () => Promise<unknown>, success: string) => {
    setBusy(true);
    try {
      await action();
      setNotice({ tone: 'success', text: success });
    } catch (e) {
      setNotice({ tone: 'error', text: e instanceof Error ? e.message : 'Une erreur est survenue.' });
    } finally {
      setConfirmId(null);
      await load();
      setBusy(false);
    }
  };

  const empty = data !== null && data.owned.length === 0 && data.shared.length === 0 && data.hidden.length === 0;

  return (
    <SafeAreaView className="flex-1 bg-background" edges={isTab ? ['top'] : ['top', 'bottom']}>
      {/* Le « + » ouvre l'écran de raccourcis (Formulaire, Scanner, Catalogue) : il ne crée jamais directement une tontine, un bien ou une facture. */}
      <AppHeader title="Mes Outils" showBack={!isTab} trailing={<IconButton icon="add" onPress={() => router.push('/mes-outils/ajouter' as never)} />} />
      <ScrollView contentContainerClassName="w-full max-w-3xl gap-5 self-center px-page-margin pb-10" showsVerticalScrollIndicator={false}>
        {notice && <InlineNotice tone={notice.tone}>{notice.text}</InlineNotice>}
        {error ? (
          <ErrorState onRetry={load} />
        ) : !data ? (
          <LoadingState />
        ) : empty ? (
          <EmptyState
            icon="dashboard-customize"
            title="Aucun outil pour l'instant"
            description="Choisissez un modèle dans le catalogue pour l'ajouter à Mes outils."
            actionLabel="Ouvrir le catalogue"
            onAction={() => router.push('/mes-outils/catalogue' as never)}
          />
        ) : (
          <>
            {data.owned.length > 0 && (
              <View className="gap-3">
                <SectionTitleText className="text-base">Mes outils</SectionTitleText>
                {data.owned.map((item) => (
                  <View key={item.tool.id} className="gap-2">
                    <ToolTile item={item} onOpen={() => router.push(item.route as never)} />
                    {confirmId === item.tool.id ? (
                      <View className="gap-2 rounded-xl border border-border bg-surface p-gutter-card">
                        <BodyMdText className="text-text-primary">
                          Retirer {item.model.title} de Mes outils ? Vos données sont conservées ; vous pourrez le réafficher à tout moment.
                        </BodyMdText>
                        <View className="flex-row gap-3">
                          <View className="flex-1"><SecondaryButton label="Annuler" disabled={busy} onPress={() => setConfirmId(null)} /></View>
                          <View className="flex-1"><PrimaryButton label="Retirer" loading={busy} onPress={() => run(() => hideTool(item.tool.id), `${item.model.title} a été retiré de Mes outils.`)} /></View>
                        </View>
                      </View>
                    ) : (
                      <SecondaryButton label={`Retirer ${item.model.title}`} icon="visibility-off" fullWidth={false} className="self-start" onPress={() => setConfirmId(item.tool.id)} />
                    )}
                  </View>
                ))}
              </View>
            )}

            {data.shared.length > 0 && (
              <View className="gap-3">
                <SectionTitleText className="text-base">Partagés avec moi</SectionTitleText>
                {data.shared.map((item) => (
                  <ToolTile key={item.tool.id} item={item} onOpen={() => router.push(item.route as never)} />
                ))}
              </View>
            )}

            {data.hidden.length > 0 && (
              <View className="gap-3">
                <SectionTitleText className="text-base">Outils retirés</SectionTitleText>
                <LabelText>Leurs données sont conservées.</LabelText>
                {data.hidden.map((item) => (
                  <View key={item.tool.id} className="flex-row items-center gap-3 rounded-xl border border-border bg-surface p-gutter-card">
                    <BodyMdText className="flex-1 text-text-primary">{item.model.title}</BodyMdText>
                    <SecondaryButton label="Réafficher" icon="visibility" fullWidth={false} loading={busy} onPress={() => run(() => restoreTool(item.tool.id), `${item.model.title} est de nouveau dans Mes outils.`)} />
                  </View>
                ))}
              </View>
            )}
          </>
        )}
        <SecondaryButton label="Catalogue" icon="dashboard-customize" onPress={() => router.push('/mes-outils/catalogue' as never)} />
      </ScrollView>
    </SafeAreaView>
  );
}
