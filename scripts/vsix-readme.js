const { execFileSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const vsixReadmePath = path.join(root, "vsix", "README.md");
const changelogPath = path.join(root, "CHANGELOG.md");
const publicReadmePath = path.join(root, "README.md");

const PUBLIC_START = "<!-- latest-changelog:start -->";
const PUBLIC_END = "<!-- latest-changelog:end -->";

function git(args) {
  return execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
}

function versionOfPackage() {
  const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
  if (!pkg.version || typeof pkg.version !== "string") {
    throw new Error("version absente de package.json");
  }
  return pkg.version;
}

/** Versions Marketplace publiables : `x.y.z` sans suffixe `-1`, `-2`, etc. */
function isPublishedVersion(version) {
  return /^\d+\.\d+\.\d+$/.test(version);
}

function hasSection(readme, version) {
  return readme.split("\n").some((line) => line === `## ${version}`);
}

function extractSectionBody(readme, version) {
  const lines = readme.split("\n");
  const start = lines.findIndex((line) => line === `## ${version}`);
  if (start < 0) {
    return undefined;
  }
  let end = start + 1;
  while (end < lines.length && !/^## /.test(lines[end])) {
    end += 1;
  }
  return lines
    .slice(start + 1, end)
    .join("\n")
    .replace(/^\n+/, "")
    .replace(/\n+$/, "");
}

function commitBullets(fromSha) {
  let log = "";
  try {
    const range = fromSha ? `${fromSha}..HEAD` : "HEAD";
    const args = fromSha
      ? ["log", range, "--pretty=format:%s"]
      : ["log", "-20", "--pretty=format:%s"];
    log = git(args);
  } catch {
    log = "";
  }
  const lines = log
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  if (lines.length === 0) {
    return "- Compilation de cette version.\n";
  }
  return lines.map((line) => `- ${line}`).join("\n") + "\n";
}

function insertSection(readme, version, body, sha) {
  const section = `## ${version}\n\n${body}\n`;
  const rev = `<!-- rev:${sha} -->`;
  if (readme.includes("<!-- rev:")) {
    const next = readme.replace(/<!-- rev:[0-9a-f]+ -->/, `${rev}\n\n${section.trim()}\n`);
    return next.endsWith("\n") ? next : `${next}\n`;
  }
  const trimmed = readme.replace(/\s*$/, "");
  return `${trimmed}\n\n${rev}\n\n${section}`;
}

function insertChangelogSection(changelog, version, body) {
  const section = `## ${version}\n\n${body.trimEnd()}\n\n`;
  if (hasSection(changelog, version)) {
    return changelog;
  }
  // Insère juste après le titre / intro (première ligne ## version ou fin d'intro).
  const lines = changelog.split("\n");
  let insertAt = 0;
  for (let i = 0; i < lines.length; i++) {
    if (/^## /.test(lines[i])) {
      insertAt = i;
      break;
    }
    insertAt = i + 1;
  }
  const next = [
    ...lines.slice(0, insertAt),
    section.trimEnd(),
    "",
    ...lines.slice(insertAt),
  ].join("\n");
  return next.endsWith("\n") ? next : `${next}\n`;
}

function publicChangelogBlock(version, body) {
  const bullets = body.trimEnd();
  return [
    PUBLIC_START,
    `### ${version}`,
    "",
    bullets,
    PUBLIC_END,
  ].join("\n");
}

function updatePublicReadme(version, body) {
  if (!fs.existsSync(publicReadmePath)) {
    throw new Error(`README.md introuvable : ${publicReadmePath}`);
  }
  const existing = fs.readFileSync(publicReadmePath, "utf8");
  const block = publicChangelogBlock(version, body);
  const section =
    [
      "## What's New",
      "",
      "Dernière version uniquement. Historique complet : onglet **Changelog** du Marketplace (`CHANGELOG.md`).",
      "",
      block,
    ].join("\n") + "\n\n";

  let next;
  if (/^## What's New\s*$/m.test(existing) && existing.includes(PUBLIC_END)) {
    next = existing.replace(
      /## What's New\n[\s\S]*?<!-- latest-changelog:end -->\n*/,
      section
    );
  } else if (
    /^## Nouveautés \/ What's new\s*$/m.test(existing) &&
    existing.includes(PUBLIC_END)
  ) {
    next = existing.replace(
      /## Nouveautés \/ What's new\n[\s\S]*?<!-- latest-changelog:end -->\n*/,
      section
    );
  } else if (existing.includes(PUBLIC_START) && existing.includes(PUBLIC_END)) {
    next = existing.replace(
      new RegExp(`${PUBLIC_START}[\\s\\S]*?${PUBLIC_END}`),
      block
    );
  } else if (/^## Français\s*$/m.test(existing)) {
    next = existing.replace(/^## Français\s*$/m, `${section}\n## Français`);
  } else {
    const trimmed = existing.replace(/\s*$/, "");
    next = `${trimmed}\n\n${section}`;
  }

  fs.writeFileSync(
    publicReadmePath,
    next.endsWith("\n") ? next : `${next}\n`,
    "utf8"
  );
}

function ensureVsixSection(version) {
  fs.mkdirSync(path.dirname(vsixReadmePath), { recursive: true });
  const existing = fs.existsSync(vsixReadmePath)
    ? fs.readFileSync(vsixReadmePath, "utf8")
    : "# SSH - Folders\n\nModifications de chaque version empaquetée dans ce dossier.\n";

  if (hasSection(existing, version)) {
    const body = extractSectionBody(existing, version);
    if (!body) {
      throw new Error(`section ## ${version} vide dans vsix/README.md`);
    }
    return body;
  }

  const revMatch = existing.match(/<!-- rev:([0-9a-f]+) -->/);
  const fromSha = revMatch ? revMatch[1] : "";
  let sha = "";
  try {
    sha = git(["rev-parse", "HEAD"]);
  } catch {
    sha = "";
  }
  const body = commitBullets(fromSha).trimEnd();
  const next = insertSection(existing, version, body, sha);
  fs.writeFileSync(vsixReadmePath, next.endsWith("\n") ? next : `${next}\n`, "utf8");
  return body;
}

/** Onglet Changelog du Marketplace : fichier racine CHANGELOG.md. */
function syncChangelog(version, body) {
  const header = "# Changelog\n\n";
  const existing = fs.existsSync(changelogPath)
    ? fs.readFileSync(changelogPath, "utf8")
    : header;
  const next = hasSection(existing, version)
    ? existing
    : insertChangelogSection(
        existing.startsWith("# ") ? existing : header + existing,
        version,
        body
      );
  fs.writeFileSync(changelogPath, next.endsWith("\n") ? next : `${next}\n`, "utf8");
}

function main() {
  const version = versionOfPackage();
  // Toujours : journal interne (inclut les builds locaux x.y.z-1).
  const body = ensureVsixSection(version);
  // Public (Marketplace) uniquement pour les versions x.y.z publiables.
  if (isPublishedVersion(version)) {
    syncChangelog(version, body);
    updatePublicReadme(version, body);
  }
}

main();
