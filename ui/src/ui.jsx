// Composants de base. Une seule forme (coins 8 px), un seul accent (vert), du gris pour tout le reste.
import { useEffect, useId, useRef, useState } from "react";
import { CaretDown, MagnifyingGlass, X } from "@phosphor-icons/react";
import { normaliser } from "./lib.js";

const STYLES_BOUTON = {
  principal: "bg-emerald-700 text-white hover:bg-emerald-800 dark:bg-emerald-500 dark:text-zinc-950 dark:hover:bg-emerald-400",
  secondaire: "border border-zinc-300 bg-white text-zinc-800 hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100 dark:hover:bg-zinc-800",
  discret: "text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-100",
};

export function Bouton({ variante = "secondaire", taille = "normale", icone, children, className = "", ...props }) {
  const dimensions = taille === "petite" ? "h-8 px-2.5 text-[13px] gap-1.5" : "h-9 px-3.5 text-sm gap-2";
  return (
    <button
      type="button"
      {...props}
      className={`inline-flex shrink-0 items-center justify-center rounded-lg font-medium whitespace-nowrap transition active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50 ${dimensions} ${STYLES_BOUTON[variante]} ${className}`}
    >
      {icone}
      {children}
    </button>
  );
}

const CHAMP = "rounded-lg border border-zinc-300 bg-white text-sm text-zinc-900 outline-none placeholder:text-zinc-500 focus:border-emerald-600 focus:ring-2 focus:ring-emerald-600/20 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100 dark:placeholder:text-zinc-400";

export function Liste({ libelle, valeur, onChange, options, tous }) {
  return (
    <label className="flex min-w-0 flex-col gap-1">
      <span className="text-xs font-medium text-zinc-600 dark:text-zinc-400">{libelle}</span>
      <select value={valeur} onChange={(e) => onChange(e.target.value)} className={`h-9 min-w-0 px-2 ${CHAMP}`}>
        <option value="">{tous}</option>
        {options.map(([v, texte]) => (
          <option key={v} value={v}>
            {texte}
          </option>
        ))}
      </select>
    </label>
  );
}

export const classeChamp = CHAMP;

// Filtre à choix multiples, avec recherche dans la liste. options : [[valeur, nombre d'infos], …].
export function FiltreMultiple({ libelle, options, valeurs, onChange, tous }) {
  const [ouvert, setOuvert] = useState(false);
  const [recherche, setRecherche] = useState("");
  const conteneur = useRef(null);
  const bouton = useRef(null);
  const id = useId();

  useEffect(() => {
    if (!ouvert) return;
    const clic = (e) => !conteneur.current?.contains(e.target) && setOuvert(false);
    const touche = (e) => {
      if (e.key !== "Escape") return;
      setOuvert(false);
      bouton.current?.focus();
    };
    addEventListener("mousedown", clic);
    addEventListener("keydown", touche);
    return () => {
      removeEventListener("mousedown", clic);
      removeEventListener("keydown", touche);
    };
  }, [ouvert]);

  // Une valeur cochée reste visible même si les autres filtres lui retirent toutes ses infos (pour pouvoir la décocher).
  const toutes = [...options, ...valeurs.filter((v) => !options.some(([o]) => o === v)).map((v) => [v, 0])];
  const q = normaliser(recherche.trim());
  const filtrees = toutes.filter(([v]) => !q || normaliser(v).includes(q));
  const basculer = (v) => onChange(valeurs.includes(v) ? valeurs.filter((x) => x !== v) : [...valeurs, v]);
  const resume = valeurs.length === 0 ? tous : valeurs.length === 1 ? valeurs[0] : `${valeurs[0]} +${valeurs.length - 1}`;

  return (
    <div ref={conteneur} className="relative flex min-w-0 flex-col gap-1">
      <span id={`${id}-libelle`} className="text-xs font-medium text-zinc-600 dark:text-zinc-400">{libelle}</span>
      <button
        ref={bouton}
        type="button"
        aria-haspopup="true"
        aria-expanded={ouvert}
        aria-labelledby={`${id}-libelle ${id}-resume`}
        onClick={() => setOuvert(!ouvert)}
        className={`flex h-9 min-w-0 items-center gap-2 px-2.5 text-left ${CHAMP} ${valeurs.length ? "border-emerald-600 dark:border-emerald-500" : ""}`}
      >
        <span id={`${id}-resume`} className={`min-w-0 flex-1 truncate ${valeurs.length ? "font-medium" : ""}`}>{resume}</span>
        <CaretDown size={14} className="shrink-0 text-zinc-500" />
      </button>
      {ouvert && (
        <div className="absolute top-full left-0 z-30 mt-1 w-72 max-w-[calc(100vw-2rem)] rounded-lg border border-zinc-200 bg-white shadow-lg dark:border-zinc-700 dark:bg-zinc-900">
          <div className="relative border-b border-zinc-200 p-2 dark:border-zinc-800">
            <MagnifyingGlass size={14} className="pointer-events-none absolute top-1/2 left-4 -translate-y-1/2 text-zinc-500" />
            <input
              autoFocus
              value={recherche}
              onChange={(e) => setRecherche(e.target.value)}
              placeholder={`Chercher dans « ${libelle} »`}
              aria-label={`Chercher dans ${libelle}`}
              className={`h-8 w-full pl-7 text-[13px] ${CHAMP}`}
            />
          </div>
          <ul className="max-h-64 overflow-auto py-1" aria-label={libelle}>
            {filtrees.length === 0 && <li className="px-3 py-2 text-[13px] text-zinc-500">Aucun résultat</li>}
            {filtrees.map(([v, n]) => (
              <li key={v}>
                <label className="flex cursor-pointer items-center gap-2.5 px-3 py-1.5 text-[13px] hover:bg-zinc-100 dark:hover:bg-zinc-800">
                  <input type="checkbox" checked={valeurs.includes(v)} onChange={() => basculer(v)} className="size-4 shrink-0 accent-emerald-700" />
                  <span className="min-w-0 flex-1 truncate">{v}</span>
                  <span className="font-mono text-xs text-zinc-500">{n}</span>
                </label>
              </li>
            ))}
          </ul>
          <div className="flex items-center border-t border-zinc-200 px-3 py-2 text-[13px] dark:border-zinc-800">
            <span className="mr-auto text-zinc-500">{valeurs.length ? `${valeurs.length} choisi${valeurs.length > 1 ? "s" : ""}` : "Aucun choix = tout"}</span>
            {valeurs.length > 0 && (
              <button onClick={() => onChange([])} className="font-medium text-zinc-700 underline underline-offset-2 dark:text-zinc-300">
                Effacer
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// Choix exclusif (ex. À lire / Alertes / Archivées).
export function Segments({ valeur, onChange, options, libelle }) {
  return (
    <div role="tablist" aria-label={libelle} className="inline-flex rounded-lg bg-zinc-200/70 p-0.5 dark:bg-zinc-800">
      {options.map(({ v, texte, n, accent }) => {
        const actif = valeur === v;
        return (
          <button
            key={v}
            role="tab"
            aria-selected={actif}
            onClick={() => onChange(v)}
            className={`inline-flex h-8 items-center gap-1.5 rounded-md px-3 text-sm transition-colors ${
              actif ? "bg-white font-medium text-zinc-900 shadow-sm dark:bg-zinc-950 dark:text-zinc-50" : "text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100"
            }`}
          >
            {texte}
            {n != null && (
              <span className={`font-mono text-xs ${accent && n > 0 ? "font-semibold text-amber-700 dark:text-amber-400" : "text-zinc-500 dark:text-zinc-400"}`}>{n}</span>
            )}
          </button>
        );
      })}
    </div>
  );
}

export function Squelette({ lignes = 8 }) {
  return (
    <div className="space-y-3" aria-busy="true" aria-label="Chargement">
      {Array.from({ length: lignes }, (_, n) => (
        <div key={n} className="space-y-2 py-2">
          <div className="h-4 w-3/4 animate-pulse rounded bg-zinc-200 dark:bg-zinc-800" />
          <div className="h-3 w-1/3 animate-pulse rounded bg-zinc-200/70 dark:bg-zinc-800/70" />
        </div>
      ))}
    </div>
  );
}

export function EtatVide({ titre, texte, action }) {
  return (
    <div className="mx-auto max-w-sm py-20 text-center">
      <h2 className="text-base font-semibold">{titre}</h2>
      {texte && <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">{texte}</p>}
      {action && <div className="mt-6 flex justify-center">{action}</div>}
    </div>
  );
}

// Messages temporaires en bas d'écran, avec une action possible (ex. « Annuler »).
export function Toasts({ toasts, onFermer }) {
  return (
    <div aria-live="polite" className="pointer-events-none fixed inset-x-0 bottom-4 z-40 flex flex-col items-center gap-2 px-4">
      {toasts.map((t) => (
        <Toast key={t.id} toast={t} onFermer={() => onFermer(t.id)} />
      ))}
    </div>
  );
}

function Toast({ toast, onFermer }) {
  useEffect(() => {
    if (toast.persistant) return;
    const minuteur = setTimeout(onFermer, 7000);
    return () => clearTimeout(minuteur);
  }, [toast, onFermer]);
  const erreur = toast.ton === "erreur";
  return (
    <div
      role={erreur ? "alert" : "status"}
      className={`pointer-events-auto flex w-full max-w-md items-center gap-3 rounded-lg px-4 py-3 text-sm shadow-lg ${
        erreur ? "bg-red-700 text-white" : "bg-zinc-900 text-zinc-50 dark:bg-zinc-100 dark:text-zinc-900"
      }`}
    >
      <span className="mr-auto">{toast.texte}</span>
      {toast.action && (
        <button
          onClick={() => {
            toast.action.faire();
            onFermer();
          }}
          className="font-semibold underline underline-offset-2"
        >
          {toast.action.texte}
        </button>
      )}
      <button onClick={onFermer} aria-label="Fermer" className="opacity-70 hover:opacity-100">
        <X size={16} />
      </button>
    </div>
  );
}

// Fenêtre de détail (ex. sortie d'une commande). Échap ou clic à côté pour fermer.
export function Fenetre({ titre, onFermer, children }) {
  useEffect(() => {
    const touche = (e) => e.key === "Escape" && onFermer();
    addEventListener("keydown", touche);
    return () => removeEventListener("keydown", touche);
  }, [onFermer]);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-zinc-950/40 p-4" onClick={onFermer}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={titre}
        onClick={(e) => e.stopPropagation()}
        className="flex max-h-[80dvh] w-full max-w-2xl flex-col rounded-lg bg-white shadow-xl dark:bg-zinc-900"
      >
        <div className="flex items-center border-b border-zinc-200 px-5 py-3 dark:border-zinc-800">
          <h2 className="mr-auto text-sm font-semibold">{titre}</h2>
          <button onClick={onFermer} aria-label="Fermer" className="text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100">
            <X size={18} />
          </button>
        </div>
        <div className="overflow-auto p-5">{children}</div>
      </div>
    </div>
  );
}

export function Section({ titre, description, action, children }) {
  return (
    <section className="border-t border-zinc-200 py-8 first:border-t-0 first:pt-0 dark:border-zinc-800">
      <div className="mb-4 flex flex-wrap items-start gap-3">
        <div className="mr-auto max-w-[65ch]">
          <h2 className="text-base font-semibold">{titre}</h2>
          {description && <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">{description}</p>}
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}
