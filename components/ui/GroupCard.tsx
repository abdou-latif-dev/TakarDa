import { Pressable, View } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { Avatar } from './Avatar';
import { SectionTitleText, LabelText } from './Typography';
import { Colors } from '@/constants/theme';
import type { Group } from '@/types/entities';

export function GroupCard({ group, onPress }: { group: Group; onPress?: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      className="flex-row items-center gap-4 rounded-lg border border-border bg-surface p-gutter-card shadow-soft active:opacity-90">
      <Avatar name={group.name} size={48} />
      <View className="flex-1">
        <SectionTitleText numberOfLines={1}>{group.name}</SectionTitleText>
        <View className="mt-1 flex-row items-center gap-1">
          <MaterialIcons name="group" size={14} color={Colors.textSecondary} />
          <LabelText>{group.memberCount} membres</LabelText>
          {group.kind === 'tontine' && (
            <LabelText className="text-primary-dark font-inter-semibold"> · Tontine</LabelText>
          )}
        </View>
      </View>
      <MaterialIcons name="chevron-right" size={22} color={Colors.emptyIcon} />
    </Pressable>
  );
}
