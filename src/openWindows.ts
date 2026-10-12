import * as fs from "fs";
import * as path from "path";
import * as vscode from "vscode";
import {
  hostFromRemoteAuthority,
  sameHost,
  sameRemotePath,
} from "./sshConfig";

type OpenSession = {
  host: string;
  path?: string;
};

let sessions: OpenSession[] = [];
let watchTimer: ReturnType<typeof setTimeout> | undefined;

export function isHostInOpenWindow(alias: string): boolean {
  return sessions.some((item) => sameHost(item.host, alias));
}

export function isFolderInOpenWindow(alias: string, folderPath: string): boolean {
  return sessions.some(
    (item) =>
      item.path !== undefined &&
      sameHost(item.host, alias) &&
      sameRemotePath(item.path, folderPath)
  );
}

function storageFile(context: vscode.ExtensionContext): string {
  return path.join(context.globalStorageUri.fsPath, "..", "storage.json");
}

function sessionFromUri(value: string): OpenSession | undefined {
  let uri: vscode.Uri;
  try {
    uri = vscode.Uri.parse(value);
  } catch {
    return undefined;
  }
  if (uri.scheme !== "vscode-remote") {
    return undefined;
  }
  const host = hostFromRemoteAuthority(uri.authority);
  if (!host) {
    return undefined;
  }
  if (!uri.path || uri.path === "/") {
    return { host };
  }
  return { host, path: uri.path };
}

function parseSessions(data: unknown): OpenSession[] {
  if (!data || typeof data !== "object") {
    return [];
  }
  const state = (
    data as {
      windowsState?: { openedWindows?: unknown[]; lastActiveWindow?: unknown };
    }
  ).windowsState;
  const windows = [...(state?.openedWindows ?? [])];
  if (state?.lastActiveWindow) {
    windows.push(state.lastActiveWindow);
  }
  const found: OpenSession[] = [];
  const seen = new Set<string>();
  for (const win of windows) {
    if (!win || typeof win !== "object") {
      continue;
    }
    const rec = win as { folder?: unknown; remoteAuthority?: unknown };
    const candidates: OpenSession[] = [];
    if (typeof rec.folder === "string") {
      const session = sessionFromUri(rec.folder);
      if (session) {
        candidates.push(session);
      }
    }
    if (typeof rec.remoteAuthority === "string") {
      const host = hostFromRemoteAuthority(rec.remoteAuthority);
      if (host) {
        candidates.push({ host });
      }
    }
    for (const session of candidates) {
      const key = `${session.host.toLowerCase()}\0${session.path ?? ""}`;
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      found.push(session);
    }
  }
  return found;
}

function readSessions(filePath: string): OpenSession[] | undefined {
  let raw: string;
  try {
    raw = fs.readFileSync(filePath, "utf8");
  } catch {
    return [];
  }
  try {
    return parseSessions(JSON.parse(raw) as unknown);
  } catch {
    return undefined;
  }
}

function sameSessions(a: OpenSession[], b: OpenSession[]): boolean {
  if (a.length !== b.length) {
    return false;
  }
  const keys = (items: OpenSession[]): string[] =>
    items
      .map((item) => `${item.host.toLowerCase()}\0${item.path ?? ""}`)
      .sort();
  const left = keys(a);
  const right = keys(b);
  return left.every((key, index) => key === right[index]);
}

/** Suit les fenêtres distantes déjà ouvertes, pour les colorier depuis la fenêtre locale. */
export function watchOpenWindows(
  context: vscode.ExtensionContext,
  onChange: () => void
): vscode.Disposable {
  const filePath = storageFile(context);
  const reload = (): void => {
    const next = readSessions(filePath);
    if (!next || sameSessions(sessions, next)) {
      return;
    }
    sessions = next;
    onChange();
  };
  reload();
  let watcher: fs.FSWatcher | undefined;
  try {
    watcher = fs.watch(path.dirname(filePath), (_event, filename) => {
      if (filename !== "storage.json") {
        return;
      }
      if (watchTimer) {
        clearTimeout(watchTimer);
      }
      watchTimer = setTimeout(reload, 200);
    });
  } catch {
    watcher = undefined;
  }
  const timer = setInterval(reload, 3000);
  return new vscode.Disposable(() => {
    watcher?.close();
    clearInterval(timer);
    if (watchTimer) {
      clearTimeout(watchTimer);
    }
  });
}
