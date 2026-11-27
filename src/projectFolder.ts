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

type SshRunResult = {
  code: number;
  stderr: string;
};

async function sshRun(
  alias: string,
  remoteCommand: string
): Promise<SshRunResult> {
  try {
    // Une seule chaîne distante : OpenSSH joint les argv avec des espaces,
    // donc `sh -c mkdir -p '…'` ferait tourner mkdir sans opérande.
    // ControlMaster=no : évite le conflit avec le multiplex Cursor Remote-SSH
    // (extension `ui` = ssh toujours depuis la machine locale).
    await execFileAsync(
      "ssh",
      [
        "-o",
        "BatchMode=yes",
        "-o",
        "ConnectTimeout=15",
        "-o",
        "ControlMaster=no",
        "-o",
        "ControlPath=none",
        alias,
        remoteCommand,
      ],
      { encoding: "utf8", timeout: 30_000 }
    );
    return { code: 0, stderr: "" };
  } catch (error) {
    const err = error as NodeJS.ErrnoException & {
      status?: number;
      code?: string | number;
      stderr?: string;
    };
    if (err.code === "ENOENT") {
      throw new Error(
        vscode.l10n.t(
          "SSH client not found. Install OpenSSH to create remote folders."
        )
      );
    }
    const stderr = typeof err.stderr === "string" ? err.stderr.trim() : "";
    if (typeof err.status === "number") {
      return { code: err.status, stderr };
    }
    if (typeof err.code === "number") {
      return { code: err.code, stderr };
    }
    throw error;
  }
}

export async function remoteDirExists(
  alias: string,
  remotePath: string
): Promise<boolean> {
  const code = (
    await sshRun(alias, `test -d ${shellSingleQuote(remotePath)}`)
  ).code;
  return code === 0;
}

/**
 * Crée le dossier distant (et les parents manquants via `mkdir -p`).
 */
export async function createRemoteLeafDirectory(
  alias: string,
  remotePath: string
): Promise<void> {
  const normalized = remotePath.replace(/\/+$/, "") || "/";
  if (normalized === "/") {
    throw new Error(vscode.l10n.t("Cannot create the filesystem root."));
  }
  const probe = await sshRun(alias, "true");
  if (probe.code !== 0) {
    throw new Error(
      vscode.l10n.t(
        "Cannot reach host {0} via SSH.{1}",
        alias,
        probe.stderr ? ` ${probe.stderr}` : ""
      )
    );
  }
  const created = await sshRun(
    alias,
    `mkdir -p ${shellSingleQuote(normalized)}`
  );
  if (created.code !== 0) {
    throw new Error(
      vscode.l10n.t(
        "Could not create folder {0} on {1}.{2}",
        normalized,
        alias,
        created.stderr ? ` ${created.stderr}` : ""
      )
    );
  }
  const verified = await sshRun(
    alias,
    `test -d ${shellSingleQuote(normalized)}`
  );
  if (verified.code !== 0) {
    throw new Error(
      vscode.l10n.t(
        "Could not create folder {0} on {1}.{2}",
        normalized,
        alias,
        verified.stderr ? ` ${verified.stderr}` : ""
      )
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
 * Crée le dossier local (et les parents manquants).
 */
export async function createLocalLeafDirectory(
  localPath: string
): Promise<void> {
  const absolute = expandLocalPath(localPath);
  const parent = path.dirname(absolute);
  if (parent === absolute) {
    throw new Error(vscode.l10n.t("Cannot create the filesystem root."));
  }
  try {
    await fs.mkdir(absolute, { recursive: true });
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
 * Si le dossier n'existe pas : demande confirmation, crée le chemin
 * (parents inclus), puis l'appelant ajoute l'entrée au JSON.
 * Retourne false si annulé / échec.
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
      'Folder "{0}" does not exist on {1}. Create it (including any missing parent folders)?',
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
