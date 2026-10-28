// La coquille de l'interface : en-tête, navigation, données, messages. Les écrans sont dans Fil, Rapport et Reglages.
import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowsClockwise, WarningCircle } from "@phosphor-icons/react";
import { Bouton, EtatVide, Fenetre, Toasts } from "./ui.jsx";
import { alerteNonVue, appel, envoyer, ilYA } from "./lib.js";
import Fil from "./Fil.jsx";
import Rapport from "./Rapport.jsx";
import Reglages from "./Reglages.jsx";

const VUES = [
  ["fil", "Fil"],
  ["rapport", "Rapport"],
  ["reglages", "Réglages"],
];

export default function App() {
  const [items, setItems] = useState(null);
  const [meta, setMeta] = useState(null);
  const [erreur, setErreur] = useState(null);
  const [rapport, setRapport] = useState(undefined); // undefined = pas chargé, null = absent
  const [vue, setVueEtat] = useState(VUES.some(([v]) => `#${v}` === location.hash) ? location.hash.slice(1) : "fil");
  const [occupe, setOccupe] = useState(null); // libellé de l'action en cours
  const [journal, setJournal] = useState(null); // { titre, sortie } affiché dans une fenêtre
  const [toasts, setToasts] = useState([]);
  const [config, setConfig] = useState(null); // brouillon du fichier de configuration { original, texte }
  const [simple, setSimple] = useState(null); // brouillon du mode simple { base, brouillon }
  const idToast = useRef(0);

  const setVue = (v) => {
    history.replaceState(null, "", v === "fil" ? location.pathname : `#${v}`);
    setVueEtat(v);
  };

  const notifier = useCallback((toast) => {
    const id = ++idToast.current;
    setToasts((t) => [...t.slice(-2), { ...toast, id }]);
  }, []);
  const fermerToast = useCallback((id) => setToasts((t) => t.filter((x) => x.id !== id)), []);

  const charger = useCallback(async () => {
    try {
      const [i, m] = await Promise.all([appel("/api/items"), appel("/api/meta")]);
      setItems(i);
      setMeta(m);
      setErreur(null);
    } catch (e) {
      setErreur(e.message);
    }
  }, []);

  const chargerRapport = useCallback(async () => {
    try {
      setRapport((await appel("/api/rapport")).markdown);
    } catch {
      setRapport(null);
    }
  }, []);

  useEffect(() => {
    charger();
  }, [charger]);

  useEffect(() => {
    if (vue === "rapport" && rapport === undefined) chargerRapport();
  }, [vue, rapport, chargerRapport]);

  // Le brouillon de configuration non enregistré ne doit pas se perdre en fermant la page.
  const configModifiee = config && config.texte !== config.original;
  useEffect(() => {
    if (!configModifiee) return;
    const avertir = (e) => e.preventDefault();
    addEventListener("beforeunload", avertir);
    return () => removeEventListener("beforeunload", avertir);
  }, [configModifiee]);

  // Enchaîne des commandes radar ; s'arrête à la première qui échoue. Renvoie la sortie complète.
  async function executer(libelle, commandes) {
    setOccupe(libelle);
    let sortie = "";
    let ok = true;
    for (const cmd of commandes) {
      try {
        const r = await envoyer(`/api/run/${cmd}`);
        sortie += `$ radar ${cmd}\n${r.sortie}\n\n`;
        ok = r.ok;
      } catch (e) {
        sortie += `$ radar ${cmd}\n${e.message}\n\n`;
        ok = false;
      }
      if (!ok) break;
    }
    sortie = sortie.trim();
    setOccupe(null);
    await charger();
    const voir = { texte: "Détails", faire: () => setJournal({ titre: libelle, sortie }) };
    if (!ok) notifier({ ton: "erreur", texte: `${libelle} : échec.`, action: voir, persistant: true });
    return { ok, sortie, voir };
  }

  async function actualiser() {
    const { ok, sortie, voir } = await executer("Actualisation", ["collect", "score"]);
    if (!ok) return;
    const nouvelles = Number(sortie.match(/(\d+) nouvelles infos/)?.[1] ?? 0);
    const alertes = Number(sortie.match(/(\d+) ALERTE/)?.[1] ?? 0);
    const echecs = (sortie.match(/ÉCHEC/g) ?? []).length;
    const morceaux = [
      nouvelles ? `${nouvelles} nouvelle${nouvelles > 1 ? "s" : ""} info${nouvelles > 1 ? "s" : ""}` : "Rien de nouveau",
      alertes && `${alertes} alerte${alertes > 1 ? "s" : ""}`,
      echecs && `${echecs} source${echecs > 1 ? "s" : ""} en échec`,
    ].filter(Boolean);
    notifier({ texte: morceaux.join(", ") + ".", action: voir });
  }

  async function genererRapport() {
    const { ok } = await executer("Génération du rapport", ["report"]);
    await chargerRapport();
    if (ok) notifier({ texte: "Rapport régénéré." });
  }

  // Change une info (archivage, étiquettes) ; l'archivage propose « Annuler ».
  async function modifier(item, changements, { silencieux = false } = {}) {
    try {
      const maj = await envoyer("/api/items/modifier", { url: item.url, ...changements });
      setItems((liste) => liste.map((i) => (i.url === item.url ? maj : i)));
      if (silencieux || changements.archivee === undefined) return;
      notifier({
        texte: changements.archivee ? "Info archivée." : "Info remise dans « À lire ».",
        action: { texte: "Annuler", faire: () => modifier(item, { archivee: !changements.archivee }, { silencieux: true }) },
      });
    } catch (e) {
      notifier({ ton: "erreur", texte: e.message });
    }
  }

  async function alertesVues() {
    try {
      const { vues } = await envoyer("/api/alertes/vues");
      await charger();
      notifier({ texte: `${vues} alerte${vues > 1 ? "s" : ""} marquée${vues > 1 ? "s" : ""} comme vue${vues > 1 ? "s" : ""}.` });
    } catch (e) {
      notifier({ ton: "erreur", texte: e.message });
    }
  }

  const nbAlertes = (items ?? []).filter((i) => !i.archivee_le && alerteNonVue(i)).length;
  const echecs = (meta?.sources ?? []).filter((s) => s.etat && !s.etat.ok).length;

  return (
    <div className="min-h-[100dvh]">
      <header className="sticky top-0 z-20 border-b border-zinc-200 bg-zinc-50/90 backdrop-blur dark:border-zinc-800 dark:bg-zinc-950/90">
        <div className="flex h-14 w-full items-center gap-4 px-4 sm:gap-8 md:px-8">
          <span className="text-[15px] font-semibold tracking-tight">RADAR</span>
          <nav className="flex h-full gap-1 sm:gap-4" aria-label="Sections">
            {VUES.map(([v, texte]) => (
              <button
                key={v}
                onClick={() => setVue(v)}
                aria-current={vue === v ? "page" : undefined}
                className={`relative inline-flex h-full items-center gap-1.5 px-1 text-sm transition-colors ${
                  vue === v ? "font-medium text-zinc-900 dark:text-zinc-50" : "text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100"
                }`}
              >
                {texte}
                {v === "fil" && nbAlertes > 0 && <span className="font-mono text-xs font-semibold text-amber-700 dark:text-amber-400">{nbAlertes}</span>}
                {v === "reglages" && (echecs > 0 || configModifiee) && (
                  <span className="text-xs text-red-700 dark:text-red-400" title={echecs ? `${echecs} source(s) en échec` : "Modifications non enregistrées"}>
                    {echecs ? <WarningCircle size={14} /> : "*"}
                  </span>
                )}
                {vue === v && <span className="absolute inset-x-0 -bottom-px h-0.5 rounded bg-zinc-900 dark:bg-zinc-100" />}
              </button>
            ))}
          </nav>
          <div className="ml-auto flex items-center gap-3">
            {meta?.derniere_collecte && !occupe && (
              <span className="hidden text-[13px] text-zinc-500 md:inline dark:text-zinc-400" title={new Date(meta.derniere_collecte.le).toLocaleString("fr-FR")}>
                Mis à jour {ilYA(meta.derniere_collecte.le)}
              </span>
            )}
            {occupe && <span className="hidden text-[13px] text-zinc-500 md:inline dark:text-zinc-400">{occupe}…</span>}
            <Bouton
              variante="principal"
              onClick={actualiser}
              disabled={Boolean(occupe)}
              icone={<ArrowsClockwise size={16} className={occupe === "Actualisation" ? "animate-spin" : ""} />}
              title="Interroger toutes les sources, puis noter et classer les nouvelles infos"
            >
              <span className="max-sm:sr-only">{occupe === "Actualisation" ? "Actualisation…" : "Actualiser"}</span>
            </Bouton>
          </div>
        </div>
      </header>

      <main className="w-full px-4 py-8 md:px-8">
        {erreur ? (
          <EtatVide titre="Impossible de lire les données" texte={erreur} action={<Bouton onClick={charger}>Réessayer</Bouton>} />
        ) : vue === "fil" ? (
          <Fil items={items} meta={meta} onModifier={modifier} onAlertesVues={alertesVues} onActualiser={actualiser} occupe={Boolean(occupe)} />
        ) : vue === "rapport" ? (
          <Rapport markdown={rapport} onGenerer={genererRapport} occupe={Boolean(occupe)} />
        ) : (
          <Reglages meta={meta} executer={executer} occupe={Boolean(occupe)} config={config} setConfig={setConfig} simple={simple} setSimple={setSimple} onEnregistree={charger} />
        )}
      </main>

      {journal && (
        <Fenetre titre={journal.titre} onFermer={() => setJournal(null)}>
          <pre className="font-mono text-xs leading-relaxed whitespace-pre-wrap text-zinc-700 dark:text-zinc-300">{journal.sortie}</pre>
        </Fenetre>
      )}
      <Toasts toasts={toasts} onFermer={fermerToast} />
    </div>
  );
}
