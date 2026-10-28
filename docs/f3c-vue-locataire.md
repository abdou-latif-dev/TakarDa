# F3c — Vue du locataire en lecture seule (état local)

> **Mise à jour (F4)** : les règles candidates et les flux décrits ici ont depuis été **exécutés dans l'émulateur Firestore local** (voir `docs/preuve-emulateur-f3.md`) ; les mentions « jamais exécuté » ci-dessous décrivent l'état au moment de la rédaction. Le projet de test réel n'a pas été utilisé.

> **Statut : code local testé contre un cloud en mémoire. Rien n'a été joué contre Firebase, rien n'est publié, `CLOUD_ACCOUNT_ENABLED` reste `false`.**
> **Décisions du propriétaire du projet (toutes confirmées)** : jour de fin de contrat = date de sortie (sinon, contrat terminé sans date : jour de sa dernière mise à jour) ; **points 4.3 : tout est visible** pour le locataire (nom du bien, mode de paiement, e-mail et note du contact, nom du propriétaire sur les reçus, loyer de référence) ; contrat archivé : oui ; paiement annulé : présenté « Rejeté » au locataire.

## Principe
Le locataire ne reçoit jamais les enregistrements du propriétaire. Le propriétaire **publie une vue** (projection) : un document par élément, `tenantViews/{uid du locataire}/items/{id}` = `{kind, body, rev, updatedAt}`. Les règles candidates n'acceptent que six types et, pour chacun, que des champs d'une liste blanche (`TENANT_BODY_FIELDS`) : un champ privé serait refusé par le cloud même si le code de projection se trompait.

| Type | Contenu publié |
|---|---|
| `contrat` | statut, nom, téléphone, **e-mail et note du contact**, **nom du propriétaire**, loyer, date d'entrée et de sortie, jour de paiement, dernier loyer payé, caution, avance |
| `logement` | nom, type, cuisine, WC, **adresse et nom du bien** qui contient son logement, **loyer de référence** |
| `paiement` (un par paiement du contrat) | mois, montant **effectif** (correction appliquée), statut (payé, en attente, rejeté, couvert), date de validation, **mode de paiement**, référence du reçu, nombre de loyers en retard à la date |
| `avance` | montant, consommé, disponible, mois couverts |
| `retards` | calculé **seulement si fiable** (contrat en cours, loyer, date d'entrée et jour d'échéance connus) : mois en retard et jour d'échéance ; sinon « non fiable », rien n'est affirmé |
| `evenement` | contrat enregistré, loyer enregistré, contrat terminé (construits à partir des faits ; jamais les résumés bruts du journal) |

## Points 4.3 (décidés)
| # | Point | Décision |
|---|---|---|
| 1 | Nom du bien | **visible** |
| 2 | Mode de paiement | **visible** (vue et reçu) |
| 3 | E-mail et note du contact | **visibles** |
| 4 | Nom du propriétaire sur les reçus | **visible** (nom du profil local ; absent si le profil porte le nom par défaut « Utilisateur ») |
| 5 | Loyer de référence du logement | **visible** |
| 6 | Début des 90 jours | date de sortie, sinon dernière mise à jour d'un contrat terminé |
| 7 | Contrat archivé | statut « Archivé » publié ; l'accès suit la fin d'accès posée |

**Restent privés** (décisions 4.2, non modifiées) : notes libres du contrat et des paiements, raisons de correction et d'annulation, champs personnalisés, dépenses, statistiques, autres locataires et contrats, journal d'activité brut, métadonnées. « Tout visible » a été compris comme couvrant les points 4.3 listés, pas ces éléments.

Un paiement **annulé** est présenté « Rejeté » au locataire (décision), **sans motif**.

## Cycle de vie
- **Propriétaire** : la vue est publiée à l'approbation, au changement de contrat, au rétablissement ; **retirée** à la révocation ; à l'ouverture de l'écran de l'espace tout est recalculé (fins d'accès à 90 jours, vues retirées pour les accès expirés) et seuls les éléments **modifiés** sont réécrits (empreintes retenues localement). Écriture d'abord, retrait ensuite.
- **Locataire** : « Actualiser » lit sa vue (accès actif seulement) et la range **à part** de ses propres données (jamais dans les collections de l'application), propre à son compte. Aucun écran de saisie : lecture seule, reçu partageable pour un loyer payé (texte construit à partir de la seule vue).
- **Fin de l'accès** : copie locale **supprimée** à la révocation, au départ, ou à l'expiration (à l'heure de l'appareil, même hors ligne ; à l'actualisation sinon). Un accès non actif ne lit rien.

## Prouvé / non prouvé
- **Prouvé localement** : aucun champ privé dans la projection (jeu de données avec champs privés partout : notes, champs personnalisés, raisons, dépenses, autre locataire) et présence des informations rendues visibles par décision ; chaque élément respecte la liste blanche ; un locataire ne lit pas la vue d'un autre, n'écrit rien, ne lit pas les données du module ; publication par différences (une seconde publication n'écrit rien) ; révocation, départ et expiration retirent la vue et la copie ; la copie est invisible pour un autre compte du même appareil.
- **Non prouvé** : règles candidates (liste blanche par type, `allowedBody`) jamais exécutées ni compilées ; adaptateur Firestore jamais exécuté ; écrans non vérifiés visuellement. La matrice de 194 cas est prête pour l'émulateur/projet de test (autorisation distincte).

## Limites
- **Rafraîchissement manuel des deux côtés** : pas de notification. La vue du locataire n'est à jour que lorsque le **propriétaire a ouvert l'application** (ou agi dessus) puis que le **locataire actualise**.
- **Révocation et appareil hors ligne** : le cloud coupe l'accès immédiatement, mais la copie déjà présente sur l'appareil du locataire reste affichée jusqu'à sa prochaine actualisation (ou la fin d'accès connue). Rien ne permet de l'effacer à distance.
- Les retards sont ceux **calculés par le propriétaire** à sa dernière publication (date indiquée dans l'écran).
- La suppression d'un module avec le compte (F4) reste à construire : les vues publiées resteraient dans le cloud.
