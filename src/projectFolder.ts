import { execFile } from "child_process";
import * as fs from "fs/promises";
import * as path from "path";
import { promisify } from "util";
import * as vscode from "vscode";
import { expandLocalPath } from "./foldersConfig";

const execFileAsync = promisify(execFile);

/** Échappe une chaîne pour un argument shell simple-quoted. */
export function shellSingleQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

async function sshExitCode(alias: string, remoteCommand: string): Promise<number> {
  try {
    await execFileAsync(
      "ssh",
      [
        "-o",
        "BatchMode=yes",
        "-o",
        "ConnectTimeout=15",
        alias,
        "--",
        "sh",
        "-c",
        remoteCommand,
      ],
      { encoding: "utf8", timeout: 30_000 }
    );
    return 0;
  } catch (error) {
    const err = error as NodeJS.ErrnoException & {
      status?: number;
      code?: string | number;
    };
    if (err.code === "ENOENT") {
      throw new Error(
        vscode.l10n.t("SSH client not found. Install OpenSSH to create remote folders.")
      );
    }
    if (typeof err.status === "number") {
      return err.status;
    }
    if (typeof err.code === "number") {
      return err.code;
    }
    throw error;
  }
}

export async function remoteDirExists(
  alias: string,
  remotePath: string
): Promise<boolean> {
  const code = await sshExitCode(
    alias,
    `test -d ${shellSingleQuote(remotePath)}`
  );
  return code === 0;
}

/**
 * Crée uniquement le dossier feuille (pas d'arborescence `-p`).
 * Le parent doit déjà exister sur l'hôte.
 */
export async function createRemoteLeafDirectory(
  alias: string,
  remotePath: string
): Promise<void> {
  const parent = path.posix.dirname(remotePath);
  if (parent === remotePath) {
    throw new Error(vscode.l10n.t("Cannot create the filesystem root."));
  }
  const parentOk = await sshExitCode(
    alias,
    `test -d ${shellSingleQuote(parent)}`
  );
  if (parentOk !== 0) {
    throw new Error(
      vscode.l10n.t(
        "Parent folder does not exist on the host: {0}. Create only the project folder, not the full tree.",
        parent
      )
    );
  }
  const created = await sshExitCode(
    alias,
    `mkdir ${shellSingleQuote(remotePath)}`
  );
  if (created !== 0) {
    throw new Error(
      vscode.l10n.t("Could not create folder {0} on {1}.", remotePath, alias)
    );
  }
}

export async function localDirExists(localPath: string): Promise<boolean> {
  try {
    const stat = await fs.stat(expandLocalPath(localPath));
    return stat.isDirectory();
  } catch {
    return false;
  }
}

/**
 * Crée uniquement le dossier feuille en local (sans parents manquants).
 */
export async function createLocalLeafDirectory(localPath: string): Promise<void> {
  const absolute = expandLocalPath(localPath);
  const parent = path.dirname(absolute);
  if (parent === absolute) {
    throw new Error(vscode.l10n.t("Cannot create the filesystem root."));
  }
  try {
    const stat = await fs.stat(parent);
    if (!stat.isDirectory()) {
      throw new Error(
        vscode.l10n.t(
          "Parent folder does not exist: {0}. Create only the project folder, not the full tree.",
          parent
        )
      );
    }
  } catch (error) {
    if (
      error instanceof Error &&
      error.message.includes("Parent folder does not exist")
    ) {
      throw error;
    }
    throw new Error(
      vscode.l10n.t(
        "Parent folder does not exist: {0}. Create only the project folder, not the full tree.",
        parent
      )
    );
  }
  try {
    await fs.mkdir(absolute);
  } catch (error) {
    const err = error as NodeJS.ErrnoException;
    if (err.code === "EEXIST") {
      return;
    }
    throw new Error(
      vscode.l10n.t(
        "Could not create folder {0}: {1}",
        absolute,
        err.message || String(error)
      )
    );
  }
}

/**
 * Si le dossier n'existe pas : demande confirmation, crée la feuille seulement,
 * puis l'appelant ajoute l'entrée au JSON. Retourne false si annulé / échec.
 */
export async function confirmAndCreateProjectFolder(options: {
  alias: string;
  folderPath: string;
  local: boolean;
}): Promise<boolean> {
  const { alias, folderPath, local } = options;
  const exists = local
    ? await localDirExists(folderPath)
    : await remoteDirExists(alias, folderPath);
  if (exists) {
    return true;
  }

  const name = local
    ? path.basename(expandLocalPath(folderPath))
    : path.posix.basename(folderPath);
  const createLabel = vscode.l10n.t("Create");
  const choice = await vscode.window.showWarningMessage(
    vscode.l10n.t(
      'Folder "{0}" does not exist on {1}. Create this project folder only (parent must already exist)?',
      name,
      alias
    ),
    { modal: true },
    createLabel
  );
  if (choice !== createLabel) {
    return false;
  }

  try {
    if (local) {
      await createLocalLeafDirectory(folderPath);
    } else {
      await createRemoteLeafDirectory(alias, folderPath);
    }
    void vscode.window.showInformationMessage(
      vscode.l10n.t('Folder "{0}" created on {1}.', name, alias)
    );
    return true;
  } catch (error) {
    void vscode.window.showErrorMessage((error as Error).message);
    return false;
  }
}
