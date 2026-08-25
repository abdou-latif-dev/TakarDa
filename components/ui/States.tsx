import { Pressable, View, type ComponentProps } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { SectionTitleText, BodyMdText, LabelText } from './Typography';
import { PrimaryButton, SecondaryButton } from './Button';
import { Colors } from '@/constants/theme';

type IconName = ComponentProps<typeof MaterialIcons>['name'];

interface EmptyStateProps {
  icon: IconName;
  title: string;
  description: string;
  actionLabel?: string;
  onAction?: () => void;
  compact?: boolean;
}

/** No-data placeholder — reused for empty groups, forms, activity, notifications, search results. */
export function EmptyState({ icon, title, description, actionLabel, onAction, compact }: EmptyStateProps) {
  return (
    <View className={`items-center justify-center gap-3 rounded-lg border border-border bg-surface px-6 ${compact ? 'py-8' : 'py-14'}`}>
      <View
        className="items-center justify-center rounded-full bg-background-secondary"
        style={{ width: compact ? 64 : 96, height: compact ? 64 : 96 }}>
        <MaterialIcons name={icon} size={compact ? 28 : 40} color={Colors.emptyIcon} />
      </View>
      <SectionTitleText className="text-center">{title}</SectionTitleText>
      <BodyMdText className="text-center">{description}</BodyMdText>
      {actionLabel && (
        <SecondaryButton label={actionLabel} onPress={onAction} fullWidth={false} className="mt-1 px-6" />
      )}
    </View>
  );
}

/** Blocking error placeholder with retry — network failures, failed loads. */
export function ErrorState({
  title = 'Une erreur est survenue',
  description = 'Impossible de charger vos données.',
  onRetry,
  onBack,
}: {
  title?: string;
  description?: string;
  onRetry?: () => void;
  onBack?: () => void;
}) {
  return (
    <View className="items-center justify-center gap-3 rounded-xl border border-border bg-surface px-8 py-14">
      <View className="items-center justify-center rounded-full bg-error-container/40" style={{ width: 96, height: 96 }}>
        <MaterialIcons name="cloud-off" size={40} color={Colors.error} />
      </View>
      <SectionTitleText className="text-center">{title}</SectionTitleText>
      <BodyMdText className="text-center">{description}</BodyMdText>
      <View className="mt-2 w-full gap-3">
        {onRetry && <PrimaryButton label="Réessayer" icon="refresh" onPress={onRetry} />}
        {onBack && <SecondaryButton label="Retour" onPress={onBack} />}
      </View>
    </View>
  );
}

/** Shimmering rectangle — building block for skeleton loading states. */
export function Skeleton({ className, style }: { className?: string; style?: object }) {
  return <View className={`rounded bg-skeleton ${className ?? ''}`} style={style} />;
}

/** Full skeleton mimicking a stat-grid + list layout while data loads. */
export function LoadingState() {
  return (
    <View className="gap-6">
      <View className="flex-row flex-wrap gap-3">
        {[0, 1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-28 flex-1 basis-[45%] rounded-lg" />
        ))}
      </View>
      <Skeleton className="h-5 w-32" />
      <View className="gap-px overflow-hidden rounded-lg">
        {[0, 1, 2].map((i) => (
          <Skeleton key={i} className="h-14 w-full" />
        ))}
      </View>
    </View>
  );
}

/** Dismissible banner signalling degraded connectivity — content below stays usable. */
export function OfflineBanner({ onDismiss }: { onDismiss?: () => void }) {
  return (
    <View className="mx-page-margin flex-row items-center gap-2 rounded-full border border-border bg-surface/95 px-4 py-2 shadow-soft">
      <MaterialIcons name="cloud-off" size={18} color={Colors.primary} />
      <LabelText className="flex-1 text-text-primary">
        Connexion limitée — vos données seront synchronisées dès que possible.
      </LabelText>
      {onDismiss && (
        <Pressable onPress={onDismiss} hitSlop={8}>
          <MaterialIcons name="close" size={16} color={Colors.textMuted} />
        </Pressable>
      )}
    </View>
  );
}
