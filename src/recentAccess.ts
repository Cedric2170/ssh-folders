import * as vscode from "vscode";
import { MAX_RECENT_LIMIT } from "./foldersConfig";

const STATE_KEY = "recentAccess";

export type RecentAccess = {
  kind: "host" | "folder";
  alias: string;
  path?: string;
  at: number;
};

let memento: vscode.Memento | undefined;
let onChange: (() => void) | undefined;
let memoryOnly = false;
let memoryItems: RecentAccess[] = [];

export function initRecentAccess(
  state: vscode.Memento,
  listener?: () => void,
  memoryOnlyMode = false
): void {
  memoryOnly = memoryOnlyMode;
  memoryItems = [];
  memento = memoryOnlyMode ? undefined : state;
  onChange = listener;
}

function accessKey(entry: Pick<RecentAccess, "kind" | "alias" | "path">): string {
  if (entry.kind === "folder" && entry.path) {
    return `folder:${entry.alias.toLowerCase()}:${entry.path}`;
  }
  return `host:${entry.alias.toLowerCase()}`;
}

function isRecentAccess(value: unknown): value is RecentAccess {
  if (!value || typeof value !== "object") {
    return false;
  }
  const entry = value as RecentAccess;
  if (entry.kind !== "host" && entry.kind !== "folder") {
    return false;
  }
  if (typeof entry.alias !== "string" || !entry.alias.trim()) {
    return false;
  }
  if (typeof entry.at !== "number" || !Number.isFinite(entry.at)) {
    return false;
  }
  if (entry.kind === "folder" && typeof entry.path !== "string") {
    return false;
  }
  return true;
}

function storedAccess(): RecentAccess[] {
  const raw = memoryOnly
    ? memoryItems
    : (memento?.get<unknown>(STATE_KEY) ?? []);
  if (!Array.isArray(raw)) {
    return [];
  }
  return raw
    .filter(isRecentAccess)
    .sort((a, b) => b.at - a.at)
    .filter((entry, index, list) => {
      const key = accessKey(entry);
      return list.findIndex((item) => accessKey(item) === key) === index;
    })
    .slice(0, MAX_RECENT_LIMIT);
}

export function listRecentAccess(limit = MAX_RECENT_LIMIT): RecentAccess[] {
  const cap = Math.min(MAX_RECENT_LIMIT, Math.max(1, Math.round(limit)));
  return storedAccess().slice(0, cap);
}

export async function recordAccess(
  entry: Omit<RecentAccess, "at">
): Promise<void> {
  if (entry.kind === "folder" && !entry.path) {
    return;
  }
  const next: RecentAccess[] = [
    {
      kind: entry.kind,
      alias: entry.alias,
      ...(entry.path ? { path: entry.path } : {}),
      at: Date.now(),
    },
    ...storedAccess().filter((item) => accessKey(item) !== accessKey(entry)),
  ].slice(0, MAX_RECENT_LIMIT);
  await persistAccess(next);
}

async function persistAccess(next: RecentAccess[]): Promise<void> {
  if (memoryOnly) {
    memoryItems = next;
  } else {
    await memento?.update(STATE_KEY, next);
  }
  onChange?.();
}

export async function removeAccess(
  entry: Pick<RecentAccess, "kind" | "alias" | "path">
): Promise<void> {
  const next = storedAccess().filter(
    (item) => accessKey(item) !== accessKey(entry)
  );
  await persistAccess(next);
}

export function formatRelativeAccess(at: number, now = Date.now()): string {
  const diff = Math.max(0, now - at);
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 1) {
    return "à l'instant";
  }
  if (minutes < 60) {
    return `il y a ${minutes} min`;
  }
  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    return `il y a ${hours} h`;
  }
  const days = Math.floor(hours / 24);
  if (days === 1) {
    return "hier";
  }
  if (days < 7) {
    return `il y a ${days} j`;
  }
  return new Date(at).toLocaleDateString("fr-CH", {
    day: "numeric",
    month: "short",
  });
}
