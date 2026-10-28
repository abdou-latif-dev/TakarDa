# TakarDa — Finalisation de Firebase : décisions validées (avant F1)

> **Statut : document de cadrage. Aucun code, aucune règle, aucune configuration Firebase n'a été modifié pour l'écrire.**
> Il consigne les décisions du propriétaire du projet et ce qui reste ouvert. Rien ici n'est une autorisation technique : chaque phase démarre sur autorisation explicite.
> `CLOUD_ACCOUNT_ENABLED` reste `false` tant que la phase F7 n'est pas validée.
> Aucune valeur de configuration, clé ou identifiant sensible n'apparaît dans ce document.

---

## 1. Décisions validées

### 1.1 Comptes et accès aux modules partagés
- Un utilisateur se connecte avec un **compte e-mail / mot de passe**. Pas d'accès anonyme, pas de page web de consultation.
- Chaque utilisateur peut **créer ses propres modules** et **rejoindre plusieurs modules** d'autres utilisateurs.
- « Rejoindre » est accessible **après connexion**. Saisir l'ID d'un module **crée une demande d'accès** ; l'ID ne donne **jamais** directement accès aux données. L'ID est une adresse, pas un mot de passe.
- **L'administrateur du module approuve ou refuse** la demande.
- **Deux rôles seulement en V1** : `administrateur` et `locataire` (lecture seule).
- Rejoindre un module **ne transfère jamais la propriété** (le propriétaire est immuable) et **ne donne aucun accès global** au compte de l'administrateur : seul le module partagé, et seulement les informations autorisées, sont concernés.
- Moteur de synchronisation **unique** pour les nouveaux comptes. Les données locales existantes sont préservées et **jamais migrées automatiquement**.

### 1.2 Fin du contrat
- À la fin du contrat, le locataire **conserve 90 jours** un accès **en lecture seule** à **ses propres informations et reçus**.
- L'administrateur peut **révoquer cet accès plus tôt**.
- La fin ou la révocation d'accès **ne supprime jamais** l'historique financier conservé par le propriétaire : elle ne retire que la visibilité du locataire.

### 1.3 Informations visibles par le locataire (section « Infos » et écrans liés)
- Le locataire voit les informations utiles de **son propre** contrat, logement, paiements, avance et reçus.
- Le **nom du logement**, son **type** et son **adresse** peuvent être visibles s'ils concernent bien son logement.
- Les **retards calculés** ne sont affichés que si le calcul est **fiable et explicable**.
- Restent **privés par défaut** : notes libres, raisons de correction ou d'annulation, champs personnalisés.
- Restent **privés** : dépenses, statistiques globales, autres locataires, autres contrats, métadonnées internes.
- L'**historique** présenté au locataire se limite aux événements utiles de **son propre** contrat.

### 1.4 Découpage et ordre des phases
F1 comptes et authentification → F2 moteur de synchronisation → F3a architecture des espaces partagés et règles → F3b demandes, approbation, rôles, révocation → F3c vue locataire en lecture seule → F4 préparation de la production → F5 validation réelle complète → F6 conformité et confidentialité → F7 ouverture progressive.

### 1.5 App Check, urgence, réseau
- **App Check : reporté** jusqu'à vérification de la compatibilité avec Expo SDK 54.
- **Coupure d'urgence : documenter d'abord** la procédure par les règles Firestore (section 6).
- **Détection du réseau : décision pendant F2**, après vérification de compatibilité.

---

## 2. Fonctionnement de « Rejoindre un module »

### 2.1 Modèle (à concevoir en F3a)
- **Module** : espace avec identifiant aléatoire long et non devinable, propriétaire immuable, type (Immobilier), nom.
- **Membres** : un enregistrement par utilisateur (rôle, état, lien vers un contrat pour un locataire, date de fin d'accès).
- **Demandes d'accès** : une par utilisateur, créée par le demandeur, lisible seulement par lui et par les administrateurs.
- **Données du module** (biens, logements, contrats, paiements…) : dans l'espace du **module**, pas dans l'espace personnel de l'administrateur. L'espace personnel de chacun reste privé.
- Chaque utilisateur a ses propres modules ; ceux qu'il a rejoints sont **séparés** des siens, en lecture seule.

### 2.2 États d'un accès
`demande en attente` → `actif` | `refusé`. Un accès actif peut devenir `révoqué` (par l'administrateur), `quitté` (par le membre) ou `expiré` (fin de contrat + 90 jours).

### 2.3 Déroulé
1. L'administrateur copie l'ID de son module.
2. L'utilisateur connecté touche « Rejoindre », saisit l'ID : une **demande** est créée.
3. L'administrateur voit la demande, choisit le rôle et le contrat à lier, approuve ou refuse.
4. Le module rejoint apparaît chez le locataire, en lecture seule, séparé de ses modules propres.
5. Révocation par l'administrateur ou départ du membre : l'accès est coupé immédiatement.

### 2.4 Contraintes techniques assumées
- **Sans fonction cloud payante** : l'approbation se fait depuis l'application de l'administrateur ; une demande attend donc qu'il ouvre l'application. Pas de notification poussée.
- Les règles Firestore consultent des documents (appartenance) : chaque consultation compte comme une lecture sur le plan gratuit (quota à vérifier). Tailles et nombre de membres seront bornés.
- La formulation exacte des règles de lecture « par contrat » doit être **prouvée par des tests réels** (émulateur indisponible). Repli prévu si Firestore ne l'accepte pas pour les listes : un document de vue dédié par locataire avec liste explicite d'identifiants autorisés.
- Le synchroniseur actuel écrit dans un espace par compte : il devra écrire dans un espace de module (chemins, règles, registre de propriété). C'est le plus gros chantier (F3a).

---

## 3. Protections requises (critères à prouver par tests de refus en réel)

- Aucun accès sans enregistrement de membre actif ; un non-membre ne peut ni lire ni lister modules, membres ou demandes d'autrui.
- Étanchéité entre modules : membre du module A ne lit rien du module B.
- Un locataire ne lit que ce qui est destiné à **son** contrat, n'écrit rien, ne voit aucun autre locataire.
- Propriétaire immuable ; un administrateur ne peut ni supprimer le module ni retirer le propriétaire.
- Faits financiers en création seule (comme aujourd'hui).
- Un utilisateur ne peut créer, lire ou retirer que **sa** demande ; **jamais s'auto-approuver**.
- Accès expiré, révoqué, en attente, refusé : lecture refusée.
- Côté appareil : les données d'un module rejoint sont marquées module + membre, séparées des modules propres, invisibles pour un autre compte du même appareil.
- Aucune règle n'est élargie avant validation du propriétaire du projet.

---

## 4. Section « Infos » : classification

Source : inspection du code (`ContratDetailScreen`, `LogementDetailScreen`, `PaiementsSection`, `AdvanceCard`, `rentReceiptService`, définitions d'entités d'`immobilierService`).

### 4.1 Visibles par le locataire (décisions du propriétaire, pour **son** contrat/logement)
| Élément | Champs |
|---|---|
| Contrat | statut, nom du locataire, téléphone du locataire, loyer mensuel, date d'entrée, date de sortie, jour de paiement, dernier loyer payé, caution, avance |
| Logement | nom, type, cuisine, WC, **adresse du bien contenant son logement** |
| Paiements de son contrat | mois, montant, statut (payé, en attente, rejeté, couvert par l'avance), date de validation |
| Avance | montant enregistré, consommé, disponible, mois couverts |
| Reçus | quittances de ses propres loyers |
| Retards calculés | **seulement** si calcul fiable et explicable (mois concernés listés, jour d'échéance indiqué) ; recalculable à partir des seules données autorisées |
| Historique | événements utiles de **son** contrat uniquement (création du contrat, loyer enregistré, contrat terminé) — liste d'événements autorisés explicite, pas les résumés bruts |

### 4.2 Privés (décidés)
Notes libres ; raisons de correction ou d'annulation ; champs personnalisés du contrat ; dépenses ; rapports et statistiques globaux ; autres locataires, contrats, contacts, paiements ; journal d'activité général ; CEET/TDE des autres locataires ; registre de propriété et métadonnées de synchronisation.

### 4.3 Points restant à confirmer par le propriétaire du projet
1. **Nom du bien** (distinct de l'adresse) : visible ou non ? *(non couvert par la décision ; privé par défaut)*
2. **Mode de paiement** : le champ est libellé « Mode de paiement (note) » dans le schéma ; à traiter comme une note libre (privé par défaut) ou à montrer ?
3. **E-mail et note du contact du locataire** : privés par défaut ; confirmer.
4. **Nom du propriétaire** sur les reçus : visible (document remis au locataire) ?
5. **Loyer de référence du logement** : privé par défaut ; confirmer.
6. **Date de fin de contrat** servant de point de départ aux 90 jours : `date de sortie` si renseignée, sinon date du passage au statut terminé ? *(à confirmer)*
7. **Statut « archivé »** d'un contrat : effet sur l'accès du locataire ?

---

## 5. Phases et critères de sortie (résumé)

| Phase | Objectif | Critère de sortie |
|---|---|---|
| **F1** comptes et authentification | moteur unique pour les nouveaux comptes, écran de compte simplifié, vérification d'e-mail, messages d'erreur en français, mot de passe, réinitialisation, configuration de test distincte de la production | parcours d'inscription, connexion, déconnexion, réinitialisation sans anomalie sur le projet de **test**, preuves jointes |
| **F2** moteur | déclenchement automatique après modification, écran de correction/annulation de paiement, envoi **volontaire** des anciennes données (aperçu, confirmation, sauvegarde, jamais automatique), états et messages clairs ; **décision réseau** | scénarios hors ligne, reprise, envoi volontaire joués en réel (projet de test) puis sur téléphone ; aucune perte ni doublon |
| **F3a** espaces partagés | modèle module/membres/demandes, règles, adaptation du transport et du registre de propriété | tests réels de refus pour chaque chemin interdit (section 3) |
| **F3b** demandes et rôles | « Rejoindre », demandes, approbation/refus, rôles, révocation, départ, expiration à 90 jours | flux complet joué en réel (deux comptes) ; auto-approbation impossible ; révocation immédiate |
| **F3c** vue locataire | vue en lecture seule selon la section 4, après validation des points 4.3 | un locataire ne voit jamais un autre locataire ni les données privées ; rien n'est écrit par lui |
| **F4** production | sauvegarde et publication contrôlée des règles, paramètres d'authentification, quotas et alertes, **procédure d'urgence répétée sur le projet de test** | règles de production identiques aux règles validées ; essai avec un compte jetable puis suppression |
| **F5** validation réelle | campagne complète d'un seul bloc, deux téléphones, conflits, coupures, suppression pendant un cycle | 0 compte et 0 document résiduel ; tous scénarios verts |
| **F6** conformité | politique de confidentialité (comptes, données de locataires, durées), page de suppression de compte, déclaration des données du Store | liens actifs dans l'application, documents validés |
| **F7** ouverture progressive | build interne, test fermé, ouverture du drapeau seulement dans ce build, surveillance, retour au mode local si incident | période d'observation sans perte ni fuite |

Contraintes de toutes les phases : plan gratuit de Firebase ; aucune migration automatique ; aucune règle publiée en production sans autorisation distincte ; chaque phase se termine par un rapport et attend l'accord avant la suivante.

---

## 6. Procédure de coupure d'urgence par les règles Firestore (à répéter en F4 sur le projet de test)

**But :** arrêter immédiatement les écritures (ou tous les accès) cloud, sans mise à jour de l'application ni service payant.

### 6.1 Effet attendu
- Le cloud refuse les requêtes : l'application passe en pause de synchronisation avec erreurs d'autorisation ; **les données locales restent intactes et utilisables hors ligne**.
- Authentication continue de fonctionner (les comptes ne sont pas supprimés).
- Les requêtes refusées consomment encore du quota.
- **Limite (levée en F2, voir section 12) :** l'application affiche désormais « Service temporairement suspendu » et conserve la file d'envoi sans rien bloquer définitivement.

### 6.2 Prérequis (à préparer avant d'en avoir besoin)
1. Un **fichier de règles d'urgence** préparé, relu, **non publié**, refusant les écritures (variante 1) ou tous les accès (variante 2). **Fait en F4** : `firestore.emergency-writes-off.rules` et `firestore.emergency-all-off.rules`, générés par `scripts/firebase-rules/emergency.js` (voir `docs/f4-production.md`), éprouvés sur l'émulateur local ; **répétition sur le projet de test non faite**.
2. La CLI Firebase disponible en local et la session ouverte (vérifier à l'avance : aucun téléchargement en urgence).
3. Une **méthode de lecture seule** des règles actives (déjà utilisée et validée sur le projet de test) pour sauvegarder la version courante **avant** toute publication.
4. Le **projet cible écrit explicitement** dans la commande (pas de projet par défaut).

### 6.3 Étapes
1. Décider de la variante (écritures refusées / tout refusé) et noter l'heure et le motif.
2. Sauvegarder les règles actives (lecture seule) dans un fichier daté, hors dépôt.
3. Publier le fichier d'urgence sur le projet visé, avec une commande à cible explicite (même commande que les publications habituelles de règles).
4. Relire les règles actives et comparer à l'attendu.
5. Vérifier par un compte de contrôle que l'écriture est refusée.
6. Informer les utilisateurs si nécessaire.

### 6.4 Retour à la normale
1. Corriger la cause.
2. Republier la sauvegarde datée (ou les règles validées), relire, comparer.
3. Vérifier la reprise avec un compte de contrôle : les envois en attente repartent.

### 6.5 Autres leviers (complémentaires, non retenus pour l'instant)
Nouvelle version avec le drapeau fermé (lente : revue du Store) ; interrupteur distant par document public lu au démarrage (à décider plus tard, gratuit mais demande une exception de lecture publique minime) ; désactivation des inscriptions ou de comptes dans la console (ne coupe pas les comptes existants).

### 6.6 Règle de conduite
La publication de règles d'urgence sur la **production** nécessite le jugement du propriétaire du projet au moment de l'incident ; la procédure doit avoir été **répétée sur le projet de test** avant l'ouverture (F4).

---

## 7. App Check (reporté)

- **Rôle :** vérifier que la requête vient de l'application authentique ; protège contre l'abus (inscriptions en masse, épuisement du quota) avec une clé publique. **Il ne remplace pas les règles**, qui décident qui peut lire ou écrire quoi.
- **Statut :** reporté. À vérifier avant toute décision : compatibilité réelle avec Expo SDK 54 et le SDK Firebase JavaScript utilisé, fournisseur adapté à Android, nécessité d'un build de développement, quotas gratuits des vérifications d'intégrité, plan de mise à jour obligatoire des anciennes versions avant d'imposer le contrôle. **Aucune de ces vérifications n'a été faite.**
- **Mesures en attendant :** règles strictes, vérification d'e-mail (F1), bornes de taille, suivi du quota, procédure d'urgence.

---

## 8. Détection du réseau (décision en F2)

- Candidats : `expo-network` (module officiel Expo) ou `@react-native-community/netinfo`. Compatibilité avec Expo SDK 54 et disponibilité de l'abonnement aux changements : **à vérifier avant le choix**.
- Intérêt : savoir immédiatement hors ligne / en ligne, relancer l'envoi au retour du réseau, éviter des requêtes vouées à l'échec, mieux gérer le quota.
- Conséquences : module natif (nouveau build nécessaire), éventuelle permission d'état du réseau dans le manifeste ; « connecté » ne garantit pas l'accès à Internet, la gestion des échecs actuelle reste nécessaire.
- Rien n'est installé à ce jour.

---

## 9. Questions encore ouvertes (à trancher avant la phase indiquée)

| # | Question | Avant |
|---|---|---|
| 1 | Plusieurs administrateurs par module, ou le propriétaire seul est administrateur en V1 ? | F3a |
| 2 | Un locataire peut-il avoir plusieurs contrats dans un même module ? | F3a |
| 3 | Que voit l'administrateur du demandeur (nom, e-mail) avant d'approuver ? | F3b |
| 4 | Protection contre les demandes répétées ou abusives (limites) | F3b |
| 5 | Points 4.3 (1 à 7) de la classification des champs | F3c |
| 6 | Lien entre le compte du locataire et sa fiche contact chez le propriétaire (le champ existe mais n'est pas utilisé) | F3b |
| 7 | Nombre maximal de membres par module (quota de lectures) | F3a |
| 8 | Interrupteur distant de coupure : **décidé — non en V1** (confirmé par le propriétaire du projet) ; l'arrêt passe par les règles d'urgence (prêtes), à reconsidérer si les essais de débogage montrent que l'erreur affichée pendant une coupure est trop obscure | F4 ✔ |
| 9 | Détection du réseau : **décidé — `@react-native-community/netinfo`** (confirmé par le propriétaire du projet) ; installation et branchement = autorisation distincte, non faits | F2 ✔ |

---

## 10. Garde-fous permanents

- `CLOUD_ACCOUNT_ENABLED` reste `false` jusqu'à validation de F7.
- Aucune migration, adoption ou envoi automatique de données locales.
- Aucune règle publiée en production sans autorisation explicite distincte ; règles jamais ouvertes à tous.
- Aucun accès au projet de production sans autorisation distincte.
- Aucun build, installation ou téléchargement sans accord.
- Aucun secret dans Git ; configuration réelle dans `.env` local ignoré.
- Chaque phase : rapport, preuves, attente de l'autorisation suivante.

---

## 11. Avancement — F1 (comptes et authentification), état local

**Réalisé (local, sans accès Firebase) :**
- **Moteur unique pour les nouveaux comptes** : l'ancienne synchronisation (biens et logements) n'est plus proposée qu'aux comptes qui l'utilisent déjà ; elle n'est jamais offerte à un nouveau compte. L'exclusion V1/moteur (marqueur persistant) est inchangée.
- **Vérification de l'adresse e-mail** : e-mail demandé à l'inscription (son échec n'annule pas l'inscription), renvoi limité à un par minute côté appareil, actualisation « J'ai vérifié mon adresse » (relecture du compte + renouvellement du jeton). **L'activation de la synchronisation est refusée tant que l'adresse n'est pas vérifiée** (refus par défaut).
- **Mot de passe à l'inscription** : 8 caractères minimum, une lettre, un chiffre, différent de l'adresse e-mail. La connexion n'impose rien (anciens comptes préservés). Le serveur reste l'arbitre.
- **Messages en français** pour chaque erreur courante ; aucun message utilisateur ne renvoie à la console Firebase ni à un réglage technique.
- **Réinitialisation du mot de passe** : une adresse inconnue n'est pas signalée (aucune fuite d'existence de compte).
- **Séparation des environnements** : une version publiée ne parle qu'à la production ; une version de développement qu'au projet de test ; projet inconnu refusé ; la production en développement exige une autorisation explicite et volontaire. Le garde s'applique avant toute initialisation de Firebase.
- **Écrans** : carte de vérification de l'adresse, synchronisation désactivée tant que l'adresse n'est pas vérifiée, textes à jour (périmètre réel d'Immobilier), politique de mot de passe annoncée.

**Non réalisé / non vérifié (à faire avec autorisation) :**
- Parcours d'inscription, de vérification, de connexion, de réinitialisation et de suppression contre le projet de **test** réel : non exécutés.
- Politique de mot de passe **côté serveur** (réglage de la console) : non modifiée ; seule la vérification locale existe.
- Modèles d'e-mail en français et domaines autorisés (console) : à régler en F4.
- Essai sur téléphone : en attente de la fin de F2. Pour cet essai, les valeurs du projet de **test** devront être fournies par un fichier local de développement ignoré par Git (le chargement automatique des fichiers `.env.*` par Expo est une hypothèse à vérifier).
- Règles de sécurité : aucune règle n'a été modifiée. La vérification d'adresse côté serveur (jeton) sera exploitée en F3a.

---

## 12. Avancement — F2 (moteur de synchronisation), état local

**Réalisé (local, sans accès Firebase) :**
- **Déclenchement automatique après modification** : l'enregistrement automatique des données (toutes les 3 s) prévient le moteur *seulement si le contenu a changé* (empreinte comparée à la précédente) ; le moteur capture alors le changement et l'envoie après un court délai d'accalmie. Sans moteur en marche, rien n'est calculé (comportement actuel inchangé). Les restaurations et les corrections financières préviennent aussi le moteur.
- **Correction / annulation d'un paiement confirmé** : dans le détail d'un paiement (liste « Paiements » d'un contrat), une action « Corriger ou annuler » apparaît *uniquement* si le paiement est déjà confirmé dans le cloud. Le paiement initial n'est jamais modifié : un nouveau fait, avec motif obligatoire, est ajouté ; une annulation est définitive ; l'historique des corrections s'affiche dans le détail.
- **Envoi volontaire des anciennes données** (Profil › Compte et synchronisation) : aperçu par type, confirmation explicite, **sauvegarde complète écrite puis relue et vérifiée avant toute décision** (échec = rien ne change), puis envoi par le moteur habituel. Jamais automatique, périmètre Immobilier seul, idempotent, sans suppression ni modification locale. Les anciennes données incomplètes (ex. contrat sans locataire) sont signalées et restent locales. Refusé en contexte multi-compte (la sauvegarde complète l'est aussi).
- **Cloud qui refuse tout** (règles d'urgence, accès retiré) : le moteur ne bloque plus définitivement les envois en attente. S'il n'a pu confirmer *aucune* écriture, il s'arrête en état « service suspendu » (file intacte, reprise lente toutes les 30 min, ou à l'ouverture, au retour du réseau, sur action manuelle) ; s'il en a confirmé au moins une, le refus est attribué à l'élément concerné (blocage comme avant). La procédure d'urgence (section 6) est ainsi cohérente avec le code : « les envois en attente repartent » au retour du service. Le bandeau affiche « Service temporairement suspendu… ». **La limite notée en 6.1 est donc levée côté application.**

**Décision réseau (question 9) — recommandation, rien d'installé :**
- Les deux candidats figurent dans la liste des modules compatibles de Expo SDK 54 installé ici (`expo-network` ~8.0.8, `@react-native-community/netinfo` 11.4.1). Aucun n'est présent dans le projet ; ni l'un ni l'autre n'a été installé ni exécuté.
- **Décision confirmée par le propriétaire du projet : `@react-native-community/netinfo`** (rien installé : l'installation, un nouveau build et le branchement demandent une autorisation distincte) (abonnement aux changements et indicateur « Internet joignable » bien établis). `expo-network` reste une alternative officielle ; **l'interface exacte de ces modules n'a pas été vérifiée dans le code** (ils ne sont pas téléchargés) : à contrôler à l'installation.
- Intégration prête : le moteur accepte déjà une fonction « en ligne ? » et un abonnement « retour du réseau » (injectés) ; le branchement tient en quelques lignes dans `services/firebase/syncRuntimeBoot.ts`. Conséquences : module natif → **nouveau build** nécessaire ; installation = téléchargement (**autorisation distincte**).
- **Sans ce module, le moteur fonctionne** : reprise au retour au premier plan, reprise différée après un échec réseau, minuteur de réception. Le module améliore la réactivité et économise des requêtes, il n'est pas indispensable à l'ouverture progressive.

**Non réalisé / non vérifié :**
- Scénarios hors ligne, reprise, envoi volontaire et correction **joués sur le projet de test réel**, puis sur téléphone : non exécutés (autorisation distincte requise). Les tests locaux utilisent un cloud en mémoire.
- Chronologie des loyers : une annulation explicite affiche désormais une ligne « Annulé » (le mois redevient « À payer » ou « En retard » comme dans les totaux) ; une correction reste un paiement « Payé » au montant corrigé (le détail liste la correction). Un rejet manuel n'est jamais présenté comme « Annulé ».
- Le bandeau de synchronisation n'apparaît que sur les écrans Biens/Détail d'un bien (inchangé) ; le détail d'un contrat n'en a pas.
- Corrections de paiements *non encore confirmés* : modification directe comme avant (volontaire).

---

## 13. Avancement — F3a (architecture des espaces partagés et règles), état local

Détail complet : `docs/f3a-espaces-partages.md`. En bref : modèle (`modules/{id}`, `members`, `requests`, `syncRecords`, `tenantViews`), règles **candidates** `firestore.p5.rules` (non publiées, **jamais exécutées**), politique de référence et matrice de 194 cas, test d'émulateur écrit mais **jamais lancé**, chemin de transport paramétré par espace (défaut inchangé). Aucune interface, aucun branchement. Défauts de V1 à confirmer avant F3b : administrateur = propriétaire (question 1), un contrat par membre (2), nom saisi sans e-mail (3), un refus bloque (4), aucun plafond de membres dans les règles (7). Les règles ne sont pas prouvées tant que la matrice n'a pas tourné contre elles (émulateur avec Java, ou projet de test : autorisation distincte).

---

## 14. Avancement — F3b (demandes, approbation, révocation, départ), état local

Détail : `docs/f3b-flux-espaces-partages.md`. Les cinq défauts de V1 de la section 13 sont **confirmés**. Flux, façade, carnet local, adaptateur Firestore et deux écrans écrits et testés contre un cloud en mémoire ; **rien joué en réel**, adaptateur et règles jamais exécutés, interface non vérifiée visuellement. Reste : preuve réelle (émulateur ou projet de test, autorisation distincte), puis F3c (vue du locataire), puis suppression d'un module avec le compte (F4). Hypothèse à confirmer : jour de fin de contrat = date de sortie (question 6).

---

## 15. Avancement — F3c (vue du locataire en lecture seule), état local

Détail : `docs/f3c-vue-locataire.md`. Question 6 **confirmée** (jour de fin = date de sortie du contrat, sinon dernière mise à jour d'un contrat terminé). Points 4.3 (1, 2, 3, 4, 5, 7) : **privés par défaut**, à confirmer. Projection, publication par différences, lecture et copie locale séparée, écran du locataire, règles candidates durcies (liste blanche de champs par type de vue) : écrits et testés contre un cloud en mémoire ; **rien joué en réel**, règles et adaptateur jamais exécutés, écrans non vérifiés visuellement. Reste : preuve réelle (émulateur ou projet de test, autorisation distincte), puis F4 (dont la suppression d'un module avec le compte).

**Décisions du propriétaire du projet après F3c** : points 4.3 **tous visibles** pour le locataire (nom du bien, mode de paiement, e-mail et note du contact, nom du propriétaire, loyer de référence) ; contrat archivé : oui ; paiement annulé présenté « Rejeté » au locataire ; **preuve réelle (émulateur ou projet de test) à faire avant F4**. Appliqué dans le code, les règles candidates et les tests locaux ; non prouvé en réel.

---

## 16. Preuve sur l'émulateur local (avant F4)

Détail : `docs/preuve-emulateur-f3.md`. Règles candidates `firestore.p5.rules` exécutées dans l'émulateur Firestore **local** : matrice de **194 cas : 194 réussis** ; flux à deux comptes avec l'adaptateur réel : **6 réussis** ; trois contrôles négatifs détectés exactement. **Non prouvé** : service Firebase réel / projet de test (non utilisé), Authentication réelle, quotas, écrans. Un test P4 existant (écritures simultanées) échoue sur cet émulateur, **indépendamment de F3** (reproduit avec le code d'origine) : à revérifier sur le projet de test réel.

---

## 17. Avancement — F4 (préparation de la production), état local

Détail : `docs/f4-production.md`. Fait en local : **effacement des espaces partagés avec le compte** (verrou irréversible, vidage, vérification, reprise ; éprouvé sur l'émulateur local, y compris la suppression de compte complète) ; **règles d'urgence** générées et éprouvées ; **manifeste des règles validées** et vérification avant/après publication ; **estimation des quotas** ; liste de contrôle d'authentification ; constat sur la configuration de build. **Non fait** (reporté à la phase de débogage sur `takarda-n2-test`) : publication des règles, répétition de la procédure d'urgence, essai avec un compte jetable. **Décisions en attente** : interrupteur distant (recommandation : non), plan gratuit ou payant. Constat : 10 comptes aux plafonds du moteur suffisent à épuiser le quota gratuit.

**Décisions du propriétaire du projet après F4** : (1) **pas d'interrupteur distant en V1** (question 8 tranchée) ; (2) **plan gratuit (Spark) conservé** : l'arrêt automatique du quota reste en place, aucun passage à un plan payant. Conséquence : le quota gratuit est un plafond dur ; son épuisement coupe le service pour tous jusqu'à la remise à zéro quotidienne (voir `docs/f4-production.md`, § 5) ; la surveillance quotidienne de l'usage et la procédure d'urgence sont les seules parades jusqu'à App Check.

---

## 18. Avancement — F6 (conformité et confidentialité), état local

Détail : `docs/confidentialite/`. **Fait** : politique de confidentialité **réécrite** pour l'état réel (comptes, synchronisation complète d'Immobilier, espaces partagés, vue du locataire, suppression, conservation) ; page de suppression de compte **réécrite** (espaces partagés, locataires, procédure interne) ; **déclaration « Sécurité des données » de Google Play** (brouillon) ; information **« Mes données »** dans l'application (Profil › Mes données), dérivée du modèle de la vue du locataire et vérifiée contre le code ; **case d'information obligatoire à l'inscription** ; notices de partage (propriétaire qui crée, locataire qui rejoint) ; **minimisation** : supprimer un espace partagé, quitter un espace retire le nom saisi (règles durcies et revalidées sur l'émulateur : 244 cas), départ des espaces rejoints à la suppression du compte ; **barrière** : `CLOUD_ACCOUNT_ENABLED` ne peut pas être ouvert tant que les documents légaux contiennent des éléments à fournir ou que leurs adresses manquent (`node scripts/release/legal-check.js`, test `legalReadiness.test.ts`).

**À fournir ou décider par le propriétaire du projet (bloquant pour F7)** — la liste détaillée, avec recommandations, est la partie 2 de la politique : responsable du traitement et contact ; date et modalités de mise à jour ; engagement de conservation des comptes inactifs ; **sauvegarde automatique Android** (recommandation : conserver) ; public visé et âge minimal ; hébergement et adresses https des deux pages ; législation applicable, base juridique, autorité de contrôle ; délai et vérification d'identité des demandes sans l'application. Les éléments « à vérifier » (conditions Firebase, région, formulaire « fonctions financières ») sont à confirmer dans les consoles. **Aucun document n'est publié.**

**Corrigé** : `docs/f4-production.md` affirmait que l'application « déclare » les permissions caméra et micro ; elles sont en fait **bloquées**.

---

## 19. Décisions provisoires de F7 (21 octobre 2026) — préparation, rien n'est lancé

Plan détaillé : `docs/f7-plan-ouverture-progressive.md`. Ce que le propriétaire a décidé **provisoirement** :
1. **Responsable et contact** : rien n'est inventé ; champs `[… À FOURNIR]` laissés dans les documents, bloquants pour l'ouverture (`legal-check.js`).
2. **Comptes inactifs** : proposition 24 mois, trois avertissements (J-60/J-30/J-7), **aucune suppression automatique** sans accord ; revue manuelle (plan gratuit sans fonction cloud).
3. **Sauvegarde Android** : conservée provisoirement ; analyse dans `docs/analyse-sauvegarde-android.md` ; **la confirmation (A + B) est en attente de la réponse du propriétaire**.
4. **Public** : proposition adultes 18+ ; **aucune tranche d'âge déclarée dans Google Play** sans validation.
5. **Pages publiques** : aucune adresse inventée ; exigences dans `docs/confidentialite/exigences-hebergement-pages-publiques.md` ; `constants/legalLinks.ts` reste à `null`.
6. **Législation** : `docs/confidentialite/analyse-juridique-togo-A-VERIFIER.md` — distingue « documenté (Google) », « rapporté (Togo, sources secondaires) » et « à vérifier » ; **ce n'est pas un avis juridique**.
7. **Suppression hors application** : accusé 3 jours ouvrés, objectif 14 jours, maximum 30 ; vérification par l'e-mail du compte, **aucune pièce d'identité**.
Limites maintenues : `CLOUD_ACCOUNT_ENABLED=false`, aucun contact Firebase, aucune règle publiée, aucun build, aucune publication, aucun commit.
