import { useEffect, useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { MaterialIcons } from '@expo/vector-icons';
import { AppHeader } from '@/components/ui/AppHeader';
import { Avatar } from '@/components/ui/Avatar';
import { PrimaryButton } from '@/components/ui/Button';
import { LoadingState } from '@/components/ui/States';
import { BodyLgText, BodyMdText, LabelText } from '@/components/ui/Typography';
import { Colors } from '@/constants/theme';
import { useGroupStore } from '@/store/groupStore';
import type { Membership } from '@/types/entities';

export function OrderScreen() {
  const { groupId } = useLocalSearchParams<{ groupId: string }>();
  const { members, membersStatus, fetchMembers, setMemberOrder } = useGroupStore();
  const [order, setOrder] = useState<Membership[]>([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetchMembers(groupId);
  }, [groupId, fetchMembers]);

  useEffect(() => {
    const active = (members[groupId] ?? []).filter((m) => m.status === 'active');
    setOrder([...active].sort((a, b) => (a.position ?? 999) - (b.position ?? 999)));
  }, [members, groupId]);

  const move = (index: number, direction: -1 | 1) => {
    const target = index + direction;
    if (target < 0 || target >= order.length) return;
    setOrder((prev) => {
      const next = [...prev];
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  };

  const onSave = async () => {
    setSaving(true);
    try {
      await setMemberOrder(
        groupId,
        order.map((m) => m.id),
      );
      router.back();
    } finally {
      setSaving(false);
    }
  };

  return (
    <SafeAreaView className="flex-1 bg-white" edges={['top', 'bottom']}>
      <AppHeader title="Ordre de Réception" showBack />
      <View className="px-page-margin pt-2">
        <BodyMdText>Utilisez les flèches pour définir l&apos;ordre dans lequel les membres recevront la cagnotte.</BodyMdText>
      </View>

      {membersStatus[groupId] === 'loading' && !order.length ? (
        <View className="px-page-margin pt-4">
          <LoadingState />
        </View>
      ) : (
        <ScrollView contentContainerClassName="gap-2 px-page-margin py-4" showsVerticalScrollIndicator={false}>
          {order.map((member, i) => (
            <View
              key={member.id}
              className="flex-row items-center gap-3 rounded-lg border border-border bg-surface p-gutter-card shadow-soft">
              <View className="h-7 w-7 items-center justify-center rounded-full bg-primary-soft">
                <LabelText className="font-inter-semibold text-primary-dark">{i + 1}</LabelText>
              </View>
              <Avatar name={member.displayName} size={40} />
              <BodyLgText className="flex-1 font-inter-semibold" numberOfLines={1}>
                {member.displayName}
              </BodyLgText>
              <View className="flex-row gap-1">
                <Pressable
                  onPress={() => move(i, -1)}
                  disabled={i === 0}
                  className="h-9 w-9 items-center justify-center rounded-full bg-surface-container active:opacity-70"
                  style={{ opacity: i === 0 ? 0.35 : 1 }}>
                  <MaterialIcons name="keyboard-arrow-up" size={22} color={Colors.textPrimary} />
                </Pressable>
                <Pressable
                  onPress={() => move(i, 1)}
                  disabled={i === order.length - 1}
                  className="h-9 w-9 items-center justify-center rounded-full bg-surface-container active:opacity-70"
                  style={{ opacity: i === order.length - 1 ? 0.35 : 1 }}>
                  <MaterialIcons name="keyboard-arrow-down" size={22} color={Colors.textPrimary} />
                </Pressable>
              </View>
            </View>
          ))}
        </ScrollView>
      )}

      <View className="border-t border-border px-page-margin pb-4 pt-4">
        <PrimaryButton label="Enregistrer l'ordre" loading={saving} disabled={order.length === 0} onPress={onSave} />
      </View>
    </SafeAreaView>
  );
}
