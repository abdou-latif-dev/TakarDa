import { useCallback } from 'react';
import { Pressable, Text, View } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import { MaterialIcons } from '@expo/vector-icons';
import { Avatar } from '@/components/ui/Avatar';
import { LabelText } from '@/components/ui/Typography';
import { Colors } from '@/constants/theme';
import { useAuthStore } from '@/store/authStore';
import { useNotificationStore } from '@/store/notificationStore';
import { buildProfileView, greetingName } from '@/services/profileService';

/** En-tête de l'accueil, sur UNE ligne : avatar (photo locale si elle existe, sinon initiales), « Bonjour, » + prénom
 * (une seule ligne, tronqué avec « … » si trop long : jamais de débordement), et la cloche à droite, centrée sur la même
 * ligne. La cloche ouvre l'écran Notifications existant ; la pastille n'apparaît que s'il existe de VRAIES notifications
 * non lues (aucune n'est générée en V1 : l'écran affiche alors « Tout est à jour »). */
export function HomeHeader() {
  const user = useAuthStore((s) => s.user);
  const unreadCount = useNotificationStore((s) => s.unreadCount);
  const fetchNotifications = useNotificationStore((s) => s.fetch);
  const view = buildProfileView(user);

  useFocusEffect(useCallback(() => { fetchNotifications(); }, [fetchNotifications]));

  return (
    <View className="flex-row items-center gap-3">
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Ouvrir mon profil"
        onPress={() => router.push('/(tabs)/profile')}
        className="min-w-0 flex-1 flex-row items-center gap-3">
        <Avatar solid name={view.name} uri={view.avatarUri} size={44} />
        <Text numberOfLines={1} className="min-w-0 flex-1 text-base text-text-secondary font-manrope">
          Bonjour, <Text className="font-manrope-bold text-text-primary">{greetingName(user)}</Text>
        </Text>
      </Pressable>

      <Pressable
        accessibilityRole="button"
        accessibilityLabel={unreadCount > 0 ? `Notifications, ${unreadCount} non lue${unreadCount > 1 ? 's' : ''}` : 'Notifications'}
        onPress={() => router.push('/notifications' as never)}
        hitSlop={4}
        className="h-11 w-11 items-center justify-center rounded-full border border-border bg-surface active:opacity-70">
        <MaterialIcons name="notifications-none" size={24} color={Colors.textPrimary} />
        {unreadCount > 0 && (
          <View className="absolute -right-1 -top-1 h-5 min-w-5 items-center justify-center rounded-full bg-primary px-1">
            <LabelText className="text-[11px] leading-[14px] font-inter-semibold" style={{ color: Colors.textOnPrimary }}>{unreadCount > 9 ? '9+' : unreadCount}</LabelText>
          </View>
        )}
      </Pressable>
    </View>
  );
}
