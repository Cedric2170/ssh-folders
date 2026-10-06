import { folderLabel, type FolderEntry } from "./foldersConfig";

export type AzFolderRef = {
  alias: string;
  entry: FolderEntry;
};

export type AzGroup = {
  kind: "group";
  name: string;
  stem: string;
  items: AzFolderRef[];
};

export type AzLeaf = {
  kind: "leaf";
  name: string;
  item: AzFolderRef;
};

export type AzNode = AzGroup | AzLeaf;

const COMPARE = { sensitivity: "base", numeric: true } as const;

export function titleCaseName(value: string): string {
  const lower = value.toLocaleLowerCase("fr");
  let result = "";
  for (let i = 0; i < lower.length; i++) {
    const ch = lower[i];
    const prev = i === 0 ? "" : lower[i - 1];
    if (i === 0 || prev === " " || prev === "-") {
      result += ch.toLocaleUpperCase("fr");
    } else {
      result += ch;
    }
  }
  return result;
}

export function displayFolderName(entry: FolderEntry): string {
  return titleCaseName(folderLabel(entry));
}

function groupStem(label: string): string {
  const trimmed = label.trim();
  const match = trimmed.match(/^[\p{L}\p{N}]+/u);
  return (match ? match[0] : trimmed).toLocaleLowerCase("fr");
}

function longestCommonPrefix(values: string[]): string {
  if (values.length === 0) {
    return "";
  }
  const lower = values.map((value) => value.toLocaleLowerCase("fr"));
  let prefix = lower[0];
  for (const value of lower.slice(1)) {
    let index = 0;
    while (
      index < prefix.length &&
      index < value.length &&
      prefix[index] === value[index]
    ) {
      index += 1;
    }
    prefix = prefix.slice(0, index);
  }
  return prefix.replace(/[-_\s]+$/u, "");
}

function compareAzText(a: string, b: string): number {
  return a.localeCompare(b, "fr", COMPARE);
}

function compareRefs(a: AzFolderRef, b: AzFolderRef): number {
  const byName = compareAzText(displayFolderName(a.entry), displayFolderName(b.entry));
  if (byName !== 0) {
    return byName;
  }
  const byHost = compareAzText(a.alias, b.alias);
  if (byHost !== 0) {
    return byHost;
  }
  return a.entry.path.localeCompare(b.entry.path);
}

export function buildAzFolderTree(items: AzFolderRef[]): AzNode[] {
  const buckets = new Map<string, AzFolderRef[]>();
  for (const item of items) {
    const stem = groupStem(folderLabel(item.entry));
    const list = buckets.get(stem) ?? [];
    list.push(item);
    buckets.set(stem, list);
  }

  const nodes: AzNode[] = [];
  for (const [stem, list] of buckets) {
    list.sort(compareRefs);
    if (list.length === 1) {
      const item = list[0];
      nodes.push({
        kind: "leaf",
        name: displayFolderName(item.entry),
        item,
      });
      continue;
    }
    const prefix = longestCommonPrefix(list.map((item) => folderLabel(item.entry)));
    nodes.push({
      kind: "group",
      name: titleCaseName(prefix || stem),
      stem,
      items: list,
    });
  }

  nodes.sort((a, b) => compareAzText(a.name, b.name));
  return nodes;
}
