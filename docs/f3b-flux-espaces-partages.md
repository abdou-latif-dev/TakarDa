# F3b — Demandes, approbation, rôles, révocation, départ (état local)

> **Mise à jour (F4)** : les règles candidates et les flux décrits ici ont depuis été **exécutés dans l'émulateur Firestore local** (voir `docs/preuve-emulateur-f3.md`) ; les mentions « jamais exécuté » ci-dessous décrivent l'état au moment de la rédaction. Le projet de test réel n'a pas été utilisé.

> **Statut : code local testé contre un cloud en mémoire. Rien n'a été joué contre Firebase (ni émulateur, ni projet de test), rien n'est publié, `CLOUD_ACCOUNT_ENABLED` reste `false`.**
> Les cinq défauts de V1 proposés en F3a sont **confirmés par le propriétaire du projet** : administrateur = propriétaire ; un contrat par membre ; nom saisi sans e-mail ; un refus bloque jusqu'à effacement par le propriétaire ; aucun plafond dans les règles (plafond côté application).

## Ce qui est livré

| Élément | Fichier |
|---|---|
| Port d'accès au cloud (sans SDK) | `services/sharedModules/modulesPort.ts` |
| Flux : créer, rejoindre, vérifier mon accès, annuler, quitter, voir demandes/membres, approuver, refuser, effacer, révoquer, rétablir, changer de contrat, poser les fins d'accès | `services/sharedModules/moduleFlows.ts` |
| Carnet local par compte (espaces créés / demandés) | `services/sharedModules/localModules.ts` |
| Réalisation Firestore du port (lecture serveur, approbation en un seul lot) | `services/firebase/firestoreModulesBackend.ts`, `services/firebase/modulesBoot.ts` (chargé à la demande) |
| Façade des écrans : gardes (drapeau, espace personnel, adresse vérifiée, compte actif), carnet local, flux | `services/sharedModulesService.ts` |
| Contrats proposés au propriétaire et jour de fin | `services/sharedModuleContracts.ts` |
| Écrans : « Espaces partagés » (créer, rejoindre, états) ; écran d'un espace (identifiant, demandes, locataires) ; choix du contrat | `features/profile/screens/SharedModulesScreen.tsx`, `SharedModuleOwnerScreen.tsx`, `features/profile/components/ContractPickerDialog.tsx`, routes `app/account/shared/*` (redirigées tant que le drapeau est fermé) |
| Entrée depuis « Compte et synchronisation » (adresse vérifiée seulement) | `features/profile/screens/CloudAccountScreen.tsx` |

## Comportements retenus
- **Rejoindre** : l'identifiant est contrôlé (format) puis une demande `pending` est créée. Il ne donne jamais accès. Le message de refus du cloud est **le même** pour module inexistant, demande déjà faite, ancien refus ou ancien membre (rien n'est révélé sur ce qui existe).
- **Approbation** : le propriétaire choisit **le contrat** (obligatoire) ; la demande passe à `approved` et la fiche du membre est créée **dans la même opération atomique** (lot Firestore ; une approbation partielle est impossible, testé en mémoire). Plafond : 50 membres actifs (côté application).
- **Révocation / départ** : effet immédiat côté cloud (la fiche est relue à chaque lecture). Un membre révoqué ne se rétablit pas lui-même ; un membre parti non plus ; seul le propriétaire rétablit. Aucune suppression de fiche : l'historique est conservé.
- **90 jours** : à l'approbation d'un contrat déjà terminé, au changement de contrat, et **à l'ouverture de l'écran du propriétaire** (aucune fonction cloud), la fin d'accès est posée à *jour de fin de contrat + 90 jours* ; une date déjà posée n'est jamais remplacée. Jour de fin = date de sortie du contrat, sinon jour de dernière mise à jour d'un contrat terminé (question 6 : **hypothèse retenue, à confirmer**). Conséquence : un locataire garde son accès tant que le propriétaire n'a pas rouvert l'application après la fin du contrat.
- **Avertissement de suppression de compte** : la procédure d'effacement **ne supprime pas encore les espaces partagés** ; le message de confirmation le dit.

## Ce qui est prouvé / non prouvé
- **Prouvé localement** : la logique des flux et la politique de référence (mêmes décisions que la matrice de F3a), l'isolation du carnet local par compte, les gardes (drapeau, adresse vérifiée, démonstration), la structure (aucun écran n'importe le moteur ni Firebase ; tout derrière le drapeau).
- **Non prouvé** : l'adaptateur Firestore n'a **jamais été exécuté** ; les règles `firestore.p5.rules` non plus ; le rendu des écrans n'a pas été vérifié (typage, lint et tests de structure seulement). Le critère de sortie de F3b (« flux complet joué en réel, deux comptes ; auto-approbation impossible ; révocation immédiate ») **n'est donc pas atteint** : il demande l'émulateur (Java) ou le projet de test, avec autorisation distincte.

## Limites et points ouverts
- **Rien n'est publié dans la vue du locataire** : le locataire approuvé n'a encore rien à lire (F3c : projection `tenantViews`, stockage local séparé).
- **Effacement de compte et modules** : à décider et construire (F4) — verrou, purge des sous-collections, suppression du module ; aucune règle ne permet la suppression aujourd'hui.
- Pas de notification : le propriétaire voit les demandes en ouvrant l'écran ; le demandeur touche « Actualiser ».
- Le propriétaire identifie un demandeur par le nom qu'il a saisi : à lui de vérifier avant d'approuver (texte affiché).
- Un locataire révoqué garde ses données déjà reçues sur son appareil (F3c).
