import type { ReactNode } from 'react';
import { KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, View } from 'react-native';
import { DestructiveButton, PrimaryButton, SecondaryButton } from './Button';
import { BodyMdText, SectionTitleText } from './Typography';

export interface DialogAction {
  label: string;
  onPress: () => void;
  /** primary : action principale pleine ; secondary : tonale ; destructive : rouge clair. */
  variant?: 'primary' | 'secondary' | 'destructive';
  loading?: boolean;
}

interface DialogProps {
  visible: boolean;
  title: string;
  message?: string;
  /** Contenu libre sous le message (champs, détails). */
  children?: ReactNode;
  /** Du plus important au moins important : affichées en colonne, pleine largeur (toujours accessibles au pouce). */
  actions: DialogAction[];
  /** Fermeture par le fond ou le retour Android ; absente = le dialogue ne se ferme que par ses actions. */
  onClose?: () => void;
}

/** Dialogue TakarDa (fenêtre React Native) : coins arrondis, marges, titre › explication › actions. Il suit le thème clair
 * ou sombre comme le reste de l'application. Les boîtes `Alert.alert` natives d'Android ne peuvent pas être stylisées :
 * ce composant les remplace là où le design compte. Le contenu défile si le texte est long ou si le clavier est ouvert. */
export function Dialog({ visible, title, message, children, actions, onClose }: DialogProps) {
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose} statusBarTranslucent>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} className="flex-1">
        <Pressable accessibilityLabel="Fermer" disabled={!onClose} onPress={onClose} className="flex-1 items-center justify-center bg-black/50 px-5">
          {/* Le fond ferme le dialogue ; la carte, elle, absorbe l'appui. */}
          <Pressable className="max-h-[85%] w-full max-w-md rounded-xl border border-border bg-surface shadow-soft">
            <ScrollView contentContainerClassName="gap-4 p-5" keyboardShouldPersistTaps="handled" bounces={false}>
              <View className="gap-2">
                <SectionTitleText>{title}</SectionTitleText>
                {message ? <BodyMdText>{message}</BodyMdText> : null}
              </View>
              {children}
              <View className="gap-2.5">
                {actions.map((action) =>
                  action.variant === 'destructive' ? (
                    <DestructiveButton key={action.label} label={action.label} loading={action.loading} onPress={action.onPress} />
                  ) : action.variant === 'secondary' ? (
                    <SecondaryButton key={action.label} label={action.label} loading={action.loading} onPress={action.onPress} />
                  ) : (
                    <PrimaryButton key={action.label} label={action.label} loading={action.loading} onPress={action.onPress} />
                  ),
                )}
              </View>
            </ScrollView>
          </Pressable>
        </Pressable>
      </KeyboardAvoidingView>
    </Modal>
  );
}
