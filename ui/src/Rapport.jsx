// Le rapport : rapport.md assemblé par « radar report » à partir de rapport.textes.yaml et des infos collectées.
import Markdown from "react-markdown";
import { FileText } from "@phosphor-icons/react";
import { Bouton, EtatVide, Squelette } from "./ui.jsx";

export default function Rapport({ markdown, onGenerer, occupe }) {
  const bouton = (
    <Bouton variante={markdown ? "secondaire" : "principal"} onClick={onGenerer} disabled={occupe} icone={<FileText size={16} />}>
      {markdown ? "Régénérer" : "Générer le rapport"}
    </Bouton>
  );
  if (markdown === undefined) return <Squelette lignes={6} />;
  return (
    <div className="mx-auto max-w-[72ch]">
      <div className="mb-8 flex flex-wrap items-start gap-4 border-b border-zinc-200 pb-6 dark:border-zinc-800">
        <p className="mr-auto max-w-[52ch] text-sm text-zinc-600 dark:text-zinc-400">
          Le rapport reprend vos textes (fichier rapport.textes.yaml) et n'accepte que des sources présentes dans vos infos. Régénérez-le après chaque changement.
        </p>
        {markdown && bouton}
      </div>
      {markdown === null ? (
        <EtatVide titre="Pas encore de rapport" texte="Générez-le pour assembler vos tendances et leurs sources datées." action={bouton} />
      ) : (
        <article className="rapport">
          <Markdown components={{ a: (p) => <a {...p} target="_blank" rel="noreferrer" /> }}>{markdown}</Markdown>
        </article>
      )}
    </div>
  );
}
