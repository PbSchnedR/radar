# Rapport de veille

_Généré par radar report le 2026-10-28._

## Page 1 · Synthèse de veille

### 1. Sources

- 2026-10-27 · GitHub openai/codex · [codex 0.165.0](https://github.com/openai/codex/releases/tag/rust-v0.165.0) · fiabilité 6
- 2026-10-26 · Dépôt GitHub officiel anthropics/claude-code · [claude-code v2.1.311](https://github.com/anthropics/claude-code/releases/tag/v2.1.311) · fiabilité 6
- 2026-10-23 · GitHub openai/codex · [codex 0.164.0](https://github.com/openai/codex/releases/tag/rust-v0.164.0) · fiabilité 6
- 2026-10-22 · Dépôt GitHub officiel anthropics/claude-code · [claude-code v2.1.309](https://github.com/anthropics/claude-code/releases/tag/v2.1.309) · fiabilité 6
- 2026-10-21 · Dépôt GitHub officiel anthropics/claude-code · [claude-code v2.1.306](https://github.com/anthropics/claude-code/releases/tag/v2.1.306) · fiabilité 6

### 2. Tendances

#### Tendance 1 · MCP devient la prise standard des CLI d'IA

Entre le 21 et le 27 octobre 2026, Claude Code et Codex ont tous deux livré des correctifs et ajouts autour de MCP : outils MCP utilisables par les sous-agents et commandes « claude mcp » corrigées (Claude Code v2.1.311), fichier de config MCP protégé du sandbox (v2.1.309), sessions avec beaucoup d'outils MCP (v2.1.306) ; côté Codex, connexions MCP d'entreprise authentifiées (0.164.0), annulation des requêtes MCP distantes et mise à jour du SDK @modelcontextprotocol/sdk en version 1.32.0 (0.165.0).

Sources : [claude-code v2.1.311, 2026-10-26](https://github.com/anthropics/claude-code/releases/tag/v2.1.311) ; [claude-code v2.1.309, 2026-10-22](https://github.com/anthropics/claude-code/releases/tag/v2.1.309) ; [claude-code v2.1.306, 2026-10-21](https://github.com/anthropics/claude-code/releases/tag/v2.1.306) ; [codex 0.164.0, 2026-10-23](https://github.com/openai/codex/releases/tag/rust-v0.164.0) ; [codex 0.165.0, 2026-10-27](https://github.com/openai/codex/releases/tag/rust-v0.165.0)

- **Impact attendu :** Les serveurs MCP que je configure servent dans Claude Code comme dans Codex : du temps passé sur MCP profite aux deux outils.
- **Ce qu'elle permet d'anticiper :** Mettre à jour les deux outils : ces versions corrigent des bugs MCP que je pourrais croiser (sous-agents, commandes claude mcp).
- **Compatibilité budget et technique :** Gratuit. Rien à développer, seulement de la configuration.
- **Retenue :** Deux éditeurs indépendants vont dans le même sens, la même semaine, dans leurs dépôts officiels.

#### Tendance 2 · Data : la mémoire des agents reste en fichiers, mais se structure

Claude Code garde sa mémoire dans des fichiers texte (MEMORY.md, CLAUDE.md) et corrige leurs effets de bord : contenu périmé après compaction, messages d'historique enregistrés dans le désordre (v2.1.311), CLAUDE.md trop gros chargé seulement en partie, historiques que jq n'arrivait plus à lire (v2.1.309). Codex passe à une « memory v2 » activée par défaut, avec import des mémoires d'autres agents (0.165.0), et retrouve désormais les historiques compressés à la reprise d'une session (0.164.0).

Sources : [claude-code v2.1.311, 2026-10-26](https://github.com/anthropics/claude-code/releases/tag/v2.1.311) ; [claude-code v2.1.309, 2026-10-22](https://github.com/anthropics/claude-code/releases/tag/v2.1.309) ; [codex 0.165.0, 2026-10-27](https://github.com/openai/codex/releases/tag/rust-v0.165.0) ; [codex 0.164.0, 2026-10-23](https://github.com/openai/codex/releases/tag/rust-v0.164.0)

- **Impact attendu :** Mes fichiers CLAUDE.md sont bien lus par l'outil, mais un CLAUDE.md trop gros n'est chargé qu'en partie (v2.1.309).
- **Ce qu'elle permet d'anticiper :** Garder mes CLAUDE.md courts. Si j'utilise Codex, regarder ce que change sa memory v2.
- **Compatibilité budget et technique :** Gratuit. Une habitude à prendre, pas un développement.
- **Retenue :** Touche directement ma façon de travailler avec ces outils.

#### Tendance 3 · Le sandbox des commandes se durcit

Claude Code corrige des fuites de son sandbox : fichiers de démarrage du shell exécutés hors du sandbox, règles d'interdiction d'écriture contournées par lien symbolique (v2.1.309). Codex durcit ses contrôles sandbox sur macOS, masque les identifiants dans les commandes Bash distantes (0.164.0) et ferme une faille de validation d'url de marketplace (0.165.0).

Sources : [claude-code v2.1.309, 2026-10-22](https://github.com/anthropics/claude-code/releases/tag/v2.1.309) ; [codex 0.164.0, 2026-10-23](https://github.com/openai/codex/releases/tag/rust-v0.164.0) ; [codex 0.165.0, 2026-10-27](https://github.com/openai/codex/releases/tag/rust-v0.165.0)

- **Impact attendu :** Quand l'IA lance des commandes sur ma machine, c'est le sandbox qui me protège, et il avait des trous.
- **Ce qu'elle permet d'anticiper :** Garder le sandbox activé et mettre à jour les outils pour récupérer ces correctifs.
- **Compatibilité budget et technique :** Budget : 0 €. Technique : un réglage à respecter, pas un développement.
- **Retenue :** Risque de sécurité direct sur ma machine.
