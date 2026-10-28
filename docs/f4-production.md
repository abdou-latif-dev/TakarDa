# F4 — Préparation de la production (état local)

> **Statut : préparation locale. Rien n'a été publié, aucun projet réel n'a été contacté (ni la production, ni `takarda-n2-test`), `CLOUD_ACCOUNT_ENABLED` reste `false`.**
> La répétition sur le projet de test réel (publication des règles, procédure d'urgence, compte jetable) est **reportée à la phase de débogage**, comme décidé.
> Aucune valeur de configuration, clé ou identifiant sensible n'apparaît dans ce document.

## 1. Ce qui est prêt

| Livrable | Fichiers | Preuve |
|---|---|---|
| **Effacement des espaces partagés avec le compte** (verrou irréversible, vidage dans l'ordre, vérification serveur, suppression, reprise) | `firestore.p5.rules` (verrou `deletionLockedAt`, suppression sous verrou, liste de SES modules), `services/firebase/moduleErasure.ts`, `firestoreModulesBackend.ts`, `accountCloudErasure.ts`, `cloudDeletionComposition.ts` | 13 tests locaux ; **émulateur** : 244 cas de règles (dont 48 cas de verrou et de suppression), 9 scénarios à deux comptes dont l'effacement avec panne puis reprise, et la suppression de compte complète via la composition réelle |
| **Règles d'urgence** (variante 1 « écritures refusées », variante 2 « tout refusé ») | `firestore.emergency-writes-off.rules`, `firestore.emergency-all-off.rules`, générateur `scripts/firebase-rules/emergency.js` | générées (jamais éditées à la main), comparées au générateur par un test ; **émulateur** : 5 tests (lectures légitimes conservées en variante 1, aucune écriture, rien de lisible en variante 2) |
| **Manifeste des règles validées** et **vérification avant/après publication** | `firestore.rules.manifest.json`, `scripts/firebase-rules/release.js` | un test échoue si les règles changent sans nouvelle validation ; `verify` compare un fichier au candidat validé (empreinte SHA-256) |
| **Configuration de publication** | `firebase.release.json` (désigne `firestore.p5.rules`, **aucun projet**) | test statique |
| **Estimation des quotas** | `services/firebase/quotaModel.ts` | 5 tests ; chiffres en § 5 |

## 2. Effacement des espaces partagés (nouveau)
**Pourquoi.** Sans cela, un propriétaire qui supprime son compte laisserait dans le cloud ses espaces, les noms saisis par les demandeurs et les vues publiées (données de locataires).
**Comment.** Avant tout le reste de la suppression du compte : pour chaque module dont le compte est propriétaire (requête serveur `ownerUid == uid`) — propriété démontrée → **verrou** posé et confirmé (les locataires perdent leur lecture, plus aucune écriture) → vues, données, demandes, fiches supprimées par lots (dans cet ordre) → vérification serveur « plus rien » → module supprimé → absence confirmée par la liste. **Un espace non vidé n'est jamais supprimé ; une procédure non terminée garde le compte** (« suppression incomplète », reprise possible, comme pour l'espace personnel).
**À savoir.**
- Les règles P5 doivent être **en ligne** pour que la suppression d'un compte aboutisse (la liste de ses modules est une requête que les anciennes règles refusent). Elles sont donc publiées **ensemble** avec le reste, jamais séparément.
- Un locataire dont l'espace est en cours d'effacement voit « votre espace n'a pas pu être lu » ; une fois l'espace supprimé, son accès est « aucun » et sa copie locale est retirée à l'actualisation.
- **Résidu connu** : un locataire qui supprime SON compte laisse sa fiche de membre et sa demande (avec le nom saisi) dans l'espace du propriétaire — historique de location tenu par le propriétaire. À traiter avec la politique de confidentialité (F6).
- Les essais réels de suppression existants (`deletionFlow.n2.test.ts`) appellent la composition : ils supposeront désormais que le projet de test porte les règles P5 (option `sharedModules: false` pour un projet qui n'aurait que les règles précédentes).

## 3. Procédure de publication des règles (à exécuter avec autorisation distincte)
**Cible : d'abord le projet de test, jamais la production en premier.** Toute commande porte `--project` explicitement (aucun projet par défaut n'existe).
1. **Pré-vol local** : `npx tsc --noEmit`, la suite ordinaire verte, `node scripts/firebase-rules/release.js verify firestore.p5.rules` → « IDENTIQUE au candidat validé ».
2. **Sauvegarde des règles actives** (lecture seule) dans un fichier daté **hors dépôt** ; noter son empreinte.
3. **Publication** (exemple, NON exécuté) : `npx firebase-tools@15.33.0 deploy --only firestore:rules --config firebase.release.json --project <identifiant-du-projet-cible>`.
4. **Relecture** des règles actives (lecture seule) dans un fichier hors dépôt, puis `node scripts/firebase-rules/release.js verify <ce fichier>` → doit répondre « IDENTIQUE ». Sinon : arrêt, retour à la sauvegarde.
5. **Essai avec un compte jetable** (inscription, vérification, espace partagé, demande, approbation, vue, suppression de compte) puis **nettoyage** : aucun compte ni document résiduel.
6. Production : mêmes étapes, **après** accord du propriétaire du projet et après la répétition sur le projet de test.
**Retour arrière** : republier la sauvegarde datée, relire, comparer.

## 4. Procédure d'urgence (mise à jour de la section 6 des décisions)
- Les **deux fichiers d'urgence existent** (non publiés) ; ils sont régénérés par `node scripts/firebase-rules/emergency.js` si les règles candidates changent (un test l'impose).
- Publication d'urgence = mêmes étapes 2 à 4 avec `--config` pointant un fichier d'urgence : à ajouter à la répétition sur le projet de test (publier, relire, vérifier qu'un compte de contrôle ne peut plus écrire, **puis revenir** aux règles validées).
- L'application affiche déjà « Service temporairement suspendu » et conserve la file d'envoi (F2). **Non répété en réel** : à faire sur `takarda-n2-test` avant toute ouverture.

## 5. Quotas (plan gratuit) — estimation, pas mesure
Hypothèse à confirmer dans la console : 50 000 lectures, 20 000 écritures, 20 000 suppressions par jour. Hypothèses d'usage et formules : `services/firebase/quotaModel.ts` (chaque écriture compte ≈ 2 lectures par excès ; une actualisation de vue ≈ éléments + 5 lectures).

| Scénario | Lectures/jour (famille) | Familles par jour dans le quota |
|---|---|---|
| Typique : 1 propriétaire (2 h/jour, 20 modifications, 5 locataires, 3 éléments de vue changés chacun) + 5 locataires qui actualisent 1 fois | ≈ 220 | **≈ 228** |
| Intensif : 1 propriétaire (6 h/jour, 80 modifications, 15 locataires, 6 éléments changés chacun) + 15 locataires qui actualisent 3 fois | ≈ 1 760 | **≈ 28** |

**Constat** : les plafonds du moteur (5 000 lectures et 2 000 écritures par compte et par jour) **ne protègent que contre un défaut de l'application** : **10 comptes qui les atteignent suffisent à épuiser le quota gratuit** ; un client qui contourne l'application n'a même pas ces plafonds. Mesures disponibles : adresse e-mail vérifiée exigée (F1), procédure d'urgence, surveillance quotidienne de l'usage dans la console. App Check (reporté) réduirait ce risque. **Décision du propriétaire du projet : plan gratuit conservé** (passer à un plan payant retirerait l'arrêt automatique du quota, avec un risque de coûts). Le quota est donc un **plafond dur** : son épuisement coupe le service pour tous les utilisateurs jusqu'à la remise à zéro quotidienne ; la surveillance de l'usage et la procédure d'urgence sont les seules parades en attendant App Check. Les chiffres ci-dessus restent à confronter à une mesure réelle (étape de débogage).

## 6. Authentification et console — liste de contrôle (à faire dans la console, non vérifiable localement)
- [ ] Fournisseurs : **e-mail / mot de passe uniquement** (aucun anonyme, aucun autre) — les règles refusent de toute façon un autre fournisseur.
- [ ] Protection contre l'énumération des e-mails : **activée** (cohérent avec les messages de l'application et le test de réinitialisation).
- [ ] Politique de mot de passe côté serveur : au moins 8 caractères (l'application impose déjà lettre + chiffre à l'inscription) — *disponibilité du réglage dans le plan utilisé à vérifier*.
- [ ] Modèles d'e-mail (vérification, réinitialisation) : **en français**, expéditeur et objet relus ; essai avec une vraie boîte.
- [ ] Domaines autorisés : seulement ceux nécessaires.
- [ ] Quota d'envoi d'e-mails de vérification et de réinitialisation : relevé (limites à confirmer).
- [ ] Région de la base : identique à celle du projet de test ; mode production (verrouillé).
- [ ] Alertes : sur le plan gratuit il n'existe pas d'alerte de budget : **relevé manuel quotidien** de l'usage les premières semaines.

## 7. Configuration de build (lecture seule du dépôt)
- `eas.json` n'a **aucune variable d'environnement** : un build EAS ne lit pas `.env` (ignoré par Git). Avant F7, les six valeurs `EXPO_PUBLIC_FIREBASE_*` de **production** doivent être fournies comme secrets du projet EAS ; **`EXPO_PUBLIC_ALLOW_PRODUCTION_IN_DEV` ne doit jamais y figurer**. Sans ces valeurs, la configuration est refusée et le cloud reste inerte (le drapeau est de toute façon fermé).
- `google-services.json` est ignoré par Git : à fournir au build par le mécanisme prévu (fichier secret EAS).
- Le garde d'environnement (F1) empêche une version publiée d'utiliser le projet de test, et inversement.
- `app.json` **bloque** les permissions `CAMERA` et `RECORD_AUDIO` (`blockedPermissions`) : l'application n'en demande aucune ; la déclaration de sécurité des données du Store l'indique (F6).

## 8. Interrupteur distant de coupure (question 8) — DÉCIDÉ : NON en V1 (confirmé par le propriétaire du projet)
- **Option A (recommandée)** : pas d'interrupteur distant. L'arrêt se fait par les **règles d'urgence** (immédiat, sans mise à jour, sans service payant) ; pour un arrêt durable, une nouvelle version avec le drapeau fermé. Aucun document public, aucune exception de lecture.
- **Option B** : un document public lu au démarrage. Gratuit, mais ajoute une **exception de lecture publique** (même minime), une lecture par démarrage et par appareil, et un comportement à définir hors ligne. Utile surtout pour afficher un message d'arrêt plutôt qu'une erreur.
- **Raison de A** : la procédure d'urgence couvre déjà l'arrêt ; B n'apporte qu'un message plus précis. À reconsidérer si les essais de débogage montrent que l'erreur affichée pendant une coupure est trop obscure.

## 9. Critères de sortie de F4 — où on en est
| Critère | État |
|---|---|
| Règles de production identiques aux règles validées | **Mécanisme prêt** (manifeste + `verify` avant et après) ; **non appliqué** : rien n'est publié |
| Procédure d'urgence répétée sur le projet de test | Fichiers prêts et éprouvés sur l'émulateur ; **répétition réelle reportée** (débogage) |
| Essai avec un compte jetable puis suppression | Suppression complète (espaces partagés compris) éprouvée sur l'émulateur ; **essai réel reporté** (débogage) |
| Quotas et alertes | Modèle d'estimation fait ; plan gratuit **décidé** ; **mesure réelle et réglages de console à faire** |
| Paramètres d'authentification | Liste de contrôle écrite ; **à faire dans la console** |

## 10. Points ouverts
- ~~Décisions en attente~~ **Tranchées** : plan gratuit conservé ; pas d'interrupteur distant en V1 (option A).
- **Test P4 qui échoue sur l'émulateur** (écritures simultanées, `permission` au lieu de `conflict`) : à revérifier sur le projet de test réel (voir `docs/preuve-emulateur-f3.md`).
- Résidu de fiche de locataire après suppression de son compte (F6).
- App Check, notification de nouvelles demandes, détection réseau (netinfo décidé, non installé).
