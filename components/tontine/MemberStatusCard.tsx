import { View } from 'react-native';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { BodyLgText, LabelText } from '@/components/ui/Typography';
import { formatFcfa } from '@/utils/format';
import type { StatusKind } from '@/constants/theme';
import type { MemberAccountType } from '@/types/entities';

/**
 * Vertical card for one member's status in a given tour — name/position on
 * top, amount + status badge below. Never a single dense horizontal row
 * (name + guest badge + amount + status all fighting for space): on a small
 * Android phone that either truncates the name or shrinks the status badge
 * into something illegible (Tontine responsive audit, 2026-09-30, §21/§22).
 * Reused by ActiveMembersScreen, the Dashboard's member preview and the
 * "Cotisation +" checklist header context so the same visual language
 * appears everywhere a member + tour amount + status is shown.
 */
export function MemberStatusCard({
  position,
  name,
  accountType,
  amount,
  status,
}: {
  position: number;
  name: string;
  accountType?: MemberAccountType;
  amount: number;
  status: StatusKind;
}) {
  return (
    <View className="gap-2 rounded-lg border border-border bg-surface p-gutter-card shadow-soft">
      <View className="flex-row items-center gap-2">
        <View className="h-6 w-6 items-center justify-center rounded-full bg-primary-soft">
          <LabelText className="font-inter-semibold text-primary-dark">{position}</LabelText>
        </View>
        <BodyLgText className="flex-1 font-inter-semibold" numberOfLines={1}>
          {name}
        </BodyLgText>
        {accountType === 'guest' && (
          <View className="rounded-full bg-surface-container px-2 py-0.5">
            <LabelText className="text-text-secondary">Invité·e</LabelText>
          </View>
        )}
      </View>
      <View className="flex-row items-center justify-between">
        <LabelText className="font-inter-semibold text-text-primary">{formatFcfa(amount)}</LabelText>
        <StatusBadge status={status} />
      </View>
    </View>
  );
}
