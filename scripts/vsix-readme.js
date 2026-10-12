const { execFileSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const readmePath = path.join(root, "vsix", "README.md");

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

function hasSection(readme, version) {
  return readme.split("\n").some((line) => line === `## ${version}`);
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

function main() {
  const version = versionOfPackage();
  fs.mkdirSync(path.dirname(readmePath), { recursive: true });
  const existing = fs.existsSync(readmePath)
    ? fs.readFileSync(readmePath, "utf8")
    : "# SSH - Folders\n\nModifications de chaque version empaquetée dans ce dossier.\n";
  if (hasSection(existing, version)) {
    return;
  }
  const revMatch = existing.match(/<!-- rev:([0-9a-f]+) -->/);
  const fromSha = revMatch ? revMatch[1] : "";
  let sha = "";
  try {
    sha = git(["rev-parse", "HEAD"]);
  } catch {
    sha = "";
  }
  const next = insertSection(existing, version, commitBullets(fromSha).trimEnd(), sha);
  fs.writeFileSync(readmePath, next.endsWith("\n") ? next : `${next}\n`, "utf8");
}

main();
