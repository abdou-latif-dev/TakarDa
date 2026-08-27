import { useEffect, useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { MaterialIcons } from '@expo/vector-icons';
import { Card } from '@/components/ui/Card';
import { TextField, TextAreaField } from '@/components/ui/TextField';
import { PrimaryButton } from '@/components/ui/Button';
import { Switch } from '@/components/ui/Switch';
import { Avatar } from '@/components/ui/Avatar';
import { SectionTitleText, LabelText, BodyLgText } from '@/components/ui/Typography';
import { Colors } from '@/constants/theme';
import { useGroupStore } from '@/store/groupStore';
import { useTontineStore } from '@/store/tontineStore';
import { formatLongDate } from '@/utils/format';

export function AddContributionScreen() {
  const { groupId } = useLocalSearchParams<{ groupId: string }>();
  const { members, fetchMembers } = useGroupStore();
  const addContribution = useTontineStore((s) => s.addContribution);
  const summary = useTontineStore((s) => s.summaries[groupId]);

  const groupMembers = members[groupId] ?? [];
  const [memberId, setMemberId] = useState<string | undefined>();
  const [pickerOpen, setPickerOpen] = useState(false);
  const [amount, setAmount] = useState('10000');
  const [paid, setPaid] = useState(true);
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (groupMembers.length === 0) fetchMembers(groupId);
  }, [groupId, groupMembers.length, fetchMembers]);

  const selectedMember = groupMembers.find((m) => m.id === memberId);
  const todayLabel = formatLongDate(new Date());

  const onSave = async () => {
    if (!memberId || !summary?.cycle) return;
    setSaving(true);
    try {
      const contribution = await addContribution({
        groupId,
        cycleId: summary.cycle.id,
        memberId,
        amount: Number(amount) || 0,
        status: paid ? 'paid' : 'pending',
        note: note.trim() || undefined,
      });
      router.replace(`/group/${groupId}/tontine/contribution-success?contributionId=${contribution.id}`);
    } finally {
      setSaving(false);
    }
  };

  return (
    <SafeAreaView className="flex-1 bg-white" edges={['top', 'bottom']}>
      <View className="flex-row items-center justify-between px-page-margin py-3">
        <Pressable onPress={() => router.back()} hitSlop={8}>
          <LabelText className="font-inter-semibold text-text-secondary">Annuler</LabelText>
        </Pressable>
        <SectionTitleText className="text-base">Nouvelle cotisation</SectionTitleText>
        <View style={{ width: 50 }} />
      </View>

      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} className="flex-1">
      <ScrollView contentContainerClassName="gap-4 px-page-margin pb-6" keyboardShouldPersistTaps="handled">
        <Card className="gap-0 p-0">
          <Pressable onPress={() => setPickerOpen((o) => !o)} className="flex-row items-center gap-3 p-gutter-card">
            <MaterialIcons name="person" size={20} color={Colors.textSecondary} />
            <LabelText className="flex-1">Membre</LabelText>
            <BodyLgText className={selectedMember ? 'font-inter-semibold' : 'text-text-muted'}>
              {selectedMember?.displayName ?? 'Sélectionner'}
            </BodyLgText>
            <MaterialIcons name="chevron-right" size={18} color={Colors.emptyIcon} />
          </Pressable>

          {pickerOpen && (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerClassName="gap-3 p-gutter-card">
              {groupMembers.map((m) => (
                <Pressable
                  key={m.id}
                  onPress={() => {
                    setMemberId(m.id);
                    setPickerOpen(false);
                  }}
                  className="items-center gap-1">
                  <Avatar name={m.displayName} size={44} />
                  <LabelText>{m.displayName}</LabelText>
                </Pressable>
              ))}
            </ScrollView>
          )}

          <View className="h-px bg-border" />

          <View className="flex-row items-center gap-3 p-gutter-card">
            <View className="h-8 w-8 items-center justify-center rounded-full bg-primary-soft">
              <MaterialIcons name="payments" size={16} color={Colors.primary} />
            </View>
            <LabelText className="flex-1">Montant</LabelText>
            <TextField
              value={amount}
              onChangeText={setAmount}
              keyboardType="numeric"
              containerClassName="w-28"
              textAlign="right"
            />
            <LabelText>FCFA</LabelText>
          </View>

          <View className="h-px bg-border" />

          <View className="flex-row items-center gap-3 p-gutter-card">
            <MaterialIcons name="calendar-today" size={20} color={Colors.textSecondary} />
            <LabelText className="flex-1">Date</LabelText>
            <BodyLgText>Aujourd&apos;hui, {todayLabel}</BodyLgText>
          </View>
        </Card>

        <Card className="gap-4">
          <View className="flex-row items-center gap-3">
            <View className="h-8 w-8 items-center justify-center rounded-full bg-success-container">
              <MaterialIcons name="check-circle" size={16} color={Colors.success} />
            </View>
            <LabelText className="flex-1">Statut : Payé</LabelText>
            <Switch value={paid} onValueChange={setPaid} />
          </View>
          <TextAreaField
            label="Note (optionnelle)"
            placeholder="Ajouter une note..."
            value={note}
            onChangeText={setNote}
          />
        </Card>
      </ScrollView>

      <View className="border-t border-border px-page-margin pb-4 pt-4">
        <PrimaryButton label="Enregistrer" loading={saving} disabled={!memberId} onPress={onSave} />
      </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
