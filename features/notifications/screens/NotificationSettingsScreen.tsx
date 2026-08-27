import { useEffect, useState } from 'react';
import { ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { MaterialIcons } from '@expo/vector-icons';
import { AppHeader } from '@/components/ui/AppHeader';
import { Card } from '@/components/ui/Card';
import { Switch } from '@/components/ui/Switch';
import { LabelText } from '@/components/ui/Typography';
import { Colors } from '@/constants/theme';
import { storage } from '@/services/storage';

const SETTINGS = [
  { key: 'contributions', icon: 'payments', label: 'Cotisations' },
  { key: 'forms', icon: 'assignment', label: 'Formulaires' },
  { key: 'tontines', icon: 'savings', label: 'Tontines' },
  { key: 'activities', icon: 'schedule', label: 'Activités' },
  { key: 'security', icon: 'shield', label: 'Sécurité' },
] as const satisfies readonly { key: string; icon: keyof typeof MaterialIcons.glyphMap; label: string }[];

const STORAGE_KEY = 'notification_preferences';
const DEFAULTS: Record<string, boolean> = { contributions: true, forms: true, tontines: false, activities: true, security: true };

export function NotificationSettingsScreen() {
  const [prefs, setPrefs] = useState<Record<string, boolean>>(DEFAULTS);

  useEffect(() => {
    storage.get<Record<string, boolean>>(STORAGE_KEY).then((saved) => {
      if (saved) setPrefs(saved);
    });
  }, []);

  const toggle = (key: string, value: boolean) => {
    const next = { ...prefs, [key]: value };
    setPrefs(next);
    storage.set(STORAGE_KEY, next);
  };

  return (
    <SafeAreaView className="flex-1 bg-white" edges={['top', 'bottom']}>
      <AppHeader title="Notifications" showBack />
      <ScrollView contentContainerClassName="gap-4 px-page-margin pb-10">
        <Card className="gap-0 p-0">
          {SETTINGS.map((setting, i) => (
            <View key={setting.key}>
              {i > 0 && <View className="h-px bg-border ml-[52px]" />}
              <View className="flex-row items-center gap-3 p-gutter-card">
                <View className="h-8 w-8 items-center justify-center rounded-full bg-surface-container">
                  <MaterialIcons name={setting.icon} size={16} color={Colors.textSecondary} />
                </View>
                <LabelText className="flex-1 text-base text-text-primary">{setting.label}</LabelText>
                <Switch value={prefs[setting.key] ?? false} onValueChange={(v) => toggle(setting.key, v)} />
              </View>
            </View>
          ))}
        </Card>
        <LabelText>
          Vous pouvez ajuster comment vous recevez des alertes pour différentes actions dans l&apos;application.
        </LabelText>
      </ScrollView>
    </SafeAreaView>
  );
}
