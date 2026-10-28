// Outils partagés de l'interface : appels au serveur, dates, vocabulaire.

const MESSAGE_HORS_LIGNE = "Pas de réponse du serveur RADAR. Vérifiez que « npm run dev » tourne dans le terminal, puis rechargez la page.";

export async function appel(chemin, options) {
  let res;
  try {
    res = await fetch(chemin, options);
  } catch {
    // fetch n'échoue ainsi que si la connexion est coupée : serveur arrêté ou en train de redémarrer.
    throw new Error(MESSAGE_HORS_LIGNE);
  }
  const donnees = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(donnees.erreur ?? donnees.sortie ?? `Erreur ${res.status}`), { donnees });
  return donnees;
}

// Écriture : l'en-tête X-Radar est exigé par le serveur pour toute action.
export const envoyer = (chemin, corps) =>
  appel(chemin, {
    method: "POST",
    headers: { "X-Radar": "1", ...(corps && { "Content-Type": "application/json" }) },
    body: corps && JSON.stringify(corps),
  });

// Même règle que radar search : sans majuscules, tirets lus comme des espaces.
export const normaliser = (t) => String(t ?? "").toLowerCase().replace(/[-_]/g, " ");

const jourIso = (d) => d.toLocaleDateString("sv-SE");

// « Aujourd'hui », « Hier », « lundi 26 octobre », ou « 12 octobre 2026 » au-delà d'une semaine.
export function libelleJour(iso) {
  const aujourdhui = new Date();
  const hier = new Date(Date.now() - 86_400_000);
  if (iso === jourIso(aujourdhui)) return "Aujourd'hui";
  if (iso === jourIso(hier)) return "Hier";
  const d = new Date(`${iso}T12:00:00`);
  const jours = (aujourdhui - d) / 86_400_000;
  return d.toLocaleDateString("fr-FR", jours < 7 ? { weekday: "long", day: "numeric", month: "long" } : { day: "numeric", month: "long", year: "numeric" });
}

export function ilYA(isoDateHeure) {
  const minutes = Math.round((Date.now() - new Date(isoDateHeure)) / 60_000);
  if (minutes < 1) return "à l'instant";
  if (minutes < 60) return `il y a ${minutes} min`;
  const heures = Math.round(minutes / 60);
  if (heures < 24) return `il y a ${heures} h`;
  const jours = Math.round(heures / 24);
  return `il y a ${jours} jour${jours > 1 ? "s" : ""}`;
}

// Le vocabulaire affiché, pour que les mots internes (types de source) ne fuient pas dans l'interface.
export const TYPES_SOURCE = {
  releases: "Versions GitHub",
  depot: "Chiffres GitHub",
  npm: "Téléchargements npm",
  flux: "Flux RSS ou Atom",
  hackernews: "Hacker News",
  failles: "Failles de sécurité",
  page: "Page surveillée",
};

export const toutesEtiquettes = (i) => [...(i.etiquettes ?? []), ...(i.etiquettes_perso ?? [])];
export const alerteNonVue = (i) => Boolean(i.alerte && !i.alerte_vue_le);
