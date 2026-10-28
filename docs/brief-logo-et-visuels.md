# Brief graphique — logo et visuels de TakarDa (23 octobre 2026)

> **Statut : BRIEF. Aucun logo n'a été créé ni improvisé, et les gabarits Expo n'ont pas été remplacés.** Ce document est à remettre à la personne qui dessinera le logo (vous, un graphiste ou un outil de votre choix). Dès réception du logo, la mise en place technique est mécanique (§ 5).

## 1. Constat : ce qui est en place aujourd'hui
Les quatre images de marque du projet sont les **gabarits fournis par Expo** (vérifié visuellement le 22 octobre 2026) : une chevron bleue sur fond bleu clair avec cercles de construction (icône et icône adaptative) et une grille avec trois cercles gris (écran de démarrage). Ils ne représentent pas TakarDa : à remplacer avant toute publication, et déjà visibles sur votre téléphone en démonstration.
| Fichier | Dimensions | Usage |
|---|---|---|
| `assets/images/icon.png` | 1 024×1 024, 24 bits | icône générale |
| `assets/images/android-icon-foreground.png` | 512×512 | avant-plan de l'icône adaptative |
| `assets/images/android-icon-background.png` | 512×512 | fond de l'icône adaptative |
| `assets/images/android-icon-monochrome.png` | 432×432 | icône « thématique » d'Android 13+ |
| `assets/images/splash-icon.png` | 1 024×1 024 | écran de démarrage (affiché à 200 px de large, fond blanc ou noir) |
| `assets/images/favicon.png` | 48×48 | version web (secondaire) |

## 2. Ce que le logo doit dire (à confirmer par vous : je n'invente ni nom, ni sens, ni symbole)
- **Application :** TakarDa, outils de gestion simples (loyers, tontines, factures partagées d'électricité et d'eau, formulaires), utilisée sur téléphone, en français, notamment au Togo.
- **Ton :** simple, fiable, chaleureux, sérieux sans être bancaire. **Pas de promesse chiffrée, pas de symbole financier trompeur** (pas de pièce « officielle », pas de logo de banque ou d'opérateur de paiement).
- **À me donner pour cadrer :** la signification du nom « TakarDa » si elle compte pour l'image, vos couleurs préférées, vos références ou croquis, toute contrainte (texte dans le logo ou symbole seul).
- **Contrainte de cohérence avec l'application :** la couleur d'accent de l'interface est l'**indigo `#1F03A8`** (thème clair) et **`#818CF8`** (thème sombre). Le logo peut s'en écarter, mais l'icône doit rester lisible à côté de l'interface.

## 3. Livrables et spécifications exactes
| # | Livrable | Format et dimensions | Règles |
|---|---|---|---|
| L1 | **Logo principal** (source) | **SVG** vectoriel + PNG 2 048×2 048 fond transparent | version couleur, version monochrome, version claire pour fond sombre |
| L2 | **Icône de l'application** | PNG **1 024×1 024**, sans transparence (fond plein) | motif lisible à 48 px ; aucun texte fin ; coins carrés (le système arrondit) |
| L3 | **Icône adaptative Android — avant-plan** | PNG **1 024×1 024**, fond transparent | motif entièrement dans le **cercle central de ≈ 66 % (≈ 680 px de diamètre)** : le reste peut être rogné par le masque |
| L4 | **Icône adaptative — fond** | PNG 1 024×1 024 **ou simple couleur unie** | uni ou très sobre : il est rogné de toutes parts |
| L5 | **Icône monochrome** | PNG 1 024×1 024, **une seule couleur**, fond transparent | silhouette du motif (Android 13+ la teinte à la couleur du thème) |
| L6 | **Écran de démarrage** | PNG **1 024×1 024**, fond transparent | affiché à ≈ 200 px de large sur **fond blanc (thème clair) et noir (thème sombre)** : lisible sur les deux |
| L7 | **Icône de la fiche Play** | PNG **512×512, 32 bits avec alpha**, ≤ 1 024 Ko | dérivée de L2/L1 (§ 5) |
| L8 | **Graphique de présentation Play** | JPEG ou PNG 24 bits **sans transparence, 1 024×500** | voir § 4 |
| L9 | Favicon (secondaire) | PNG 48×48 | dérivé de L1 |
Les exigences de Google (L7, L8) ont été lues sur ses pages d'aide le 22 octobre 2026 ; vérifier de nouveau dans la console au moment de l'envoi.

## 4. Graphique de présentation (1 024×500) — composition proposée
- **Fond :** aplat de la couleur de marque (ou dégradé très léger) ; **aucune capture d'écran inventée**.
- **Gauche :** le logo (L1) avec la marge de sécurité (≥ 5 % du bord).
- **Droite :** titre « **Loyers, tontines et factures** » puis, en dessous, « **Simple. Sur votre téléphone.** ». Police lisible (taille de titre ≥ 48 px sur 500 px de haut), contraste suffisant.
- **Interdit :** promesse de gain, chiffres d'utilisateurs, mention « sécurisé » ou « conforme » sans preuve, éléments de marques tierces.
- **Captures d'écran (autre livrable, voir `docs/play-store-preparation.md` § 4)** : prises sur la vraie application en mode démonstration ; aucune donnée réelle ; recadrées à 9:16 (1 080×1 920).

## 5. Mise en place après réception du logo (je m'en charge, aucun build)
1. Remplacer `assets/images/icon.png`, les trois `android-icon-*.png` et `splash-icon.png` par L2 à L6 **sans modifier `app.json`** (les chemins et le fond clair/sombre sont déjà configurés).
2. Produire l'icône de la fiche (L7) depuis L2 : redimensionnement 512×512 en PNG 32 bits (commande PowerShell prête, utilisée le 22 octobre 2026 sur le gabarit puis supprimée).
3. Vérifier visuellement l'icône à 48, 96 et 192 px, l'écran de démarrage clair et sombre, puis `expo config` (hors ligne) pour confirmer les chemins.
4. Un nouveau build de test est nécessaire pour voir l'icône sur le téléphone (accord distinct).

## 6. Ce que je ne fais pas
Je ne dessine pas votre logo, je ne tire pas d'image d'une banque d'images, je ne génère pas d'icône à partir d'un modèle d'IA, et je ne remplace pas les gabarits par une image improvisée.
