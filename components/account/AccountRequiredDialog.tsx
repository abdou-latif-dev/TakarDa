import { router } from 'expo-router';
import { Dialog } from '@/components/ui/Dialog';
import { CLOUD_ACCOUNT_ENABLED } from '@/constants/features';
import { ACCOUNT_UNAVAILABLE_COPY, accountPromptCopy, resolveAccountChoice, type AccountChoice } from '@/services/accountPromptService';
import { useAccountPromptStore } from '@/store/accountPromptStore';

/** Fenêtre « un compte est nécessaire » : S'inscrire, Se connecter, Plus tard. Voir services/accountPromptService.ts. */
export function AccountRequiredDialog() {
  const { visible, reason, unavailable, close, showUnavailable } = useAccountPromptStore();

  const choose = (choice: AccountChoice) => {
    const result = resolveAccountChoice(choice, CLOUD_ACCOUNT_ENABLED);
    if (result.kind === 'unavailable') {
      showUnavailable();
      return;
    }
    close();
    router.push(result.route as never);
  };

  if (unavailable) {
    return <Dialog visible={visible} onClose={close} title={ACCOUNT_UNAVAILABLE_COPY.title} message={ACCOUNT_UNAVAILABLE_COPY.message} actions={[{ label: 'OK', onPress: close }]} />;
  }
  const copy = accountPromptCopy(reason);
  return (
    <Dialog
      visible={visible}
      onClose={close}
      title={copy.title}
      message={copy.message}
      actions={[
        { label: 'S’inscrire', onPress: () => choose('sign-up') },
        { label: 'Se connecter', variant: 'secondary', onPress: () => choose('login') },
        { label: 'Plus tard', variant: 'secondary', onPress: close },
      ]}
    />
  );
}
