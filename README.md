# RADAR

Outil de veille en ligne de commande. Il récupère des infos datées (versions GitHub, flux RSS/Atom, Hacker News, failles de sécurité, changements de pages web), prévient quand une info importante arrive, peut tourner tout seul, leur donne une note de fiabilité, les étiquette, permet de les retrouver, et assemble un rapport.

**Principe :** ce qu'on surveille et comment on le note est écrit dans `radar.config.yaml`, pas dans le code. Pour changer de veille, on modifie la config.

## Installer et lancer

Prérequis : Node.js 24 ou plus récent (pour SQLite, intégré à Node ; testé avec la v24.13), et la CLI GitHub `gh` connectée (`gh auth status` doit dire « Logged in »).

```
npm install      # installe les dépendances
npm link         # rend la commande « radar » disponible partout (sinon : node radar.js <commande>)
```

Le cycle normal :

```
radar collect          # 1. récupère les nouvelles infos
radar score            # 2. note, classe et étiquette les infos (à relancer après chaque collect)
radar search mcp       # 3. retrouve des infos par mot
radar report           # 4. écrit rapport.md
```

Les 4 façons de ne plus chercher à la main :

| Technique | Dans RADAR |
|---|---|
| 1. Agréger les flux | source `flux` (RSS ou Atom) |
| 2. Poser des alertes | rubrique `alertes` (mots ou types de source) + source `hackernews` (mot-clé) ; notification Windows |
| 3. Surveiller sans flux | source `page` : une info est créée quand le texte de la page change |
| 4. Suivre dépôts et failles | sources `releases` (GitHub) et `failles` (base OSV) |
| Et pour que « l'info vienne à vous » | `radar planifier` : collecte + score automatiques toutes les N heures |

### L'interface graphique

```
npm run dev            # ouvre http://localhost:4319 dans le navigateur (Ctrl+C pour arrêter)
```

`npm run dev` suffit : pas de build à faire avant, et l'interface se recharge toute seule si on modifie `ui/src`. (`npm run build` puis `npm run preview` donnent la version optimisée, avec les mêmes boutons.)

Pourquoi un serveur : une page web ne peut ni lire les fichiers du projet ni lancer `radar.js`. Le serveur de Vite le fait pour elle, grâce aux quelques routes `/api` ajoutées dans `ui/api.js`. Les boutons lancent exactement les mêmes commandes que le terminal.

L'interface a trois écrans :

- **Fil** : les infos comme une boîte de réception, en grille de cartes groupées par jour. « À lire » montre les infos fiables non archivées ; « Alertes » les nouvelles infos qui contiennent un mot surveillé ; « Archivées » celles déjà lues. Les infos peu fiables sont masquées par défaut (case « Montrer les peu fiables »). Chaque jour d'au moins 3 infos a une carte « à la une » (la plus fiable, jamais une simple mesure d'étoiles ou de téléchargements). Chaque carte montre le favicon et le nom de la source (favicon récupéré via icons.duckduckgo.com, sinon l'initiale), le titre, trois lignes d'extrait, le thème et les étiquettes ; au survol, deux actions : ouvrir la source, archiver. Recherche (raccourci `/`), filtres par thème, famille de source, source et étiquette (plusieurs valeurs possibles, avec une recherche dans chaque liste), tri par date ou fiabilité.
- **Panneau de lecture** : un clic sur une carte ouvre l'info sur le côté (extrait complet, fiabilité détaillée, étiquettes perso). « Précédente » / « Suivante » ou les flèches ← → pour enchaîner, « Archiver et passer à la suivante » pour trier vite (avec « Annuler » dans le message qui suit), Échap pour fermer.
- **Rapport** : `rapport.md` mis en page, et le bouton pour le régénérer.
- **Réglages** : la collecte automatique (activer, désactiver, prochaine collecte), l'état de chaque source à la dernière collecte (sources en échec signalées), un lexique des mots de RADAR, et la configuration, modifiable de deux façons :
  - **Simple** : des formulaires pour les sources (ajouter, modifier, supprimer, avec l'état de la dernière collecte), les thèmes, les étiquettes, les alertes, le seuil de fiabilité, les mots ignorés et la fréquence de collecte. Seules les rubriques modifiées sont réécrites dans le fichier : les commentaires et le reste du fichier restent identiques.
  - **Fichier (avancé)** : le texte complet, y compris les règles de fiabilité (Ctrl+S pour enregistrer).

  Dans les deux cas, la configuration est vérifiée par `radar check` avant d'être écrite, et la version précédente est gardée en `radar.config.yaml.bak`.

L'interface est en thème clair uniquement.

En haut, en permanence : l'heure de la dernière mise à jour, et **Actualiser** (= `collect` puis `score`), suivi d'un résumé (« 8 nouvelles infos, 1 alerte ») avec un lien vers le détail. Le nombre d'alertes non vues s'affiche à côté de « Fil », et une icône à côté de « Réglages » si une source est en échec.
- Le serveur n'écoute que sur votre machine et ne sait lancer que `collect`, `score`, `report`, `planifier` et `deplanifier`. Port et ouverture du navigateur : dans `ui/vite.config.js`.

## Avec Docker

Tout RADAR (interface + collecte automatique) en une commande, sans rien installer d'autre que Docker :

```
copy .env.exemple .env      # puis collez votre jeton GitHub après GH_TOKEN= (« gh auth token » l'affiche)
docker compose up -d        # ouvre ensuite http://localhost:4319
```

- Deux conteneurs : `web` (l'interface et ses boutons) et `collecte` (`radar boucle` : collecte + score toutes les `planification.toutes_les_heures` heures, relu à chaque tour). La tâche planifiée Windows n'est pas utilisée.
- Les infos sont dans le volume Docker `radar-data` (une base SQLite dans un dossier partagé avec Windows peut s'abîmer). **Au premier démarrage, `data/radar.db` est copiée dans le volume** ; ensuite, la base Docker et la base locale vivent séparément : utilisez l'une ou l'autre, pas les deux.
- `radar.config.yaml`, `rapport.textes.yaml` et `rapport.md` restent ceux du dossier : modifiables depuis l'interface ou à la main.
- Sans `GH_TOKEN`, les sources GitHub (`releases`, `depot`) échouent (l'interface le signale dans Réglages) ; les autres marchent.
- L'interface n'est accessible que depuis cet ordinateur (`127.0.0.1`), car elle peut lancer des commandes et modifier la config. Autre port : `RADAR_PORT=8080 docker compose up -d`.
- Commandes utiles : `docker compose logs -f collecte` (suivre les collectes), `docker compose exec web node radar.js search mcp` (n'importe quelle commande radar), `docker compose down` (arrêter ; les données restent dans le volume), `docker compose up -d --build` (après une modification du code).
- Pas de notification Windows depuis Docker : les alertes restent visibles dans l'interface.

## Les fichiers

| Fichier | Rôle | Qui l'écrit |
|---|---|---|
| `radar.config.yaml` | Le plan de veille : sources, mots, règles de score, étiquettes, seuil | Vous |
| `data/radar.db` | La base SQLite : table `items` (toutes les infos) et table `pages` (dernière version connue de chaque page surveillée) | `collect`, `score`, l'interface |
| `db.js` | Tout l'accès à la base, partagé par `radar.js` et l'interface | — |
| `data/journal.log` | La sortie de chaque collecte automatique | `radar auto` |
| `rapport.textes.yaml` | Les textes du rapport (tendances, analyses) | Vous |
| `rapport.md` | Le rapport final | `radar report` (régénéré à chaque fois, ne pas l'éditer à la main) |
| `radar.js` | Le code des commandes | — |
| `ui/` | L'interface graphique : `src/` (React), `api.js` (les routes /api), `vite.config.js`, `dist/` (créé par `npm run build`) | — |

## Une info (table `items` de `data/radar.db`)

Les infos sont dans une base SQLite (`data/radar.db`, une ligne par info, l'url comme clé). Chaque commande ne modifie que ses propres colonnes : `collect` ajoute des lignes, `score` met à jour les champs calculés, l'interface met à jour les choix manuels. Une collecte (même automatique) peut donc tourner pendant que vous archivez ou étiquetez, sans rien écraser.

Pour lire les données telles quelles : `radar export` écrit `data/items.json` (ou `radar export chemin.json`). Ce fichier est une copie : le modifier ne change pas la base. Pour explorer la base directement, n'importe quel outil SQLite convient (DB Browser for SQLite, extension VS Code « SQLite Viewer »…).

Une info, telle qu'exportée :

```json
{
  "titre": "claude-code v2.1.312",
  "url": "https://github.com/anthropics/claude-code/releases/tag/v2.1.312",
  "publie_le": "2026-10-27",
  "collecte_le": "2026-10-28",
  "source": "Dépôt GitHub officiel anthropics/claude-code",
  "auteur": "ashwin-ant",
  "extrait": "## What's changed - Added ...",
  "type_veille": "ia",
  "etiquettes": ["securite"],
  "fiabilite": 5,
  "statut": "retenue"
}
```

- `titre`, `url`, `publie_le`, `collecte_le`, `source`, `auteur`, `extrait` : remplis par `collect`. `extrait` = les 300 premiers caractères du texte.
- `mesures` : chiffres bruts des sources `depot` et `npm`.
- `type_veille`, `etiquettes`, `famille`, `fiabilite`, `statut` : remplis par `score` (recalculés à chaque fois).
- `etiquettes_perso` (liste) et `archivee_le` (date ou `null`) : vos choix faits dans l'interface. **Aucune commande ne les modifie**, ils survivent donc à `collect` et `score`. Absents tant que vous n'avez rien fait sur l'info.
- `alerte` (la raison, ex. `mot « cve »`) et `alerte_vue_le` : posés par `collect` sur une nouvelle info qui déclenche une alerte ; `alerte_vue_le` se remplit quand vous la marquez comme vue.
- Les dates sont au format `AAAA-MM-JJ`. `publie_le` est la date UTC donnée par la source.

## Les commandes

### `radar collect`

Pour chaque source de la config :

1. appelle le collecteur correspondant à son `type` (voir « Une source ») ;
2. **rejette toute info sans url ou sans date de publication** ;
3. écarte les infos dont le titre contient un mot de `ignorer` ;
4. ajoute les infos nouvelles. Une info déjà connue (même url) n'est pas dupliquée et garde ses valeurs ; seuls les champs qui lui manquent sont complétés.

Les sources sont interrogées en parallèle (8 à la fois). Si une source échoue (réseau, dépôt inexistant, site qui bloque les robots…), elle est marquée `ÉCHEC` et les autres continuent.

**Alertes :** une info *nouvelle* déclenche une alerte si elle contient un mot de `alertes.mots` ou vient d'un type de source listé dans `alertes.sources`. Les alertes sont affichées à la fin de `collect`, et notifiées par Windows si `alertes.notification: true`. La toute première collecte d'une source ne déclenche pas d'alerte (tout y serait nouveau).

### `radar export [fichier]`

Écrit toutes les infos de la base dans un fichier JSON lisible (par défaut `data/items.json`).

### `radar alertes`

Liste les alertes pas encore vues. `radar alertes vues` les marque toutes comme vues.

### `radar auto`, `radar planifier`, `radar deplanifier`

- `radar auto` = `collect` puis `score`, avec la sortie ajoutée à `data/journal.log`.
- `radar planifier` crée (ou remplace) une tâche planifiée Windows nommée « RADAR » qui lance `radar auto` toutes les `planification.toutes_les_heures` heures, sans ouvrir de fenêtre. Il faut que l'ordinateur soit allumé.
- `radar deplanifier` supprime cette tâche. Hors Windows : mettre `node radar.js auto` dans cron.

### `radar score`

Pour chaque info :

- **`fiabilite`** = somme des points des règles de `regles_score` dont toutes les conditions sont vraies ;
- **`type_veille`** = celui imposé par sa source dans la config ; sinon le **premier** type de `types_veille` dont un mot apparaît dans le titre ou l'extrait ; sinon `null` (« sans type ») ;
- **`etiquettes`** = les étiquettes de la config dont un mot apparaît dans le titre ou l'extrait ;
- **`statut`** = `retenue` si `fiabilite` ≥ `seuil`, sinon `ecartee`.

Puis affiche le nombre de retenues et le top 10, avec pour chaque info la source, la date et les règles qui ont donné des points.

Ces quatre champs sont **recalculés à chaque lancement** : une modification faite à la main dans la base sera écrasée. Pour changer un résultat, changez la config.

### `radar search <mot>`

Cherche le mot (majuscules ignorées, tirets traités comme des espaces) dans le titre, le type et les étiquettes (automatiques et perso). Les infos archivées sont aussi trouvées, marquées « archivée ». Affiche date, titre, étiquettes, statut, score et url, du plus récent au plus ancien. Plusieurs mots possibles : `radar search claude code`.

### `radar check`

Vérifie `radar.config.yaml` sans rien collecter ni modifier : listes obligatoires présentes, `type_veille` des sources connus, règles avec des conditions qui existent et des points numériques. Vérifie aussi que chaque source a un type connu, ses champs obligatoires, une url valide, et un libellé unique. Pour vérifier un autre fichier : variable `RADAR_CONFIG=chemin/vers/fichier.yaml`.

### `radar report`

Assemble `rapport.md` à partir de `rapport.textes.yaml` et de la base :

- **Sources** : toutes les infos citées par les tendances, avec date, source et fiabilité ;
- **Tendances** : pour chacune, le constat, ses sources datées, l'impact, ce qu'elle permet d'anticiper, la compatibilité budget/technique, retenue ou écartée et pourquoi ;
- **Page 2 (note de recommandation)** : n'apparaît que si un de ses champs est rempli dans `rapport.textes.yaml`, ou si un fichier `decision.md` existe.

**Garde-fou :** si une url citée dans `rapport.textes.yaml` (dans `sources` ou dans un texte) n'existe pas dans la base, le rapport n'est pas écrit et l'url est affichée. On ne peut donc citer que ce qui a été collecté. Une source citée mais `ecartee` déclenche un avertissement.

## La config (`radar.config.yaml`)

### Ce que le code utilise

| Clé | Utilisée par | Rôle |
|---|---|---|
| `sources` | collect, score | Ce qu'on surveille (voir ci-dessous) |
| `ignorer` | collect | Une info dont le **titre** contient un de ces mots n'est pas enregistrée |
| `mots_cles` | score | Utilisés par la condition `confirmee_ailleurs` |
| `regles_score` | score | Les règles de fiabilité |
| `types_veille` | score, ui | Les types possibles (ia, devops, legal…) et leurs mots déclencheurs |
| `etiquettes` | score | La liste des étiquettes possibles et leurs mots déclencheurs |
| `seuil` | score | Fiabilité minimale pour `retenue` |
| `alertes` | collect | `mots`, `sources` (types de source) et `notification` (true/false) |
| `planification` | planifier | `toutes_les_heures` : de 1 à 23 |

`axes`, `frequence` et `livrable` documentent le plan mais **ne sont lus par aucune commande**.

### Une source

```yaml
- { type: releases, depot: anthropics/claude-code, nom: "Dépôt officiel Claude Code", limite: 10, categorie: officielle }
```

| Champ | Obligatoire | Rôle |
|---|---|---|
| `type` | oui | Choisit le collecteur (tableau ci-dessous) |
| `type_veille` | non | Impose ce type à toutes les infos de la source. Doit exister dans `types_veille` (sinon `score` s'arrête). Sans lui, le type est deviné par mots |
| `categorie` | non | Utilisée par les règles (`officielle`, `institution`, `communaute`, `social`) |
| `famille` | non | Sert à filtrer dans l'interface (ex. `blog`, `agregat`, `presse`, `securite`, `legal`, `github`, `stats`). Par défaut : le type de source |
| `nom` | non | Libellé affiché comme `source` de l'info. Par défaut : `GitHub <depot>` pour releases, `<type> <requete, paquet ou url>` sinon |
| `limite` | non | Nombre d'infos récupérées à chaque collecte (10 par défaut) |

| Type | Champs obligatoires | Champs facultatifs | Ce qui devient une info |
|---|---|---|---|
| `releases` | `depot` (propriétaire/nom) | | chaque version publiée du dépôt GitHub (via `gh api`) |
| `flux` | `url` du flux | | chaque article d'un flux RSS ou Atom ; marche aussi avec `https://github.com/<depot>/releases.atom` |
| `hackernews` | `requete` (sauf avec `une: true`) | `points_min`, `une: true` (page d'accueil) | chaque article Hacker News récent contenant la requête ; l'url est la page de discussion HN, le lien de l'article est dans l'extrait |
| `failles` | `paquet`, `ecosysteme` (npm, PyPI, Go, Maven, crates.io…) | `version` (seulement les failles qui la touchent) | chaque faille connue de la base OSV ; l'url est sa fiche sur osv.dev |
| `depot` | `depot` (propriétaire/nom) | | une mesure par jour : étoiles, forks, tickets ouverts, licence, avec l'évolution depuis la mesure précédente (champ `mesures`) |
| `npm` | `paquet` | | une mesure par semaine : téléchargements npm des 7 derniers jours et évolution en % |
| `page` | `url` de la page | | **un changement** du texte de la page. La 1re collecte enregistre seulement la référence (table `pages`). Ensuite, chaque changement crée une info datée du jour de détection, avec les lignes ajoutées et retirées en extrait ; son url est celle de la page suivie de `#radar-modif-<date>` |

N'importe quel autre champ (ex. `vend_produit: true`) peut être ajouté et testé par une règle.

**Attention :** c'est le libellé (`nom`, ou `GitHub <depot>`) qui relie une info déjà collectée à sa source. Si vous changez `nom`, les anciennes infos ne retrouvent plus leur source : `score` l'affiche en avertissement, et leurs règles `source` ne s'appliquent plus. Remettez l'ancien nom, ou supprimez `data/radar.db` et recollectez.

### Une règle de score

```yaml
- { nom: "auteur identifié", points: 1, si: { champ_rempli: auteur, ne_contient_pas: ["[bot]"], dans: [auteur] } }
```

La règle donne `points` (négatif possible) si **toutes** les conditions de `si` sont vraies.

| Condition | Vraie si… |
|---|---|
| `source: { champ: valeur }` | la source de l'info a ce champ avec cette valeur |
| `moins_de_jours: N` | l'info a été publiée il y a moins de N jours |
| `champ_rempli: champ` | ce champ de l'info n'est pas vide |
| `contient: [mots]` | au moins un mot apparaît (par défaut dans titre, url, extrait) |
| `ne_contient_pas: [mots]` | aucun mot n'apparaît (mêmes champs) |
| `dans: [champs]` | ne teste rien : limite `contient` / `ne_contient_pas` à ces champs |
| `confirmee_ailleurs: true` | une info d'une **autre** source contient un des `mots_cles` présents dans celle-ci |

Une condition mal orthographiée arrête `score` avec une erreur qui nomme la règle.

### Un type de veille

Chaque info a **un seul** type (alors qu'elle peut avoir plusieurs étiquettes).

```yaml
types_veille:
  - { nom: securite, mots: ["cve", "vulnerab", "faille"] }   # testé en premier
  - { nom: devops,   mots: ["docker", "kubernetes"] }
  - { nom: ia,       mots: ["llm", "agent", "claude"] }       # large : à mettre en dernier
```

L'ordre compte : le premier type dont un mot apparaît gagne. Mettez les types précis avant les types larges, sinon tout finira dans le type large. Pour ajouter un type, ajoutez une ligne : il apparaît dans les filtres de l'interface au prochain chargement.

### Une étiquette

```yaml
etiquettes:
  - { nom: mcp, mots: ["mcp", "model context protocol"] }
  - plugins            # forme courte : se déclenche sur son propre nom
```

## Le rapport (`rapport.textes.yaml`)

```yaml
tendances:
  - titre: "..."
    constat: "..."                 # ce que disent les sources
    sources: [https://..., ...]    # urls présentes dans la base
    impact: "..."
    anticiper: "..."
    compatibilite: "..."
    statut: retenue                # ou ecartee
    pourquoi: "..."

# Page 2, facultative : tout vide = pas de page 2
question: ""
recommandation: ""
impact: { perimetre: "", budget: "", delais: "" }
risques: ""
plan_b: ""
prochaine_etape: ""
```

Un champ vide s'affiche `_À compléter._` dans le rapport. Avant de partager le rapport, ouvrez chaque lien : le garde-fou vérifie que l'url a été collectée, pas que le texte dit bien ce que vous affirmez.

## Ajouter un type de source

Dans `radar.js`, ajouter une fonction à l'objet `collecteurs`, du nom du `type` utilisé dans la config. Elle reçoit la source (l'objet de la config) et renvoie une liste de `fiche({ titre, url, publie_le, source, auteur, extrait })`. Tout le reste (rejet sans url ni date, `ignorer`, dédoublonnage, score) s'applique automatiquement. Exemple existant : `releases`.

Penser à ajouter le type et ses champs obligatoires dans la fonction `check` de `radar.js`.

## Limites connues

- SQLite est intégré à Node (`node:sqlite`) mais encore marqué « expérimental » : son fonctionnement pourrait changer dans une future version de Node. Les accès sont tous regroupés dans `db.js`, à adapter si besoin.

- `page` compare tout le texte visible : une page qui affiche une date, un compteur ou un contenu tournant créera une info à chaque collecte. À vérifier sur deux collectes avant de s'y fier (la page CGU Anthropic est stable).
- `page` ne connaît pas la vraie date du changement : seulement le jour où RADAR l'a vu.
- La collecte automatique ne tourne que si l'ordinateur est allumé et la session ouverte.
- La règle `confirmee_ailleurs` se contente d'un mot-clé commun : un article Hacker News qui cite « claude code » est « confirmé » par n'importe quelle version de Claude Code.
- Les étiquettes et les règles `contient` ne voient que les 300 premiers caractères du texte (`extrait`).
- Les correspondances de mots sont des recherches de texte simples : « partner » repère aussi « partnership ». Vérifiez les étiquettes et les points sur quelques infos après avoir changé une liste de mots.
- `ignorer` ne regarde que le titre.
