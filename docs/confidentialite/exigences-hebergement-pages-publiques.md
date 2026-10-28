# Pages publiques (politique de confidentialité, suppression de compte) — exigences d'hébergement

> **Statut : préparation. Rien n'est publié, aucune adresse n'est inventée.** `constants/legalLinks.ts` reste à `null` : les liens n'apparaissent nulle part dans l'application tant qu'une vraie adresse https n'y est pas écrite. La barrière `node scripts/release/legal-check.js` bloque l'ouverture des comptes tant que ce n'est pas fait.

## 1. Exigences à satisfaire (pour les deux pages)
| Exigence | Pourquoi / contrôle |
|---|---|
| **HTTPS** avec un certificat **valide** (pas auto-signé, pas expiré), nom de domaine propre à un point au moins | l'application n'ouvre que des adresses https de domaine public (`services/legalLinks.ts`) ; Google l'exige pour le lien |
| **Adresse stable et permanente** (pas de lien temporaire, pas d'aperçu) | l'adresse est écrite dans l'application, dans la console Play et dans la politique ; la changer demande une nouvelle version |
| **Publique** : sans connexion, sans mur de cookies, sans blocage géographique, lisible sur téléphone avec des données mobiles | un utilisateur sans l'application doit pouvoir y accéder |
| **Page Web (HTML)** lisible sur mobile ; éviter le PDF | **[À VÉRIFIER dans la console Play]** la forme acceptée |
| **Français** (langue des utilisateurs) ; une version anglaise recommandée pour la revue du Store | |
| **Identité du responsable et contact** visibles (mêmes que dans la console Play) | cohérence exigée |
| **Contenu identique au texte validé** (partie 1 des documents), daté, **versionné** (on conserve les versions précédentes) | comparaison par empreinte entre le fichier du dépôt et la page publiée |
| **Page de suppression** : nom de l'application et de l'éditeur, étapes claires dans l'application, procédure hors application, ce qui est supprimé / conservé et les durées | exigence Google ; texte prêt : `page-suppression-de-compte-BROUILLON.md` |
| **Disponibilité** : surveillée (vérification hebdomadaire au moins) ; pas de redirection vers une page de connexion | un lien mort rend la déclaration non conforme |
| **Pas de suivi tiers** sur ces pages (ni statistiques, ni publicité) | cohérent avec le texte de la politique |

## 2. Choix d'hébergement (à décider par vous ; aucun n'est imposé)
| Option | Avantages | Points d'attention |
|---|---|---|
| Hébergement statique gratuit (par exemple pages statiques d'un dépôt) | gratuit, HTTPS fourni, simple | adresse du fournisseur ou nom de domaine à vous ; dépendance à un tiers ; garder le contrôle du compte |
| Hébergement statique du projet Firebase | déjà dans l'écosystème, HTTPS fourni | **c'est une ressource de production** : sa création demande votre autorisation explicite et touche la configuration du projet ; à éviter avant F5 |
| Site existant ou nom de domaine à vous | adresse la plus durable et crédible | achat/renouvellement du domaine ; configuration HTTPS |
**Recommandation** : un **domaine ou sous-domaine à vous** devant un hébergement statique gratuit, pour pouvoir changer d'hébergeur sans changer l'adresse.

## 3. Procédure de vérification avant de renseigner les adresses
1. Publier le texte **validé** (jamais le brouillon avec ses `[À FOURNIR]`).
2. Ouvrir chaque adresse **depuis un téléphone en données mobiles** et depuis un navigateur sans session : page lisible, certificat valide, aucune redirection de connexion.
3. Comparer le texte publié au fichier du dépôt (empreinte) ; noter la date et la version.
4. Renseigner les adresses dans `constants/legalLinks.ts` (`PRIVACY_POLICY_URL`, `ACCOUNT_DELETION_URL`) **et** dans la console Play, **les mêmes**.
5. Lancer `node scripts/release/legal-check.js` : il doit répondre **PRÊT**.
6. Vérifier dans une version de test que les deux liens s'ouvrent depuis Profil › Mes données.
