// Les réglages : collecte automatique, état des sources, lexique, et le fichier de configuration (avancé).
import { useCallback, useEffect, useState } from "react";
import YAML from "yaml";
import { FloppyDisk } from "@phosphor-icons/react";
import { Bouton, Section, Segments, Squelette } from "./ui.jsx";
import { appel, envoyer } from "./lib.js";
import ConfigSimple, { brouillonDepuis, aDesChangements } from "./ConfigSimple.jsx";

export default function Reglages({ meta, executer, occupe, config, setConfig, simple, setSimple, onEnregistree }) {
  return (
    <div className="mx-auto max-w-4xl">
      <Planification executer={executer} occupe={occupe} />
      <Configuration meta={meta} occupe={occupe} config={config} setConfig={setConfig} simple={simple} setSimple={setSimple} onEnregistree={onEnregistree} />
      <Lexique />
    </div>
  );
}

// Le fichier de configuration, modifiable de deux façons : formulaires (simple) ou texte (fichier).
function Configuration({ meta, occupe, config, setConfig, simple, setSimple, onEnregistree }) {
  const [mode, setMode] = useState("simple");
  const [erreurChargement, setErreurChargement] = useState(null);

  const recharger = useCallback(async () => {
    try {
      const { texte } = await appel("/api/config");
      setConfig({ original: texte, texte });
      setErreurChargement(null);
    } catch (e) {
      setErreurChargement(e.message);
    }
  }, [setConfig]);
  useEffect(() => {
    if (!config) recharger();
  }, [config, recharger]);

  // Le brouillon du mode simple repart du fichier enregistré dès que celui-ci change.
  let base = null;
  let illisible = null;
  if (config) {
    try {
      base = YAML.parse(config.original) ?? {};
    } catch (e) {
      illisible = e.message;
    }
  }
  useEffect(() => {
    if (base && simple?.base !== config.original) setSimple({ base: config.original, brouillon: brouillonDepuis(base) });
  });

  const fichierModifie = config && config.texte !== config.original;
  const simpleModifie = simple && base && aDesChangements(base, simple.brouillon);
  const echecs = (meta?.sources ?? []).filter((s) => s.etat && !s.etat.ok);

  return (
    <Section
      titre="Configuration"
      description="Tout ce que RADAR surveille et comment il classe les infos. Chaque enregistrement est vérifié : une configuration invalide n'est jamais écrite."
      action={
        <Segments
          libelle="Mode d'édition"
          valeur={mode}
          onChange={(m) => {
            if (m === mode) return;
            if ((mode === "simple" && simpleModifie) || (mode === "fichier" && fichierModifie)) return;
            setMode(m);
          }}
          options={[
            { v: "simple", texte: "Simple" },
            { v: "fichier", texte: "Fichier (avancé)" },
          ]}
        />
      }
    >
      {(simpleModifie || fichierModifie) && (
        <p className="mb-4 text-[13px] text-zinc-500 dark:text-zinc-400">Enregistrez ou annulez vos modifications pour changer de mode.</p>
      )}
      {echecs.length > 0 && (
        // Une même cause (ex. gh pas connecté) est dite une fois, avec la liste des sources touchées.
        <ul className="mb-6 space-y-3 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-900 dark:border-red-900 dark:bg-red-950/40 dark:text-red-200">
          {Object.entries(Object.groupBy(echecs, (s) => s.etat.erreur)).map(([erreur, sources]) => (
            <li key={erreur}>
              <div className="font-medium">
                {sources.length > 1 ? `${sources.length} sources ont échoué` : `${sources[0].nom} a échoué`} à la dernière collecte : {erreur}
              </div>
              {sources.length > 1 && <div className="mt-1 text-[13px] text-red-800">{sources.map((s) => s.nom).join(", ")}</div>}
            </li>
          ))}
        </ul>
      )}
      {erreurChargement ? (
        <p className="text-sm text-red-700 dark:text-red-400">{erreurChargement}</p>
      ) : !config || (mode === "simple" && !simple && !illisible) ? (
        <Squelette lignes={4} />
      ) : mode === "simple" && illisible ? (
        <p className="text-sm text-red-700 dark:text-red-400">Le fichier ne peut pas être lu en mode simple ({illisible}). Corrigez-le en mode Fichier.</p>
      ) : mode === "simple" ? (
        <ConfigSimple
          base={base}
          brouillon={simple.brouillon}
          setBrouillon={(brouillon) => setSimple({ ...simple, brouillon })}
          meta={meta}
          occupe={occupe}
          onEnregistre={(texte) => {
            setConfig({ original: texte, texte });
            onEnregistree();
          }}
        />
      ) : (
        <Fichier config={config} setConfig={setConfig} onEnregistree={onEnregistree} occupe={occupe} />
      )}
    </Section>
  );
}

function Planification({ executer, occupe }) {
  const [etat, setEtat] = useState(null);
  const lire = useCallback(() => appel("/api/planification").then(setEtat).catch(() => setEtat({ disponible: false })), []);
  useEffect(() => {
    lire();
  }, [lire]);

  const basculer = async () => {
    await executer(etat.active ? "Arrêt de la collecte automatique" : "Activation de la collecte automatique", [etat.active ? "deplanifier" : "planifier"]);
    await lire();
  };

  return (
    <Section
      titre="Collecte automatique"
      description={
        !etat
          ? "Lecture de l'état…"
          : !etat.disponible
            ? "Disponible sous Windows uniquement. Ailleurs, programmez « node radar.js auto » avec cron."
            : etat.docker
              ? `Assurée par le conteneur « collecte » de Docker, tant qu'il tourne. Prochaine collecte : ${etat.prochaine ?? "en cours ou au démarrage"}. Fréquence : rubrique « planification » (prise en compte à la collecte suivante).`
              : etat.active
                ? `Activée. Prochaine collecte : ${etat.prochaine ?? "inconnue"}. Fréquence : rubrique « planification » du fichier de configuration.`
                : "Désactivée. Une fois activée, RADAR actualise tout seul les infos à intervalle régulier, tant que l'ordinateur est allumé."
      }
      action={
        etat?.disponible && !etat.docker && (
          <Bouton variante={etat.active ? "secondaire" : "principal"} onClick={basculer} disabled={occupe}>
            {etat.active ? "Désactiver" : "Activer"}
          </Bouton>
        )
      }
    />
  );
}

const MOTS = [
  ["Info", "Un article, une version, une faille ou un changement de page, toujours avec un lien et une date."],
  ["Thème", "Le sujet de l'info (ia, devops, sécurité, légal…), deviné à partir de mots que vous choisissez."],
  ["Famille de source", "Le genre de source : blog, presse, agrégat, GitHub, sécurité… Sert à filtrer."],
  ["Étiquette", "Un mot-clé sur l'info. Automatique (d'après vos mots) ou ajoutée à la main dans « Détails »."],
  ["Fiabilité", "Un score calculé par vos règles (source officielle, récente, auteur connu…). Au-dessus du seuil, l'info est « fiable » ; en dessous, elle est masquée par défaut."],
  ["Alerte", "Une nouvelle info qui contient un mot surveillé, ou qui vient d'une source critique (failles, pages)."],
  ["Archiver", "Ranger une info lue. Elle quitte « À lire » et reste dans « Archivées ». Réversible."],
];

function Lexique() {
  return (
    <Section titre="Comprendre RADAR">
      <dl className="grid gap-x-8 gap-y-3 text-sm sm:grid-cols-[10rem_1fr]">
        {MOTS.map(([mot, definition]) => (
          <div key={mot} className="contents">
            <dt className="font-medium">{mot}</dt>
            <dd className="text-zinc-600 dark:text-zinc-400">{definition}</dd>
          </div>
        ))}
      </dl>
    </Section>
  );
}

// L'éditeur texte de radar.config.yaml (mode Fichier). Le brouillon vit dans App pour survivre aux changements d'onglet.
function Fichier({ config, setConfig, onEnregistree, occupe }) {
  const [enregistrement, setEnregistrement] = useState(false);
  const [resultat, setResultat] = useState(null);
  const modifiee = config.texte !== config.original;

  async function enregistrer() {
    setEnregistrement(true);
    try {
      const r = await envoyer("/api/config", { texte: config.texte });
      setResultat({ ok: true, sortie: r.sortie });
      setConfig({ original: config.texte, texte: config.texte });
      onEnregistree();
    } catch (e) {
      setResultat({ ok: false, sortie: e.message });
    } finally {
      setEnregistrement(false);
    }
  }

  // Ctrl+S enregistre ; Tab insère deux espaces (le YAML s'indente avec des espaces).
  function touche(e) {
    if (e.key === "s" && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      if (modifiee && !enregistrement && !occupe) enregistrer();
      return;
    }
    if (e.key !== "Tab") return;
    e.preventDefault();
    const el = e.target;
    const { selectionStart: debut, selectionEnd: fin } = el;
    setConfig({ ...config, texte: config.texte.slice(0, debut) + "  " + config.texte.slice(fin) });
    requestAnimationFrame(() => el.setSelectionRange(debut + 2, debut + 2));
  }

  return (
    <div>
      <p className="mb-3 max-w-[65ch] text-[13px] text-zinc-600 dark:text-zinc-400">
        Le fichier complet, y compris ce que le mode simple ne montre pas (règles de fiabilité, mots-clés). Ctrl+S pour enregistrer ; la version précédente est gardée dans radar.config.yaml.bak.
      </p>
      {resultat && (
        <div
          role="status"
          className={`mb-3 rounded-lg border px-4 py-3 text-sm ${
            resultat.ok
              ? "border-emerald-200 bg-emerald-50 text-emerald-900 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-200"
              : "border-red-200 bg-red-50 text-red-900 dark:border-red-900 dark:bg-red-950/40 dark:text-red-200"
          }`}
        >
          <div className="font-medium">{resultat.ok ? "Enregistré." : "Pas enregistré : le fichier contient une erreur."}</div>
          <pre className="mt-1 font-mono text-xs whitespace-pre-wrap">{resultat.sortie}</pre>
        </div>
      )}
      <label htmlFor="editeur-config" className="sr-only">Contenu de radar.config.yaml</label>
      <textarea
        id="editeur-config"
        value={config.texte}
        onChange={(e) => setConfig({ ...config, texte: e.target.value })}
        onKeyDown={touche}
        spellCheck={false}
        className="h-[60dvh] min-h-80 w-full resize-y rounded-lg border border-zinc-300 bg-white p-4 font-mono text-[13px] leading-relaxed whitespace-pre text-zinc-900 outline-none focus:border-emerald-600 focus:ring-2 focus:ring-emerald-600/20 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100"
      />
      <div className="mt-3 flex flex-wrap items-center justify-end gap-2">
        {modifiee && <span className="mr-auto text-[13px] text-zinc-500 dark:text-zinc-400">Modifications non enregistrées</span>}
        <Bouton onClick={() => { setConfig({ ...config, texte: config.original }); setResultat(null); }} disabled={!modifiee || enregistrement}>
          Annuler les modifications
        </Bouton>
        <Bouton variante="principal" onClick={enregistrer} disabled={!modifiee || enregistrement || occupe} icone={<FloppyDisk size={16} />}>
          {enregistrement ? "Vérification…" : "Enregistrer"}
        </Bouton>
      </div>
    </div>
  );
}
