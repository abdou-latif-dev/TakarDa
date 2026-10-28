import { useCallback, useState } from 'react';
import { ScrollView, View } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { MaterialIcons } from '@expo/vector-icons';
import { AppHeader } from '@/components/ui/AppHeader';
import { PrimaryButton, SecondaryButton } from '@/components/ui/Button';
import { ErrorState, LoadingState } from '@/components/ui/States';
import { LabelText, SectionTitleText } from '@/components/ui/Typography';
import { Colors } from '@/constants/theme';
import { getCatalogModels, type CatalogModel, type ToolModelKey } from '@/services/toolCatalogService';
import { ensureInstalledTools, getMyTools, installTool, restoreTool, type MyTools } from '@/services/toolRegistryService';
import { InlineNotice, type NoticeTone } from '@/features/utilities/components/InlineNotice';

type State = 'none' | 'installed' | 'hidden';

/** Catalogue TakarDa : les modèles proposés. Ajouter un modèle crée (ou retrouve) son outil
 * dans Mes outils — jamais de doublon. « Bientôt » : visible, non installable. */
export function CatalogueScreen() {
  const [mine, setMine] = useState<MyTools | null>(null);
  const [error, setError] = useState(false);
  const [notice, setNotice] = useState<{ tone: NoticeTone; text: string } | null>(null);
  const [busyKey, setBusyKey] = useState<ToolModelKey | null>(null);

  const load = useCallback(async () => {
    try {
      await ensureInstalledTools();
      setMine(await getMyTools());
      setError(false);
    } catch {
      setError(true);
    }
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const stateOf = (model: CatalogModel): State => {
    if (mine?.owned.some((t) => t.model.key === model.key)) return 'installed';
    if (mine?.hidden.some((t) => t.model.key === model.key)) return 'hidden';
    return 'none';
  };

  const add = async (model: CatalogModel) => {
    setBusyKey(model.key);
    try {
      const hidden = mine?.hidden.find((t) => t.model.key === model.key);
      if (hidden) await restoreTool(hidden.tool.id);
      else await installTool(model.key);
      setNotice({ tone: 'success', text: `${model.title} est dans Mes outils.` });
    } catch (e) {
      setNotice({ tone: 'error', text: e instanceof Error ? e.message : 'Une erreur est survenue.' });
    } finally {
      await load();
      setBusyKey(null);
    }
  };

  return (
    <SafeAreaView className="flex-1 bg-background" edges={['top', 'bottom']}>
      <AppHeader title="Catalogue" showBack />
      <ScrollView contentContainerClassName="w-full max-w-3xl gap-3 self-center px-page-margin pb-10" showsVerticalScrollIndicator={false}>
        <LabelText>Choisissez les outils que vous voulez utiliser. Ils apparaissent ensuite dans Mes outils.</LabelText>
        {notice && <InlineNotice tone={notice.tone}>{notice.text}</InlineNotice>}
        {error ? (
          <ErrorState onRetry={load} />
        ) : !mine ? (
          <LoadingState />
        ) : (
          getCatalogModels().map((model) => {
            const state = stateOf(model);
            return (
              <View key={model.key} className="gap-3 rounded-xl border border-border bg-surface p-gutter-card">
                <View className="flex-row items-center gap-3">
                  <View className="h-11 w-11 items-center justify-center rounded-full bg-primary-soft">
                    <MaterialIcons name={model.icon} size={20} color={Colors.primary} />
                  </View>
                  <View className="flex-1">
                    <SectionTitleText className="text-base">{model.title}</SectionTitleText>
                    <LabelText>{model.description}</LabelText>
                  </View>
                </View>
                {!model.installable ? (
                  <View className="self-start rounded-full bg-surface-container px-3 py-1">
                    <LabelText className="font-inter-semibold">Bientôt</LabelText>
                  </View>
                ) : state === 'installed' ? (
                  <View className="flex-row items-center gap-3">
                    <View className="flex-row items-center gap-1">
                      <MaterialIcons name="check-circle" size={16} color={Colors.success} />
                      <LabelText className="font-inter-semibold">Ajouté</LabelText>
                    </View>
                    <SecondaryButton label="Ouvrir" fullWidth={false} onPress={() => model.route && router.push(model.route as never)} />
                  </View>
                ) : (
                  <PrimaryButton
                    label={state === 'hidden' ? 'Réafficher' : 'Ajouter'}
                    icon={state === 'hidden' ? 'visibility' : 'add'}
                    fullWidth={false}
                    className="self-start"
                    loading={busyKey === model.key}
                    disabled={busyKey !== null}
                    onPress={() => add(model)}
                  />
                )}
              </View>
            );
          })
        )}
      </ScrollView>
    </SafeAreaView>
  );
}
