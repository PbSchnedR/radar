// Ce qui décrit une source de la config, partagé par radar.js et l'interface (ui/api.js).

// Le libellé « source » d'une info : c'est lui qui relie l'info à sa source dans la config.
export function libelleSource(source) {
  if (source.nom) return source.nom;
  if (source.type === "releases") return `GitHub ${source.depot}`;
  return `${source.type} ${source.depot ?? source.requete ?? source.paquet ?? source.url}`;
}

// Ce que la source surveille, en une ligne (dépôt, url, requête ou paquet).
export function cibleSource(source) {
  if (source.type === "hackernews" && source.une) return `page d'accueil${source.requete ? ` : ${source.requete}` : ""}`;
  return source.depot ?? source.url ?? source.requete ?? source.paquet ?? "";
}
