// Accès à la base SQLite de RADAR (data/radar.db), partagé par radar.js et l'interface (ui/api.js).
// Chaque écriture ne touche que ses colonnes : collect ajoute des infos, score met à jour les champs calculés,
// l'interface met à jour les choix manuels. Une collecte ne peut donc plus écraser un archivage fait en même temps.
import { existsSync, readFileSync, renameSync, mkdirSync } from "node:fs";
import { join } from "node:path";

// node:sqlite est intégré à Node mais encore marqué « expérimental » : on masque seulement cet avertissement-là.
const emettre = process.emitWarning;
process.emitWarning = (alerte, ...reste) => (String(alerte).includes("SQLite") ? undefined : emettre.call(process, alerte, ...reste));
const { DatabaseSync } = await import("node:sqlite");
process.emitWarning = emettre;

// Les champs d'une info. Les listes et objets sont stockés en JSON.
const CHAMPS_JSON = ["etiquettes", "etiquettes_perso", "mesures"];
const COLONNES = [
  "url", "titre", "publie_le", "collecte_le", "source", "auteur", "extrait", "mesures",
  "type_veille", "etiquettes", "famille", "fiabilite", "statut",
  "etiquettes_perso", "archivee_le", "alerte", "alerte_vue_le",
];

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS items (
    url TEXT PRIMARY KEY,
    titre TEXT NOT NULL,
    publie_le TEXT NOT NULL,          -- AAAA-MM-JJ : jamais d'info sans date
    collecte_le TEXT NOT NULL,
    source TEXT NOT NULL,
    auteur TEXT,
    extrait TEXT,
    mesures TEXT,                     -- JSON (sources depot, npm)
    type_veille TEXT,                 -- calculés par score
    etiquettes TEXT,                  -- JSON
    famille TEXT,
    fiabilite INTEGER,
    statut TEXT,
    etiquettes_perso TEXT,            -- choix manuels (interface), jamais touchés par collect ni score
    archivee_le TEXT,
    alerte TEXT,                      -- posés par collect sur une nouvelle info qui alerte
    alerte_vue_le TEXT
  );
  CREATE INDEX IF NOT EXISTS items_publie_le ON items (publie_le);
  CREATE INDEX IF NOT EXISTS items_source ON items (source);
  CREATE TABLE IF NOT EXISTS meta (   -- date de la dernière collecte, état de chaque source…
    cle TEXT PRIMARY KEY,
    valeur TEXT NOT NULL              -- JSON
  );
  CREATE TABLE IF NOT EXISTS pages (
    url TEXT PRIMARY KEY,
    empreinte TEXT NOT NULL,
    texte TEXT NOT NULL,
    vu_le TEXT NOT NULL
  );
`;

const versLigne = (item) =>
  Object.fromEntries(COLONNES.map((c) => [c, CHAMPS_JSON.includes(c) ? (item[c] == null ? null : JSON.stringify(item[c])) : item[c] ?? null]));

function versItem(ligne) {
  const item = {};
  for (const c of COLONNES) {
    const v = ligne[c];
    if (v == null && ["mesures", "etiquettes_perso", "archivee_le", "alerte", "alerte_vue_le"].includes(c)) continue;
    item[c] = CHAMPS_JSON.includes(c) && v != null ? JSON.parse(v) : v;
  }
  return item;
}

export function ouvrirBase(dossier) {
  mkdirSync(dossier, { recursive: true });
  const db = new DatabaseSync(join(dossier, "radar.db"));
  // WAL + attente : la tâche planifiée, le terminal et l'interface peuvent écrire en même temps sans erreur.
  db.exec("PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000;");
  db.exec(SCHEMA);
  migrerDepuisJson(db, dossier);
  return db;
}

// Une seule fois : reprend data/items.json et data/pages.json, puis les renomme en .migre (gardés en sauvegarde).
function migrerDepuisJson(db, dossier) {
  const fichierItems = join(dossier, "items.json");
  const fichierPages = join(dossier, "pages.json");
  if (existsSync(fichierItems) && db.prepare("SELECT COUNT(*) n FROM items").get().n === 0) {
    const items = JSON.parse(readFileSync(fichierItems, "utf8"));
    transaction(db, () => insererItems(db, items));
    renameSync(fichierItems, fichierItems + ".migre");
    console.log(`(migration : ${items.length} infos reprises de data/items.json, gardé en items.json.migre)`);
  }
  if (existsSync(fichierPages) && db.prepare("SELECT COUNT(*) n FROM pages").get().n === 0) {
    const pages = JSON.parse(readFileSync(fichierPages, "utf8"));
    transaction(db, () => {
      for (const [url, p] of Object.entries(pages)) ecrirePage(db, url, p);
    });
    renameSync(fichierPages, fichierPages + ".migre");
  }
}

export function transaction(db, fn) {
  db.exec("BEGIN IMMEDIATE");
  try {
    const resultat = fn();
    db.exec("COMMIT");
    return resultat;
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
}

export function lireItems(db) {
  return db.prepare("SELECT * FROM items ORDER BY publie_le DESC, titre").all().map(versItem);
}

export function lireItem(db, url) {
  const ligne = db.prepare("SELECT * FROM items WHERE url = ?").get(url);
  return ligne ? versItem(ligne) : null;
}

// Ajoute les infos absentes (même url = déjà connue, ignorée). Renvoie le nombre d'ajouts.
export function insererItems(db, items) {
  const requete = db.prepare(
    `INSERT OR IGNORE INTO items (${COLONNES.join(", ")}) VALUES (${COLONNES.map((c) => `:${c}`).join(", ")})`
  );
  let n = 0;
  for (const item of items) n += Number(requete.run(versLigne(item)).changes);
  return n;
}

// Les champs calculés par score, et eux seuls.
export function majCalculs(db, items) {
  const requete = db.prepare(
    "UPDATE items SET type_veille = :type_veille, etiquettes = :etiquettes, famille = :famille, fiabilite = :fiabilite, statut = :statut WHERE url = :url"
  );
  transaction(db, () => {
    for (const i of items) {
      requete.run({
        url: i.url,
        type_veille: i.type_veille ?? null,
        etiquettes: JSON.stringify(i.etiquettes ?? []),
        famille: i.famille ?? null,
        fiabilite: i.fiabilite ?? null,
        statut: i.statut ?? null,
      });
    }
  });
}

// Les choix manuels (interface) : étiquettes perso et archivage.
export function majManuel(db, url, { etiquettes_perso, archivee_le }) {
  if (etiquettes_perso !== undefined) db.prepare("UPDATE items SET etiquettes_perso = ? WHERE url = ?").run(JSON.stringify(etiquettes_perso), url);
  if (archivee_le !== undefined) db.prepare("UPDATE items SET archivee_le = ? WHERE url = ?").run(archivee_le, url);
}

export function marquerAlertesVues(db, date) {
  return Number(db.prepare("UPDATE items SET alerte_vue_le = ? WHERE alerte IS NOT NULL AND alerte_vue_le IS NULL").run(date).changes);
}

export function lireMeta(db, cle) {
  const ligne = db.prepare("SELECT valeur FROM meta WHERE cle = ?").get(cle);
  return ligne ? JSON.parse(ligne.valeur) : null;
}

export function ecrireMeta(db, cle, valeur) {
  db.prepare("INSERT INTO meta (cle, valeur) VALUES (?, ?) ON CONFLICT(cle) DO UPDATE SET valeur = excluded.valeur").run(cle, JSON.stringify(valeur));
}

export function lirePages(db) {
  return Object.fromEntries(db.prepare("SELECT * FROM pages").all().map((p) => [p.url, { empreinte: p.empreinte, texte: p.texte, vu_le: p.vu_le }]));
}

export function ecrirePage(db, url, { empreinte, texte, vu_le }) {
  db.prepare("INSERT INTO pages (url, empreinte, texte, vu_le) VALUES (?, ?, ?, ?) ON CONFLICT(url) DO UPDATE SET empreinte = excluded.empreinte, texte = excluded.texte, vu_le = excluded.vu_le").run(url, empreinte, texte, vu_le);
}
