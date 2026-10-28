// Plugin Vite : ajoute les routes /api au serveur de Vite (npm run dev et npm run preview).
// Le navigateur ne peut ni lire les fichiers du projet ni lancer radar.js : ces routes le font pour lui.
import { readFileSync, writeFileSync, existsSync, copyFileSync, mkdtempSync, rmSync } from "node:fs";
import { execFile } from "node:child_process";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import YAML from "yaml";
import { ouvrirBase, lireItems, lireItem, majManuel, marquerAlertesVues, lireMeta } from "../db.js";
import { libelleSource, cibleSource } from "../sources.js";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const CONFIG = join(ROOT, "radar.config.yaml");
const COMMANDES = ["collect", "score", "report", "planifier", "deplanifier"];

let commandeEnCours = null;

function json(res, code, donnees) {
  res.writeHead(code, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(donnees));
}

function lancer(commande, env = {}) {
  return new Promise((ok) => {
    const options = { cwd: ROOT, maxBuffer: 20 * 1024 * 1024, env: { ...process.env, ...env } };
    execFile(process.execPath, [join(ROOT, "radar.js"), commande], options, (err, stdout, stderr) =>
      ok({ ok: !err, sortie: (stdout + stderr).trim() })
    );
  });
}

function lireCorps(req, max = 1024 * 1024) {
  return new Promise((ok, echec) => {
    let corps = "";
    req.on("data", (morceau) => {
      corps += morceau;
      if (corps.length > max) echec(new Error("Contenu trop gros"));
    });
    req.on("end", () => ok(corps));
    req.on("error", echec);
  });
}

// Ouverte au premier appel. Partagée avec les commandes radar : SQLite gère les écritures simultanées.
let db = null;
const base = () => (db ??= ouvrirBase(join(ROOT, "data")));

function aujourdhui() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

// Applique les choix faits à la main sur une info : étiquettes perso et archivage.
// Ces champs ne sont jamais touchés par collect ni score.
function modifierItem({ url, etiquettes_perso, archivee }) {
  if (!lireItem(base(), url)) throw new Error(`Info introuvable : ${url}`);
  const changements = {};
  if (etiquettes_perso !== undefined) {
    if (!Array.isArray(etiquettes_perso)) throw new Error("« etiquettes_perso » doit être une liste");
    const propres = etiquettes_perso.map((e) => String(e).trim().toLowerCase().slice(0, 40)).filter(Boolean);
    changements.etiquettes_perso = [...new Set(propres)];
  }
  if (archivee !== undefined) changements.archivee_le = archivee ? aujourdhui() : null;
  majManuel(base(), url, changements);
  return lireItem(base(), url);
}

// Les rubriques que le mode simple sait modifier (les règles de score restent dans le fichier).
const RUBRIQUES_SIMPLES = ["sources", "types_veille", "etiquettes", "alertes", "seuil", "ignorer", "planification"];

// Remplace des rubriques du fichier sans toucher au reste : commentaires, ordre et style sont conservés.
// Dans une liste (sources, thèmes…), les éléments inchangés gardent leur nœud, donc leurs commentaires ;
// un élément modifié reprend le commentaire de l'élément d'origine (« __origine » = sa position avant).
// Seul le texte des rubriques changées est remplacé : le reste du fichier reste octet pour octet identique.
function appliquerModeSimple(texte, changements) {
  const doc = YAML.parseDocument(texte);
  const remplacements = [];
  for (const [cle, valeur] of Object.entries(changements)) {
    if (!RUBRIQUES_SIMPLES.includes(cle)) throw new Error(`Rubrique non modifiable en mode simple : ${cle}`);
    const paire = doc.contents.items.find((p) => p.key?.value === cle);
    // Rubrique renvoyée telle quelle : on n'y touche pas (sinon elle serait reformatée pour rien).
    const sansOrigine = JSON.parse(JSON.stringify(valeur, (k, v) => (k === "__origine" ? undefined : v)));
    if (paire && JSON.stringify(paire.value?.toJSON()) === JSON.stringify(sansOrigine)) continue;
    const rendu = rendreRubrique(doc, cle, valeur);
    if (!paire) remplacements.push({ debut: texte.length, fin: texte.length, texte: (texte.endsWith("\n") ? "" : "\n") + rendu });
    else {
      const debut = paire.key.range[0];
      const fin = paire.value?.range[2] ?? paire.key.range[2];
      // Le segment d'origine peut finir par des sauts de ligne (avant la rubrique suivante) : on les garde tels quels.
      const sauts = texte.slice(debut, fin).match(/\n*$/)[0];
      remplacements.push({ debut, fin, texte: rendu.replace(/\n+$/, "") + sauts });
    }
  }
  // De la fin vers le début, pour que les positions restent justes.
  let resultat = texte;
  for (const r of remplacements.sort((a, b) => b.debut - a.debut)) resultat = resultat.slice(0, r.debut) + r.texte + resultat.slice(r.fin);
  return resultat;
}

// Le texte YAML d'une rubrique (« cle: valeur »), dans le style du fichier.
function rendreRubrique(doc, cle, valeur) {
  const mini = new YAML.Document({});
  {
    const ancien = doc.get(cle, true);
    if (Array.isArray(valeur) && valeur.every((v) => v && typeof v === "object")) {
      const anciens = YAML.isSeq(ancien) ? ancien.items : [];
      const nouveau = doc.createNode([]);
      for (const { __origine, ...element } of valeur) {
        const identique = anciens.find((n) => JSON.stringify(n.toJSON()) === JSON.stringify(element));
        const noeud = identique ?? doc.createNode(element);
        if (!identique) {
          noeud.flow = true;
          if (YAML.isMap(noeud)) for (const p of noeud.items) if (YAML.isSeq(p.value)) p.value.flow = true;
          const origine = anciens[__origine];
          if (origine?.commentBefore) noeud.commentBefore = origine.commentBefore;
        }
        nouveau.items.push(noeud);
      }
      // Le commentaire au-dessus du premier élément est rattaché à la liste elle-même.
      if (ancien?.commentBefore) nouveau.commentBefore = ancien.commentBefore;
      if (ancien?.comment) nouveau.comment = ancien.comment;
      mini.set(cle, nouveau);
    } else {
      const noeud = doc.createNode(valeur);
      if (YAML.isSeq(noeud)) noeud.flow = true;
      if (YAML.isMap(noeud)) {
        noeud.flow = cle === "planification";
        for (const p of noeud.items) {
          if (YAML.isSeq(p.value)) p.value.flow = true;
          // Les commentaires de fin de ligne des sous-rubriques (ex. « notification: true # … ») sont gardés.
          const anciennePaire = YAML.isMap(ancien) ? ancien.items.find((a) => a.key?.value === p.key?.value) : null;
          if (anciennePaire?.value?.comment && p.value) p.value.comment = anciennePaire.value.comment;
        }
      }
      // Le commentaire de fin de ligne (ex. « seuil: 5 # … ») suit la valeur.
      if (ancien?.comment) noeud.comment = ancien.comment;
      mini.set(cle, noeud);
    }
  }
  return mini.toString({ lineWidth: 0 });
}

// Vérifie le nouveau texte avec « radar check » sur une copie, puis seulement l'enregistre (ancienne version gardée en .bak).
async function enregistrerConfig(texte) {
  try {
    YAML.parse(texte);
  } catch (e) {
    return { ok: false, sortie: `YAML invalide : ${e.message}` };
  }
  const dossier = mkdtempSync(join(tmpdir(), "radar-"));
  try {
    const copie = join(dossier, "radar.config.yaml");
    writeFileSync(copie, texte, "utf8");
    const verif = await lancer("check", { RADAR_CONFIG: copie });
    if (!verif.ok) return verif;
    copyFileSync(CONFIG, CONFIG + ".bak");
    writeFileSync(CONFIG, texte, "utf8");
    return verif;
  } finally {
    rmSync(dossier, { recursive: true, force: true });
  }
}

// Les noms utiles à l'interface (types, étiquettes, seuil), lus dans la config.
function meta() {
  const config = YAML.parse(readFileSync(join(ROOT, "radar.config.yaml"), "utf8")) ?? {};
  const noms = (liste) => (liste ?? []).map((e) => (typeof e === "string" ? e : e.nom));
  const collecte = lireMeta(base(), "derniere_collecte");
  return {
    types: noms(config.types_veille),
    etiquettes: noms(config.etiquettes),
    seuil: config.seuil ?? null,
    derniere_collecte: collecte && { le: collecte.le, nouvelles: collecte.nouvelles, alertes: collecte.alertes },
    // Les sources de la config, avec leur état à la dernière collecte (null si jamais collectée depuis).
    sources: (config.sources ?? []).map((s) => ({
      nom: libelleSource(s),
      type: s.type,
      famille: s.famille ?? s.type,
      categorie: s.categorie ?? null,
      cible: cibleSource(s),
      etat: collecte?.sources?.[libelleSource(s)] ?? null,
    })),
  };
}

async function api(req, res, chemin) {
  if (req.method === "GET" && chemin === "/api/items") {
    return json(res, 200, lireItems(base()));
  }
  if (req.method === "GET" && chemin === "/api/meta") {
    try {
      return json(res, 200, meta());
    } catch (e) {
      return json(res, 500, { erreur: `radar.config.yaml illisible : ${e.message}` });
    }
  }
  if (req.method === "POST" && chemin === "/api/items/modifier") {
    if (req.headers["x-radar"] !== "1") return json(res, 403, { erreur: "En-tête X-Radar manquant" });
    // Pas besoin d'attendre la fin d'un collect ou d'un score : ils ne touchent pas aux colonnes modifiées ici.
    try {
      return json(res, 200, modifierItem(JSON.parse(await lireCorps(req))));
    } catch (e) {
      return json(res, 400, { erreur: e.message });
    }
  }
  if (req.method === "POST" && chemin === "/api/alertes/vues") {
    if (req.headers["x-radar"] !== "1") return json(res, 403, { erreur: "En-tête X-Radar manquant" });
    return json(res, 200, { vues: marquerAlertesVues(base(), aujourdhui()) });
  }
  if (req.method === "GET" && chemin === "/api/planification") {
    // Sous Docker, la collecte automatique est assurée par le conteneur « collecte » (radar boucle).
    if (process.env.RADAR_COLLECTE_AUTO === "docker") {
      const prochaine = lireMeta(base(), "prochaine_collecte");
      return json(res, 200, { disponible: true, active: true, docker: true, prochaine: prochaine && new Date(prochaine).toLocaleString("fr-FR") });
    }
    if (process.platform !== "win32") return json(res, 200, { disponible: false });
    // Lecture seule : la tâche existe-t-elle, et quand tourne-t-elle ensuite ?
    return execFile("schtasks", ["/Query", "/TN", "RADAR", "/FO", "CSV", "/NH"], (err, stdout) => {
      if (err) return json(res, 200, { disponible: true, active: false });
      const champs = stdout.trim().split('","').map((c) => c.replace(/"/g, ""));
      json(res, 200, { disponible: true, active: true, prochaine: champs[1] ?? null });
    });
  }
  if (req.method === "POST" && chemin === "/api/config/simple") {
    if (req.headers["x-radar"] !== "1") return json(res, 403, { erreur: "En-tête X-Radar manquant" });
    if (commandeEnCours) return json(res, 409, { erreur: `« radar ${commandeEnCours} » est en cours, réessayez après` });
    let texte;
    try {
      texte = appliquerModeSimple(readFileSync(CONFIG, "utf8"), JSON.parse(await lireCorps(req)).changements ?? {});
    } catch (e) {
      return json(res, 400, { ok: false, sortie: e.message });
    }
    commandeEnCours = "check";
    try {
      const r = await enregistrerConfig(texte);
      return json(res, r.ok ? 200 : 400, { ...r, texte: readFileSync(CONFIG, "utf8") });
    } finally {
      commandeEnCours = null;
    }
  }
  if (req.method === "GET" && chemin === "/api/config") {
    return json(res, 200, { texte: readFileSync(CONFIG, "utf8") });
  }
  if (req.method === "POST" && chemin === "/api/config") {
    if (req.headers["x-radar"] !== "1") return json(res, 403, { erreur: "En-tête X-Radar manquant" });
    if (commandeEnCours) return json(res, 409, { erreur: `« radar ${commandeEnCours} » est en cours, réessayez après` });
    const { texte } = JSON.parse(await lireCorps(req));
    if (typeof texte !== "string") return json(res, 400, { erreur: "Champ « texte » manquant" });
    commandeEnCours = "check";
    try {
      const r = await enregistrerConfig(texte);
      return json(res, r.ok ? 200 : 400, r);
    } finally {
      commandeEnCours = null;
    }
  }
  if (req.method === "GET" && chemin === "/api/rapport") {
    const fichier = join(ROOT, "rapport.md");
    return existsSync(fichier) ? json(res, 200, { markdown: readFileSync(fichier, "utf8") }) : json(res, 404, { erreur: "rapport.md absent" });
  }
  const run = chemin.match(/^\/api\/run\/(\w+)$/);
  if (req.method === "POST" && run) {
    // L'en-tête obligatoire empêche une autre page web ouverte dans le navigateur de lancer des commandes.
    if (req.headers["x-radar"] !== "1") return json(res, 403, { erreur: "En-tête X-Radar manquant" });
    if (!COMMANDES.includes(run[1])) return json(res, 404, { erreur: `Commande inconnue : ${run[1]}` });
    if (commandeEnCours) return json(res, 409, { erreur: `« radar ${commandeEnCours} » est déjà en cours` });
    commandeEnCours = run[1];
    try {
      return json(res, 200, await lancer(run[1]));
    } finally {
      commandeEnCours = null;
    }
  }
  return json(res, 404, { erreur: "Route inconnue" });
}

function middleware(req, res, next) {
  const chemin = new URL(req.url, "http://localhost").pathname;
  if (!chemin.startsWith("/api/")) return next();
  api(req, res, chemin).catch((e) => json(res, 500, { erreur: e.message }));
}

export default function radarApi() {
  return {
    name: "radar-api",
    // Accolades obligatoires : si le hook renvoie une fonction, Vite l'exécute après coup.
    configureServer(server) {
      server.middlewares.use(middleware);
    },
    configurePreviewServer(server) {
      server.middlewares.use(middleware);
    },
  };
}
