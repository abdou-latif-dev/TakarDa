// Donnée de démonstration « Formulaires » : un formulaire d'exemple avec trois champs et deux réponses, créés par les MÊMES services que les écrans (formService, submissionService).
// Réservé à l'espace de démonstration : refuse de s'exécuter ailleurs, donc ne peut jamais écrire dans les données personnelles. Noms suffixés « (démo) ».

import { formService } from './formService';
import { isDemoWorkspace } from './persistence';
import { submissionService } from './submissionService';

export const DEMO_FORM_TITLE = 'Fiche de visite (démo)';

export async function seedDemoForms(): Promise<string> {
  if (!isDemoWorkspace()) throw new Error('Les exemples de formulaire ne se créent que dans l’espace de démonstration.');
  const form = await formService.createForm({ title: DEMO_FORM_TITLE, description: 'Exemple de formulaire rempli par un visiteur (données fictives).' });
  await formService.addField(form.id, { type: 'text', label: 'Nom du visiteur', required: true });
  await formService.addField(form.id, { type: 'phone', label: 'Téléphone', required: true });
  await formService.addField(form.id, { type: 'text', label: 'Logement visité', required: false });
  for (const clientName of ['Prisca Adjovi (démo)', 'Komi Ayivi (démo)']) {
    await submissionService.createSubmission({ formId: form.id, clientName, answers: [] });
  }
  return form.id;
}
