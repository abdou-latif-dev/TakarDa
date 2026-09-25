import { useEffect, useState } from 'react';
import { ScrollView, View } from 'react-native';
import { router } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { AppHeader } from '@/components/ui/AppHeader';
import { Card } from '@/components/ui/Card';
import { SecondaryButton } from '@/components/ui/Button';
import { LoadingState } from '@/components/ui/States';
import { BodyMdText, SectionTitleText } from '@/components/ui/Typography';
import { ensureImmobilierTool } from '@/services/immobilierService';
import type { EntityDefinition, Tool } from '@/types/entities';

export function ImmobilierFormsScreen() {
  const [tool, setTool] = useState<Tool | null>(null);
  const [entities, setEntities] = useState<EntityDefinition[]>([]);
  useEffect(() => {
    ensureImmobilierTool().then(({ tool: ensured, bien, contrat, paiement, depense }) => {
      setTool(ensured); setEntities([bien, contrat, paiement, depense]);
    });
  }, []);
  return <SafeAreaView className="flex-1 bg-background" edges={['top', 'bottom']}>
    <AppHeader title="Formulaires Immobilier" showBack />
    {!tool ? <LoadingState /> : <ScrollView contentContainerClassName="gap-4 px-page-margin pb-10">
      <Card className="gap-2"><SectionTitleText className="text-base">Adaptez votre cahier</SectionTitleText><BodyMdText>Ajoutez des champs propres à votre activité. Les données déjà saisies restent dans les enregistrements.</BodyMdText></Card>
      {entities.map((entity) => { const plural = entity.labelPlural ?? `${entity.label}s`; return <Card key={entity.id} className="gap-3"><SectionTitleText className="text-base">{plural}</SectionTitleText><BodyMdText>{entity.fields.filter((field) => field.key.startsWith('custom_')).length} champ(s) personnalisé(s)</BodyMdText><SecondaryButton label={`Personnaliser ${plural.toLocaleLowerCase()}`} icon="tune" onPress={() => router.push({ pathname: '/schema/customize' as never, params: { toolId: tool.id, entityDefinitionId: entity.id } })} /></Card>; })}
    </ScrollView>}
  </SafeAreaView>;
}
