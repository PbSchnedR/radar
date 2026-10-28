#!/usr/bin/env node
// RADAR : outil de veille. Tout ce qui est surveillé vient de radar.config.yaml.
import { readFileSync, writeFileSync, mkdirSync, existsSync, appendFileSync } from "node:fs";
import { execFile, execFileSync } from "node:child_process";
import { promisify } from "node:util";
import { createHash } from "node:crypto";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import YAML from "yaml";
import { XMLParser } from "fast-xml-parser";
import { libelleSource } from "./sources.js";
import { ouvrirBase, ecrireMeta, transaction, lireItems as dbLireItems, insererItems, majCalculs, marquerAlertesVues, lirePages, ecrirePage } from "./db.js";

const ROOT = dirname(fileURLToPath(import.meta.url));
// RADAR_CONFIG permet de vérifier un autre fichier (l'interface s'en sert avant d'enregistrer).
const CONFIG_PATH = process.env.RADAR_CONFIG || join(ROOT, "radar.config.yaml");
// RADAR_DATA permet de collecter dans un autre dossier (pour essayer des sources sans toucher aux vraies données).
const DATA_DIR = process.env.RADAR_DATA || join(ROOT, "data");
const JOURNAL_PATH = join(DATA_DIR, "journal.log"); // sortie des collectes automatiques
const COLLECTES_EN_PARALLELE = 8;

function lireConfig() {
  const config = YAML.parse(readFileSync(CONFIG_PATH, "utf8"));
  if (!config || !Array.isArray(config.sources)) {
    throw new Error(`${CONFIG_PATH} doit contenir une liste « sources ».`);
  }
  return config;
}

// La base SQLite (data/radar.db), ouverte au premier besoin : check et planifier n'en ont pas besoin.
let db = null;
const base = () => (db ??= ouvrirBase(DATA_DIR));
const lireItems = () => dbLireItems(base());

// Date du jour en heure locale, au format AAAA-MM-JJ.
function aujourdhui() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}


// La fiche d'une info (partie 3 du kit), plus auteur et extrait qui servent au score.
function fiche({ titre, url, publie_le, source, auteur, extrait, mesures }) {
  return {
    ...(mesures && { mesures }), // chiffres bruts des sources depot et npm
    titre,
    url,
    publie_le,
    collecte_le: aujourdhui(),
    source,
    auteur: auteur || null,
    extrait: extrait ? extrait.replace(/\s+/g, " ").trim().slice(0, 300) : null,
    type_veille: null,
    etiquettes: null,
    fiabilite: null,
    statut: null,
  };
}

async function ghApi(chemin) {
  try {
    const { stdout } = await promisify(execFile)("gh", ["api", chemin], { encoding: "utf8", maxBuffer: 50 * 1024 * 1024 });
    return JSON.parse(stdout);
  } catch (e) {
    // Le cas le plus courant (ex. dans Docker) : gh n'est pas connecté. On le dit clairement.
    if (/gh auth login|GH_TOKEN|authenticat/i.test(String(e.stderr ?? e.message))) {
      throw new Error("gh n'est pas connecté à GitHub : lancez « gh auth login », ou, sous Docker, mettez GH_TOKEN dans le fichier .env");
    }
    if (e.code === "ENOENT") throw new Error("la CLI GitHub (gh) n'est pas installée");
    throw new Error(String(e.stderr || e.message).trim().split("\n")[0]);
  }
}

// La dernière mesure enregistrée pour une source (depot, npm), pour calculer l'évolution.
function derniereMesure(items, source) {
  return items
    .filter((i) => i.source === libelleSource(source) && i.mesures)
    .sort((a, b) => b.publie_le.localeCompare(a.publie_le))[0]?.mesures;
}

const ecart = (maintenant, avant) => {
  if (avant == null) return "";
  const d = maintenant - avant;
  return ` (${d >= 0 ? "+" : ""}${d.toLocaleString("fr-FR")})`;
};

async function telecharger(url, options = {}) {
  const res = await fetch(url, {
    ...options,
    headers: { "User-Agent": "RADAR-veille/1.0", ...options.headers },
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) throw new Error(`${url} : HTTP ${res.status}`);
  return res;
}

// Une date quelconque (RSS, Atom, ISO) au format AAAA-MM-JJ, ou null si illisible.
function dateIso(valeur) {
  const d = new Date(valeur ?? "");
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
}

// Le texte lisible d'un HTML : sans scripts ni balises, une ligne par bloc.
function texteBrut(html) {
  const entites = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };
  return String(html ?? "")
    .replace(/<(script|style|noscript|svg|template)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<(br|\/p|\/div|\/li|\/h[1-6]|\/tr|\/section|\/article)[^>]*>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&(#x?[0-9a-f]+|\w+);/gi, (m, e) =>
      e[0] === "#" ? String.fromCodePoint(e[1].toLowerCase() === "x" ? parseInt(e.slice(2), 16) : Number(e.slice(1))) : entites[e.toLowerCase()] ?? m
    )
    .split("\n")
    .map((l) => l.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .join("\n");
}

// Le texte d'un nœud XML, qu'il soit une chaîne ou un objet avec attributs.
const texteXml = (v) => (v == null ? "" : typeof v === "object" ? String(v["#text"] ?? "") : String(v));
const enListe = (v) => (v == null ? [] : Array.isArray(v) ? v : [v]);

// Un collecteur par « type » de source. Pour ajouter une source : ajouter une entrée ici.
const collecteurs = {
  // Technique 4 : les versions d'un dépôt GitHub.
  async releases(source) {
    const limite = source.limite ?? 10;
    const releases = await ghApi(`repos/${source.depot}/releases?per_page=${limite}`);
    const nomDepot = source.depot.split("/").pop();
    return releases.map((r) =>
      fiche({
        titre: `${nomDepot} ${r.name || r.tag_name}`,
        url: r.html_url,
        publie_le: r.published_at ? r.published_at.slice(0, 10) : null,
        source: libelleSource(source),
        auteur: r.author?.login,
        extrait: r.body,
      })
    );
  },

  // Technique 1 : un flux RSS ou Atom (blog, actualités, et aussi https://github.com/<depot>/releases.atom).
  async flux(source) {
    const xml = await (await telecharger(source.url)).text();
    const doc = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: "@_" }).parse(xml);
    const rss = enListe(doc.rss?.channel?.item ?? doc["rdf:RDF"]?.item);
    const atom = enListe(doc.feed?.entry);
    const entrees = rss.length
      ? rss.map((e) => ({
          titre: texteXml(e.title),
          url: texteXml(e.link) || texteXml(e.guid),
          date: e.pubDate ?? e["dc:date"],
          auteur: texteXml(e["dc:creator"] ?? e.author),
          texte: texteXml(e.description ?? e["content:encoded"]),
        }))
      : atom.map((e) => {
          const liens = enListe(e.link);
          const lien = liens.find((l) => !l["@_rel"] || l["@_rel"] === "alternate") ?? liens[0];
          return {
            titre: texteXml(e.title),
            url: lien?.["@_href"] ?? texteXml(lien),
            date: e.published ?? e.updated,
            auteur: texteXml(enListe(e.author)[0]?.name),
            texte: texteXml(e.summary ?? e.content),
          };
        });
    // Certains flux ne sont pas triés (ex. CERT-FR) : on garde les plus récents, pas les premiers venus.
    const recentes = entrees.sort((a, b) => String(dateIso(b.date) ?? "").localeCompare(String(dateIso(a.date) ?? "")));
    return recentes.slice(0, source.limite ?? 10).map((e) =>
      fiche({ titre: e.titre.trim(), url: e.url.trim(), publie_le: dateIso(e.date), source: libelleSource(source), auteur: e.auteur, extrait: texteBrut(e.texte) })
    );
  },

  // Technique 2 (alerte sur mot-clé) : les articles Hacker News qui contiennent la requête.
  async hackernews(source) {
    // « une: true » : les articles de la page d'accueil, avec ou sans requête.
    const params = new URLSearchParams({
      query: source.requete ?? "",
      tags: source.une ? "front_page" : "story",
      hitsPerPage: String(source.limite ?? 10),
    });
    // Filtré côté Hacker News : sinon on ne recevrait que les derniers articles, souvent sans points.
    if (source.points_min) params.set("numericFilters", `points>=${source.points_min}`);
    const { hits } = await (await telecharger(`https://hn.algolia.com/api/v1/search_by_date?${params}`)).json();
    return hits.map((h) =>
        fiche({
          titre: h.title,
          url: `https://news.ycombinator.com/item?id=${h.objectID}`,
          publie_le: dateIso(h.created_at),
          source: libelleSource(source),
          auteur: h.author,
          extrait: [h.url && `Lien : ${h.url}`, `${h.points ?? 0} points, ${h.num_comments ?? 0} commentaires`].filter(Boolean).join(". "),
        })
      );
  },

  // Technique 4 : les failles connues d'un paquet (base OSV : npm, PyPI, Go, Maven, crates.io…).
  async failles(source) {
    const requete = { package: { name: source.paquet, ecosystem: source.ecosysteme } };
    if (source.version) requete.version = String(source.version);
    const res = await telecharger("https://api.osv.dev/v1/query", { method: "POST", body: JSON.stringify(requete) });
    const { vulns = [] } = await res.json();
    return vulns
      .sort((a, b) => String(b.published).localeCompare(String(a.published)))
      .slice(0, source.limite ?? 10)
      .map((v) =>
        fiche({
          titre: `${source.paquet} : ${v.summary ?? v.id}${v.aliases?.length ? ` (${v.aliases.join(", ")})` : ""}`,
          url: `https://osv.dev/vulnerability/${v.id}`,
          publie_le: dateIso(v.published),
          source: libelleSource(source),
          extrait: v.details,
        })
      );
  },

  // Technique 3 : une page sans flux (CGU, tarifs, doc). Une info est créée quand son texte change.
  // « pages » est l'état partagé de la table pages, écrit une seule fois à la fin de collect.
  async page(source, { pages, notes }) {
    const html = await (await telecharger(source.url)).text();
    const texte = texteBrut(html);
    const empreinte = createHash("sha256").update(texte).digest("hex");
    const avant = pages[source.url];
    const titrePage = source.nom || texteBrut(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]) || source.url;
    const enregistrer = () => {
      pages[source.url] = { empreinte, texte, vu_le: aujourdhui() };
    };
    if (!avant) {
      enregistrer();
      notes.push(`première capture enregistrée ; les prochains changements créeront une info`);
      return [];
    }
    if (avant.empreinte === empreinte) return [];
    const anciennes = new Set(avant.texte.split("\n"));
    const nouvelles = new Set(texte.split("\n"));
    const ajoutees = [...nouvelles].filter((l) => !anciennes.has(l));
    const retirees = [...anciennes].filter((l) => !nouvelles.has(l));
    enregistrer();
    return [
      fiche({
        titre: `${titrePage} modifiée (+${ajoutees.length} lignes, -${retirees.length} lignes)`,
        // L'ancre rend chaque changement unique : la même page peut changer plusieurs fois.
        url: `${source.url}#radar-modif-${aujourdhui()}`,
        publie_le: aujourdhui(),
        source: libelleSource(source),
        extrait: [ajoutees.length && `Ajouté : ${ajoutees.join(" / ")}`, retirees.length && `Retiré : ${retirees.join(" / ")}`].filter(Boolean).join(" | "),
      }),
    ];
  },

  // Les chiffres d'un dépôt GitHub (étoiles, forks, licence…) : une mesure par jour, avec l'évolution depuis la précédente.
  async depot(source, { items }) {
    const r = await ghApi(`repos/${source.depot}`);
    const mesures = { etoiles: r.stargazers_count, forks: r.forks_count, tickets_ouverts: r.open_issues_count };
    const avant = derniereMesure(items, source);
    return [
      fiche({
        titre: `${source.depot} : ${mesures.etoiles.toLocaleString("fr-FR")} étoiles${ecart(mesures.etoiles, avant?.etoiles)}, licence ${r.license?.spdx_id ?? "aucune"}`,
        // Une mesure par jour : l'ancre datée la rend unique.
        url: `${r.html_url}#radar-stats-${aujourdhui()}`,
        publie_le: aujourdhui(),
        source: libelleSource(source),
        auteur: r.owner?.login,
        extrait:
          `${mesures.etoiles} étoiles${ecart(mesures.etoiles, avant?.etoiles)}, ${mesures.forks} forks${ecart(mesures.forks, avant?.forks)}, ` +
          `${mesures.tickets_ouverts} tickets ouverts, licence ${r.license?.spdx_id ?? "aucune"}, créé le ${dateIso(r.created_at)}, ` +
          `dernier push le ${dateIso(r.pushed_at)}. ${r.description ?? ""}`,
        mesures,
      }),
    ];
  },

  // Les téléchargements npm d'un paquet : une mesure par semaine (7 derniers jours connus vs les 7 d'avant).
  async npm(source) {
    const r = await (await telecharger(`https://api.npmjs.org/downloads/range/last-month/${source.paquet}`)).json();
    const jours = r.downloads ?? [];
    if (jours.length < 14) return [];
    const somme = (l) => l.reduce((t, j) => t + j.downloads, 0);
    const semaine = somme(jours.slice(-7));
    const precedente = somme(jours.slice(-14, -7));
    const fin = jours.at(-1).day;
    const evolution = precedente ? Math.round(((semaine - precedente) / precedente) * 100) : null;
    return [
      fiche({
        titre: `${source.paquet} : ${semaine.toLocaleString("fr-FR")} téléchargements npm en 7 jours${evolution == null ? "" : ` (${evolution >= 0 ? "+" : ""}${evolution} %)`}`,
        url: `https://www.npmjs.com/package/${source.paquet}#radar-telechargements-${fin}`,
        publie_le: fin,
        source: libelleSource(source),
        extrait: `Du ${jours.at(-7).day} au ${fin} : ${semaine} téléchargements ; semaine précédente : ${precedente}. Source : api.npmjs.org.`,
        mesures: { telechargements_7j: semaine },
      }),
    ];
  },
};

// Lance fn sur chaque élément, au plus « max » à la fois ; renvoie les résultats dans l'ordre.
async function enParallele(elements, max, fn) {
  const resultats = new Array(elements.length);
  let suivant = 0;
  const ouvrier = async () => {
    while (suivant < elements.length) {
      const n = suivant++;
      resultats[n] = await fn(elements[n], n);
    }
  };
  await Promise.all(Array.from({ length: Math.min(max, elements.length) }, ouvrier));
  return resultats;
}

// Technique 2 : une nouvelle info déclenche une alerte si elle contient un mot de « alertes.mots »
// ou vient d'un type de source listé dans « alertes.sources ». Renvoie la raison, ou null.
function raisonAlerte(item, source, alertes) {
  if (!alertes) return null;
  if ((alertes.sources ?? []).includes(source.type)) return `nouvelle info « ${source.type} »`;
  // Une mesure (depot, npm) revient à chaque collecte avec la même description : pas d'alerte sur ses mots.
  if (item.mesures) return null;
  const mot = (alertes.mots ?? []).find((m) => contientUn(texte(item, ["titre", "extrait"]), [m]));
  return mot ? `mot « ${mot} »` : null;
}

// Notification Windows (via PowerShell). Ailleurs, l'alerte reste dans le terminal et l'interface.
function notifier(titre, message) {
  if (process.platform !== "win32") return;
  const script = `
    [Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime] > $null
    $modele = [Windows.UI.Notifications.ToastNotificationManager]::GetTemplateContent([Windows.UI.Notifications.ToastTemplateType]::ToastText02)
    $textes = $modele.GetElementsByTagName("text")
    $textes.Item(0).AppendChild($modele.CreateTextNode($env:RADAR_TITRE)) > $null
    $textes.Item(1).AppendChild($modele.CreateTextNode($env:RADAR_MESSAGE)) > $null
    $appli = '{1AC14E77-02E7-4E5D-B744-2EB1AE5198B7}\\WindowsPowerShell\\v1.0\\powershell.exe'
    [Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier($appli).Show([Windows.UI.Notifications.ToastNotification]::new($modele))`;
  try {
    execFileSync("powershell", ["-NoProfile", "-NonInteractive", "-Command", script], {
      env: { ...process.env, RADAR_TITRE: titre, RADAR_MESSAGE: message },
      stdio: "ignore",
    });
  } catch {
    console.log("(notification Windows impossible, l'alerte reste visible ici et dans l'interface)");
  }
}

// Jamais d'info sans url ni date de publication.
function estValide(item) {
  return Boolean(item.url) && /^\d{4}-\d{2}-\d{2}$/.test(item.publie_le ?? "");
}

function estIgnore(item, motsIgnores) {
  const titre = item.titre.toLowerCase();
  return motsIgnores.some((mot) => titre.includes(String(mot).toLowerCase()));
}

async function collect() {
  const config = lireConfig();
  const motsIgnores = config.ignorer ?? [];
  const items = lireItems(); // état de la base au début : sert au dédoublonnage et aux évolutions (depot, npm)
  const parUrl = new Map(items.map((i) => [i.url, i]));
  const alertes = [];
  const aInserer = [];
  const pages = lirePages(base());
  let ajoutees = 0;

  // Les sources sont interrogées en parallèle ; leurs résultats sont ensuite traités dans l'ordre de la config.
  const resultats = await enParallele(config.sources, COLLECTES_EN_PARALLELE, async (source) => {
    const collecteur = collecteurs[source.type];
    if (!collecteur) return { erreur: `type « ${source.type} » inconnu (types possibles : ${Object.keys(collecteurs).join(", ")})` };
    const notes = [];
    try {
      return { trouvees: await collecteur(source, { pages, items, notes }), notes };
    } catch (e) {
      return { erreur: e.message.split("\n")[0], notes };
    }
  });

  // L'état de chaque source à cette collecte, affiché dans les réglages de l'interface.
  const etats = {};
  for (const [n, source] of config.sources.entries()) {
    const libelle = `${source.type} · ${libelleSource(source)}`;
    const { trouvees, erreur, notes = [] } = resultats[n];
    for (const note of notes) console.log(`  (${libelleSource(source)} : ${note})`);
    if (erreur) {
      console.log(`- ${libelle} : ÉCHEC (${erreur})`);
      etats[libelleSource(source)] = { ok: false, erreur };
      continue;
    }
    {
      const valides = trouvees.filter(estValide);
      const gardees = valides.filter((i) => !estIgnore(i, motsIgnores));
      const nouvelles = gardees.filter((i) => !parUrl.has(i.url));
      // La toute première collecte d'une source ne déclenche pas d'alerte : tout y serait « nouveau ».
      // Une page n'a d'info qu'en cas de changement : sa référence est la première capture, pas une info.
      const dejaSuivie = source.type === "page" || connues(items, source);
      for (const i of nouvelles) {
        const raison = dejaSuivie ? raisonAlerte(i, source, config.alertes) : null;
        if (raison) {
          i.alerte = raison;
          alertes.push(i);
        }
        aInserer.push(i);
        parUrl.set(i.url, i);
      }
      ajoutees += nouvelles.length;
      etats[libelleSource(source)] = { ok: true, trouvees: trouvees.length, nouvelles: nouvelles.length };
      const rejetees = trouvees.length - valides.length;
      console.log(
        `- ${libelle} : ${trouvees.length} trouvées, ${nouvelles.length} nouvelles` +
          (rejetees ? `, ${rejetees} rejetées (sans url ou date)` : "")
      );
    }
  }

  // Une seule transaction : ajoute les nouvelles infos sans toucher aux existantes (ni à leurs choix manuels).
  const total = transaction(base(), () => {
    insererItems(base(), aInserer);
    for (const [url, page] of Object.entries(pages)) ecrirePage(base(), url, page);
    ecrireMeta(base(), "derniere_collecte", { le: new Date().toISOString(), nouvelles: ajoutees, alertes: alertes.length, sources: etats });
    return base().prepare("SELECT COUNT(*) n FROM items").get().n;
  });
  console.log(`${ajoutees} nouvelles infos, ${total} au total dans data/radar.db`);
  if (alertes.length) {
    console.log(`\n${alertes.length} ALERTE(S) :`);
    for (const i of alertes) console.log(`- ${i.titre} (${i.alerte})\n  ${i.url}`);
    if (config.alertes?.notification) {
      notifier(`RADAR : ${alertes.length} alerte(s)`, alertes.slice(0, 3).map((i) => i.titre).join(" ; "));
    }
  }
}

// Vrai si la source a déjà des infos enregistrées (donc ce n'est pas sa première collecte).
function connues(items, source) {
  return items.some((i) => i.source === libelleSource(source));
}

// Texte d'une info dans lequel on cherche des mots (champs choisis par « dans »).
function texte(item, champs = ["titre", "url", "extrait"]) {
  return champs.map((c) => item[c] ?? "").join(" ").toLowerCase().replace(/[-_]/g, " ");
}

function contientUn(chaine, mots) {
  return mots.some((m) => chaine.includes(String(m).toLowerCase().replace(/[-_]/g, " ")));
}

function joursDepuis(dateIso) {
  return (Date.parse(aujourdhui()) - Date.parse(dateIso)) / 86_400_000;
}

// Une condition par clé possible dans « si » (voir le commentaire de regles_score dans la config).
const conditions = {
  source: (attendu, { source }) =>
    Boolean(source) && Object.entries(attendu).every(([cle, val]) => source[cle] === val),
  moins_de_jours: (n, { item }) => joursDepuis(item.publie_le) < n,
  champ_rempli: (champ, { item }) => Boolean(item[champ]),
  contient: (mots, { item, si }) => contientUn(texte(item, si.dans), mots),
  ne_contient_pas: (mots, { item, si }) => !contientUn(texte(item, si.dans), mots),
  dans: () => true,
  confirmee_ailleurs: (attendu, { item, items, motsCles }) => {
    const mots = motsCles.filter((m) => contientUn(texte(item), [m]));
    const confirmee = items.some((autre) => autre.source !== item.source && contientUn(texte(autre), mots));
    return confirmee === attendu;
  },
};

// Une liste « { nom, mots } » de la config ; un nom écrit seul se déclenche sur lui-même.
function listeAvecMots(liste) {
  return liste.map((e) => (typeof e === "string" ? { nom: e, mots: [e] } : e));
}

// Lit « types_veille », « etiquettes » et « seuil » de la config, et vérifie le type_veille des sources.
function lireClassement(config) {
  if (!Array.isArray(config.types_veille)) throw new Error(`${CONFIG_PATH} doit contenir une liste « types_veille ».`);
  if (!Array.isArray(config.etiquettes)) throw new Error(`${CONFIG_PATH} doit contenir une liste « etiquettes ».`);
  if (typeof config.seuil !== "number") throw new Error(`${CONFIG_PATH} doit contenir un nombre « seuil ».`);
  const types = listeAvecMots(config.types_veille);
  const nomsTypes = types.map((t) => t.nom);
  for (const s of config.sources) {
    if (s.type_veille != null && !nomsTypes.includes(s.type_veille)) {
      throw new Error(`Source « ${libelleSource(s)} » : type_veille « ${s.type_veille} » absent de types_veille (${nomsTypes.join(", ")}).`);
    }
  }
  return { types, etiquettes: listeAvecMots(config.etiquettes), seuil: config.seuil };
}

// Le type d'une info : celui imposé par sa source, sinon le premier type de la config dont un mot apparaît.
function typeVeille(item, source, types) {
  if (source?.type_veille) return source.type_veille;
  return types.find((t) => contientUn(texte(item, ["titre", "extrait"]), t.mots))?.nom ?? null;
}

function lireRegles(config) {
  const regles = config.regles_score;
  if (!Array.isArray(regles)) throw new Error(`${CONFIG_PATH} doit contenir une liste « regles_score ».`);
  for (const regle of regles) {
    if (typeof regle.points !== "number") throw new Error(`Règle « ${regle.nom} » : « points » doit être un nombre.`);
    for (const cle of Object.keys(regle.si ?? {})) {
      if (!conditions[cle]) throw new Error(`Règle « ${regle.nom} » : condition inconnue « ${cle} ».`);
    }
  }
  return regles;
}

function score() {
  const config = lireConfig();
  const regles = lireRegles(config);
  const { types, etiquettes, seuil } = lireClassement(config);

  const sourceParLibelle = new Map(config.sources.map((s) => [libelleSource(s), s]));
  const items = lireItems();
  const motsCles = config.mots_cles ?? [];
  const sansSource = new Set();

  const resultats = items.map((item) => {
    const source = sourceParLibelle.get(item.source);
    if (!source) sansSource.add(item.source);
    const contexte = { item, source, items, motsCles };
    const appliquees = regles.filter((r) =>
      Object.entries(r.si ?? {}).every(([cle, val]) => conditions[cle](val, { ...contexte, si: r.si }))
    );
    item.fiabilite = appliquees.reduce((total, r) => total + r.points, 0);
    item.type_veille = typeVeille(item, source, types);
    // La famille sert à filtrer (blog, agrégat, presse…) ; par défaut, le type de la source.
    item.famille = source?.famille ?? source?.type ?? null;
    item.etiquettes = etiquettes.filter((e) => contientUn(texte(item, ["titre", "extrait"]), e.mots)).map((e) => e.nom);
    item.statut = item.fiabilite >= seuil ? "retenue" : "ecartee";
    return { item, appliquees };
  });

  majCalculs(base(), items); // seulement les champs calculés : les choix manuels restent intacts
  for (const s of sansSource) console.log(`Attention : la source « ${s} » n'est plus dans la config, ses règles « source » ne s'appliquent pas.`);

  resultats.sort((a, b) => b.item.fiabilite - a.item.fiabilite || b.item.publie_le.localeCompare(a.item.publie_le));
  const retenues = items.filter((i) => i.statut === "retenue").length;
  console.log(`${retenues} retenues, ${items.length - retenues} écartées (seuil ${seuil}).`);
  console.log(`Top 10 sur ${items.length} infos :\n`);
  resultats.slice(0, 10).forEach(({ item, appliquees }, n) => {
    const detail = appliquees.map((r) => `${r.nom} ${r.points >= 0 ? "+" : ""}${r.points}`).join(", ");
    console.log(`${n + 1}. [${item.fiabilite}] ${item.titre}`);
    console.log(`   ${item.source} · publiée le ${item.publie_le}`);
    console.log(`   ${detail || "aucune règle"}\n`);
  });
}

// Retrouve les infos dont le titre, le type ou une étiquette contient le mot (sans tenir compte des majuscules).
function search(...mots) {
  const mot = mots.join(" ").trim();
  if (!mot) {
    console.log("Usage : radar search <mot>");
    process.exit(1);
  }
  const etiquettesDe = (i) => [...(i.etiquettes ?? []), ...(i.etiquettes_perso ?? [])];
  const trouvees = lireItems()
    .filter((i) => contientUn([texte(i, ["titre", "type_veille"]), ...etiquettesDe(i)].join(" ").toLowerCase().replace(/[-_]/g, " "), [mot]))
    .sort((a, b) => b.publie_le.localeCompare(a.publie_le));
  console.log(`${trouvees.length} info(s) pour « ${mot} » :\n`);
  for (const i of trouvees) {
    const archive = i.archivee_le ? ` [archivée le ${i.archivee_le}]` : "";
    console.log(`${i.publie_le} · ${i.titre} (${i.type_veille ?? "sans type"}) [${etiquettesDe(i).join(", ")}] ${i.statut ?? "non scorée"} (${i.fiabilite ?? "?"})${archive}`);
    console.log(`   ${i.url}`);
  }
}

const TEXTES_PATH = join(ROOT, "rapport.textes.yaml");
const DECISION_PATH = join(ROOT, "decision.md");
const RAPPORT_PATH = join(ROOT, "rapport.md");

// Assemble rapport.md (partie 6 du kit) à partir de rapport.textes.yaml, la base et decision.md.
function report() {
  const textes = YAML.parse(readFileSync(TEXTES_PATH, "utf8")) ?? {};
  const tendances = textes.tendances ?? [];
  const parUrl = new Map(lireItems().map((i) => [i.url, i]));

  // Aucune source inventée : toute url citée doit venir de la base.
  const urlsCitees = [
    ...tendances.flatMap((t) => t.sources ?? []),
    ...(JSON.stringify(textes).match(/https?:\/\/[^\s"'<>)\]]+/g) ?? []),
  ];
  const inconnues = [...new Set(urlsCitees.filter((u) => !parUrl.has(u)))];
  if (inconnues.length) {
    throw new Error(`Url absente de la base, rapport non écrit :\n  ${inconnues.join("\n  ")}`);
  }
  const ecartees = [...new Set(urlsCitees)].filter((u) => parUrl.get(u).statut === "ecartee");
  for (const u of ecartees) console.log(`Attention : ${u} est citée mais « ecartee ».`);

  const aRemplir = (t) => (t && String(t).trim()) || "_À compléter._";
  const ref = (u) => `[${parUrl.get(u).titre}, ${parUrl.get(u).publie_le}](${u})`;
  const lignes = [];
  const l = (...t) => lignes.push(...t);

  l("# Rapport de veille", "", `_Généré par radar report le ${aujourdhui()}._`, "");
  l("## Page 1 · Synthèse de veille", "", "### 1. Sources", "");
  const sources = [...new Set(tendances.flatMap((t) => t.sources ?? []))]
    .map((u) => parUrl.get(u))
    .sort((a, b) => b.publie_le.localeCompare(a.publie_le));
  if (!sources.length) l("_Aucune source citée._");
  for (const i of sources) l(`- ${i.publie_le} · ${i.source} · [${i.titre}](${i.url}) · fiabilité ${i.fiabilite ?? "?"}`);

  l("", "### 2. Tendances", "");
  if (!tendances.length) l("_À compléter._");
  tendances.forEach((t, n) => {
    l(`#### Tendance ${n + 1} · ${aRemplir(t.titre)}`, "", aRemplir(t.constat).trim(), "");
    l(`Sources : ${(t.sources ?? []).map(ref).join(" ; ") || "_aucune_"}`, "");
    l(`- **Impact attendu :** ${aRemplir(t.impact).trim()}`);
    l(`- **Ce qu'elle permet d'anticiper :** ${aRemplir(t.anticiper).trim()}`);
    l(`- **Compatibilité budget et technique :** ${aRemplir(t.compatibilite).trim()}`);
    l(`- **${t.statut === "ecartee" ? "Écartée" : t.statut === "retenue" ? "Retenue" : "Statut à choisir"} :** ${aRemplir(t.pourquoi).trim()}`, "");
  });

  // La page 2 est facultative : elle n'apparaît que si un texte est rempli ou si decision.md existe.
  const champsPage2 = [textes.question, textes.recommandation, textes.risques, textes.plan_b, textes.prochaine_etape,
    ...Object.values(textes.impact ?? {})];
  const avecPage2 = existsSync(DECISION_PATH) || champsPage2.some((t) => t && String(t).trim());
  if (avecPage2) page2();
  writeFileSync(RAPPORT_PATH, lignes.join("\n"), "utf8");
  console.log(`rapport.md écrit : ${tendances.length} tendances, ${sources.length} sources, toutes présentes dans la base.`);
  return;

  function page2() {
  l("## Page 2 · Note de recommandation", "");
  l("### 1. La question et le contexte", "", aRemplir(textes.question), "");
  l("### 2. Les options et la matrice", "");
  if (existsSync(DECISION_PATH)) {
    // decision.md est inclus tel quel, titres décalés d'un niveau.
    const decision = readFileSync(DECISION_PATH, "utf8").replace(/^# .*\n/, "").replace(/^(#+) /gm, "$1## ");
    l(decision.trim(), "");
  } else {
    l("_decision.md introuvable : lancez « radar decide »._", "");
  }
  l("### 3. La recommandation", "", aRemplir(textes.recommandation), "");
  l("### 4. L'impact", "");
  l(`- **Périmètre :** ${aRemplir(textes.impact?.perimetre)}`);
  l(`- **Budget :** ${aRemplir(textes.impact?.budget)}`);
  l(`- **Délais :** ${aRemplir(textes.impact?.delais)}`, "");
  l("### 5. Les risques et le plan B", "", aRemplir(textes.risques), "", `**Plan B :** ${aRemplir(textes.plan_b)}`, "");
  l("### 6. La prochaine étape", "", aRemplir(textes.prochaine_etape), "");
  }
}

// Les alertes pas encore vues ; « radar alertes vues » les marque toutes comme vues.
function alertes(action) {
  const items = lireItems();
  const nonVues = items.filter((i) => i.alerte && !i.alerte_vue_le);
  if (action === "vues") {
    marquerAlertesVues(base(), aujourdhui());
    console.log(`${nonVues.length} alerte(s) marquée(s) comme vue(s).`);
    return;
  }
  console.log(`${nonVues.length} alerte(s) non vue(s)${nonVues.length ? " :" : "."}`);
  for (const i of nonVues) console.log(`- ${i.publie_le} · ${i.titre} (${i.alerte})\n  ${i.url}`);
}

// Collecte + score, pour la tâche planifiée. La sortie est aussi ajoutée à data/journal.log.
async function auto() {
  const lignes = [];
  const log = console.log;
  console.log = (...a) => {
    lignes.push(a.join(" "));
    log(...a);
  };
  try {
    await collect();
    score();
  } catch (e) {
    lignes.push(`Erreur : ${e.message}`);
    throw e;
  } finally {
    console.log = log;
    mkdirSync(dirname(JOURNAL_PATH), { recursive: true });
    appendFileSync(JOURNAL_PATH, `=== ${new Date().toLocaleString("fr-FR")}\n${lignes.join("\n")}\n\n`, "utf8");
  }
}

// Collecte automatique sans tâche Windows (ex. conteneur Docker) : « radar auto » toutes les N heures, sans fin.
// La fréquence est relue dans la config à chaque tour : un changement s'applique au tour suivant.
async function boucle() {
  for (;;) {
    let heures = 6;
    try {
      heures = lireConfig().planification?.toutes_les_heures ?? heures;
      await auto();
    } catch (e) {
      console.error(`Erreur : ${e.message}`);
    }
    const prochaine = new Date(Date.now() + heures * 3_600_000);
    ecrireMeta(base(), "prochaine_collecte", prochaine.toISOString());
    console.log(`Prochaine collecte : ${prochaine.toLocaleString("fr-FR")}\n`);
    await new Promise((r) => setTimeout(r, heures * 3_600_000));
  }
}

// Crée (ou remplace) la tâche planifiée Windows qui lance « radar auto » toutes les N heures.
const NOM_TACHE = process.env.RADAR_TACHE || "RADAR";
function planifier() {
  if (process.platform !== "win32") throw new Error("La planification automatique n'est prévue que pour Windows (ailleurs : cron avec « node radar.js auto »).");
  const heures = lireConfig().planification?.toutes_les_heures;
  if (!Number.isInteger(heures) || heures < 1 || heures > 23) {
    throw new Error("Ajoutez dans la config : planification: { toutes_les_heures: N } avec N entre 1 et 23.");
  }
  // conhost --headless : la collecte tourne sans ouvrir de fenêtre.
  const commande = `conhost.exe --headless "${process.execPath}" "${join(ROOT, "radar.js")}" auto`;
  execFileSync("schtasks", ["/Create", "/TN", NOM_TACHE, "/SC", "HOURLY", "/MO", String(heures), "/TR", commande, "/F"], { stdio: "pipe" });
  console.log(`Tâche « ${NOM_TACHE} » créée : collecte + score toutes les ${heures} h. Journal : data/journal.log.`);
  console.log(`Pour l'arrêter : radar deplanifier`);
}

function deplanifier() {
  execFileSync("schtasks", ["/Delete", "/TN", NOM_TACHE, "/F"], { stdio: "pipe" });
  console.log(`Tâche « ${NOM_TACHE} » supprimée.`);
}

// Exporte toutes les infos de la base en JSON lisible (par défaut data/items.json, le format du kit).
function exporter(fichier = join(DATA_DIR, "items.json")) {
  const items = lireItems();
  writeFileSync(fichier, JSON.stringify(items, null, 2) + "\n", "utf8");
  console.log(`${items.length} infos exportées dans ${fichier}`);
}

// Vérifie la config sans rien collecter ni modifier.
function check() {
  const config = lireConfig();
  const regles = lireRegles(config);
  const { types, etiquettes, seuil } = lireClassement(config);
  const obligatoires = {
    releases: ["depot"],
    flux: ["url"],
    hackernews: ["requete"],
    failles: ["paquet", "ecosysteme"],
    page: ["url"],
    depot: ["depot"],
    npm: ["paquet"],
  };
  const libelles = new Set();
  for (const s of config.sources) {
    if (!collecteurs[s.type]) {
      throw new Error(`Source « ${libelleSource(s)} » : type « ${s.type} » inconnu (types possibles : ${Object.keys(collecteurs).join(", ")}).`);
    }
    const manque = obligatoires[s.type].filter((c) => !s[c] && !(s.type === "hackernews" && s.une));
    if (manque.length) throw new Error(`Source « ${libelleSource(s)} » (${s.type}) : champ manquant ${manque.join(", ")}.`);
    if (s.url && !/^https?:\/\//.test(s.url)) throw new Error(`Source « ${libelleSource(s)} » : url invalide « ${s.url} ».`);
    // Le libellé relie les infos à leur source : deux sources ne peuvent pas avoir le même.
    if (libelles.has(libelleSource(s))) throw new Error(`Deux sources ont le libellé « ${libelleSource(s)} » : donnez-leur des « nom » différents.`);
    libelles.add(libelleSource(s));
  }
  const planif = config.planification?.toutes_les_heures;
  if (planif !== undefined && !(Number.isInteger(planif) && planif >= 1 && planif <= 23)) {
    throw new Error("planification.toutes_les_heures doit être un entier entre 1 et 23.");
  }
  console.log(
    `Config valide : ${config.sources.length} sources, ${types.length} types, ${etiquettes.length} étiquettes, ${regles.length} règles, seuil ${seuil}.`
  );
}

const commandes = { collect, score, search, report, check, alertes, auto, boucle, planifier, deplanifier, export: exporter };
const [nom, ...args] = process.argv.slice(2);
if (!commandes[nom]) {
  console.log(
    `Usage : radar <commande>\nCommandes : collect, score, search <mot>, report, check, alertes [vues], auto, boucle, planifier, deplanifier, export [fichier]`
  );
  process.exit(nom ? 1 : 0);
}
try {
  await commandes[nom](...args);
} catch (e) {
  console.error(`Erreur : ${e.message}`);
  process.exit(1);
}
