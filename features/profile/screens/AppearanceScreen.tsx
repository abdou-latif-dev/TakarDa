import { Pressable, ScrollView, View } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import { AppHeader } from '@/components/ui/AppHeader';
import { Card } from '@/components/ui/Card';
import { BodyMdText, LabelText, SectionTitleText } from '@/components/ui/Typography';
import { Colors } from '@/constants/theme';
import { useThemeStore, type ThemeMode } from '@/store/themeStore';

const OPTIONS: { mode: ThemeMode; title: string; description: string; icon: keyof typeof MaterialIcons.glyphMap }[] = [
  { mode: 'system', title: 'Système', description: 'Suit le réglage clair ou sombre de votre téléphone.', icon: 'brightness-auto' },
  { mode: 'light', title: 'Clair', description: 'Fond clair et texte sombre.', icon: 'light-mode' },
  { mode: 'dark', title: 'Sombre', description: 'Fond sombre et texte clair.', icon: 'dark-mode' },
];

export function AppearanceScreen() {
  const mode = useThemeStore((state) => state.mode);
  const setMode = useThemeStore((state) => state.setMode);

  return (
    <SafeAreaView className="flex-1 bg-background" edges={['top', 'bottom']}>
      <AppHeader title="Apparence" showBack />
      <ScrollView contentContainerClassName="gap-4 px-page-margin pb-10">
        <View className="gap-1">
          <SectionTitleText className="text-base">Thème de l’application</SectionTitleText>
          <BodyMdText>Choisissez l’apparence de TakarDa. Ce réglage est conservé sur cet appareil.</BodyMdText>
        </View>
        <Card className="gap-2 p-2">
          {OPTIONS.map((option) => {
            const selected = mode === option.mode;
            return (
              <Pressable
                key={option.mode}
                accessibilityRole="radio"
                accessibilityState={{ checked: selected }}
                onPress={() => { void setMode(option.mode); }}
                className={`flex-row items-center gap-3 rounded-lg p-3 ${selected ? 'bg-background-secondary' : ''}`}>
                <View className={`h-11 w-11 items-center justify-center rounded-full ${selected ? 'bg-primary-soft' : 'bg-surface-container'}`}>
                  <MaterialIcons name={option.icon} size={22} color={Colors.primary} />
                </View>
                <View className="flex-1 gap-0.5">
                  <LabelText className="font-inter-semibold text-text-primary">{option.title}</LabelText>
                  <BodyMdText>{option.description}</BodyMdText>
                </View>
                {selected && <MaterialIcons name="check-circle" size={22} color={Colors.primary} />}
              </Pressable>
            );
          })}
        </Card>
      </ScrollView>
    </SafeAreaView>
  );
}
