// Le mode simple du fichier de configuration : des formulaires au lieu du YAML.
// Seules les rubriques modifiées sont envoyées ; le serveur ne réécrit qu'elles (commentaires et reste du fichier intacts).
import { useEffect, useState } from "react";
import { ArrowDown, ArrowUp, PencilSimple, Plus, Trash, WarningCircle, CheckCircle } from "@phosphor-icons/react";
import { Bouton, Fenetre, classeChamp } from "./ui.jsx";
import { TYPES_SOURCE, envoyer } from "./lib.js";
import { libelleSource, cibleSource } from "../../sources.js";

const RUBRIQUES = ["sources", "types_veille", "etiquettes", "alertes", "seuil", "ignorer", "planification"];
const CATEGORIES = [
  ["officielle", "officielle (éditeur, projet)"],
  ["institution", "institution (CERT, CNIL, base de failles)"],
  ["presse", "presse"],
  ["communaute", "communauté (blogs, agrégats, forums)"],
  ["social", "réseau social"],
];
const ECOSYSTEMES = ["npm", "PyPI", "Go", "Maven", "crates.io", "RubyGems", "NuGet", "Packagist"];

// Ce que chaque type de source demande, et comment l'expliquer.
const CHAMPS_TYPE = {
  releases: { aide: "Chaque nouvelle version publiée d'un dépôt GitHub.", champs: [["depot", "Dépôt GitHub", "propriétaire/nom, ex. openai/codex", true]] },
  depot: { aide: "Une mesure par jour : étoiles, forks, licence d'un dépôt GitHub.", champs: [["depot", "Dépôt GitHub", "propriétaire/nom, ex. ollama/ollama", true]] },
  npm: { aide: "Une mesure par semaine : téléchargements npm d'un paquet.", champs: [["paquet", "Paquet npm", "ex. @anthropic-ai/claude-code", true]] },
  flux: { aide: "Chaque article d'un flux RSS ou Atom (blog, actualités, releases.atom d'un dépôt).", champs: [["url", "Adresse du flux", "https://…/feed.xml", true]] },
  hackernews: {
    aide: "Les articles Hacker News qui contiennent des mots, ou ceux de la page d'accueil.",
    champs: [["requete", "Mots recherchés", "ex. claude code", false], ["points_min", "Points minimum", "ex. 50", false, "nombre"], ["une", "Seulement la page d'accueil", "", false, "case"]],
  },
  failles: {
    aide: "Les failles de sécurité connues d'un paquet (base OSV).",
    champs: [["paquet", "Paquet", "ex. express", true], ["ecosysteme", "Écosystème", "", true, "ecosysteme"], ["version", "Version utilisée (facultatif)", "ex. 4.17.1", false]],
  },
  page: { aide: "Une page sans flux (CGU, tarifs, doc) : une info est créée quand son texte change.", champs: [["url", "Adresse de la page", "https://…", true]] },
};

const sansOrigine = (v) => JSON.parse(JSON.stringify(v ?? null, (k, x) => (k === "__origine" ? undefined : x)));
const memes = (a, b) => JSON.stringify(sansOrigine(a)) === JSON.stringify(sansOrigine(b));
const versMots = (texte) => texte.split(",").map((m) => m.trim()).filter(Boolean);
const enObjet = (e) => (typeof e === "string" ? { nom: e, mots: [e] } : e);

export function brouillonDepuis(config) {
  return {
    ...config,
    sources: (config.sources ?? []).map((s, i) => ({ ...s, __origine: i })),
    types_veille: (config.types_veille ?? []).map(enObjet),
    etiquettes: (config.etiquettes ?? []).map(enObjet),
    alertes: { mots: [], sources: [], notification: false, ...config.alertes },
    ignorer: config.ignorer ?? [],
  };
}

export const aDesChangements = (base, brouillon) => {
  const reference = brouillonDepuis(base);
  return RUBRIQUES.some((r) => !memes(brouillon[r], reference[r]));
};

export default function ConfigSimple({ base, brouillon, setBrouillon, meta, onEnregistre, occupe }) {
  const [enregistrement, setEnregistrement] = useState(false);
  const [resultat, setResultat] = useState(null);
  const reference = brouillonDepuis(base);
  const changees = RUBRIQUES.filter((r) => !memes(brouillon[r], reference[r]));
  const maj = (cle, valeur) => setBrouillon({ ...brouillon, [cle]: valeur });

  async function enregistrer() {
    setEnregistrement(true);
    setResultat(null);
    try {
      const changements = Object.fromEntries(changees.map((r) => [r, brouillon[r]]));
      const r = await envoyer("/api/config/simple", { changements });
      setResultat({ ok: true, sortie: r.sortie });
      onEnregistre(r.texte);
    } catch (e) {
      setResultat({ ok: false, sortie: e.donnees?.sortie ?? e.message });
    } finally {
      setEnregistrement(false);
    }
  }

  return (
    <div className="space-y-10">
      <EditeurSources sources={brouillon.sources} setSources={(v) => maj("sources", v)} types={brouillon.types_veille} meta={meta} />
      <EditeurMots
        titre="Thèmes"
        description="Chaque info reçoit un seul thème : le premier de la liste dont un mot apparaît dans son titre ou son extrait. Mettez les thèmes précis avant les thèmes larges."
        liste={brouillon.types_veille}
        setListe={(v) => maj("types_veille", v)}
        ordonne
      />
      <EditeurMots
        titre="Étiquettes automatiques"
        description="Une info reçoit toutes les étiquettes dont un mot apparaît dans son titre ou son extrait."
        liste={brouillon.etiquettes}
        setListe={(v) => maj("etiquettes", v)}
      />
      <Alertes alertes={brouillon.alertes} setAlertes={(v) => maj("alertes", v)} />
      <div className="grid gap-8 sm:grid-cols-2">
        <Bloc titre="Fiabilité" description="En dessous de ce score, une info est « peu fiable » et masquée par défaut. Les règles qui donnent les points se modifient dans le mode Fichier.">
          <Champ libelle="Score minimum pour être fiable">
            <input type="number" value={brouillon.seuil ?? ""} onChange={(e) => maj("seuil", e.target.value === "" ? null : Number(e.target.value))} className={`h-9 w-28 px-2 ${classeChamp}`} />
          </Champ>
        </Bloc>
        <Bloc titre="Collecte automatique" description="Toutes les combien d'heures RADAR actualise tout seul, une fois la collecte automatique activée (en haut de la page).">
          <Champ libelle="Toutes les … heures (1 à 23)">
            <input
              type="number"
              min="1"
              max="23"
              value={brouillon.planification?.toutes_les_heures ?? ""}
              onChange={(e) => maj("planification", { ...brouillon.planification, toutes_les_heures: e.target.value === "" ? undefined : Number(e.target.value) })}
              className={`h-9 w-28 px-2 ${classeChamp}`}
            />
          </Champ>
        </Bloc>
      </div>
      <Bloc titre="Mots à ignorer" description="Une info dont le titre contient un de ces mots n'est jamais enregistrée.">
        <ChampMots valeur={brouillon.ignorer} onChange={(v) => maj("ignorer", v)} libelle="Mots à ignorer" />
      </Bloc>

      {/* Barre d'enregistrement : visible dès qu'il y a une modification. */}
      {(changees.length > 0 || resultat) && (
        <div className="sticky bottom-4 z-20 rounded-lg border border-zinc-200 bg-white p-4 shadow-lg dark:border-zinc-700 dark:bg-zinc-900">
          {resultat && (
            <div className={`mb-3 text-sm ${resultat.ok ? "text-emerald-800 dark:text-emerald-300" : "text-red-800 dark:text-red-300"}`}>
              <div className="font-medium">{resultat.ok ? "Enregistré. Les changements s'appliquent à la prochaine actualisation." : "Pas enregistré : la configuration contient une erreur."}</div>
              {!resultat.ok && <pre className="mt-1 font-mono text-xs whitespace-pre-wrap">{resultat.sortie}</pre>}
            </div>
          )}
          {changees.length > 0 && (
            <div className="flex flex-wrap items-center gap-3">
              <span className="mr-auto text-sm text-zinc-600 dark:text-zinc-400">
                Modifications non enregistrées ({changees.map(nomRubrique).join(", ")})
              </span>
              <Bouton onClick={() => setBrouillon(reference)} disabled={enregistrement}>Annuler les modifications</Bouton>
              <Bouton variante="principal" onClick={enregistrer} disabled={enregistrement || occupe}>
                {enregistrement ? "Vérification…" : "Enregistrer"}
              </Bouton>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

const nomRubrique = (r) =>
  ({ sources: "sources", types_veille: "thèmes", etiquettes: "étiquettes", alertes: "alertes", seuil: "fiabilité", ignorer: "mots ignorés", planification: "collecte automatique" })[r];

function Bloc({ titre, description, action, children }) {
  return (
    <div>
      <div className="mb-3 flex flex-wrap items-start gap-3">
        <div className="mr-auto max-w-[65ch]">
          <h3 className="text-sm font-semibold">{titre}</h3>
          {description && <p className="mt-0.5 text-[13px] text-zinc-600 dark:text-zinc-400">{description}</p>}
        </div>
        {action}
      </div>
      {children}
    </div>
  );
}

function Champ({ libelle, aide, erreur, children }) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-[13px] font-medium text-zinc-700 dark:text-zinc-300">{libelle}</span>
      {children}
      {aide && !erreur && <span className="text-xs text-zinc-500 dark:text-zinc-400">{aide}</span>}
      {erreur && <span className="text-xs text-red-700 dark:text-red-400">{erreur}</span>}
    </label>
  );
}

// Une liste de mots tapée séparée par des virgules ; validée en quittant le champ (pour ne pas gêner la frappe).
function ChampMots({ valeur, onChange, libelle }) {
  const [texte, setTexte] = useState((valeur ?? []).join(", "));
  useEffect(() => setTexte((valeur ?? []).join(", ")), [valeur]);
  return (
    <input
      aria-label={libelle}
      value={texte}
      onChange={(e) => setTexte(e.target.value)}
      onBlur={() => onChange(versMots(texte))}
      placeholder="mot, autre mot, …"
      className={`h-9 w-full px-2.5 ${classeChamp}`}
    />
  );
}

function EditeurSources({ sources, setSources, types, meta }) {
  const [edition, setEdition] = useState(null); // { index | null pour un ajout, source }
  const [aSupprimer, setASupprimer] = useState(null);
  const etat = (s) => meta?.sources?.find((m) => m.nom === libelleSource(s))?.etat;
  const parFamille = new Map();
  sources.forEach((s, index) => {
    const f = s.famille ?? s.type;
    parFamille.set(f, [...(parFamille.get(f) ?? []), { s, index }]);
  });
  const familles = [...parFamille].sort((a, b) => a[0].localeCompare(b[0], "fr"));

  return (
    <Bloc
      titre={`Sources (${sources.length})`}
      description="Ce que RADAR surveille. L'état indique le résultat de la dernière collecte."
      action={<Bouton variante="principal" taille="petite" icone={<Plus size={14} />} onClick={() => setEdition({ index: null, source: { type: "flux" } })}>Ajouter une source</Bouton>}
    >
      <div className="divide-y divide-zinc-200 rounded-lg border border-zinc-200 bg-white dark:divide-zinc-800 dark:border-zinc-800 dark:bg-zinc-900">
        {familles.map(([famille, liste]) => (
          <details key={famille} className="group" open={liste.some(({ s }) => etat(s) && !etat(s).ok) || undefined}>
            <summary className="flex cursor-pointer list-none items-center gap-3 px-4 py-3 text-sm hover:bg-zinc-50 dark:hover:bg-zinc-800/50">
              <span className="font-medium first-letter:uppercase">{famille}</span>
              <span className="text-zinc-500 dark:text-zinc-400">{liste.length}</span>
              {liste.some(({ s }) => etat(s) && !etat(s).ok) && <span className="text-red-700 dark:text-red-400">échec</span>}
              <span className="ml-auto text-xs text-zinc-500 group-open:hidden">Voir</span>
              <span className="ml-auto hidden text-xs text-zinc-500 group-open:inline">Masquer</span>
            </summary>
            <ul className="border-t border-zinc-100 dark:border-zinc-800">
              {liste.map(({ s, index }) => (
                <li key={index} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2.5 text-sm">
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-medium">{libelleSource(s)}</div>
                    <div className="truncate text-[13px] text-zinc-500 dark:text-zinc-400">
                      {TYPES_SOURCE[s.type] ?? s.type} · {cibleSource(s)}
                    </div>
                  </div>
                  <Etat etat={etat(s)} />
                  {aSupprimer === index ? (
                    <span className="flex items-center gap-2 text-[13px]">
                      Supprimer ?
                      <Bouton taille="petite" onClick={() => setASupprimer(null)}>Non</Bouton>
                      <Bouton
                        taille="petite"
                        className="bg-red-700 text-white hover:bg-red-800"
                        variante="discret"
                        onClick={() => {
                          setSources(sources.filter((_, i) => i !== index));
                          setASupprimer(null);
                        }}
                      >
                        Oui
                      </Bouton>
                    </span>
                  ) : (
                    <span className="flex items-center gap-1">
                      <Bouton taille="petite" variante="discret" icone={<PencilSimple size={14} />} onClick={() => setEdition({ index, source: s })} aria-label={`Modifier ${libelleSource(s)}`}>
                        <span className="hidden sm:inline">Modifier</span>
                      </Bouton>
                      <Bouton taille="petite" variante="discret" icone={<Trash size={14} />} onClick={() => setASupprimer(index)} aria-label={`Supprimer ${libelleSource(s)}`} />
                    </span>
                  )}
                </li>
              ))}
            </ul>
          </details>
        ))}
      </div>
      {edition && (
        <FormulaireSource
          initiale={edition.source}
          types={types}
          familles={[...parFamille.keys()]}
          autresNoms={sources.filter((_, i) => i !== edition.index).map(libelleSource)}
          onAnnuler={() => setEdition(null)}
          onValider={(source) => {
            setSources(edition.index === null ? [...sources, source] : sources.map((s, i) => (i === edition.index ? source : s)));
            setEdition(null);
          }}
        />
      )}
    </Bloc>
  );
}

function Etat({ etat }) {
  if (!etat) return <span className="text-[13px] text-zinc-500">pas encore collectée</span>;
  if (!etat.ok)
    return (
      <span className="inline-flex items-center gap-1 text-[13px] text-red-700 dark:text-red-400" title={etat.erreur}>
        <WarningCircle size={14} /> échec
      </span>
    );
  return (
    <span className="inline-flex items-center gap-1 text-[13px] text-zinc-500 dark:text-zinc-400">
      <CheckCircle size={14} className="text-emerald-700 dark:text-emerald-400" /> {etat.trouvees} trouvée{etat.trouvees > 1 ? "s" : ""}
    </span>
  );
}

function FormulaireSource({ initiale, types, familles, autresNoms, onAnnuler, onValider }) {
  const [s, setS] = useState(initiale);
  const [erreurs, setErreurs] = useState({});
  const def = CHAMPS_TYPE[s.type];
  const changer = (cle, valeur) => setS({ ...s, [cle]: valeur });

  function valider(e) {
    e.preventDefault();
    const err = {};
    for (const [cle, libelle, , obligatoire] of def.champs) {
      if (obligatoire && !String(s[cle] ?? "").trim()) err[cle] = `${libelle} : obligatoire.`;
    }
    if (s.type === "hackernews" && !s.une && !String(s.requete ?? "").trim()) err.requete = "Indiquez des mots, ou cochez « Seulement la page d'accueil ».";
    if (["flux", "page"].includes(s.type) && s.url && !/^https?:\/\//.test(s.url)) err.url = "L'adresse doit commencer par https:// (ou http://).";
    if (["releases", "depot"].includes(s.type) && s.depot && !/^[\w.-]+\/[\w.-]+$/.test(s.depot)) err.depot = "Format attendu : propriétaire/nom, ex. openai/codex.";
    const nom = libelleSource({ ...s, nom: s.nom?.trim() || undefined });
    if (autresNoms.includes(nom)) err.nom = `Une autre source s'appelle déjà « ${nom} ».`;
    setErreurs(err);
    if (Object.keys(err).length) return;
    // On garde les champs inconnus du formulaire (ex. vend_produit) et on retire les champs vides.
    const propre = Object.fromEntries(Object.entries(s).filter(([k, v]) => k === "__origine" || (v !== "" && v != null && v !== false)));
    onValider(propre);
  }

  return (
    <Fenetre titre={initiale.type && Object.keys(initiale).length > 1 ? "Modifier la source" : "Ajouter une source"} onFermer={onAnnuler}>
      <form onSubmit={valider} className="space-y-4">
        <Champ libelle="Type de source" aide={def.aide}>
          <select value={s.type} onChange={(e) => setS({ ...s, type: e.target.value })} className={`h-9 px-2 ${classeChamp}`}>
            {Object.entries(TYPES_SOURCE).map(([t, texte]) => (
              <option key={t} value={t}>{texte}</option>
            ))}
          </select>
        </Champ>
        {def.champs.map(([cle, libelle, indice, , genre]) =>
          genre === "case" ? (
            <label key={cle} className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={Boolean(s[cle])} onChange={(e) => changer(cle, e.target.checked)} className="size-4 accent-emerald-700" />
              {libelle}
            </label>
          ) : (
            <Champ key={cle} libelle={libelle} erreur={erreurs[cle]}>
              {genre === "ecosysteme" ? (
                <select value={s[cle] ?? ""} onChange={(e) => changer(cle, e.target.value)} className={`h-9 px-2 ${classeChamp}`}>
                  <option value="">Choisir…</option>
                  {ECOSYSTEMES.map((x) => <option key={x}>{x}</option>)}
                </select>
              ) : (
                <input
                  type={genre === "nombre" ? "number" : "text"}
                  value={s[cle] ?? ""}
                  onChange={(e) => changer(cle, genre === "nombre" ? (e.target.value === "" ? "" : Number(e.target.value)) : e.target.value)}
                  placeholder={indice}
                  className={`h-9 px-2.5 ${classeChamp}`}
                />
              )}
            </Champ>
          )
        )}
        <Champ libelle="Nom affiché" aide={`Facultatif. Sans nom : « ${libelleSource({ ...s, nom: undefined })} ».`} erreur={erreurs.nom}>
          <input value={s.nom ?? ""} onChange={(e) => changer("nom", e.target.value)} placeholder="ex. Blog OpenAI" className={`h-9 px-2.5 ${classeChamp}`} />
        </Champ>
        <div className="grid gap-4 sm:grid-cols-2">
          <Champ libelle="Famille" aide="Sert à filtrer le fil (blog, presse…).">
            <input list="familles-connues" value={s.famille ?? ""} onChange={(e) => changer("famille", e.target.value)} placeholder={s.type} className={`h-9 px-2.5 ${classeChamp}`} />
            <datalist id="familles-connues">{familles.map((f) => <option key={f} value={f} />)}</datalist>
          </Champ>
          <Champ libelle="Catégorie" aide="Donne les points de fiabilité.">
            <select value={s.categorie ?? ""} onChange={(e) => changer("categorie", e.target.value)} className={`h-9 px-2 ${classeChamp}`}>
              <option value="">Aucune</option>
              {CATEGORIES.map(([v, t]) => <option key={v} value={v}>{t}</option>)}
            </select>
          </Champ>
          <Champ libelle="Thème imposé" aide="Sinon, deviné d'après les mots des thèmes.">
            <select value={s.type_veille ?? ""} onChange={(e) => changer("type_veille", e.target.value)} className={`h-9 px-2 ${classeChamp}`}>
              <option value="">Deviner</option>
              {types.map((t) => <option key={t.nom} value={t.nom}>{t.nom}</option>)}
            </select>
          </Champ>
          {!["depot", "npm", "page"].includes(s.type) && (
            <Champ libelle="Infos par collecte" aide="10 par défaut.">
              <input type="number" min="1" value={s.limite ?? ""} onChange={(e) => changer("limite", e.target.value === "" ? "" : Number(e.target.value))} placeholder="10" className={`h-9 px-2.5 ${classeChamp}`} />
            </Champ>
          )}
        </div>
        <div className="flex justify-end gap-2 border-t border-zinc-200 pt-4 dark:border-zinc-800">
          <Bouton onClick={onAnnuler}>Annuler</Bouton>
          <Bouton type="submit" variante="principal">Valider</Bouton>
        </div>
        <p className="text-xs text-zinc-500 dark:text-zinc-400">« Valider » prépare la modification ; elle est écrite dans le fichier avec « Enregistrer », en bas de la page.</p>
      </form>
    </Fenetre>
  );
}

function EditeurMots({ titre, description, liste, setListe, ordonne }) {
  const deplacer = (i, d) => {
    const copie = [...liste];
    [copie[i], copie[i + d]] = [copie[i + d], copie[i]];
    setListe(copie);
  };
  return (
    <Bloc titre={titre} description={description} action={<Bouton taille="petite" icone={<Plus size={14} />} onClick={() => setListe([...liste, { nom: "", mots: [] }])}>Ajouter</Bouton>}>
      <ul className="space-y-2">
        {liste.map((e, i) => (
          <li key={i} className="grid grid-cols-[minmax(0,9rem)_minmax(0,1fr)_auto] items-center gap-2">
            <input aria-label={`Nom (${titre})`} value={e.nom} onChange={(ev) => setListe(liste.map((x, j) => (j === i ? { ...x, nom: ev.target.value } : x)))} placeholder="nom" className={`h-9 px-2.5 font-medium ${classeChamp}`} />
            <ChampMots libelle={`Mots de ${e.nom || "ce thème"}`} valeur={e.mots} onChange={(mots) => setListe(liste.map((x, j) => (j === i ? { ...x, mots } : x)))} />
            <span className="flex">
              {ordonne && (
                <>
                  <Bouton taille="petite" variante="discret" className="px-1.5" disabled={i === 0} onClick={() => deplacer(i, -1)} aria-label="Monter" icone={<ArrowUp size={14} />} />
                  <Bouton taille="petite" variante="discret" className="px-1.5" disabled={i === liste.length - 1} onClick={() => deplacer(i, 1)} aria-label="Descendre" icone={<ArrowDown size={14} />} />
                </>
              )}
              <Bouton taille="petite" variante="discret" className="px-1.5" onClick={() => setListe(liste.filter((_, j) => j !== i))} aria-label={`Supprimer ${e.nom}`} icone={<Trash size={14} />} />
            </span>
          </li>
        ))}
      </ul>
    </Bloc>
  );
}

function Alertes({ alertes, setAlertes }) {
  return (
    <Bloc titre="Alertes" description="Une nouvelle info déclenche une alerte si elle contient un de ces mots, ou si elle vient d'un des types de source cochés.">
      <div className="space-y-4">
        <Champ libelle="Mots qui déclenchent une alerte">
          <ChampMots valeur={alertes.mots} onChange={(mots) => setAlertes({ ...alertes, mots })} libelle="Mots qui déclenchent une alerte" />
        </Champ>
        <fieldset>
          <legend className="mb-2 text-[13px] font-medium text-zinc-700 dark:text-zinc-300">Toute nouvelle info de ces types déclenche une alerte</legend>
          <div className="flex flex-wrap gap-x-5 gap-y-2">
            {Object.entries(TYPES_SOURCE).map(([t, texte]) => (
              <label key={t} className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={(alertes.sources ?? []).includes(t)}
                  onChange={(e) => setAlertes({ ...alertes, sources: e.target.checked ? [...(alertes.sources ?? []), t] : alertes.sources.filter((x) => x !== t) })}
                  className="size-4 accent-emerald-700"
                />
                {texte}
              </label>
            ))}
          </div>
        </fieldset>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={Boolean(alertes.notification)} onChange={(e) => setAlertes({ ...alertes, notification: e.target.checked })} className="size-4 accent-emerald-700" />
          Notification Windows en plus de l'interface
        </label>
      </div>
    </Bloc>
  );
}
