import * as fs from "fs";
import * as fsPromises from "fs/promises";
import * as os from "os";
import * as path from "path";
import * as vscode from "vscode";

const ENV_NAME = "SSH_FOLDERS_DEV";
/** Force la recopie des exemples par-dessus le bac à sable existant. */
const RESET_ENV_NAME = "SSH_FOLDERS_DEV_RESET";
/** Fichier local (écrit par npm / tâches) : `real` ou `sandbox`. Prioritaire sur l'env. */
const MODE_FILE = path.join(".vscode", "ssh-folders-dev.mode");

let enabled = false;
let sandboxRoot = "";
let sshConfigPath = "";
let foldersConfigPath = "";

function isInside(root: string, target: string): boolean {
  const rel = path.relative(root, target);
  return (
    rel === "" ||
    (!rel.startsWith(`..${path.sep}`) && rel !== ".." && !path.isAbsolute(rel))
  );
}

/**
 * Lit le mode demandé pour l'hôte de développement.
 * Le fichier `.vscode/ssh-folders-dev.mode` prime sur `SSH_FOLDERS_DEV` :
 * l'env peut rester collée au process Cursor après un ancien lancement.
 * Absent / `real` → JSON réel. `sandbox` → exemples. Un VSIX ignore tout ça.
 */
function wantSandbox(extensionPath: string): boolean {
  const marker = path.join(extensionPath, MODE_FILE);
  try {
    const mode = fs.readFileSync(marker, "utf8").trim().toLowerCase();
    if (mode === "sandbox") {
      return true;
    }
    if (mode === "real") {
      return false;
    }
  } catch {
    // pas de marqueur
  }
  return process.env[ENV_NAME] === "1";
}

/**
 * Bac à sable (exemples/) seulement en Development + mode `sandbox`
 * (fichier marqueur ou SSH_FOLDERS_DEV=1). Par défaut : fichiers réels.
 */
export function initDevMode(context: vscode.ExtensionContext): boolean {
  enabled =
    context.extensionMode === vscode.ExtensionMode.Development &&
    wantSandbox(context.extensionPath);
  if (!enabled) {
    sandboxRoot = "";
    sshConfigPath = "";
    foldersConfigPath = "";
    return false;
  }
  sandboxRoot = path.join(context.globalStorageUri.fsPath, "ssh-folders-dev");
  sshConfigPath = path.join(sandboxRoot, "config");
  foldersConfigPath = path.join(sandboxRoot, "ssh-folders.json");
  return true;
}

export function isDevMode(): boolean {
  return enabled;
}

export function devSshConfigPath(): string {
  return sshConfigPath;
}

export function devFoldersConfigPath(): string {
  return foldersConfigPath;
}

/** Refuse toute écriture hors du bac à sable, en particulier sous ~/.ssh. */
export function assertDevWritePath(filePath: string): void {
  if (!enabled) {
    return;
  }
  const root = path.resolve(sandboxRoot);
  const resolved = path.resolve(filePath);
  const userSsh = path.resolve(path.join(os.homedir(), ".ssh"));
  if (!sandboxRoot || !isInside(root, resolved) || isInside(userSsh, resolved)) {
    throw new Error(
      "Mode dev : refus d'écrire ce fichier. ~/.ssh et le dépôt ne sont pas modifiés."
    );
  }
}

async function copyIfMissingOrReset(
  src: string,
  dest: string,
  reset: boolean
): Promise<void> {
  assertDevWritePath(dest);
  if (!reset) {
    try {
      await fsPromises.access(dest);
      return;
    } catch {
      // absent → seed
    }
  }
  await fsPromises.copyFile(src, dest);
}

/**
 * Initialise le bac à sable depuis `examples/` s'il est vide.
 * Les ajouts (dossiers, libellés…) sont conservés entre F5 / relances.
 * Recopie forcée si `SSH_FOLDERS_DEV_RESET=1` (script `dev:host:exemples:reset`).
 */
export async function prepareDevSandbox(
  context: vscode.ExtensionContext
): Promise<void> {
  if (!enabled) {
    return;
  }
  const sshSrc = path.join(
    context.extensionPath,
    "examples",
    "ssh-config.example"
  );
  const foldersSrc = path.join(
    context.extensionPath,
    "examples",
    "ssh-folders.example.json"
  );
  const reset = process.env[RESET_ENV_NAME] === "1";
  await fsPromises.mkdir(sandboxRoot, { recursive: true });
  await copyIfMissingOrReset(sshSrc, sshConfigPath, reset);
  await copyIfMissingOrReset(foldersSrc, foldersConfigPath, reset);
}
