// Information « Mes données » affichée DANS l'application — F6. Pur : produit le texte à partir de faits que le code garantit (et que des tests vérifient), sans réseau.
// La liste de ce que voit un locataire est DÉRIVÉE du modèle de la vue (TENANT_BODY_FIELDS) : si un champ y est ajouté sans libellé, un test échoue — le texte ne peut
// pas dire moins que ce qui est réellement publié. La politique de confidentialité complète (page Web) est ailleurs ; ceci est l'information de premier niveau.

import { TENANT_BODY_FIELDS, TENANT_ITEM_KINDS, type TenantItemKind } from './sharedModules/model';

export interface PrivacySection {
  id: string;
  title: string;
  /** Paragraphes ou puces (une chaîne = une ligne). */
  lines: string[];
  /** Section qui ne concerne que les comptes et le partage (masquée tant que ces fonctions sont fermées). */
  cloudOnly: boolean;
}

/** Libellé en français de chaque champ de la vue du locataire. Un champ sans libellé fait échouer un test. */
export const TENANT_FIELD_LABELS: Record<TenantItemKind, Record<string, string>> = {
  contrat: {
    statut: 'le statut du contrat',
    locataireNom: 'votre nom',
    locataireTelephone: 'votre téléphone',
    locataireEmail: 'votre e-mail',
    locataireNote: 'la note enregistrée sur vous',
    proprietaireNom: 'le nom du propriétaire',
    loyerMensuel: 'le loyer',
    dateEntree: 'la date d’entrée',
    dateSortie: 'la date de sortie',
    jourEcheance: 'le jour de paiement',
    dernierLoyerPaye: 'le dernier loyer payé',
    caution: 'la caution',
    avance: 'l’avance',
  },
  logement: { nom: 'le nom du logement', type: 'son type', cuisine: 'la cuisine', wc: 'les WC', adresse: 'l’adresse du bien', nomBien: 'le nom du bien', loyerReference: 'le loyer de référence' },
  paiement: {
    mois: 'le mois',
    montant: 'le montant',
    statut: 'le statut',
    dateValidation: 'la date de validation',
    modePaiement: 'le mode de paiement',
    reference: 'la référence du reçu',
    retardsALaDate: 'les loyers en retard à la date du paiement',
  },
  avance: { montant: 'le montant de l’avance', consomme: 'la part consommée', disponible: 'la part disponible', moisCouverts: 'les mois couverts' },
  retards: { fiable: 'si le calcul est fiable', mois: 'les mois en retard', jourEcheance: 'le jour d’échéance', calculeLe: 'la date du calcul' },
  evenement: { type: 'le type d’événement', date: 'sa date', mois: 'le mois concerné' },
};

const KIND_TITLE: Record<TenantItemKind, string> = {
  contrat: 'Votre contrat',
  logement: 'Votre logement',
  paiement: 'Vos paiements',
  avance: 'Votre avance',
  retards: 'Vos retards',
  evenement: 'L’historique de votre contrat',
};

/** Ce que voit un locataire, une ligne par rubrique, dérivé du modèle (jamais écrit à la main). */
export function tenantVisibleLines(): string[] {
  return TENANT_ITEM_KINDS.map((kind) => `${KIND_TITLE[kind]} : ${TENANT_BODY_FIELDS[kind].map((field) => TENANT_FIELD_LABELS[kind][field] ?? field).join(', ')}.`);
}

export function buildPrivacySections(): PrivacySection[] {
  return [
    {
      id: 'local',
      title: 'Sur votre téléphone',
      cloudOnly: false,
      lines: [
        'TakarDa fonctionne sans compte : tout ce que vous saisissez (tontines, formulaires, immobilier, factures, profil, photos et fichiers que vous joignez) reste sur votre téléphone et n’est envoyé à personne.',
        'Ces données ne sont pas chiffrées par l’application : elles sont protégées par l’isolation que le système Android applique à chaque application.',
        'La sauvegarde automatique d’Android, selon vos réglages, peut en conserver une copie dans votre compte Google. Vous pouvez aussi exporter une copie : Profil › Stockage.',
      ],
    },
    {
      id: 'account',
      title: 'Si vous créez un compte',
      cloudOnly: true,
      lines: [
        'Le compte est facultatif. Il utilise votre adresse e-mail et un mot de passe, gérés par le service Firebase Authentication de Google. TakarDa ne conserve pas votre mot de passe.',
        'Un e-mail de vérification vous est envoyé : sans adresse vérifiée, la synchronisation et les espaces partagés restent fermés.',
      ],
    },
    {
      id: 'sync',
      title: 'Si vous activez la synchronisation',
      cloudOnly: true,
      lines: [
        'Sont envoyés à votre espace personnel dans le cloud, uniquement pour Immobilier : biens, logements, contrats, locataires (nom, téléphone, e-mail, note), paiements et leurs corrections (avec le motif), dépenses, avances. Vos notes libres et champs personnalisés en font partie.',
        'Ne sont jamais envoyés : tontines, formulaires et réponses, factures CEET et TDE, votre profil local, vos photos et fichiers.',
        'Vos données créées avant l’activation ne partent que si vous le demandez, après un aperçu, une confirmation et une sauvegarde de sécurité.',
        'Les locataires dont vous saisissez les informations ne sont pas informés par TakarDa : c’est à vous de les prévenir que vous les enregistrez.',
      ],
    },
    {
      id: 'owner',
      title: 'Si vous créez un espace partagé (propriétaire)',
      cloudOnly: true,
      lines: [
        'Vous donnez à CHAQUE locataire approuvé une vue en lecture seule de SES informations. Il voit uniquement :',
        ...tenantVisibleLines(),
        'Il ne voit jamais : vos notes libres, vos champs personnalisés, les raisons de correction ou d’annulation, vos dépenses, vos statistiques, les autres locataires ni les autres contrats.',
        'Vous voyez, pour une demande d’accès, l’identifiant du compte du demandeur et le nom qu’il a choisi de saisir. Vous approuvez chaque demande ; vous pouvez retirer l’accès à tout moment. Informez vos locataires de ce partage.',
        'Vous pouvez supprimer un espace : il est supprimé du cloud et vos locataires perdent l’accès aussitôt. Vos données dans l’application ne sont pas touchées.',
      ],
    },
    {
      id: 'tenant',
      title: 'Si vous rejoignez un espace (locataire)',
      cloudOnly: true,
      lines: [
        'L’identifiant d’un espace ne donne jamais accès : le propriétaire doit approuver votre demande. Il voit l’identifiant de votre compte et le nom que vous saisissez, rien d’autre.',
        'Vous ne pouvez rien modifier : vous lisez les informations que le propriétaire publie à votre sujet. Une copie est gardée sur votre téléphone, à part de vos données ; elle est supprimée quand votre accès est retiré, quitté ou terminé.',
        'Vous pouvez quitter l’espace à tout moment : cela retire aussi le nom saisi dans votre demande. Le propriétaire conserve une fiche d’accès (identifiant, contrat lié, état) comme historique de location.',
        'Votre accès est prévu pour se terminer 90 jours après la fin de votre contrat (la date est inscrite par le propriétaire à l’ouverture de son application), ou plus tôt s’il le retire.',
      ],
    },
    {
      id: 'deletion',
      title: 'Supprimer votre compte',
      cloudOnly: true,
      lines: [
        'Profil › Compte et synchronisation › Supprimer mon compte. Sont supprimés dans le cloud : votre compte, votre espace personnel et vos données synchronisées, et les espaces partagés que vous avez créés. Cette suppression est irréversible.',
        'Les espaces que vous aviez rejoints sont quittés, dans la mesure du possible : un échec n’empêche pas la suppression de votre compte. Vos données sur votre téléphone sont conservées.',
      ],
    },
    {
      id: 'never',
      title: 'Ce que TakarDa ne fait pas',
      cloudOnly: false,
      lines: [
        'Aucune publicité, aucun outil de statistiques d’usage, aucun rapport d’erreurs automatique.',
        'Aucun accès à votre position. Sur Android, ni la caméra ni le micro ne sont utilisés.',
        'Aucune donnée n’est vendue.',
      ],
    },
  ];
}

/** Texte de la case à cocher de création de compte. */
export const SIGNUP_CONSENT_TEXT = 'J’ai pris connaissance de l’information sur mes données : ce qui reste sur mon téléphone, ce qui part dans le cloud, et comment supprimer mon compte.';
