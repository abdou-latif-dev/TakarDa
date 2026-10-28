# F3a — Architecture des espaces partagés et règles (candidat)

> **Mise à jour (F4)** : les règles candidates et les flux décrits ici ont depuis été **exécutés dans l'émulateur Firestore local** (voir `docs/preuve-emulateur-f3.md`) ; les mentions « jamais exécuté » ci-dessous décrivent l'état au moment de la rédaction. Le projet de test réel n'a pas été utilisé.

> **Statut : conception + code local + règles CANDIDATES. Rien n'est publié, rien n'est branché à l'application, aucun accès Firebase n'a eu lieu.**
> `CLOUD_ACCOUNT_ENABLED` reste `false`. Le fichier `firestore.p5.rules` n'a **jamais été exécuté** (ni émulateur, ni projet de test) : sa syntaxe et son comportement ne sont **pas prouvés**.

## 1. Ce que F3a livre

| Livrable | Fichier | Nature |
|---|---|---|
| Modèle : chemins, états, validation, identifiant, fin d'accès | `services/sharedModules/model.ts` | code pur, testé |
| Politique d'accès de référence | `services/sharedModules/accessPolicy.ts` | code pur, testé |
| Matrice de 194 cas partagée | `services/__tests__/helpers/modulesMatrix.ts` | données de test |
| Règles candidates | `firestore.p5.rules` (= P4 + un bloc délimité) | **non publié, non exécuté** |
| Test de la politique + contrôles statiques des règles | `services/__tests__/sharedModules.test.ts` | exécuté, vert |
| Test des règles dans l'émulateur (même matrice) | `services/__tests__/modulesRules.emulator.test.ts`, `jest.emulator.modules.config.js`, `firebase.modules.json` | **écrit, jamais lancé** (Java absent) |
| Chemin de transport par espace | `syncCollectionPath` / `createFirestoreSyncBackend(db, uid, space?)` | défaut = espace personnel, inchangé |

## 2. Modèle (chemins Firestore)

```
modules/{moduleId}                               module : ownerUid, type, name, createdAt, schemaVersion
modules/{moduleId}/members/{uid}                 membre (locataire) : role, state, contractId, accessUntil, addedBy, dates
modules/{moduleId}/requests/{uid}                demande d'accès (une par utilisateur) : state, label, decidedBy, dates
modules/{moduleId}/syncRecords/{recordId}        données du module (même modèle que les documents de synchronisation V1)
modules/{moduleId}/tenantViews/{uid}/items/{id}  vue en lecture seule destinée à CE locataire (projection)
```

- `moduleId` : `mod_` + 24 caractères aléatoires. **Adresse, pas secret** : le connaître ne donne aucun accès. Les règles imposent le format.
- Les règles existantes (`users`, `spaces`, `syncRecords` personnels) **ne sont pas modifiées** : le bloc est un voisin de `spaces` (vérifié par test : `P5 = P4 + bloc`).
- `accessUntil` est un **Timestamp Firestore** dans le cloud (seul type comparable à l'heure du serveur dans les règles) ; ISO dans le modèle local.

### États
- Membre : `active` → `revoked` (propriétaire) ou `left` (le membre) ; `revoked|left` → `active` (rétablissement par le propriétaire seulement).
- Demande : `pending` → `approved` | `refused` (propriétaire seul, une fois). Une demande tranchée ne change plus.

## 3. Décisions de V1 retenues PAR DÉFAUT (à confirmer avant F3b)

| # | Question ouverte | Défaut retenu dans F3a | Pourquoi |
|---|---|---|---|
| 1 | Plusieurs administrateurs ? | **Non : l'administrateur est le propriétaire.** Les membres ne sont que des locataires. | Règles bien plus simples et sûres ; moins de lectures facturées ; le multi-administrateur ajoute la propriété partagée des documents et des conflits entre appareils. |
| 2 | Plusieurs contrats par locataire ? | **Un contrat par membre** (`contractId`). | Une fiche par utilisateur et par module ; à étendre en liste plus tard si besoin. |
| 3 | Que voit l'administrateur du demandeur ? | Un **nom saisi par le demandeur** (`label`, facultatif, 60 car.) ; **aucun e-mail** n'est stocké dans la demande. | Minimisation des données ; l'administrateur identifie la personne par son nom et reconnaît le contexte. |
| 4 | Abus / demandes répétées | Une seule demande par utilisateur ; **un refus bloque** tant que le propriétaire n'a pas effacé la demande ; un membre ou ancien membre ne redemande pas (il passe par le propriétaire). | Anti-harcèlement sans compteur ni fonction cloud. |
| 7 | Nombre maximal de membres | **Aucun plafond dans les règles** ; à imposer côté application (F3b). | Une règle de plafond demande un compteur transactionnel ; reporté. |

Ces choix sont **réversibles** tant que rien n'est publié.

## 4. Protections (section 3 des décisions) → où elles vivent

| Protection | Règles | Politique + matrice |
|---|---|---|
| Aucun accès sans membre actif, non-membre ne lit rien | `activeTenant`, `isOwner`, `allow list: if false` | cas « accès réservé aux membres actifs » |
| Étanchéité entre modules | tout est conditionné au `moduleId` du chemin | cas « étanchéité entre modules » |
| Locataire : seulement sa vue, jamais d'écriture, aucun autre locataire | `tenantViews/{viewUid}` + `isSelf` ; aucune règle d'écriture pour un locataire | cas « un locataire ne voit… / n'écrit rien » |
| Propriétaire immuable, pas de suppression de module | `affectedKeys().hasOnly(['name'])`, `allow delete: if false` | cas « propriétaire immuable » |
| Faits financiers en création seule | `!(resource.data.kind in financialKinds())` | cas « faits financiers… » |
| Pas d'auto-approbation | demande créée `pending` non tranchée ; seul le propriétaire (≠ demandeur) tranche ; membre créé seulement avec `getAfter(demande).state == 'approved'` | cas « jamais d'auto-approbation » |
| Accès expiré, révoqué, en attente, refusé : refusé | fiche du membre relue à chaque accès (`state`, `accessUntil`) | cas « accès expiré/révoqué/… » |
| Pas d'accès sans connexion par mot de passe | `signedIn()` (existant) | cas « aucun accès sans connexion… » |
| Côté appareil : données d'un module rejoint séparées, invisibles d'un autre compte | **non couvert en F3a** (voir §6) | — |

## 5. Ce qui est prouvé, et ce qui ne l'est pas

**Prouvé (tests locaux, toujours exécutés) :** la cohérence du modèle et de la politique de référence sur 194 cas, la couverture des protections, la forme du fichier de règles (`P5 = P4 + un bloc`, aucune règle ouverte, listes de champs et de types identiques au modèle et au registre, protections clés présentes dans le texte), l'absence de branchement dans l'application.

**NON prouvé :**
- que `firestore.p5.rules` **se compile** (une erreur de syntaxe n'a jamais pu être détectée) ;
- que les règles **se comportent comme la politique** : la même matrice est prête à être rejouée contre elles (`modulesRules.emulator.test.ts`), mais n'a **jamais tourné**. Tant qu'elle n'a pas tourné, la politique n'est pas une preuve du comportement des règles.
- Constructions à surveiller en priorité : `getAfter()` (approbation atomique, lot d'écritures), la comparaison `request.time < accessUntil` avec un Timestamp, le motif `matches('mod_[a-z0-9]{24}')`.
- Approximation du test d'émulateur : l'heure des règles est celle de l'émulateur ; l'égalité stricte « à l'instant de fin d'accès » n'est prouvée que par la politique.

**Pour prouver les règles** (autorisations distinctes) : (a) émulateur local : demande Java ; (b) ou projet de test `takarda-n2-test` : publication du candidat sur le projet de test seulement, accès réseau. Aucun des deux n'a été fait.

## 6. Registre de propriété et transport (analyse)

- **Côté propriétaire (administrateur)** : ses données restent locales et marquées à son compte (`cloudOwnerUid`) ; **le registre de propriété n'a pas besoin de changer** : seule la **destination** change (espace personnel → module). Le choix de destination est une fonction (`syncCollectionPath`) ; le transport en dépend, l'application ne choisit jamais un module (testé).
- **Côté locataire** : il ne reçoit que sa **vue** (projection publiée par le propriétaire). Elle devra être stockée **à part** des données propres (clé module + membre), en lecture seule, invisible d'un autre compte du même appareil. Ce stockage et la séparation d'appareil relèvent de **F3c** ; il n'est pas implémenté ici.
- **Multi-administrateur** (écarté en V1) obligerait à appliquer des documents dont l'auteur est un autre administrateur : le registre de propriété et les règles de modification devraient alors changer.

## 7. Coûts et limites (plan gratuit)

- Chaque accès d'un locataire coûte **1 lecture de plus** (relecture de sa fiche de membre par les règles) ; l'approbation d'une demande : 1 lecture supplémentaire (`getAfter`). Quotas à vérifier en F4.
- Un locataire lit **sa vue seulement** (pas les données du module) : le coût de lecture croît avec le nombre de locataires **actifs**, pas avec la taille du module.
- Pas de notification poussée : l'administrateur voit les demandes en ouvrant l'application.

## 8. Reste à faire / points ouverts (hors F3a)

- **Effacement de compte** : la procédure actuelle couvre l'espace personnel ; un module dont le propriétaire supprime son compte reste orphelin (et aucune règle n'autorise la suppression). À traiter en F3b/F4 (suppression d'un module : décision de produit + règles + procédure vérifiée).
- **Création du module, « Rejoindre », approbation, révocation, départ** (interface et flux) : F3b. **Vue locataire** et stockage appareil : F3c.
- **Expiration à 90 jours** : la règle lit `accessUntil` ; la **valeur** (date de fin de contrat → +90 j) est posée par l'application du propriétaire (`accessUntilForContractEnd`). Question 6 (point de départ des 90 jours) reste ouverte.
- **Publication des règles** : jamais sans autorisation distincte et sans passage des tests réels.
- **Mise à jour d'un accès par un locataire hors ligne** : la lecture est refusée côté cloud dès la révocation ; les données déjà reçues restent sur l'appareil jusqu'à leur retrait (à traiter en F3c).
