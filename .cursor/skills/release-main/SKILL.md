---
name: release-main
description: >-
  Squash la branche dev vers main en un commit vX.Y.Z pour une release
  Marketplace, sans réécrire l'historique détaillé de dev. Utiliser quand
  l'utilisateur demande de pousser une version sur main, release:main,
  publier une release propre, ou préparer la publication Marketplace /
  Open VSX depuis SSH-Folders.
---

# Release main (squash vX.Y.Z)

## Objectif

Sur **SSH-Folders** : `dev` garde le détail ; `main` ne reçoit qu’un commit propre `vX.Y.Z`. Le **tag Git est toujours identique à la version** (`v` + `package.json` version).

## Version / tag (obligatoire)

1. Si l’utilisateur **n’a pas indiqué** de version (`0.3.0`, `v0.3.0`, etc.) : **lui demander** avant toute action.
2. Normaliser : chiffres seulement `x.y.z` (enlever un `v` initial si présent). Refuser `x.y.z-1`.
3. Le tag sera **`vX.Y.Z`** — même numéro que la version, pas un autre nom.
4. Lire `package.json` → `version` :
   - si différente de la version choisie : **demander confirmation** avant de la modifier, puis aligner `package.json` (et vérifier `CHANGELOG` / What's New) ;
   - si déjà égale : continuer.
5. Ne jamais inventer de version ni publier sans demande explicite.

## Prérequis (vérifier avant d’exécuter)

1. Version / tag obtenus (étape ci-dessus)
2. Branche courante = `dev`
3. Arbre Git propre (pas de modifications non commitées)
4. `package.json` → `version` = **`x.y.z`** choisie
5. `CHANGELOG.md` et **What's New** du `README.md` à jour pour cette version
6. Demande **explicite** de l’utilisateur pour release / push `main` (et pour publish)

## Commandes

Toujours passer **`--tag`** (tag = version). Ajouter `--publish` seulement si l’utilisateur le demande.

```bash
# Squash + commit vX.Y.Z + tag vX.Y.Z + push main, retour sur dev
npm run release:main -- --tag

# + publish:vscode + publish:openvsx (--publish implique le tag)
npm run release:main -- --publish
```

Script : `scripts/release-main.sh`.

## Workflow agent

```text
Progression:
- [ ] 1) Version fournie ? Sinon demander (tag = v + version)
- [ ] 2) Aligner package.json si besoin (avec accord) + changelog / What's New
- [ ] 3) Vérifier branche dev + git status propre
- [ ] 4) npm run release:main -- --tag  (ou --publish si demandé)
- [ ] 5) Nettoyer todo.md (voir section ci-dessous)
- [ ] 6) Rapporter commit main, tag vX.Y.Z, branche courante (dev)
```

## Nettoyage `todo.md`

Fichier **local** (gitignore). Ne pas le committer.

### Contenu attendu (entre deux releases, sur `dev`)

Ne garder que :

1. **Fait depuis le dernier commit `main`** — cases `[x]` des travaux pas encore livrés sur `main`.
2. **Pas encore fait** — cases `[ ]` ou items ouverts sans case.

**Conserver les titres de section** existants (`# Fonctionnalités`, `# Tri`, `# Color`, etc.). Ne pas aplatir le fichier en une seule liste. Retirer une section seulement si elle devient vide. Retirer les `[x]` déjà inclus dans la dernière release `main` (changelog / What's New de cette version).

### Après un `release:main` réussi

1. Supprimer toutes les cases `[x]` (désormais livrées avec `vX.Y.Z`).
2. Conserver les items non faits **et leurs titres de section**.
3. Retirer les sections devenues vides.

## Après release

- Continuer sur `dev`
- Nettoyer `todo.md` comme ci-dessus
- Publication Marketplace : `npm run publish:vscode` puis `npm run publish:openvsx` (si pas déjà `--publish`)
- Ne pas force-push `main` ni squash `dev`
