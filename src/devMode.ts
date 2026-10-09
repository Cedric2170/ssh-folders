import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";
import * as vscode from "vscode";

const ENV_NAME = "SSH_FOLDERS_DEV";

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
 * Actif seulement dans l'hôte de développement (F5) quand SSH_FOLDERS_DEV=1.
 * Run Extension pose cette variable. Run Extension (config réelle) la met à 0.
 * Un VSIX installé est en mode Production : la variable d'environnement est ignorée.
 */
export function initDevMode(context: vscode.ExtensionContext): boolean {
  enabled =
    context.extensionMode === vscode.ExtensionMode.Development &&
    process.env[ENV_NAME] === "1";
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

/** Recopie les exemples dans le stockage de l'extension. Ne touche ni ~/.ssh ni le dépôt. */
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
  assertDevWritePath(sshConfigPath);
  assertDevWritePath(foldersConfigPath);
  await fs.mkdir(sandboxRoot, { recursive: true });
  await fs.copyFile(sshSrc, sshConfigPath);
  await fs.copyFile(foldersSrc, foldersConfigPath);
}
