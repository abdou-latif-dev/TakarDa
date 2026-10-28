import { Platform, Pressable, ScrollView, View } from 'react-native';
import { router } from 'expo-router';
import Constants from 'expo-constants';
import { MaterialIcons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import { AppHeader } from '@/components/ui/AppHeader';
import { BodyMdText, LabelText, SectionTitleText } from '@/components/ui/Typography';
import { Colors } from '@/constants/theme';
import { shortcutAvailability, visibleShortcuts } from '@/services/shortcutService';

/** Écran du « + » de Mes Outils : trois raccourcis distincts. Le catalogue reste l'endroit où l'on installe,
 * masque et restaure les outils ; ici on ne fait que choisir où aller. */
export function AddShortcutsScreen() {
  const blocked = Constants.expoConfig?.android?.blockedPermissions;
  return (
    <SafeAreaView className="flex-1 bg-background" edges={['top', 'bottom']}>
      <AppHeader title="Ajouter" showBack />
      <ScrollView contentContainerClassName="w-full max-w-3xl gap-3 self-center px-page-margin pb-10" showsVerticalScrollIndicator={false}>
        <BodyMdText>Que voulez-vous faire ?</BodyMdText>
        {visibleShortcuts(Platform.OS, blocked).map((shortcut) => {
          const { available, reason } = shortcutAvailability(shortcut, Platform.OS, blocked);
          return (
            <Pressable
              key={shortcut.id}
              accessibilityRole="button"
              accessibilityState={{ disabled: !available }}
              disabled={!available}
              onPress={() => router.push(shortcut.route as never)}
              className={`flex-row items-center gap-3.5 rounded-xl border border-border bg-surface p-gutter-card shadow-soft active:opacity-80 ${available ? '' : 'opacity-60'}`}>
              <View className="h-12 w-12 items-center justify-center rounded-xl bg-primary-soft">
                <MaterialIcons name={shortcut.icon} size={24} color={Colors.primary} />
              </View>
              <View className="min-w-0 flex-1 gap-0.5">
                <SectionTitleText className="text-base">{shortcut.title}</SectionTitleText>
                <LabelText>{shortcut.description}</LabelText>
                {reason && <LabelText className="mt-1 font-inter-semibold text-warning">{reason}</LabelText>}
              </View>
              {available && <MaterialIcons name="chevron-right" size={22} color={Colors.emptyIcon} />}
            </Pressable>
          );
        })}
      </ScrollView>
    </SafeAreaView>
  );
}
