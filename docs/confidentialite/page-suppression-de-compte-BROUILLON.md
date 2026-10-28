# TakarDa — Page « Supprimer mon compte » (BROUILLON, non publié)

> **Statut : brouillon réécrit le 21 octobre 2026** (comptes, synchronisation d'Immobilier, espaces partagés). Page Web destinée aux personnes qui veulent supprimer leur compte TakarDa, **y compris sans accès à l'application**.
> Rien n'est publié et aucun hébergement n'est choisi. Les éléments `[À FOURNIR]` / `[À DÉCIDER]` / `[À VÉRIFIER]` attendent le propriétaire. Cette adresse devra aussi être renseignée dans la console Google Play (sécurité des données) et dans `constants/legalLinks.ts` (`ACCOUNT_DELETION_URL`).

---

## PARTIE 1 — Texte de la page

# Supprimer mon compte TakarDa

TakarDa fonctionne sans compte. Cette page concerne uniquement les personnes qui ont **créé un compte** (adresse e-mail et mot de passe), par exemple pour retrouver leurs données d'Immobilier sur un autre téléphone ou pour partager leurs informations avec leurs locataires.

## Ce qui est supprimé
Quand votre compte est supprimé, TakarDa supprime, dans cet ordre :
1. vos **espaces partagés** (ceux que vous avez créés en tant que propriétaire) : l'espace est d'abord verrouillé, **vos locataires perdent aussitôt l'accès**, puis les demandes, les fiches d'accès et les informations publiées sont supprimées, et enfin l'espace lui-même ;
2. vos **données synchronisées** (biens, logements, contrats, locataires, paiements, dépenses…) ;
3. votre **espace personnel** et votre petit **profil technique** ;
4. votre **compte** (adresse e-mail, connexion).
Si vous aviez **rejoint** des espaces en tant que locataire, vous les quittez et le nom que vous aviez saisi dans vos demandes est retiré (dans la mesure du possible).
**Cette suppression est irréversible.**

## Ce qui n'est pas supprimé
- **Les données qui sont sur vos téléphones** : TakarDa ne peut pas les effacer à distance. Elles restent utilisables sans compte. Pour les effacer, supprimez-les dans l'application, effacez les données de l'application dans les réglages Android, ou désinstallez-la.
- **Les sauvegardes automatiques d'Android** de votre compte Google, qui dépendent de Google et de vos réglages.
- **Chez un propriétaire dont vous étiez locataire :** votre **fiche d'accès** (identifiant, contrat lié, état « quitté ») reste dans son historique de location. Vous pouvez demander à ce propriétaire de l'effacer, ou nous écrire (voir « Contact »).
- Un identifiant technique du compte (une suite de caractères sans nom ni coordonnée) et la date de suppression. Ils sont conservés pour empêcher qu'un appareil resté connecté recrée des données après la suppression ; ils ne permettent pas, à eux seuls, de vous identifier. **[À VÉRIFIER avec un juriste : qualification de cet identifiant et durée de conservation]**.
- Les copies de sauvegarde conservées par Google (Firebase) pendant leurs propres délais **[À VÉRIFIER : délais dans les conditions Firebase]**.

## Option 1 — Depuis l'application (recommandé)
1. Ouvrez TakarDa et allez dans **Profil › Compte et synchronisation**.
2. Appuyez sur **Supprimer mon compte**.
3. Lisez le message, saisissez votre mot de passe, puis appuyez sur **Supprimer définitivement**.
4. Attendez le message **« Compte supprimé »**. L'application ne l'affiche qu'après confirmation.
Vous pouvez aussi **supprimer un seul espace partagé** sans supprimer votre compte : ouvrez l'espace puis **Supprimer cet espace**.

**Si un message d'échec s'affiche**
| Message | Ce que cela veut dire | Que faire |
|---|---|---|
| « Réauthentification nécessaire » | Mot de passe refusé ou session trop ancienne. **Rien n'a été supprimé.** | Vérifiez le mot de passe, reconnectez-vous, réessayez. |
| « Suppression cloud incomplète » | Une partie de vos données (ou de vos espaces partagés) n'a pas pu être supprimée (réseau, par exemple). Votre compte est conservé. Un espace en cours de suppression reste **verrouillé** : vos locataires n'y ont déjà plus accès. | Vérifiez votre connexion et appuyez sur **Réessayer la suppression**. |
| « Données cloud supprimées, compte encore actif » | Vos données cloud sont supprimées, mais le compte lui-même n'a pas pu l'être. | Appuyez sur **Réessayer la suppression**. |
| « Suppression refusée » (espace non démontré comme le vôtre) | Par sécurité, rien n'a été supprimé. | Utilisez l'option 2. |

## Option 2 — Sans l'application
Si vous avez désinstallé l'application, perdu votre téléphone ou si la suppression ne fonctionne pas :
- Écrivez à **[ADRESSE DE CONTACT À FOURNIR]**, avec pour objet « Suppression de compte TakarDa », depuis **l'adresse e-mail du compte**.
- **[PROCÉDURE DE VÉRIFICATION D'IDENTITÉ À DÉFINIR PAR LE PROPRIÉTAIRE]**.
- Délai de traitement : **[DÉLAI À FOURNIR]**. Vous recevrez une confirmation à la fin de la suppression.

## Vos autres appareils
Si vous utilisiez TakarDa sur plusieurs téléphones, leurs données locales restent en place. Après la suppression du compte, il se peut que certains éléments y apparaissent masqués : dans **Profil › Compte et synchronisation › Données d'un autre compte**, appuyez sur **Les rendre locaux** pour les retrouver. Rien n'est supprimé par cette action.

## Contact
**[ADRESSE DE CONTACT À FOURNIR]** · Politique de confidentialité : **[ADRESSE À FOURNIR]**

---

## PARTIE 2 — Procédure interne pour traiter une demande reçue sans l'application (NON publique, à valider)
> **À tester d'abord sur le projet de test (`takarda-n2-test`).** Ne pas l'exécuter sur la production sans avoir validé chaque étape. Aucune étape n'a été exécutée.

1. Vérifier l'identité du demandeur **[PROCÉDURE À DÉFINIR]**.
2. Console Firebase › Authentication : retrouver l'utilisateur par e-mail et noter son **identifiant (uid)**.
3. Dans Firestore, dans cet ordre : (a) **ses espaces partagés** — chercher dans `modules` ceux dont `ownerUid` vaut l'uid ; pour chacun, **poser d'abord le champ `deletionLockedAt`** (chaîne non vide) sur le document du module (ce verrou coupe l'accès des locataires), puis supprimer les documents de `tenantViews/*/items`, `syncRecords`, `requests`, `members`, et enfin le document du module — **supprimer le document d'un module ne supprime PAS ses sous-collections** ; (b) tous les documents de `spaces/personal_<uid>/syncRecords` puis de `records`, puis `spaces/personal_<uid>`, puis `users/<uid>`. **[À VÉRIFIER : l'option de suppression récursive de la console]**.
   *Note :* la console d'administration ignore les règles d'accès ; le verrou n'est donc pas obligatoire pour l'exploitant, mais il est conseillé pour couper l'accès des locataires dès la première étape.
4. Supprimer l'utilisateur dans Authentication.
5. Vérifier que ses espaces, `spaces/personal_<uid>`, ses sous-documents et `users/<uid>` n'existent plus, puis confirmer au demandeur.
6. Si la demande vient d'un **locataire** : retirer, dans les espaces concernés, `requests/<uid>` et mettre la fiche `members/<uid>` à l'état « quitté » (ou la supprimer si le propriétaire y consent) ; supprimer `tenantViews/<uid>`.
7. Consigner la demande et sa date **[DURÉE DE CONSERVATION DU JOURNAL À DÉCIDER]**.

## PARTIE 3 — Informations à fournir pour publier
1. Adresse de contact et procédure de vérification d'identité.
2. Délai de traitement des demandes reçues sans l'application.
3. Hébergement choisi par le propriétaire (cette page ne sera publiée qu'à votre demande), puis l'adresse https réelle à renseigner dans `constants/legalLinks.ts` (`ACCOUNT_DELETION_URL`) et dans la console Google Play.
4. Validation des délais de purge côté Google (Firebase).

## PARTIE 4 — Faits confirmés par le code
| Affirmation | Preuve |
|---|---|
| Chemin dans l'application | `features/profile/screens/CloudAccountScreen.tsx` (carte « Supprimer mon compte », confirmation, saisie du mot de passe) |
| Ordre : espaces partagés, synchronisation, espace personnel, profil, compte ; « Compte supprimé » seulement après confirmation | `services/accountDeletionService.ts`, `services/firebase/accountCloudErasure.ts`, `moduleErasure.ts` ; `services/__tests__/accountDeletion.test.ts`, `moduleErasure.test.ts` ; émulateur local : suppression complète via la composition réelle |
| Le verrou coupe l'accès des locataires, rien ne s'écrit plus | `firestore.p5.rules` (`deletionLockedAt`) ; 48 cas de la matrice, jouée sur l'émulateur local |
| Un espace non vidé n'est jamais supprimé ; reprise possible | `moduleErasure.ts` ; tests (panne, reprise, délai) |
| Supprimer un seul espace | `services/sharedModulesService.ts` (`deleteModule`) ; `services/__tests__/dataMinimisation.test.ts` |
| Départ des espaces rejoints, nom saisi retiré (meilleur effort) | `services/sharedModules/departure.ts`, `services/firebase/accountDeletionApi.ts` |
| La fiche d'accès reste chez le propriétaire | règles (`members` jamais supprimées par le membre) ; `dataMinimisation.test.ts` |
| Données locales conservées, marquage retiré | `services/cloudSyncService.ts` (`releaseLocalOwnership`) |
