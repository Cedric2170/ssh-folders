import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";
import * as vscode from "vscode";
import { assertDevWritePath, devFoldersConfigPath, isDevMode } from "./devMode";
import { sameHost } from "./sshConfig";

export interface FolderEntry {
  label?: string;
  path: string;
}

export const DEFAULT_RECENT_LIMIT = 20;
export const MAX_RECENT_LIMIT = 100;

/**
 * Clés écrites dans `defaults` lorsqu'elles manquent dans ssh-folders.json.
 * Chaque nouveau réglage qui a une valeur par défaut s'ajoute ici, dans le schéma et dans l'exemple.
 * Une clé sans défaut sûr, comme DefaultFolder, ne figure pas dans ce catalogue.
 */
export const DEFAULT_SETTINGS = {
  RecentLimit: DEFAULT_RECENT_LIMIT,
  ActiveColor: "green",
  SortAlphabetical: true,
} as const;

export const ACTIVE_COLOR_NAMES = [
  "green",
  "blue",
  "orange",
  "red",
  "purple",
  "yellow",
] as const;

export type ActiveColorName = (typeof ACTIVE_COLOR_NAMES)[number];

export type ActiveColor =
  | { kind: "name"; name: ActiveColorName }
  | { kind: "hex"; hex: string };

const ACTIVE_COLOR_ALIASES: Record<string, ActiveColorName> = {
  green: "green",
  vert: "green",
  blue: "blue",
  bleu: "blue",
  orange: "orange",
  red: "red",
  rouge: "red",
  purple: "purple",
  violet: "purple",
  yellow: "yellow",
  jaune: "yellow",
};

export interface FolderDefaults {
  DefaultFolder?: string;
  RecentLimit?: number;
  ActiveColor?: string;
  SortAlphabetical?: boolean;
  [key: string]: unknown;
}

export interface FoldersFile {
  $schema?: string;
  defaults?: FolderDefaults;
  folders: Record<string, FolderEntry[]>;
}

const EMPTY_FILE: FoldersFile = { folders: {} };
const RELATIVE_SCHEMA = "./remote-folders.schema.json";

function bundledExamplePath(): string {
  return path.join(__dirname, "..", "examples", "ssh-folders.example.json");
}

function bundledSchemaPath(): string {
  return path.join(__dirname, "..", "schemas", "remote-folders.schema.json");
}

async function copySchemaNextToConfig(configPath: string): Promise<void> {
  if (isDevMode()) {
    return;
  }
  const dest = path.join(path.dirname(configPath), "remote-folders.schema.json");
  await fs.copyFile(bundledSchemaPath(), dest);
}

/** Copie le schéma seulement s'il n'est pas déjà à côté du JSON. */
async function copySchemaIfAbsent(configPath: string): Promise<void> {
  if (isDevMode()) {
    return;
  }
  const dest = path.join(path.dirname(configPath), "remote-folders.schema.json");
  try {
    await fs.copyFile(bundledSchemaPath(), dest, fs.constants.COPYFILE_EXCL);
  } catch (error) {
    const err = error as NodeJS.ErrnoException;
    if (err.code === "EEXIST" || err.code === "ENOENT") {
      return;
    }
    throw error;
  }
}

function expandHome(filePath: string): string {
  if (filePath === "~") {
    return os.homedir();
  }
  if (filePath.startsWith("~/") || filePath.startsWith("~\\")) {
    return path.join(os.homedir(), filePath.slice(2));
  }
  return filePath;
}

export function getFoldersConfigPath(): string {
  if (isDevMode()) {
    return devFoldersConfigPath();
  }
  const custom = vscode.workspace
    .getConfiguration("sshFolders")
    .get<string>("configPath");
  if (custom && custom.trim()) {
    return expandHome(custom.trim());
  }
  return path.join(os.homedir(), ".ssh", "extensions", "ssh-folders.json");
}

export function folderLabel(entry: FolderEntry): string {
  if (entry.label && entry.label.trim()) {
    return entry.label.trim();
  }
  const base = path.posix.basename(entry.path);
  return base || entry.path;
}

export function assertRemotePath(remotePath: string): string {
  const trimmed = remotePath.trim();
  if (!trimmed.startsWith("/")) {
    throw new Error("Le chemin distant doit être absolu (commencer par /).");
  }
  if (trimmed.includes("~")) {
    throw new Error("Le chemin distant ne doit pas contenir ~.");
  }
  return trimmed;
}

/** Dossier projects d'un hôte (libellé Projects, chemin se terminant par /projects, ou DefaultFolder). */
export function projectsRootForHost(
  host: string,
  folders: Record<string, FolderEntry[]>,
  globalDefault?: string
): string | undefined {
  const list = folders[host] ?? [];
  for (const entry of list) {
    if (entry.label?.trim().toLocaleLowerCase("fr") === "projects") {
      return entry.path.replace(/\/+$/, "");
    }
  }
  for (const entry of list) {
    const normalized = entry.path.replace(/\/+$/, "");
    if (normalized.endsWith("/projects")) {
      return normalized;
    }
  }
  return globalDefault?.replace(/\/+$/, "");
}

/**
 * Corrige /opt/docker/foo → /opt/docker/projects/foo quand le dossier projects existe
 * mais a été omis à la saisie manuelle.
 */
export function repairPathUnderProjectsRoot(
  remotePath: string,
  projectsRoot: string
): string {
  const root = projectsRoot.replace(/\/+$/, "");
  const parent = path.posix.dirname(root);
  const rootBase = path.posix.basename(root);
  const prefix = `${parent}/`;
  if (!remotePath.startsWith(prefix)) {
    return remotePath;
  }
  if (remotePath === root || remotePath.startsWith(`${root}/`)) {
    return remotePath;
  }
  const rest = remotePath.slice(prefix.length);
  if (rest === rootBase || rest.startsWith(`${rootBase}/`)) {
    return remotePath;
  }
  return `${root}/${rest.replace(/^\/+/, "")}`;
}

export function foldersForHost(
  data: FoldersFile,
  host: string
): FolderEntry[] {
  const entries: FolderEntry[] = [];
  const seen = new Set<string>();
  for (const [key, list] of Object.entries(data.folders)) {
    if (!sameHost(key, host)) {
      continue;
    }
    for (const entry of list) {
      if (seen.has(entry.path)) {
        continue;
      }
      seen.add(entry.path);
      entries.push(entry);
    }
  }
  return entries;
}

export function findFolderEntry(
  data: FoldersFile,
  host: string,
  remotePath: string
): FolderEntry | undefined {
  return foldersForHost(data, host).find((entry) => entry.path === remotePath);
}

function existingHostKey(data: FoldersFile, host: string): string | undefined {
  return Object.keys(data.folders).find((key) => sameHost(key, host));
}

function isFolderEntry(value: unknown): value is FolderEntry {
  if (!value || typeof value !== "object") {
    return false;
  }
  const entry = value as FolderEntry;
  return typeof entry.path === "string";
}

function normalizeDefaults(raw: unknown): FolderDefaults | undefined {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return undefined;
  }
  const rec = raw as Record<string, unknown>;
  const defaults: FolderDefaults = { ...rec };
  if (typeof rec.DefaultFolder === "string" && rec.DefaultFolder.trim()) {
    defaults.DefaultFolder = assertRemotePath(rec.DefaultFolder);
  } else {
    delete defaults.DefaultFolder;
  }
  if (typeof rec.RecentLimit === "number" && Number.isFinite(rec.RecentLimit)) {
    defaults.RecentLimit = Math.min(
      MAX_RECENT_LIMIT,
      Math.max(1, Math.round(rec.RecentLimit))
    );
  } else {
    delete defaults.RecentLimit;
  }
  if (typeof rec.ActiveColor === "string" && parseActiveColor(rec.ActiveColor)) {
    defaults.ActiveColor = rec.ActiveColor.trim();
  } else {
    delete defaults.ActiveColor;
  }
  if (typeof rec.SortAlphabetical === "boolean") {
    defaults.SortAlphabetical = rec.SortAlphabetical;
  } else {
    delete defaults.SortAlphabetical;
  }
  return Object.keys(defaults).length > 0 ? defaults : undefined;
}

function normalizeHex(value: string): string | undefined {
  const match = /^#([0-9a-f]{3}|[0-9a-f]{6})$/.exec(value);
  if (!match) {
    return undefined;
  }
  const body = match[1];
  if (body.length === 3) {
    return `#${body[0]}${body[0]}${body[1]}${body[1]}${body[2]}${body[2]}`;
  }
  return `#${body}`;
}

export function parseActiveColor(raw: unknown): ActiveColor | undefined {
  if (typeof raw !== "string") {
    return undefined;
  }
  const text = raw.trim().toLowerCase();
  const name = ACTIVE_COLOR_ALIASES[text];
  if (name) {
    return { kind: "name", name };
  }
  const hex = normalizeHex(text);
  if (!hex) {
    return undefined;
  }
  return { kind: "hex", hex };
}

/** Vert si la clé est absente ou illisible. */
export function activeColorOf(data: FoldersFile | undefined): ActiveColor {
  return (
    parseActiveColor(data?.defaults?.ActiveColor) ?? {
      kind: "name",
      name: "green",
    }
  );
}

function rawDefaultsRecord(raw: unknown): Record<string, unknown> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return {};
  }
  return raw as Record<string, unknown>;
}

/** Ajoute les clés du catalogue absentes du fichier. Une clé déjà présente est conservée. */
export function applyMissingDefaults(
  data: FoldersFile,
  rawDefaults: unknown
): { data: FoldersFile; added: boolean } {
  const raw = rawDefaultsRecord(rawDefaults);
  const defaults: FolderDefaults = { ...(data.defaults ?? {}) };
  let added = false;
  for (const [key, value] of Object.entries(DEFAULT_SETTINGS)) {
    if (Object.prototype.hasOwnProperty.call(raw, key)) {
      continue;
    }
    defaults[key] = value;
    added = true;
  }
  if (!added) {
    return { data, added: false };
  }
  return {
    data: { ...data, defaults },
    added: true,
  };
}

function normalizeFile(raw: unknown): FoldersFile {
  return normalizeFileWithMeta(raw).data;
}

export function normalizeFileWithMeta(raw: unknown): {
  data: FoldersFile;
  repairedPaths: boolean;
} {
  if (!raw || typeof raw !== "object") {
    return { data: { ...EMPTY_FILE }, repairedPaths: false };
  }
  const source = raw as FoldersFile;
  const foldersRaw = source.folders;
  if (!foldersRaw || typeof foldersRaw !== "object") {
    return { data: { ...EMPTY_FILE }, repairedPaths: false };
  }

  const folders: Record<string, FolderEntry[]> = {};
  for (const [host, list] of Object.entries(foldersRaw)) {
    if (!Array.isArray(list)) {
      continue;
    }
    folders[host] = list.filter(isFolderEntry).map((entry) => ({
      path: entry.path,
      ...(entry.label ? { label: entry.label } : {}),
    }));
  }
  const defaults = normalizeDefaults(source.defaults);
  const globalDefault = defaults?.DefaultFolder;
  let repairedPaths = false;
  for (const [host, list] of Object.entries(folders)) {
    const projectsRoot = projectsRootForHost(host, folders, globalDefault);
    if (!projectsRoot) {
      continue;
    }
    folders[host] = list.map((entry) => {
      const pathFixed = repairPathUnderProjectsRoot(entry.path, projectsRoot);
      if (pathFixed === entry.path) {
        return entry;
      }
      repairedPaths = true;
      return { ...entry, path: pathFixed };
    });
  }
  return {
    data: {
      folders,
      ...(defaults ? { defaults } : {}),
    },
    repairedPaths,
  };
}

let foldersCache: { path: string; data: FoldersFile } | undefined;
let foldersInFlight: Promise<FoldersFile> | undefined;

export function invalidateFoldersCache(): void {
  foldersCache = undefined;
}

export function cachedFoldersFile(): FoldersFile | undefined {
  const filePath = getFoldersConfigPath();
  if (foldersCache && foldersCache.path === filePath) {
    return foldersCache.data;
  }
  return undefined;
}

async function loadFoldersFile(filePath: string): Promise<FoldersFile> {
  let content: string;
  try {
    content = await fs.readFile(filePath, "utf8");
  } catch (error) {
    const err = error as NodeJS.ErrnoException;
    if (err.code === "ENOENT") {
      const data = { ...EMPTY_FILE };
      foldersCache = { path: filePath, data };
      return data;
    }
    throw error;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    throw new Error(`Fichier JSON invalide : ${filePath}`);
  }

  const { data, repairedPaths } = normalizeFileWithMeta(parsed);
  const rawDefaults =
    parsed && typeof parsed === "object"
      ? (parsed as FoldersFile).defaults
      : undefined;
  const merged = applyMissingDefaults(data, rawDefaults);
  foldersCache = { path: filePath, data: merged.data };
  if (merged.added || (repairedPaths && !isDevMode())) {
    await writeFoldersFile(merged.data);
  }
  return foldersCache.data;
}

export async function readFoldersFile(): Promise<FoldersFile> {
  const filePath = getFoldersConfigPath();
  const cached = cachedFoldersFile();
  if (cached) {
    return cached;
  }
  if (!foldersInFlight) {
    foldersInFlight = loadFoldersFile(filePath).finally(() => {
      foldersInFlight = undefined;
    });
  }
  return foldersInFlight;
}

export async function writeFoldersFile(data: FoldersFile): Promise<void> {
  const filePath = getFoldersConfigPath();
  assertDevWritePath(filePath);
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await copySchemaNextToConfig(filePath);
  const complete = applyMissingDefaults(data, data.defaults).data;
  const payload = `${JSON.stringify(
    {
      $schema: RELATIVE_SCHEMA,
      ...(complete.defaults ? { defaults: complete.defaults } : {}),
      folders: complete.folders,
    },
    null,
    2
  )}\n`;
  await fs.writeFile(filePath, payload, "utf8");
  foldersCache = { path: filePath, data: normalizeFile(complete) };
}

export function defaultFolderPath(data: FoldersFile): string | undefined {
  return data.defaults?.DefaultFolder;
}

/** Vrai par défaut. `false` conserve l'ordre du fichier SSH config et du JSON. */
export function sortAlphabetical(data: FoldersFile | undefined): boolean {
  return data?.defaults?.SortAlphabetical !== false;
}

export function recentLimit(data: FoldersFile): number {
  const value = data.defaults?.RecentLimit;
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return DEFAULT_RECENT_LIMIT;
  }
  return Math.min(MAX_RECENT_LIMIT, Math.max(1, Math.round(value)));
}

export function labelFromDefaultFolder(
  remotePath: string,
  defaultFolder?: string
): string {
  if (!defaultFolder) {
    return path.posix.basename(remotePath);
  }
  const normalizedDefault = defaultFolder.replace(/\/+$/, "");
  if (remotePath === normalizedDefault || remotePath === `${normalizedDefault}/`) {
    return "";
  }
  const prefix = `${normalizedDefault}/`;
  if (remotePath.startsWith(prefix)) {
    return remotePath.slice(prefix.length).replace(/^\/+/, "");
  }
  return path.posix.basename(remotePath);
}

export async function addFolderEntry(
  host: string,
  entry: FolderEntry
): Promise<void> {
  const data = await readFoldersFile();
  const key = existingHostKey(data, host) ?? host;
  if (foldersForHost(data, key).some((item) => item.path === entry.path)) {
    throw new Error("Ce dossier est déjà enregistré pour cet hôte.");
  }
  const list = data.folders[key] ?? [];
  list.push(entry);
  data.folders[key] = list;
  await writeFoldersFile(data);
}

export async function renameFolderEntry(
  host: string,
  remotePath: string,
  label: string
): Promise<void> {
  const data = await readFoldersFile();
  const key = existingHostKey(data, host);
  const list = key ? data.folders[key] ?? [] : [];
  const entry = list.find((item) => item.path === remotePath);
  if (!key || !entry) {
    throw new Error("Dossier introuvable dans la configuration.");
  }
  const trimmed = label.trim();
  if (trimmed) {
    entry.label = trimmed;
  } else {
    delete entry.label;
  }
  await writeFoldersFile(data);
}

export async function removeFolderEntry(
  host: string,
  remotePath: string
): Promise<void> {
  const data = await readFoldersFile();
  const key = existingHostKey(data, host);
  if (!key) {
    return;
  }
  const list = data.folders[key] ?? [];
  data.folders[key] = list.filter((item) => item.path !== remotePath);
  if (data.folders[key].length === 0) {
    delete data.folders[key];
  }
  await writeFoldersFile(data);
}

async function seedFoldersFileFromExample(filePath: string): Promise<void> {
  assertDevWritePath(filePath);
  const raw = await fs.readFile(bundledExamplePath(), "utf8");
  const parsed = JSON.parse(raw) as Record<string, unknown>;
  // L'exemple du dépôt pointe vers ../schemas/ pour l'éditeur.
  // Le fichier installé a le schéma copié dans le même dossier.
  parsed.$schema = RELATIVE_SCHEMA;
  const payload = `${JSON.stringify(parsed, null, 2)}\n`;
  await fs.writeFile(filePath, payload, { encoding: "utf8", flag: "wx" });
}

export async function ensureFoldersFile(): Promise<string> {
  if (isDevMode()) {
    return getFoldersConfigPath();
  }
  const filePath = getFoldersConfigPath();
  let jsonExists = true;
  try {
    await fs.access(filePath);
  } catch (error) {
    const err = error as NodeJS.ErrnoException;
    if (err.code !== "ENOENT") {
      throw error;
    }
    jsonExists = false;
  }

  if (!jsonExists) {
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    try {
      await seedFoldersFileFromExample(filePath);
      invalidateFoldersCache();
    } catch (error) {
      const err = error as NodeJS.ErrnoException;
      if (err.code === "EEXIST") {
        // Un autre lancement a créé le fichier : on garde cette copie.
      } else if (err.code === "ENOENT") {
        await writeFoldersFile({ ...EMPTY_FILE });
        return filePath;
      } else {
        throw error;
      }
    }
  }

  await copySchemaIfAbsent(filePath);
  return filePath;
}
