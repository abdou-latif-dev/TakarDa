# TakarDa — Politique de confidentialité (BROUILLON, non publié)

> **Statut : brouillon réécrit le 21 octobre 2026 à partir du code réel de l'application (comptes, synchronisation d'Immobilier, espaces partagés, vue du locataire, suppression de compte).**
> Rien n'est publié. Les éléments `[À FOURNIR]`, `[À DÉCIDER]`, `[À VÉRIFIER]`, `[À CONFIRMER]` ne doivent pas être publiés tels quels : ils attendent une information ou une décision du propriétaire du projet. Aucun nom, adresse, durée ou engagement n'a été inventé.
> Ce texte n'est pas un avis juridique : il doit être relu par le propriétaire et, si nécessaire, par un conseil.
> **Tant que ces éléments restent, l'ouverture des comptes (drapeau `CLOUD_ACCOUNT_ENABLED`) est bloquée par un test** (`services/__tests__/legalReadiness.test.ts`, commande `node scripts/release/legal-check.js`).

Légende des parties 2 à 4 : **[CODE]** = confirmé par le code · **[À FOURNIR]** = information que seul le propriétaire connaît · **[À DÉCIDER]** = décision du propriétaire (une recommandation est donnée) · **[À VÉRIFIER]** = point juridique ou opérationnel à confirmer.

---

## PARTIE 1 — Texte de la politique (à compléter puis publier)

**Dernière mise à jour : [DATE À FOURNIR]**

### 1. Qui est responsable de vos données ?
TakarDa est une application Android de gestion (tontines, immobilier, factures d'électricité et d'eau, formulaires).
Responsable du traitement pour les comptes et les espaces partagés : **[NOM OU ENTITÉ À FOURNIR]**. Contact pour toute question sur vos données : **[ADRESSE DE CONTACT À FOURNIR]**.
**Propriétaires et locataires.** Lorsqu'un propriétaire enregistre dans TakarDa des informations sur ses locataires, **c'est lui qui décide de ces informations et de leur usage** ; TakarDa fournit l'outil et l'hébergement. Le propriétaire doit informer ses locataires qu'il les enregistre et, s'il crée un espace partagé, qu'ils pourront consulter leurs informations dans TakarDa.

### 2. L'essentiel
- **TakarDa fonctionne sans compte.** Dans ce cas, vos données restent sur votre téléphone et ne sont envoyées à personne.
- **Un compte est facultatif.** Il sert à retrouver vos données d'Immobilier sur un autre téléphone (synchronisation) et à partager avec vos locataires, en lecture seule, **leurs propres informations**.
- TakarDa n'affiche **aucune publicité**, n'utilise **aucun outil de statistiques d'usage ni de rapport d'erreurs automatique**, n'accède pas à votre position et n'utilise **ni la caméra ni le micro** sur Android.
- **Aucune donnée n'est vendue.**

### 3. Les données que TakarDa traite

**3.1 Sur votre téléphone (dans tous les cas)**
Les informations que vous saisissez sont enregistrées dans la mémoire privée de l'application :
- votre profil local : nom, e-mail, téléphone et photo, si vous les renseignez ;
- vos tontines : groupes, membres, cotisations, tours ;
- vos formulaires et leurs réponses, y compris les photos, fichiers et signatures que vous choisissez d'y joindre ;
- votre gestion immobilière : biens, logements, contrats, locataires (nom, téléphone, e-mail, note), paiements et leurs corrections, avances, dépenses ;
- vos factures d'électricité (CEET) et d'eau (TDE) ;
- vos notifications, votre historique d'activité et vos préférences ;
- l'état de la synchronisation, le carnet de vos espaces partagés, les copies de sécurité locales créées avant un envoi volontaire de données, et, si vous êtes locataire, la copie de votre vue (voir 3.5).
Ces données ne sont **pas chiffrées par l'application elle-même** ; elles sont protégées par l'isolation que le système Android applique à chaque application.

**3.2 Si vous créez un compte**
- votre **adresse e-mail** et votre **mot de passe**, gérés par le service Firebase Authentication de Google. TakarDa ne conserve pas votre mot de passe ;
- un **identifiant unique** de compte ;
- l'état de vérification de votre adresse : un **e-mail de vérification** vous est envoyé, et la synchronisation comme les espaces partagés restent fermés tant que l'adresse n'est pas vérifiée ;
- Firebase tient aussi certaines informations techniques de compte (dates de création et de connexion, par exemple) **[À VÉRIFIER : liste exacte dans la documentation Firebase]**.

**3.3 Si vous activez la synchronisation (propriétaire)**
Sont envoyés vers votre **espace personnel** dans Cloud Firestore (base hébergée dans la région africa-south1 **[À VÉRIFIER : confirmer dans la console Firebase]**), uniquement pour **Immobilier** et **ce qui est créé après l'activation** (sauf envoi volontaire de vos données plus anciennes, après aperçu, confirmation et sauvegarde de sécurité) :
- **biens, logements, contrats, paiements, corrections de paiement (avec leur motif), dépenses** : l'ensemble des champs que vous saisissez, y compris vos **notes libres et champs personnalisés** ;
- **locataires** (contacts liés à un contrat) : nom, téléphone, e-mail, note ;
- pour chaque élément : dates de création et de modification, numéro de version, indication de suppression ;
- un espace personnel (identifiant, propriétaire) et un petit profil technique.
**Ne sont jamais envoyés dans le cloud :** tontines, formulaires et réponses, factures CEET/TDE, profil local, photos et fichiers.
Les noms, téléphones et notes que vous saisissez peuvent être des données personnelles de tiers : ne les saisissez que si vous en avez le droit.

**3.4 Si vous créez un espace partagé (propriétaire)**
- l'**espace** : identifiant, nom, propriétaire, date de création ;
- les **demandes d'accès** : identifiant du compte du demandeur, nom qu'il a choisi de saisir (facultatif), date, état (en attente, approuvée, refusée) ;
- les **fiches d'accès** (une par locataire approuvé) : identifiant du compte, état (actif, retiré, quitté), contrat lié, date de fin d'accès ;
- la **vue de chaque locataire**, publiée par vous : uniquement les informations de **son** contrat — contrat (statut, nom, téléphone, e-mail et note du contact, nom du propriétaire, loyer, dates d'entrée et de sortie, jour de paiement, dernier loyer payé, caution, avance), logement (nom, type, cuisine, WC, adresse et nom du bien, loyer de référence), paiements (mois, montant, statut, date de validation, mode de paiement, référence du reçu), avance (montant, part consommée et disponible, mois couverts), retards (mois en retard et jour d'échéance, seulement si le calcul est fiable) et historique du contrat (contrat enregistré, loyer enregistré, contrat terminé).
**Vos notes libres, champs personnalisés, raisons de correction ou d'annulation, dépenses, statistiques, ainsi que les autres locataires et contrats, ne figurent jamais dans la vue d'un locataire** : les règles de la base refusent tout champ qui n'est pas dans la liste ci-dessus.
Vos données de synchronisation (3.3) ne sont **jamais lisibles par vos locataires** : seuls vous et vous-même y avez accès.

**3.5 Si vous rejoignez un espace partagé (locataire)**
- votre **demande** : identifiant de votre compte et, si vous le saisissez, un nom ; l'identifiant d'un espace est une adresse, **il ne donne jamais accès** : le propriétaire doit approuver ;
- votre **fiche d'accès** (créée par le propriétaire) ;
- sur votre téléphone, une **copie en lecture seule de votre vue**, rangée à part de vos propres données, supprimée quand votre accès est retiré, quitté ou terminé (à l'actualisation, ou à l'heure de fin d'accès si l'appareil est hors ligne).
Vous ne pouvez rien modifier : vous lisez ce que le propriétaire publie à votre sujet.

### 4. Pourquoi ces données ?
- fournir les fonctions de l'application sur votre téléphone ;
- créer votre compte, vous reconnaître à la connexion, vous envoyer l'e-mail de vérification et, à votre demande, celui de réinitialisation du mot de passe ;
- synchroniser vos données d'Immobilier entre vos appareils ;
- permettre à un propriétaire de montrer à chaque locataire ses propres informations, après approbation de sa demande.
Base juridique : **[À FOURNIR / À VÉRIFIER selon la législation applicable]**.

### 5. Qui voit quoi ? Avec qui les données sont-elles partagées ?
- **Vous seul** accédez à vos données synchronisées (propriétaire).
- **Un locataire approuvé** voit **uniquement** sa vue (3.4), en lecture seule, tant que son accès est actif.
- **Le propriétaire** voit, pour une demande d'accès, l'identifiant du compte du demandeur et le nom saisi — rien d'autre.
- **Aucun autre utilisateur** n'a accès à vos données. Il n'existe pas de page publique : un espace ne se découvre pas, il faut en connaître l'identifiant **et** être approuvé.
- **Google (Firebase)** traite les données du compte et de la base comme prestataire technique, pour le compte de TakarDa **[À VÉRIFIER : conditions Firebase applicables, transferts internationaux éventuels]**.
- Aucune donnée n'est vendue ni cédée à des annonceurs.

### 6. Sauvegarde automatique d'Android
L'application autorise la sauvegarde automatique d'Android : selon les réglages de votre téléphone, une copie des données de l'application (y compris, le cas échéant, l'état de synchronisation et la copie de votre vue de locataire) peut être conservée dans votre compte Google et restaurée sur un nouveau téléphone. Cette sauvegarde est gérée par Google et le système Android, pas par TakarDa. **[À DÉCIDER : conserver ou désactiver cette sauvegarde automatique — voir la partie 2]**.

### 7. Combien de temps vos données sont-elles conservées ?
- **Sur votre téléphone :** jusqu'à ce que vous les supprimiez, effaciez les données de l'application ou la désinstalliez. La copie de la vue d'un locataire est supprimée quand son accès est retiré, quitté ou terminé.
- **Dans le cloud, propriétaire :** tant que votre compte existe ; supprimées avec lui. Vous pouvez aussi supprimer un espace partagé à tout moment : il est supprimé aussitôt (vos locataires perdent l'accès).
- **Accès d'un locataire :** jusqu'à 90 jours après la fin de son contrat, ou jusqu'à ce que le propriétaire le retire ; l'accès est refusé dès cette date, et la vue est retirée du cloud lorsque le propriétaire ouvre l'application ensuite.
- **Demandes d'accès :** une demande approuvée ou en attente peut être effacée par son auteur (en quittant l'espace, le nom saisi est retiré) ; une demande refusée reste jusqu'à ce que le propriétaire l'efface, pour éviter les demandes répétées ; la fiche d'accès (identifiant, contrat lié, état) reste chez le propriétaire comme historique de location tant que l'espace existe.
- **Comptes inactifs :** TakarDa ne supprime pas automatiquement les données d'un compte inactif. **[ENGAGEMENT DE CONSERVATION À FOURNIR]**.
- **Identifiant technique d'un compte supprimé :** un identifiant technique du compte (une suite de caractères sans nom ni coordonnée) et la date de suppression. Ils sont conservés pour empêcher qu'un appareil resté connecté recrée des données après la suppression ; ils ne permettent pas, à eux seuls, de vous identifier. **[À VÉRIFIER avec un juriste : qualification de cet identifiant et durée de conservation]**.
- **Après suppression du compte :** les données du cloud sont supprimées par l'application ; les délais de purge côté Google (copies de sauvegarde) sont indiqués dans les conditions de Firebase **[À VÉRIFIER]**.

### 8. Supprimer votre compte
Dans l'application : **Profil › Compte et synchronisation › Supprimer mon compte**. Vous devez saisir votre mot de passe. TakarDa supprime alors, dans cet ordre : **vos espaces partagés** (verrouillés d'abord : vos locataires perdent l'accès aussitôt), vos données synchronisées et votre espace personnel, votre profil technique, puis votre compte. **Cette suppression est irréversible.** Si vous aviez rejoint des espaces, vous les quittez et le nom saisi dans vos demandes est retiré, dans la mesure du possible ; un échec n'empêche pas la suppression.
- **Ce qui est conservé dans le cloud après la suppression :** un identifiant technique du compte (une suite de caractères sans nom ni coordonnée) et la date de suppression. Ils sont conservés pour empêcher qu'un appareil resté connecté recrée des données après la suppression ; ils ne permettent pas, à eux seuls, de vous identifier. **[À VÉRIFIER avec un juriste : qualification de cet identifiant et durée de conservation]**.
- **Ce qui reste sur votre téléphone :** toutes vos données locales sont conservées et continuent de fonctionner sans compte.
- **Ce qui reste sur vos autres téléphones :** rien n'y est effacé à distance.
- **Ce qui reste chez un propriétaire dont vous étiez locataire :** votre fiche d'accès (identifiant, contrat lié, état « quitté ») fait partie de son historique de location ; vous pouvez demander son effacement à ce propriétaire, ou à **[ADRESSE DE CONTACT À FOURNIR]**.
- **Si la suppression échoue ou n'est que partielle :** l'application l'indique précisément et vous permet de réessayer ; votre compte n'est jamais présenté comme supprimé avant confirmation.
- **Sans accès à l'application :** utilisez la page **[ADRESSE DE LA PAGE DE SUPPRESSION À FOURNIR]**.

### 9. Vos droits
Vous pouvez demander l'accès à vos données, leur rectification, leur suppression, ou la limitation de leur traitement, dans les conditions prévues par la loi **[LÉGISLATION APPLICABLE À CONFIRMER]**. Pour exercer ces droits : **[ADRESSE DE CONTACT À FOURNIR]**. Vous pouvez saisir l'autorité de protection des données de votre pays **[AUTORITÉ À CONFIRMER]**.
- **Accès :** vous consultez vos données dans l'application ; un locataire consulte sa vue ; vous exportez une copie de vos données locales depuis Profil › Stockage › Exporter une sauvegarde.
- **Rectification :** vos données se corrigent dans l'application ; un locataire demande la correction de ses informations à son propriétaire, qui les tient.
- **Effacement :** voir les points 7 et 8.

### 10. Sécurité
Les échanges avec Firebase se font par connexion sécurisée. Des règles d'accès limitent chaque compte à ce qui lui revient : un propriétaire à son espace personnel et à ses espaces partagés, un locataire à sa seule vue ; un compte dont l'adresse n'est pas vérifiée n'accède à rien de tout cela. Un arrêt d'urgence du service est possible. Les données locales ne sont pas chiffrées par l'application. Aucun système ne garantit une sécurité absolue. **[À VÉRIFIER : formulations techniques à valider]**.

### 11. Enfants
**[À DÉCIDER : public visé et âge minimal — voir la partie 2]**.

### 12. Modifications de cette politique
Toute modification sera publiée sur cette page avec sa date. **[MODALITÉS D'INFORMATION À FOURNIR]**.

---

## PARTIE 2 — Informations et décisions attendues du propriétaire du projet
| # | Information ou décision | Utilisée dans | Recommandation |
|---|---|---|---|
| 1 | Nom ou entité responsable du traitement | §1 | — |
| 2 | Adresse de contact (e-mail ou formulaire) pour les questions et demandes de droits | §1, §8, §9 | une adresse dédiée, relevée régulièrement |
| 3 | Date de mise à jour et modalités d'information des changements | en-tête, §12 | mise à jour datée sur la page + information dans l'application pour tout changement important |
| 4 | Engagement de conservation des données cloud d'un compte inactif | §7 | décider d'une durée (ou « aucune purge automatique ») et la publier ; la surveillance manuelle suffit au départ |
| 5 | **Sauvegarde automatique Android : conserver ou désactiver** | §6 | **Conserver** : c'est, pour les utilisateurs sans compte, le seul moyen de retrouver leurs données sur un nouveau téléphone ; l'information est donnée. La désactiver (`android.allowBackup: false`) supprime cette restauration, et exclure seulement certaines données demande une configuration native (nouveau build). |
| 6 | Public visé, âge minimal | §11 | indiquer que l'application n'est pas destinée aux enfants ; âge selon la législation applicable |
| 7 | Adresse (https) de la page de politique et de la page de suppression | application, Google Play | hébergement au choix du propriétaire ; à renseigner dans `constants/legalLinks.ts` et la console Play |
| 8 | Législation applicable, base juridique, autorité de protection des données | §4, §9 | à confirmer avec un conseil |
| 9 | Délai de traitement et vérification d'identité des demandes reçues sans l'application | page de suppression | ex. confirmation depuis l'adresse e-mail du compte |

## PARTIE 3 — Points juridiques ou opérationnels à vérifier
1. **Législation applicable** à vos utilisateurs (pays) et déclarations éventuelles auprès de l'autorité de protection des données.
2. **Conditions Firebase / Google Cloud** : liste exacte des données techniques d'Authentication, délais de suppression et de purge des sauvegardes, transferts internationaux.
3. **Région des données** : confirmer `africa-south1` dans la console.
4. **Déclaration « Sécurité des données » de Google Play** : brouillon dans `declaration-securite-donnees-play-BROUILLON.md`, à rendre cohérent avec ce texte.
5. **Suppression côté exploitant** : procédure manuelle de la page de suppression (partie 2 de ce document), à tester sur le projet de test.
6. **Locataires** : la mention du §1 (le propriétaire informe ses locataires) est-elle suffisante pour votre contexte d'usage ?
7. **Règles Firestore** : ce texte décrit des fonctions qui ne s'ouvrent qu'avec les règles validées publiées ensemble (`firestore.p5.rules`) ; il ne doit pas être publié avant que ce soit le cas.

## PARTIE 4 — Faits confirmés par le code (source des affirmations)
| Affirmation du texte | Preuve dans le code |
|---|---|
| Fonctionne sans compte ; connexion jamais imposée | `app/index.tsx`, `services/onboardingService.ts` ; drapeau `constants/features.ts` (fermé) |
| Pas de publicité, de statistiques ni de rapport d'erreurs | `package.json` : aucune bibliothèque correspondante (test `legalReadiness.test.ts`) |
| Ni caméra ni micro sur Android | `app.json` `blockedPermissions` (CAMERA, RECORD_AUDIO) ; test `legalReadiness.test.ts` |
| Pas de position | aucune bibliothèque de localisation (test) |
| Compte : e-mail, mot de passe, identifiant ; vérification d'adresse | `services/firebase/firebaseAuthService.ts`, `services/accountVerification.ts`, `services/syncLifecycle.ts`, `services/sharedModulesService.ts` |
| Seuls Immobilier et le contact locataire sont synchronisés ; tontines, formulaires, CEET/TDE jamais | `services/sync/syncScope.ts` (liste blanche) ; règles `firestore.p4.rules` / `firestore.p5.rules` |
| Tous les champs saisis (notes, champs personnalisés) partent avec la synchronisation | `services/sync/wireFormat.ts` (`buildWireRecord` : contenu métier complet) |
| Envoi des anciennes données : volontaire, aperçu, confirmation, sauvegarde | `services/sync/legacyAdoption.ts` |
| Espace partagé : propriétaire, demandes, fiches d'accès, vue du locataire | `services/sharedModules/model.ts`, `moduleFlows.ts`, `tenantViewBuilder.ts` |
| La vue du locataire ne contient que les champs listés | `TENANT_BODY_FIELDS` ; liste dérivée dans `services/privacyNotice.ts` ; règle `allowedBody` de `firestore.p5.rules` ; émulateur : 244 cas |
| Un locataire ne voit pas les données du module ni celles d'un autre | `firestore.p5.rules` ; matrice de cas jouée sur l'émulateur |
| L'identifiant d'un espace ne donne pas accès | `services/sharedModules/accessPolicy.ts`, règles, matrice |
| Copie locale de la vue supprimée au retrait, départ, expiration | `services/sharedModulesService.ts` (`refreshMyView`, `viewCopy`, `leave`) ; `services/__tests__/tenantView.test.ts` |
| Quitter retire le nom saisi ; refus conservé | `services/__tests__/dataMinimisation.test.ts` ; règle de suppression des demandes |
| Supprimer un espace ; suppression du compte efface les espaces | `services/firebase/moduleErasure.ts`, `accountCloudErasure.ts` ; tests locaux et émulateur |
| Départ des espaces rejoints à la suppression du compte (meilleur effort) | `services/sharedModules/departure.ts`, `services/firebase/accountDeletionApi.ts` |
| Données locales non chiffrées ; sauvegarde Android active | `services/storage.ts` ; configuration Expo résolue (`allowBackup`) |
| Export d'une copie locale | `features/profile/screens/StorageScreen.tsx` |
| Arrêt d'urgence possible | `firestore.emergency-*.rules`, `docs/f4-production.md` |
