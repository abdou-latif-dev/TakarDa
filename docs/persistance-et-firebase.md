# Persistance locale et préparation de Firebase (Phase 10)

État : **Firebase n'est pas intégré.** Cette note décrit l'existant, les frontières à respecter et les décisions encore
ouvertes. TakarDa V1 fonctionne sans compte, sans réseau, avec l'identité locale `u-me`.

## 1. Persistance actuelle

- **Un seul accès à AsyncStorage** : `services/storage.ts` (`storage.get/set/remove`, valeurs en JSON, préfixe
  historique `@formease/` exporté sous `STORAGE_PREFIX`, **à ne jamais changer**). Tous les autres modules passent par lui.
  `KeyValueStore` en est le contrat minimal ; `storage` est son implémentation locale.
- **Base en mémoire** : `services/db.ts` (tableaux importés par référence par tous les services). `services/persistence.ts`
  les relit au démarrage (`hydrateDb`) et les enregistre toutes les 3 s et à la mise en arrière-plan (`startAutoPersist`).
  Les erreurs d'enregistrement automatique sont ignorées (`.catch(() => {})`) ; celles de lecture remontent à l'appelant.
- **Deux familles de clés**
  - Historique, un seul blob : `db_snapshot` (users, groups, memberships, tontineCycles, tours, contributions, forms,
    submissions, activityEvents, notifications).
  - Core, une clé par collection : `core_tools`, `core_entity_definitions`, `core_records`, `core_tool_members`,
    `core_external_contacts`, `core_role_definitions`, `core_events`, `core_documents`, `core_workflow_rules`, plus
    `core_meta` (`schemaVersion` = 1, mécanisme `coreMigrations` vide et réservé).
  - Les modèles de formulaires (`templates`) ne sont pas persistés : ils sont recréés à chaque lancement.
- **Autres clés** : `session` (écrite seulement par `login`/`signUp`, jamais nécessaire pour entrer), `onboarding_seen`,
  `theme_settings`, `announcements_dismissed`, `notification_preferences`.
- Pas de requête réseau dans le code applicatif (vérifié par `services/__tests__/firebasePrep.test.ts`).

## 2. Frontières préparées pour Firebase

- Aucune couche de plus n'a été ajoutée : `storage.ts` est déjà la frontière locale, et `persistence.ts` le seul
  endroit qui sait *quoi* enregistrer. Une synchronisation future s'y raccordera (un nouveau module de synchronisation
  qui lit/écrit les collections de `db.ts` ou, mieux, des fonctions de service), **pas** en important un SDK dans
  `coreService`, `immobilierService`, `tontineService`, `utility*Service` ou les écrans.
- Règle : un SDK Firebase ne doit être importé que par un module « distant » dédié, derrière une interface
  (`AuthProvider`, `RemoteStore`…) à définir lors de l'intégration. Il n'en existe pas encore ; elle ne se justifie
  pas tant qu'aucun besoin réel n'est connu.
- `authService` est déjà décrit comme remplaçable (« réécrire les corps ») ; aujourd'hui `login`/`signUp` sont des
  simulations locales qui ne vérifient rien. Elles ne doivent jamais être présentées comme une vraie authentification.

## 3. Identité locale

- `CURRENT_USER_ID = 'u-me'` (`db.ts`) ; `getCurrentUserId()` et `ensureLocalUser()` (`identityService.ts`).
  `groupService`, `formService`, `formTemplateService`, `coreService` lisent encore `CURRENT_USER_ID` directement.
- Notions à distinguer le jour venu (ne pas les confondre dans un seul champ `userId`) :
  1. **identité locale anonyme** (`u-me`, présente sur *chaque* installation) ;
  2. **compte authentifié** (UID distant) ;
  3. **utilisateur distant** (autre personne ayant un compte) ;
  4. **propriétaire d'un outil** (`Tool.ownerId`) ;
  5. **membre invité** (`ToolMember`, `userId` ou `contactId`).
- Principe de liaison proposé : conserver `u-me` comme identifiant *interne* des données existantes et ajouter, le moment
  venu, une table de correspondance `u-me ↔ UID` (ou un champ `linkedAccountId` sur l'utilisateur local), plutôt que
  réécrire les `ownerId`/`createdBy`/`userId`. Rien n'est migré aujourd'hui ; les utilisateurs sans compte restent valides.
- Risques à résoudre avant toute synchronisation :
  - `u-me` est identique sur tous les appareils : deux appareils d'une même personne, ou de personnes différentes,
    produiraient des données du « même » propriétaire. Il faut un identifiant d'installation distinct, ou lier explicitement.
  - `formeaseId` (ex. `FE-4821`) est une valeur par défaut identique pour toute nouvelle installation : ce n'est pas un
    identifiant unique et ne peut pas servir à retrouver une personne tel quel.
  - Un utilisateur qui se connecte sur un second appareil déjà utilisé en local : fusion, choix ou doublons à décider.
  - `ExternalContact.linkedUserId` existe déjà pour rattacher un contact à un compte (non utilisé).

## 4. Propriété et membres (modèles existants)

- `Tool { ownerId, settings, … }`, `ToolMember { toolId, roleId, accountType: 'user' | 'external', userId?, contactId?,
  status: 'active' | 'invited' | 'inactive' }`, `RoleDefinition { toolId, key, permissions: PermissionSet }`
  (`canView/canCreate/canEdit/canDelete/canManageTool/canInvite`, `scope: 'all' | 'own'`).
  Les rôles sont libres par outil, pas un énumérateur global.
- Hypothèses locales à lever pour le partage :
  - `getMyTools()` sépare déjà `owned` / `shared` (membre d'un outil d'un autre propriétaire) ; `shared` est toujours vide en V1.
  - `coreService.listTools` filtre sur `ownerId === CURRENT_USER_ID` : un outil partagé n'apparaîtrait pas.
  - **`installedAt` et `hidden` (Mes Outils) sont stockés dans `Tool.settings`**, donc sur l'outil lui-même. Pour un outil
    partagé, ce sont des préférences *par utilisateur* : elles devront vivre ailleurs (par membre ou par utilisateur),
    sinon masquer un outil le masquerait pour tous.
  - Les services Tontine historiques utilisent `Group`/`Membership` (`ownerId`, `userId`, `accountType: 'formease_user' | 'guest'`),
    alors que Immobilier/CEET/TDE utilisent `Tool`/`ToolMember`/`Record` : deux modèles à unifier ou à synchroniser séparément.
  - Identifiants générés localement (`genId` = préfixe + `nanoid(8)`) : collisions peu probables mais non impossibles ;
    à valider (ou à remplacer par des identifiants attribués côté serveur).
  - Les calculs CEET/TDE, loyers et reçus figent des valeurs à la validation (snapshots) : à conserver tels quels côté distant.
- Les contrôles d'accès actuels sont des filtres côté application. **Ils ne constituent pas une sécurité** : lors d'un
  partage réel, propriétaire, membres, rôles et permissions devront être vérifiés côté serveur (règles de sécurité),
  jamais seulement dans l'interface.
- Invitations et demandes d'accès : non conçues ni implémentées (`status: 'invited'` est le seul vestige du modèle).

## 5. Décisions encore ouvertes

- Fournisseurs d'authentification (email, téléphone, autre) et parcours de liaison de l'identité locale.
- Source de vérité : local d'abord avec synchronisation différée, ou serveur pour les outils partagés uniquement.
- Stratégie de conflits (dernier écrit gagne, fusion champ à champ, ou enregistrements immuables), horloges des appareils.
- Données modifiées sur plusieurs appareils ; suppression distante (suppression logique ?) ; reprise après échec ;
  files d'envoi hors ligne.
- Granularité de la synchronisation : par outil, par collection, par enregistrement ; format des identifiants.
- Modèle de données distant (collections, index) et règles de sécurité ; invitations (code, lien, QR) et expiration.
- Données personnelles : quoi envoyer, consentement, suppression de compte, conservation.

## 6. Étapes pour une intégration réelle (à valider une par une)

1. Décider l'authentification et le modèle d'identité (section 3), puis créer le projet Firebase *en dehors* du code
   (aucun secret dans le dépôt ; configuration par variables d'environnement EAS).
2. Définir un module `AuthProvider` et un module distant isolés ; ne toucher aucun service métier.
3. Introduire un identifiant d'installation / lier `u-me` à un compte, sans réécrire les données existantes ; prévoir
   la sauvegarde avant toute migration et un retour arrière.
4. Sortir `installedAt`/`hidden` de `Tool.settings` pour les outils partagés.
5. Écrire les règles de sécurité serveur et les tester avant de brancher l'application.
6. Synchroniser d'abord un seul outil en lecture, puis l'écriture, avec journal des conflits ; garder l'application
   pleinement utilisable hors ligne et sans compte.
7. Invitations et demandes d'accès en dernier.

## 7. Risques de migration et de synchronisation

- Perte ou duplication de données à la fusion de deux jeux locaux (même `u-me`, mêmes `genId` sur des appareils distincts).
- Écrasement silencieux en cas de conflit ; suppressions qui « ressuscitent » depuis un appareil resté hors ligne.
- Instantané historique `db_snapshot` d'un seul tenant : toute évolution de son schéma doit rester rétrocompatible.
- Clé de stockage `@formease/` et identifiants de publication (`com.takarda.app`, projectId EAS) à conserver : les changer
  rendrait les données locales ou le projet introuvables.
- Fausse impression de sécurité : un contrôle d'accès uniquement dans l'interface n'empêche rien côté serveur.
