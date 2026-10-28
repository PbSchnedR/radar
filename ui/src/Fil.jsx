// Le fil : les infos comme une boîte de réception. À lire → (lu) → Archivées. Les alertes à part.
import { useEffect, useMemo, useRef, useState } from "react";
import { Archive, ArrowCounterClockwise, ArrowSquareOut, Bell, CaretLeft, CaretRight, MagnifyingGlass, Plus, X } from "@phosphor-icons/react";
import { Bouton, EtatVide, FiltreMultiple, Segments, Squelette, classeChamp } from "./ui.jsx";
import { alerteNonVue, libelleJour, normaliser, toutesEtiquettes } from "./lib.js";

const PAR_PAGE = 60;
const FILTRES_VIDES = { themes: [], familles: [], sources: [], etiquettes: [] };

export default function Fil({ items, meta, onModifier, onAlertesVues, onActualiser, occupe }) {
  const [vue, setVue] = useState("alire");
  const [recherche, setRecherche] = useState("");
  // Plusieurs valeurs par filtre : « ou » à l'intérieur d'un filtre, « et » entre les filtres.
  const [filtres, setFiltres] = useState(FILTRES_VIDES);
  const { themes, familles, sources, etiquettes } = filtres;
  const changerFiltre = (cle) => (valeurs) => setFiltres((f) => ({ ...f, [cle]: valeurs }));
  const [peuFiables, setPeuFiables] = useState(false);
  const [tri, setTri] = useState("date");
  const [selection, setSelection] = useState(null); // url de l'info affichée dans le panneau
  const [limite, setLimite] = useState(PAR_PAGE);
  const champRecherche = useRef(null);

  // « / » place le curseur dans la recherche, Échap la vide (raccourcis des habitués).
  useEffect(() => {
    const touche = (e) => {
      const dansUnChamp = ["INPUT", "TEXTAREA", "SELECT"].includes(document.activeElement?.tagName);
      if (e.key === "/" && !dansUnChamp) {
        e.preventDefault();
        champRecherche.current?.focus();
      }
      if (e.key === "Escape" && document.activeElement === champRecherche.current) setRecherche("");
    };
    addEventListener("keydown", touche);
    return () => removeEventListener("keydown", touche);
  }, []);

  useEffect(() => setLimite(PAR_PAGE), [vue, recherche, filtres, peuFiables, tri]);

  const liste = items ?? [];
  const actives = liste.filter((i) => !i.archivee_le);
  const compte = {
    alire: actives.filter((i) => i.statut !== "ecartee").length,
    alertes: actives.filter(alerteNonVue).length,
    archivees: liste.length - actives.length,
  };
  const masquees = vue === "alire" ? actives.filter((i) => i.statut === "ecartee").length : 0;

  // Les infos de l'onglet courant, avant les filtres : sert aussi à remplir les listes de filtres.
  const perimetre = useMemo(() => {
    if (vue === "archivees") return liste.filter((i) => i.archivee_le);
    if (vue === "alertes") return liste.filter((i) => !i.archivee_le && alerteNonVue(i));
    return liste.filter((i) => !i.archivee_le && (peuFiables || i.statut !== "ecartee"));
  }, [liste, vue, peuFiables]);

  const options = useMemo(() => {
    const compter = (valeurs) => {
      const c = new Map();
      for (const i of perimetre) for (const v of valeurs(i)) if (v) c.set(v, (c.get(v) ?? 0) + 1);
      return [...c].sort((a, b) => a[0].localeCompare(b[0], "fr"));
    };
    return {
      themes: compter((i) => [i.type_veille]),
      familles: compter((i) => [i.famille]),
      // Les sources proposées suivent les familles choisies.
      sources: compter((i) => (!familles.length || familles.includes(i.famille) ? [i.source] : [])),
      etiquettes: compter(toutesEtiquettes),
    };
  }, [perimetre, familles]);

  const visibles = useMemo(() => {
    const q = normaliser(recherche.trim());
    return perimetre
      .filter((i) => !themes.length || themes.includes(i.type_veille))
      .filter((i) => !familles.length || familles.includes(i.famille))
      .filter((i) => !sources.length || sources.includes(i.source))
      .filter((i) => !etiquettes.length || toutesEtiquettes(i).some((e) => etiquettes.includes(e)))
      .filter((i) => !q || normaliser([i.titre, i.source, i.type_veille, i.extrait, ...toutesEtiquettes(i)].join(" ")).includes(q))
      .sort((a, b) => (tri === "fiabilite" ? (b.fiabilite ?? -99) - (a.fiabilite ?? -99) : 0) || b.publie_le.localeCompare(a.publie_le));
  }, [perimetre, recherche, themes, familles, sources, etiquettes, tri]);

  if (!items) return <Squelette />;
  if (items.length === 0) {
    return (
      <EtatVide
        titre="Aucune info pour l'instant"
        texte="« Actualiser » interroge toutes les sources de vos réglages et range les infos ici."
        action={<Bouton variante="principal" onClick={onActualiser} disabled={occupe}>Actualiser</Bouton>}
      />
    );
  }

  const filtresActifs = Boolean(recherche || Object.values(filtres).some((v) => v.length));
  const reinitialiser = () => {
    setRecherche("");
    setFiltres(FILTRES_VIDES);
  };
  const affichees = visibles.slice(0, limite);
  const groupes = tri === "date" ? grouperParJour(affichees) : [{ jour: "", une: null, autres: affichees }];
  // L'ordre de lecture du panneau = l'ordre affiché (la une d'abord dans chaque jour).
  const ordre = groupes.flatMap((g) => (g.une ? [g.une, ...g.autres] : g.autres));

  return (
    <div className="w-full">
      <div className="relative">
        <MagnifyingGlass size={18} className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-zinc-500" />
        <label htmlFor="recherche" className="sr-only">Rechercher</label>
        <input
          id="recherche"
          ref={champRecherche}
          value={recherche}
          onChange={(e) => setRecherche(e.target.value)}
          placeholder="Rechercher un titre, une source, une étiquette…"
          className={`h-11 w-full pr-12 pl-10 text-[15px] ${classeChamp}`}
        />
        <kbd className="pointer-events-none absolute top-1/2 right-3 hidden -translate-y-1/2 rounded border border-zinc-300 px-1.5 font-mono text-xs text-zinc-500 sm:block dark:border-zinc-700">/</kbd>
      </div>

      <div className="mt-5 flex flex-wrap items-center gap-3">
        <Segments
          libelle="Boîte"
          valeur={vue}
          onChange={(v) => {
            setVue(v);
            setSelection(null);
          }}
          options={[
            { v: "alire", texte: "À lire", n: compte.alire },
            { v: "alertes", texte: "Alertes", n: compte.alertes, accent: true },
            { v: "archivees", texte: "Archivées", n: compte.archivees },
          ]}
        />
        {vue === "alertes" && compte.alertes > 0 && (
          <Bouton taille="petite" variante="discret" onClick={onAlertesVues}>Tout marquer comme vu</Bouton>
        )}
      </div>

      <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <FiltreMultiple libelle="Thème" valeurs={themes} onChange={changerFiltre("themes")} options={options.themes} tous="Tous" />
        <FiltreMultiple libelle="Famille de source" valeurs={familles} onChange={changerFiltre("familles")} options={options.familles} tous="Toutes" />
        <FiltreMultiple libelle="Source" valeurs={sources} onChange={changerFiltre("sources")} options={options.sources} tous="Toutes" />
        <FiltreMultiple libelle="Étiquette" valeurs={etiquettes} onChange={changerFiltre("etiquettes")} options={options.etiquettes} tous="Toutes" />
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-zinc-200 pb-3 text-sm text-zinc-600 dark:border-zinc-800 dark:text-zinc-400">
        <span>
          <span className="font-medium text-zinc-900 dark:text-zinc-100">{visibles.length}</span> info{visibles.length > 1 ? "s" : ""}
        </span>
        {filtresActifs && (
          <button onClick={reinitialiser} className="underline underline-offset-2 hover:text-zinc-900 dark:hover:text-zinc-100">
            Effacer les filtres
          </button>
        )}
        {vue === "alire" && (masquees > 0 || peuFiables) && (
          <label className="inline-flex cursor-pointer items-center gap-2">
            <input type="checkbox" checked={peuFiables} onChange={(e) => setPeuFiables(e.target.checked)} className="size-4 accent-emerald-700" />
            Montrer les peu fiables ({masquees})
          </label>
        )}
        <label className="ml-auto inline-flex items-center gap-2">
          Trier par
          <select value={tri} onChange={(e) => setTri(e.target.value)} className={`h-8 px-2 ${classeChamp}`}>
            <option value="date">date</option>
            <option value="fiabilite">fiabilité</option>
          </select>
        </label>
      </div>

      {visibles.length === 0 ? (
        <EtatVide
          titre={vue === "alertes" ? "Aucune alerte" : vue === "archivees" ? "Rien d'archivé" : "Aucune info ne correspond"}
          texte={
            vue === "alertes"
              ? "Une alerte apparaît quand une nouvelle info contient un mot surveillé (réglages, rubrique « alertes »)."
              : vue === "archivees"
                ? "Archivez une info une fois lue : elle quitte « À lire » et reste retrouvable ici."
                : filtresActifs
                  ? "Essayez d'élargir la recherche ou d'effacer les filtres."
                  : "Toutes les infos fiables ont été archivées."
          }
          action={filtresActifs && <Bouton onClick={reinitialiser}>Effacer les filtres</Bouton>}
        />
      ) : (
        <>
          {groupes.map(({ jour, une, autres }) => (
            <section key={jour || "tout"} aria-label={jour ? libelleJour(jour) : undefined} className="pt-8 first:pt-6">
              {jour && (
                <h2 className="sticky top-14 z-10 -mx-1 mb-4 flex items-baseline gap-3 bg-zinc-50/95 px-1 py-2 backdrop-blur">
                  <span className="text-lg font-semibold tracking-tight first-letter:uppercase">{libelleJour(jour)}</span>
                  <span className="text-[13px] text-zinc-500">
                    {autres.length + (une ? 1 : 0)} info{autres.length + (une ? 1 : 0) > 1 ? "s" : ""}
                  </span>
                </h2>
              )}
              <ul className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
                {une && <Carte item={une} une onOuvrir={() => setSelection(une.url)} onModifier={onModifier} />}
                {autres.map((i) => (
                  <Carte key={i.url} item={i} onOuvrir={() => setSelection(i.url)} onModifier={onModifier} />
                ))}
              </ul>
            </section>
          ))}
          {visibles.length > limite && (
            <div className="flex justify-center py-8">
              <Bouton onClick={() => setLimite(limite + PAR_PAGE)}>
                Afficher {Math.min(PAR_PAGE, visibles.length - limite)} de plus ({visibles.length - limite} restantes)
              </Bouton>
            </div>
          )}
        </>
      )}

      {selection && (
        <Panneau
          url={selection}
          items={liste}
          ordre={ordre}
          seuil={meta?.seuil}
          etiquettesConnues={meta?.etiquettes ?? []}
          onAller={setSelection}
          onFermer={() => setSelection(null)}
          onModifier={onModifier}
        />
      )}
    </div>
  );
}

// Les infos par jour ; dans chaque jour, la plus fiable « à la une » (jamais une simple mesure d'étoiles ou de téléchargements).
function grouperParJour(infos) {
  const parJour = new Map();
  for (const i of infos) parJour.set(i.publie_le, [...(parJour.get(i.publie_le) ?? []), i]);
  return [...parJour].map(([jour, liste]) => {
    const candidates = liste.filter((i) => !i.mesures);
    const une = liste.length > 2 && candidates.length ? candidates.reduce((m, i) => ((i.fiabilite ?? -99) > (m.fiabilite ?? -99) ? i : m)) : null;
    return { jour, une, autres: liste.filter((i) => i !== une) };
  });
}

// L'extrait lisible : sans la syntaxe markdown des notes de version (##, *, `, « What's changed »).
function extraitPropre(texte) {
  return String(texte ?? "")
    .replace(/#{1,6}\s*/g, "")
    .replace(/^(What's changed|New Features|Release [\w.-]+)\s*-?\s*/i, "")
    .replace(/[*`_]/g, "")
    .replace(/\s+-\s+/g, " · ")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1") // lien markdown [texte](adresse) → texte
    // Une adresse complète est illisible dans un extrait : on n'en garde que le site (« Lien : https://github.com/x » → « github.com »).
    .replace(/Lien\s*:\s*/g, "")
    .replace(/https?:\/\/(?:www\.)?([^/\s]+)\S*?(?=[.,;)]{0,2}(?:\s|$))/g, "$1")
    .replace(/\b([01]) points\b/g, "$1 point")
    .replace(/\b([01]) commentaires\b/g, "$1 commentaire")
    .trim();
}

// Le favicon du site de l'info (via DuckDuckGo) ; à défaut, l'initiale de la source.
function Favicon({ url, nom, grand }) {
  const [echec, setEchec] = useState(false);
  let hote = "";
  try {
    hote = new URL(url).hostname;
  } catch {
    /* url illisible : initiale */
  }
  const taille = grand ? "size-7" : "size-5";
  if (echec || !hote) {
    return (
      <span aria-hidden="true" className={`${taille} inline-flex shrink-0 items-center justify-center rounded bg-zinc-200 text-[11px] font-semibold text-zinc-600 uppercase`}>
        {nom?.[0] ?? "?"}
      </span>
    );
  }
  return <img src={`https://icons.duckduckgo.com/ip3/${hote}.ico`} alt="" loading="lazy" onError={() => setEchec(true)} className={`${taille} shrink-0 rounded`} />;
}

// Une carte : source, titre, extrait, thème. Un clic ouvre le panneau de lecture ; les actions n'apparaissent qu'au survol.
function Carte({ item, une, onOuvrir, onModifier }) {
  const extrait = extraitPropre(item.extrait);
  const etiquettes = toutesEtiquettes(item);
  return (
    <li className={`group relative flex min-w-0 flex-col rounded-xl bg-white p-5 ring-1 ring-zinc-200 transition hover:shadow-md hover:ring-zinc-300 ${une ? "sm:p-6 md:col-span-2" : ""}`}>
      <div className="flex items-center gap-2">
        <Favicon url={item.url} nom={item.source} />
        <span className="min-w-0 truncate text-[13px] font-medium text-zinc-600">{item.source}</span>
        {une && <span className="shrink-0 text-[13px] font-semibold text-emerald-700">À la une</span>}
        {/* Au-dessus du bouton qui couvre la carte (z-10) ; visibles au survol ou au clavier, toujours sur écran tactile. */}
        <div className="relative z-10 ml-auto flex shrink-0 items-center gap-0.5 transition-opacity md:opacity-0 md:group-focus-within:opacity-100 md:group-hover:opacity-100">
          <a
            href={item.url}
            target="_blank"
            rel="noreferrer"
            title="Ouvrir la source dans un nouvel onglet"
            aria-label={`Ouvrir la source : ${item.titre}`}
            className="inline-flex size-8 items-center justify-center rounded-lg text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900"
          >
            <ArrowSquareOut size={16} />
          </a>
          <Bouton
            taille="petite"
            variante="discret"
            className="size-8 px-0"
            onClick={() => onModifier(item, { archivee: !item.archivee_le })}
            title={item.archivee_le ? "Remettre dans « À lire »" : "Archiver (une fois lue)"}
            aria-label={item.archivee_le ? `Désarchiver : ${item.titre}` : `Archiver : ${item.titre}`}
            icone={item.archivee_le ? <ArrowCounterClockwise size={16} /> : <Archive size={16} />}
          />
        </div>
      </div>

      {alerteNonVue(item) && (
        <div className="mt-3 inline-flex items-center gap-1.5 self-start rounded-md bg-amber-50 px-2 py-1 text-xs font-medium text-amber-800 ring-1 ring-amber-200">
          <Bell size={12} weight="fill" /> Alerte : {item.alerte}
        </div>
      )}

      {/* Le titre est le bouton de la carte : son « after » couvre toute la carte (clic partout, une seule cible au clavier). */}
      <h3 className={`mt-3 text-zinc-900 [overflow-wrap:anywhere] ${une ? "text-2xl leading-tight font-semibold tracking-tight" : "line-clamp-3 text-base leading-snug font-semibold"}`}>
        <button
          onClick={onOuvrir}
          className="text-left after:absolute after:inset-0 after:rounded-xl after:content-[''] focus-visible:outline-none focus-visible:after:ring-2 focus-visible:after:ring-emerald-600"
        >
          {item.titre}
        </button>
      </h3>

      {extrait && <p className={`mt-2 text-sm leading-relaxed text-zinc-600 ${une ? "line-clamp-4 max-w-[75ch] text-[15px]" : "line-clamp-3"}`}>{extrait}</p>}

      <div className="mt-auto flex flex-wrap items-center gap-x-2 gap-y-1.5 pt-4 text-xs">
        {item.type_veille && <span className="rounded-md bg-zinc-100 px-2 py-0.5 font-medium text-zinc-700">{item.type_veille}</span>}
        {etiquettes.slice(0, 4).map((e) => (
          <span key={e} className="text-zinc-500">#{e}</span>
        ))}
        {item.statut === "ecartee" && (
          <span className="ml-auto text-zinc-500" title={`Score ${item.fiabilite}, sous le seuil`}>
            peu fiable
          </span>
        )}
      </div>
    </li>
  );
}

// Le panneau de lecture : tout sur une info, et Précédente / Suivante (← →) pour enchaîner sans revenir à la liste.
function Panneau({ url, items, ordre, seuil, etiquettesConnues, onAller, onFermer, onModifier }) {
  const item = items.find((i) => i.url === url);
  const position = ordre.findIndex((i) => i.url === url);
  const precedente = position > 0 ? ordre[position - 1] : null;
  const suivante = position >= 0 && position < ordre.length - 1 ? ordre[position + 1] : null;
  const titre = useRef(null);

  useEffect(() => {
    titre.current?.focus();
  }, [url]);

  useEffect(() => {
    const touche = (e) => {
      if (["INPUT", "TEXTAREA", "SELECT"].includes(document.activeElement?.tagName)) return;
      if (e.key === "Escape") onFermer();
      if (e.key === "ArrowLeft" && precedente) onAller(precedente.url);
      if (e.key === "ArrowRight" && suivante) onAller(suivante.url);
    };
    addEventListener("keydown", touche);
    return () => removeEventListener("keydown", touche);
  }, [precedente, suivante, onAller, onFermer]);

  if (!item) return null;
  const fiable = item.statut === "retenue";

  // Archiver depuis le panneau passe à l'info suivante : on lit, on range, on continue.
  const archiver = () => {
    onModifier(item, { archivee: !item.archivee_le });
    if (!item.archivee_le) {
      if (suivante) onAller(suivante.url);
      else onFermer();
    }
  };

  return (
    <div className="fixed inset-0 z-40" role="dialog" aria-modal="true" aria-label={item.titre}>
      <div className="absolute inset-0 bg-zinc-900/20" onClick={onFermer} />
      <aside className="absolute inset-y-0 right-0 flex w-full max-w-xl flex-col bg-white shadow-2xl">
        <div className="flex items-center gap-1 border-b border-zinc-200 px-4 py-2.5">
          <Bouton taille="petite" variante="discret" disabled={!precedente} onClick={() => onAller(precedente.url)} icone={<CaretLeft size={14} />} title="Info précédente (←)">
            Précédente
          </Bouton>
          <Bouton taille="petite" variante="discret" disabled={!suivante} onClick={() => onAller(suivante.url)} title="Info suivante (→)">
            Suivante <CaretRight size={14} />
          </Bouton>
          {position >= 0 && (
            <span className="ml-2 text-xs text-zinc-500">
              {position + 1} / {ordre.length}
            </span>
          )}
          <button onClick={onFermer} aria-label="Fermer (Échap)" className="ml-auto rounded-lg p-1.5 text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900">
            <X size={18} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-6">
          <div className="flex items-center gap-2.5">
            <Favicon url={item.url} nom={item.source} grand />
            <div className="min-w-0">
              <div className="truncate text-sm font-medium text-zinc-800">{item.source}</div>
              <div className="text-xs text-zinc-500">
                Publiée le {new Date(`${item.publie_le}T12:00:00`).toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" })}
              </div>
            </div>
          </div>
          <h2 ref={titre} tabIndex={-1} className="mt-5 [overflow-wrap:anywhere] text-2xl leading-tight font-semibold tracking-tight text-zinc-900 outline-none">
            {item.titre}
          </h2>
          {alerteNonVue(item) && (
            <div className="mt-3 inline-flex items-center gap-1.5 rounded-md bg-amber-50 px-2 py-1 text-xs font-medium text-amber-800 ring-1 ring-amber-200">
              <Bell size={12} weight="fill" /> Alerte : {item.alerte}
            </div>
          )}
          <div className="mt-5 flex flex-wrap gap-2">
            <a href={item.url} target="_blank" rel="noreferrer" className="inline-flex h-9 items-center gap-2 rounded-lg bg-emerald-700 px-3.5 text-sm font-medium text-white hover:bg-emerald-800">
              Ouvrir la source <ArrowSquareOut size={15} />
            </a>
            <Bouton onClick={archiver} icone={item.archivee_le ? <ArrowCounterClockwise size={15} /> : <Archive size={15} />}>
              {item.archivee_le ? "Désarchiver" : "Archiver et passer à la suivante"}
            </Bouton>
          </div>

          <p className="mt-6 text-[15px] leading-relaxed text-zinc-700">{extraitPropre(item.extrait) || "Pas d'extrait pour cette info."}</p>

          <dl className="mt-6 grid grid-cols-[8rem_1fr] gap-x-4 gap-y-2 border-t border-zinc-200 pt-5 text-sm">
            <dt className="text-zinc-500">Thème</dt>
            <dd className="text-zinc-800">{item.type_veille ?? "aucun"}</dd>
            <dt className="text-zinc-500">Famille</dt>
            <dd className="text-zinc-800">{item.famille ?? "aucune"}</dd>
            <dt className="text-zinc-500">Fiabilité</dt>
            <dd className="text-zinc-800">
              <span className={fiable ? "font-medium text-emerald-700" : ""}>{fiable ? "fiable" : "peu fiable"}</span> (score {item.fiabilite ?? "?"}, seuil {seuil ?? "?"})
            </dd>
            <dt className="text-zinc-500">Auteur</dt>
            <dd className="text-zinc-800">{item.auteur || "inconnu"}</dd>
            {item.archivee_le && (
              <>
                <dt className="text-zinc-500">Archivée le</dt>
                <dd className="text-zinc-800">{item.archivee_le}</dd>
              </>
            )}
          </dl>

          <EtiquettesPerso item={item} onModifier={onModifier} etiquettesConnues={etiquettesConnues} />
        </div>
      </aside>
    </div>
  );
}

function EtiquettesPerso({ item, onModifier, etiquettesConnues }) {
  const [saisie, setSaisie] = useState("");
  const perso = item.etiquettes_perso ?? [];
  const deja = toutesEtiquettes(item);

  function ajouter(e) {
    e.preventDefault();
    const nouvelle = saisie.trim().toLowerCase();
    setSaisie("");
    if (nouvelle && !deja.includes(nouvelle)) onModifier(item, { etiquettes_perso: [...perso, nouvelle] }, { silencieux: true });
  }

  return (
    <div className="mt-6 border-t border-zinc-200 pt-5">
      <div className="mb-2 text-sm font-medium text-zinc-800">Mes étiquettes</div>
      <div className="flex flex-wrap items-center gap-1.5">
        {perso.map((e) => (
          <span key={e} className="inline-flex h-7 items-center gap-1 rounded-md bg-white pr-1 pl-2 text-xs text-zinc-700 ring-1 ring-zinc-300">
            {e}
            <button
              onClick={() => onModifier(item, { etiquettes_perso: perso.filter((x) => x !== e) }, { silencieux: true })}
              aria-label={`Retirer l'étiquette ${e}`}
              className="rounded p-0.5 text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900"
            >
              <X size={12} />
            </button>
          </span>
        ))}
        <form onSubmit={ajouter} className="flex items-center gap-1.5">
          <label htmlFor="saisie-etiquette" className="sr-only">
            Nouvelle étiquette
          </label>
          <input
            id="saisie-etiquette"
            list="suggestions-etiquettes"
            value={saisie}
            onChange={(e) => setSaisie(e.target.value)}
            placeholder="ajouter une étiquette"
            className={`h-8 w-48 px-2 text-[13px] ${classeChamp}`}
          />
          <datalist id="suggestions-etiquettes">
            {etiquettesConnues
              .filter((e) => !deja.includes(e))
              .map((e) => (
                <option key={e} value={e} />
              ))}
          </datalist>
          <Bouton type="submit" taille="petite" disabled={!saisie.trim()} icone={<Plus size={12} />}>
            Ajouter
          </Bouton>
        </form>
      </div>
      {(item.etiquettes ?? []).length > 0 && (
        <p className="mt-2 text-xs text-zinc-500">Étiquettes automatiques : {item.etiquettes.join(", ")} (d'après les mots des réglages).</p>
      )}
    </div>
  );
}
