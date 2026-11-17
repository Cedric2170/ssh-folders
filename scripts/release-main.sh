#!/usr/bin/env bash
# Squash de dev → main en un commit vX.Y.Z, puis retour sur dev.
# Usage:
#   npm run release:main
#   npm run release:main -- --tag
#   npm run release:main -- --publish
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

DO_TAG=0
DO_PUBLISH=0
for arg in "$@"; do
  case "$arg" in
    --tag) DO_TAG=1 ;;
    --publish) DO_TAG=1; DO_PUBLISH=1 ;;
    -h|--help)
      echo "Usage: npm run release:main [-- --tag] [-- --publish]"
      echo "  --tag      crée et pousse le tag vX.Y.Z"
      echo "  --publish  tag + npm run publish:vscode + publish:openvsx"
      exit 0
      ;;
    *)
      echo "Option inconnue: $arg" >&2
      exit 1
      ;;
  esac
done

VERSION="$(node -p "require('./package.json').version")"
if ! [[ "$VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  echo "Version publiable requise (x.y.z). Actuelle: $VERSION" >&2
  echo "Les builds locaux x.y.z-1 ne doivent pas partir sur main." >&2
  exit 1
fi

BRANCH="$(git branch --show-current)"
if [[ "$BRANCH" != "dev" ]]; then
  echo "Être sur la branche dev (actuelle: $BRANCH)." >&2
  exit 1
fi

if [[ -n "$(git status --porcelain)" ]]; then
  echo "Arbre de travail non propre. Commit ou stash d'abord." >&2
  git status -sb >&2
  exit 1
fi

if ! git rev-parse --verify main >/dev/null 2>&1; then
  echo "Branche main introuvable." >&2
  exit 1
fi

MSG="v${VERSION}"
echo "→ Release $MSG (squash dev → main)"

git fetch origin
git checkout main
git pull --ff-only origin main

git merge --squash dev

if git diff --cached --quiet; then
  echo "Rien à squash : main a déjà le même contenu que dev."
  git checkout dev
  exit 0
fi

git commit -m "$MSG"
git push origin main

if [[ "$DO_TAG" -eq 1 ]]; then
  if git rev-parse "refs/tags/v${VERSION}" >/dev/null 2>&1; then
    echo "Tag v${VERSION} existe déjà (local) — non recréé."
  else
    git tag -a "v${VERSION}" -m "v${VERSION}"
  fi
  git push origin "v${VERSION}"
fi

git checkout dev

if [[ "$DO_PUBLISH" -eq 1 ]]; then
  echo "→ Publication Marketplace + Open VSX"
  npm run publish:vscode
  npm run publish:openvsx
fi

echo "✓ main mis à jour ($MSG). Branche courante: dev."
