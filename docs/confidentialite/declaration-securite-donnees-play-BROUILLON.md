# TakarDa — Déclaration « Sécurité des données » de Google Play (BROUILLON, non soumis)

> **Statut : brouillon du 21 octobre 2026**, à reporter dans la console Google Play au moment de la publication. Il décrit l'application **avec les comptes et les espaces partagés ouverts** (drapeau `CLOUD_ACCOUNT_ENABLED`) ; tant que ce drapeau est fermé, **aucune donnée ne quitte l'appareil** et la déclaration serait « aucune donnée collectée ».
> Les libellés de catégories suivent la console telle que je la connais ; **[À VÉRIFIER dans la console au moment de la saisie]** : l'intitulé exact des questions et la façon dont Google traite le partage demandé par l'utilisateur lui-même (propriétaire → locataire) et le prestataire technique (Firebase).
> Doit rester **cohérent avec la politique de confidentialité** (`politique-de-confidentialite-BROUILLON.md`).

## 1. Collecte et partage par type de données
« Collectée » = quittant l'appareil vers TakarDa/Firebase. Les données qui ne font que résider sur l'appareil (tontines, formulaires, photos, fichiers, factures CEET/TDE, profil local, historique d'activité) ne sont **pas collectées** au sens de Google.

| Catégorie Google | Type | Collectée ? | Partagée ? | Facultative ? | Finalités | Détail |
|---|---|---|---|---|---|---|
| Infos personnelles | **Adresse e-mail** | Oui | Non (Firebase = prestataire technique) | Oui (compte facultatif) | Gestion du compte, fonctionnalités de l'application | e-mail du compte (Firebase Authentication) ; e-mail et note de contact des locataires saisis par le propriétaire (synchronisation) |
| Infos personnelles | **Identifiants utilisateur** | Oui | Non | Oui | Gestion du compte, fonctionnalités | identifiant de compte ; identifiants d'espaces, de demandes et de fiches d'accès |
| Infos personnelles | **Nom** | Oui | Non | Oui | Fonctionnalités | nom des locataires saisi par le propriétaire (synchronisation et vue du locataire) ; nom facultatif saisi par un demandeur d'accès |
| Infos personnelles | **Numéro de téléphone** | Oui | Non | Oui | Fonctionnalités | téléphone des locataires saisi par le propriétaire |
| Infos personnelles | **Adresse** | Oui | Non | Oui | Fonctionnalités | adresse des biens immobiliers |
| Infos financières | **Autres infos financières** | Oui | Non | Oui | Fonctionnalités | loyers, paiements saisis, avances, cautions, dépenses : **enregistrements saisis par l'utilisateur, aucun paiement n'est traité par l'application** |
| Contenu généré par l'utilisateur / fichiers | **Autre contenu généré par l'utilisateur** | Oui | Non | Oui | Fonctionnalités | notes libres et champs personnalisés des enregistrements d'Immobilier synchronisés |
| Photos, fichiers, audio, vidéo, SMS, contacts du téléphone, agenda, santé | tous | **Non** | — | — | — | restent sur l'appareil ; ni caméra ni micro (`blockedPermissions`) ; aucun accès aux contacts du téléphone |
| Position | tous | **Non** | — | — | — | aucune bibliothèque de localisation |
| Activité dans l'application, historique de navigation, recherche | tous | **Non** | — | — | — | aucun outil de statistiques ; l'historique d'activité reste local |
| Infos et performances de l'application | Journaux de plantage, diagnostics | **Non** | — | — | — | aucun rapport d'erreurs automatique |
| Identifiants d'appareil | tous | **Non** | — | — | — | aucun identifiant publicitaire ni d'appareil |

**Partage.** Aucune donnée n'est vendue ni cédée à des tiers. Deux cas à examiner dans la console **[À VÉRIFIER]** : (a) **Firebase (Google)** traite les données pour le compte de TakarDa → prestataire technique, normalement **non déclaré comme « partage »** ; (b) le **propriétaire montre à chaque locataire ses propres informations** à l'initiative de l'utilisateur → partage entre utilisateurs décidé par l'utilisateur, **pas un transfert à un tiers** par TakarDa.

## 2. Pratiques de sécurité
| Question | Réponse | Preuve / remarque |
|---|---|---|
| Données chiffrées en transit | **Oui** | SDK Firebase : connexion sécurisée |
| Possibilité de demander la suppression des données | **Oui** | dans l'application (Profil › Compte et synchronisation › Supprimer mon compte ; supprimer un espace) et par une page Web (adresse à fournir) |
| Conforme à la politique Familles de Google Play | **Non applicable** | public non enfant **[À DÉCIDER : confirmer le public visé]** |
| Examen de sécurité indépendant | **Non** | aucun à ce jour |

## 3. Suppression de compte (exigence de Google Play)
- **Dans l'application** : chemin ci-dessus, vérifié par des tests locaux et sur l'émulateur ; **non encore vérifié sur le projet de test réel** (phase de débogage).
- **Adresse Web de demande de suppression** : à publier (`page-suppression-de-compte-BROUILLON.md`), puis à saisir dans la console **et** dans `constants/legalLinks.ts`.
- Ce qui est supprimé et ce qui ne l'est pas : décrit dans la page de suppression (données locales conservées ; fiche d'accès chez le propriétaire ; **identifiant technique du compte supprimé, conservé pour des raisons de sécurité** : à déclarer comme conservation pour la sécurité et la prévention de la fraude, **[À VÉRIFIER dans le formulaire : comment la déclarer]**).

## 4. Autres déclarations à préparer
- **Politique de confidentialité** : adresse https à fournir (obligatoire).
- **Publicités** : aucune.
- **Public cible et contenu** : non destiné aux enfants **[À DÉCIDER]**.
- **Permissions** : aucune permission sensible ; caméra et micro explicitement retirées.
- **Accès à l'application pour la revue** : la connexion est facultative ; pour les fonctions de compte, prévoir des identifiants de test jetables fournis à la revue **[À DÉCIDER à l'ouverture progressive]**.
- **Fonctions financières** : l'application enregistre des loyers et des paiements saisis par l'utilisateur mais n'en traite aucun ; **[À VÉRIFIER]** le formulaire « fonctions financières » de la console pour confirmer qu'aucune déclaration n'est requise.
- **Sauvegarde automatique Android** : active (décision en attente) ; à mentionner dans la politique.

## 5. Source des affirmations
| Affirmation | Preuve dans le code |
|---|---|
| Aucune bibliothèque d'analyse, de plantage, de publicité, de localisation | `package.json` ; test `services/__tests__/legalReadiness.test.ts` |
| Caméra et micro retirés | `app.json` (`blockedPermissions`) ; test `legalReadiness.test.ts` |
| Ce qui est synchronisé | `services/sync/syncScope.ts`, `services/sync/wireFormat.ts` |
| Ce que voit un locataire | `services/sharedModules/model.ts` (`TENANT_BODY_FIELDS`), `services/privacyNotice.ts` |
| Suppression complète | `services/firebase/accountCloudErasure.ts`, `moduleErasure.ts` |
