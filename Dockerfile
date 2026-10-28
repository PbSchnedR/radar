# RADAR : interface + commandes, dans une seule image.
# Node 24 minimum : SQLite est intégré à Node (node:sqlite).
FROM node:24-slim

# La CLI GitHub (gh) sert aux sources « releases » et « depot ». Elle s'authentifie avec la variable GH_TOKEN.
RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates curl \
 && curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg -o /usr/share/keyrings/githubcli-archive-keyring.gpg \
 && echo "deb [arch=$(dpkg --print-architecture) signed-by=/usr/share/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" > /etc/apt/sources.list.d/github-cli.list \
 && apt-get update \
 && apt-get install -y --no-install-recommends gh \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Les dépendances d'abord : la couche reste en cache tant que package-lock.json ne change pas.
COPY package.json package-lock.json ./
RUN npm ci

COPY . .
RUN npm run build

EXPOSE 4319

# Par défaut : l'interface (version optimisée) et ses routes /api, ouvertes au conteneur seulement sur le port 4319.
CMD ["npx", "vite", "preview", "--config", "ui/vite.config.js", "--host", "0.0.0.0", "--port", "4319", "--strictPort"]
