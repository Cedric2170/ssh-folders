import * as assert from "assert";
import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";
import { after, before, beforeEach, describe, it } from "node:test";
import * as vscode from "vscode";
import {
  addLocalFolderEntry,
  applyMissingDefaults,
  assertLocalPath,
  compareHostRoots,
  DEFAULT_LOCAL_SEED,
  DEFAULT_SETTINGS,
  defaultFolderPath,
  virtualHostPosition,
  expandLocalPath,
  invalidateFoldersCache,
  isArchiveFolderPath,
  isFavoriteFolder,
  isFavoriteHost,
  isHostHidden,
  listLocalSubdirectories,
  localFoldersForHost,
  localVirtualHosts,
  normalizeFileWithMeta,
  pathParentName,
  readFoldersFile,
  removeLocalFolderEntry,
  toTildePath,
  visibleHostAliases,
  writeFoldersFile,
  ICON_PALETTE_NAMES,
  parseIconPaletteColor,
  type FoldersFile,
} from "../foldersConfig";
import { suggestedRemoteAddPath } from "../sshConfig";
import {
  createLocalLeafDirectory,
  localDirExists,
  shellSingleQuote,
} from "../projectFolder";
import {
  buildAzFolderTree,
  sortFolderEntries,
} from "../folderDisplay";
import {
  resolveFolderIconPalette,
  resolveHostIconPalette,
} from "../iconColors";
import {
  initDevMode,
  isDevMode,
  prepareDevSandbox,
  devFoldersConfigPath,
} from "../devMode";

type VscodeMock = typeof vscode & {
  __setConfig(key: string, value: unknown): void;
  __clearConfig(): void;
};

const vscodeMock = vscode as VscodeMock;

async function makeTempDir(prefix: string): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), prefix));
}

describe("chemins locaux", () => {
  it("accepte ~ et chemins absolus", () => {
    assert.strictEqual(assertLocalPath("~/Documents"), "~/Documents");
    assert.strictEqual(assertLocalPath("~"), "~");
    const abs = path.join(os.homedir(), "tmp-ssh-folders-test");
    assert.strictEqual(assertLocalPath(abs), abs);
  });

  it("refuse un chemin relatif", () => {
    assert.throws(() => assertLocalPath("Documents/Projets"), /absolute|~/);
  });

  it("toTildePath / expandLocalPath / same sous-home", () => {
    const home = os.homedir();
    assert.strictEqual(toTildePath(home), "~");
    assert.strictEqual(
      toTildePath(path.join(home, "Documents", "Notes")),
      "~/Documents/Notes"
    );
    assert.strictEqual(
      expandLocalPath("~/Documents"),
      path.normalize(path.join(home, "Documents"))
    );
  });

  it("listLocalSubdirectories liste les dossiers non cachés", async () => {
    const root = await makeTempDir("ssh-folders-list-");
    await fs.mkdir(path.join(root, "Visible"));
    await fs.mkdir(path.join(root, ".hidden"));
    await fs.writeFile(path.join(root, "fichier.txt"), "x");
    const names = await listLocalSubdirectories(root);
    assert.deepStrictEqual(names, ["Visible"]);
    await fs.rm(root, { recursive: true, force: true });
  });
});

describe("catalogue defaults / local", () => {
  it("applique toutes les clés absentes sans écraser l'existant", () => {
    const { data, added } = applyMissingDefaults(
      {
        folders: { demo: [{ path: "/a" }] },
        defaults: { RecentLimit: 5 },
      },
      { RecentLimit: 5 }
    );
    assert.strictEqual(added, true);
    assert.strictEqual(data.defaults?.RecentLimit, 5);
    assert.strictEqual(data.defaults?.DefaultFolder, "");
    assert.strictEqual(defaultFolderPath(data), undefined);
    for (const key of Object.keys(DEFAULT_SETTINGS)) {
      assert.ok(
        Object.prototype.hasOwnProperty.call(data.defaults, key),
        `defaults.${key}`
      );
    }
    assert.deepStrictEqual(data.local, []);
  });

  it("sème local/Documents si local est absent du fichier", () => {
    const { data, added } = applyMissingDefaults(
      { folders: {} },
      {},
      { seedDefaultLocal: true }
    );
    assert.strictEqual(added, true);
    assert.deepStrictEqual(data.local, DEFAULT_LOCAL_SEED);
  });

  it("ne sème pas si local: [] est déjà explicite", () => {
    const { data } = applyMissingDefaults(
      { folders: {}, local: [] },
      {},
      { seedDefaultLocal: true }
    );
    assert.deepStrictEqual(data.local, []);
  });

  it("écrit local: [] et DefaultFolder vide dans le JSON", async () => {
    const dir = await makeTempDir("ssh-folders-catalog-");
    const configPath = path.join(dir, "ssh-folders.json");
    vscodeMock.__setConfig("sshFolders.configPath", configPath);
    invalidateFoldersCache();
    try {
      await writeFoldersFile({ folders: {}, local: [] });
      const raw = JSON.parse(await fs.readFile(configPath, "utf8")) as FoldersFile;
      assert.deepStrictEqual(raw.local, []);
      assert.strictEqual(raw.defaults?.DefaultFolder, "");
      for (const key of Object.keys(DEFAULT_SETTINGS)) {
        assert.ok(
          Object.prototype.hasOwnProperty.call(raw.defaults, key),
          `defaults.${key}`
        );
      }
    } finally {
      invalidateFoldersCache();
      vscodeMock.__clearConfig();
      await fs.rm(dir, { recursive: true, force: true });
    }
  });
});

describe("VirtualHostPosition", () => {
  const ssh = { alias: "zeta", local: false, favorite: false };
  const local = { alias: "alpha", local: true, favorite: false };
  const favLocal = { alias: "zzz", local: true, favorite: true };

  it("défaut alphabet", () => {
    assert.strictEqual(virtualHostPosition(undefined), "alphabet");
    assert.strictEqual(
      virtualHostPosition({ folders: {}, defaults: {} }),
      "alphabet"
    );
  });

  it("top place les VirtualHost avant les SSH", () => {
    const data: FoldersFile = {
      folders: {},
      defaults: { VirtualHostPosition: "top", SortAlphabetical: true },
    };
    assert.ok(compareHostRoots(local, ssh, data) < 0);
    assert.ok(compareHostRoots(ssh, local, data) > 0);
  });

  it("bottom place les VirtualHost après les SSH", () => {
    const data: FoldersFile = {
      folders: {},
      defaults: { VirtualHostPosition: "bottom", SortAlphabetical: true },
    };
    assert.ok(compareHostRoots(local, ssh, data) > 0);
    assert.ok(compareHostRoots(ssh, local, data) < 0);
  });

  it("alphabet mélange par nom", () => {
    const data: FoldersFile = {
      folders: {},
      defaults: { VirtualHostPosition: "alphabet", SortAlphabetical: true },
    };
    assert.ok(compareHostRoots(local, ssh, data) < 0);
  });

  it("favoris restent en tête", () => {
    const data: FoldersFile = {
      folders: {},
      defaults: { VirtualHostPosition: "bottom" },
    };
    assert.ok(compareHostRoots(favLocal, ssh, data) < 0);
  });
});

describe("local[] / VirtualHost", () => {
  it("normalizeFileWithMeta garde local même si folders est absent", () => {
    const { data } = normalizeFileWithMeta({
      local: [
        { VirtualHost: "Prod", path: "~/Documents/Projets", label: "Projets" },
      ],
    });
    assert.deepStrictEqual(localVirtualHosts(data), ["Prod"]);
    assert.strictEqual(localFoldersForHost(data, "prod").length, 1);
    assert.deepStrictEqual(Object.keys(data.folders), []);
  });

  it("regroupe par VirtualHost sans casse", () => {
    const data: FoldersFile = {
      folders: {},
      local: [
        { VirtualHost: "Prod", path: "~/a" },
        { VirtualHost: "prod", path: "~/b" },
        { VirtualHost: "Dev", path: "~/c" },
      ],
    };
    assert.deepStrictEqual(localVirtualHosts(data), ["Prod", "Dev"]);
    assert.strictEqual(localFoldersForHost(data, "PROD").length, 2);
  });
});

describe("création dossier projet (feuille)", () => {
  it("shellSingleQuote échappe les quotes", () => {
    assert.strictEqual(shellSingleQuote("a'b"), String.raw`'a'\''b'`);
  });

  it("crée uniquement la feuille si le parent existe", async () => {
    const root = await makeTempDir("ssh-folders-mkdir-");
    const child = path.join(root, "mon-projet");
    assert.strictEqual(await localDirExists(child), false);
    await createLocalLeafDirectory(child);
    assert.strictEqual(await localDirExists(child), true);
    await fs.rm(root, { recursive: true, force: true });
  });

  it("refuse de créer toute une arborescence manquante", async () => {
    const root = await makeTempDir("ssh-folders-mkdir-miss-");
    const deep = path.join(root, "a", "b", "projet");
    await assert.rejects(
      () => createLocalLeafDirectory(deep),
      /Parent folder does not exist|dossier parent/i
    );
    await fs.rm(root, { recursive: true, force: true });
  });
});

describe("suggestedRemoteAddPath", () => {
  it("DefaultFolder vide → dossier IDE ouvert", () => {
    assert.strictEqual(
      suggestedRemoteAddPath(undefined, "/home/user/app"),
      "/home/user/app"
    );
    assert.strictEqual(suggestedRemoteAddPath("", "/home/user/app"), "/home/user/app");
    assert.strictEqual(suggestedRemoteAddPath(undefined, undefined), "");
  });

  it("DefaultFolder connu (ouvert dessous) → DefaultFolder", () => {
    assert.strictEqual(
      suggestedRemoteAddPath(
        "/opt/docker/projects",
        "/opt/docker/projects/grafana/"
      ),
      "/opt/docker/projects"
    );
  });

  it("DefaultFolder connu via dossiers enregistrés → DefaultFolder", () => {
    assert.strictEqual(
      suggestedRemoteAddPath("/opt/docker/projects", undefined, [
        "/opt/docker/projects/grafana",
      ]),
      "/opt/docker/projects"
    );
  });

  it("DefaultFolder inconnu sur l'hôte → dossier IDE", () => {
    assert.strictEqual(
      suggestedRemoteAddPath(
        "/opt/docker/projects",
        "/home/user/app",
        ["/home/user/other"]
      ),
      "/home/user/app"
    );
  });

  it("DefaultFolder inconnu et rien d'ouvert → vide", () => {
    assert.strictEqual(
      suggestedRemoteAddPath("/opt/docker/projects", undefined, ["/home/x"]),
      ""
    );
  });
});

describe("HiddenHosts", () => {
  it("masque les alias selon motifs", () => {
    const data: FoldersFile = {
      folders: {},
      defaults: { HiddenHosts: ["gitlab*", "Legacy"] },
    };
    assert.strictEqual(isHostHidden("gitlab.com", data), true);
    assert.strictEqual(isHostHidden("legacy", data), true);
    assert.strictEqual(isHostHidden("demo-docker", data), false);
    assert.deepStrictEqual(
      visibleHostAliases(["demo-docker", "gitlab-ci", "Legacy"], data),
      ["demo-docker"]
    );
  });
});

describe("Favoris", () => {
  it("détecte FavoriteHosts et favorite sur entrée", () => {
    const data: FoldersFile = {
      folders: {
        demo: [{ path: "/a", favorite: true }, { path: "/b" }],
      },
      defaults: { FavoriteHosts: ["Demo"] },
    };
    assert.strictEqual(isFavoriteHost("demo", data), true);
    assert.strictEqual(isFavoriteHost("other", data), false);
    assert.strictEqual(isFavoriteFolder(data.folders.demo[0]), true);
    assert.strictEqual(isFavoriteFolder(data.folders.demo[1]), false);
  });

  it("place les favoris en tête sous l'hôte", () => {
    const ordered = sortFolderEntries(
      [
        { path: "/z", label: "Zulu" },
        { path: "/a", label: "Alpha", favorite: true },
        { path: "/m", label: "Mike" },
      ],
      { data: { folders: {} } }
    ).map((entry) => entry.label);
    assert.deepStrictEqual(ordered, ["Alpha", "Mike", "Zulu"]);
  });

  it("conserve favorite au normalize", () => {
    const { data } = normalizeFileWithMeta({
      folders: {
        demo: [{ path: "/opt/x", favorite: true }],
      },
      local: [
        {
          VirtualHost: "Prod",
          path: "~/Documents",
          favorite: true,
        },
      ],
    });
    assert.strictEqual(data.folders.demo[0].favorite, true);
    assert.strictEqual(localFoldersForHost(data, "Prod")[0].favorite, true);
  });
});

describe("icon palette", () => {
  it("parseIconPaletteColor accepte 20 noms et alias", () => {
    for (const name of ICON_PALETTE_NAMES) {
      assert.strictEqual(parseIconPaletteColor(name), name);
    }
    assert.strictEqual(parseIconPaletteColor("gris"), "grey");
    assert.strictEqual(parseIconPaletteColor("VIOLET"), "purple");
    assert.strictEqual(parseIconPaletteColor("unknown"), undefined);
  });

  it("HostIconColors prime sur filtre host", () => {
    const data: FoldersFile = {
      folders: {},
      defaults: {
        HostIconColors: { "HEIG-prod": "blue" },
        IconColorFilters: [
          { scope: "host", name: "HEIG-*", color: "purple" },
        ],
      },
    };
    assert.strictEqual(resolveHostIconPalette("HEIG-prod", data), "blue");
    assert.strictEqual(resolveHostIconPalette("HEIG-lab", data), "purple");
  });

  it("hôte et dossier sans héritage", () => {
    const data: FoldersFile = {
      folders: {
        "demo-docker": [
          { path: "/opt/x", color: "green" },
          { path: "/opt/y" },
        ],
      },
      defaults: {
        HostIconColors: { "demo-docker": "purple" },
      },
    };
    assert.strictEqual(resolveHostIconPalette("demo-docker", data), "purple");
    assert.strictEqual(
      resolveFolderIconPalette("demo-docker", data.folders["demo-docker"][0], data),
      "green"
    );
    assert.strictEqual(
      resolveFolderIconPalette("demo-docker", data.folders["demo-docker"][1], data),
      undefined
    );
  });

  it("filtres dossier : ordre et archive", () => {
    const data: FoldersFile = {
      folders: {
        demo: [
          { path: "/opt/projects/_old/legacy", favorite: true },
          { path: "/opt/projects/grafana" },
        ],
      },
      defaults: {
        ArchiveParents: ["_old"],
        IconColorFilters: [
          { scope: "folder", favorite: true, color: "yellow" },
          { scope: "folder", archive: true, color: "grey" },
        ],
      },
    };
    const fav = data.folders.demo[0];
    const active = data.folders.demo[1];
    assert.strictEqual(resolveFolderIconPalette("demo", fav, data), "yellow");
    assert.strictEqual(resolveFolderIconPalette("demo", active, data), undefined);
  });

  it("conserve color au normalize", () => {
    const { data } = normalizeFileWithMeta({
      folders: {
        demo: [{ path: "/a", color: "teal" }],
      },
      defaults: {
        HostIconColors: { Demo: "pink" },
        IconColorFilters: [
          { scope: "host", name: "*", color: "red" },
          { scope: "host", path: "/nope", color: "red" },
        ],
      },
    });
    assert.strictEqual(data.folders.demo[0].color, "teal");
    assert.strictEqual(data.defaults?.HostIconColors?.Demo, "pink");
    assert.strictEqual(data.defaults?.IconColorFilters?.length, 1);
  });
});

describe("ArchiveParents", () => {
  const data: FoldersFile = {
    folders: {},
    defaults: { ArchiveParents: ["_old", "old"] },
  };

  it("détecte le parent immédiat _old / old", () => {
    assert.strictEqual(pathParentName("/opt/docker/projects/_old/legacy"), "_old");
    assert.strictEqual(
      isArchiveFolderPath("/opt/docker/projects/_old/legacy", data),
      true
    );
    assert.strictEqual(
      isArchiveFolderPath("/opt/docker/projects/old/portal", data),
      true
    );
    assert.strictEqual(
      isArchiveFolderPath("~/Documents/_old/notes", data),
      true
    );
  });

  it("ne marque pas le dossier _old lui-même ni un actif", () => {
    assert.strictEqual(
      isArchiveFolderPath("/opt/docker/projects/_old", data),
      false
    );
    assert.strictEqual(
      isArchiveFolderPath("/opt/docker/projects/grafana", data),
      false
    );
  });

  it("place les archives après LastFolder", () => {
    const ordered = sortFolderEntries(
      [
        { path: "/opt/docker/projects/_old/legacy", label: "Legacy" },
        { path: "/opt/docker/projects/grafana", label: "Grafana" },
        { path: "/opt/docker/projects/_old", label: "_old" },
        { path: "/opt/docker/projects", label: "Projects" },
      ],
      { data: { ...data, defaults: { ...data.defaults, LastFolder: ["Projects", "_old"] } } }
    ).map((entry) => entry.label);
    assert.deepStrictEqual(ordered, ["Grafana", "Projects", "_old", "Legacy"]);
  });

  it("sépare archives et actifs dans l'arbre A-Z", () => {
    const nodes = buildAzFolderTree(
      [
        { alias: "demo", entry: { path: "/p/grafana", label: "Grafana" } },
        {
          alias: "demo",
          entry: { path: "/p/_old/grafana", label: "Grafana" },
        },
        {
          alias: "demo",
          entry: { path: "/p/_old/legacy", label: "Legacy" },
        },
      ],
      { data }
    );
    assert.strictEqual(nodes.length, 3);
    assert.strictEqual(nodes[0].kind, "leaf");
    if (nodes[0].kind === "leaf") {
      assert.strictEqual(nodes[0].item.entry.path, "/p/grafana");
    }
    const archivePaths = nodes.slice(1).flatMap((node) =>
      node.kind === "leaf"
        ? [node.item.entry.path]
        : node.items.map((item) => item.entry.path)
    );
    assert.ok(archivePaths.every((p) => p.includes("/_old/")));
  });
});

describe("ajout local sur fichier temporaire", () => {
  let configDir = "";
  let configPath = "";

  before(async () => {
    configDir = await makeTempDir("ssh-folders-cfg-");
    configPath = path.join(configDir, "ssh-folders.json");
    await fs.writeFile(
      configPath,
      JSON.stringify(
        {
          defaults: { SortAlphabetical: true },
          folders: {},
          local: [{ VirtualHost: "Prod", path: "~/Documents/Projets" }],
        },
        null,
        2
      ),
      "utf8"
    );
  });

  beforeEach(() => {
    // Sortir du mode sandbox si un test précédent l'a activé.
    initDevMode({
      extensionMode: vscode.ExtensionMode.Production,
      extensionPath: configDir,
      globalStorageUri: { fsPath: configDir },
    } as vscode.ExtensionContext);
    vscodeMock.__clearConfig();
    vscodeMock.__setConfig("sshFolders.configPath", configPath);
    invalidateFoldersCache();
  });

  after(async () => {
    vscodeMock.__clearConfig();
    invalidateFoldersCache();
    await fs.rm(configDir, { recursive: true, force: true });
  });

  it("addLocalFolderEntry ajoute sous le VirtualHost", async () => {
    await addLocalFolderEntry({
      VirtualHost: "Prod",
      path: "~/Documents/Notes",
      label: "Notes",
    });
    invalidateFoldersCache();
    const data = await readFoldersFile();
    const folders = localFoldersForHost(data, "Prod");
    assert.ok(
      folders.some((entry) => entry.path === "~/Documents/Notes"),
      JSON.stringify(folders)
    );
  });

  it("refuse un doublon sous le même VirtualHost", async () => {
    await assert.rejects(
      () =>
        addLocalFolderEntry({
          VirtualHost: "Prod",
          path: "~/Documents/Projets",
        }),
      /already registered/
    );
  });

  it("removeLocalFolderEntry retire l'entrée", async () => {
    await removeLocalFolderEntry("Prod", "~/Documents/Notes");
    invalidateFoldersCache();
    const data = await readFoldersFile();
    assert.ok(
      !localFoldersForHost(data, "Prod").some(
        (entry) => entry.path === "~/Documents/Notes"
      )
    );
  });
});

describe("bac à sable exemples (seed une fois)", () => {
  let extensionRoot = "";
  let storageRoot = "";

  before(async () => {
    extensionRoot = await makeTempDir("ssh-folders-ext-");
    storageRoot = await makeTempDir("ssh-folders-store-");
    await fs.mkdir(path.join(extensionRoot, "examples"), { recursive: true });
    await fs.writeFile(
      path.join(extensionRoot, "examples", "ssh-config.example"),
      "Host demo\n",
      "utf8"
    );
    await fs.writeFile(
      path.join(extensionRoot, "examples", "ssh-folders.example.json"),
      JSON.stringify(
        {
          folders: { demo: [{ path: "/tmp" }] },
          local: [{ VirtualHost: "Prod", path: "~/a", label: "A" }],
        },
        null,
        2
      ),
      "utf8"
    );
    await fs.mkdir(path.join(extensionRoot, ".vscode"), { recursive: true });
    await fs.writeFile(
      path.join(extensionRoot, ".vscode", "ssh-folders-dev.mode"),
      "sandbox\n",
      "utf8"
    );
  });

  after(async () => {
    delete process.env.SSH_FOLDERS_DEV_RESET;
    initDevMode({
      extensionMode: vscode.ExtensionMode.Production,
      extensionPath: extensionRoot,
      globalStorageUri: { fsPath: storageRoot },
    } as vscode.ExtensionContext);
    await fs.rm(extensionRoot, { recursive: true, force: true });
    await fs.rm(storageRoot, { recursive: true, force: true });
  });

  it("seed puis conserve les modifications ; reset force la recopie", async () => {
    const context = {
      extensionMode: vscode.ExtensionMode.Development,
      extensionPath: extensionRoot,
      globalStorageUri: { fsPath: storageRoot },
    } as vscode.ExtensionContext;

    assert.strictEqual(initDevMode(context), true);
    assert.strictEqual(isDevMode(), true);

    await prepareDevSandbox(context);
    const foldersPath = devFoldersConfigPath();
    const first = await fs.readFile(foldersPath, "utf8");
    assert.ok(first.includes('"VirtualHost": "Prod"'));

    const modified = JSON.parse(first) as FoldersFile;
    modified.local = [
      ...(modified.local ?? []),
      { VirtualHost: "Prod", path: "~/b", label: "B" },
    ];
    await fs.writeFile(foldersPath, `${JSON.stringify(modified, null, 2)}\n`);

    await prepareDevSandbox(context);
    const afterSecond = JSON.parse(
      await fs.readFile(foldersPath, "utf8")
    ) as FoldersFile;
    assert.ok(
      afterSecond.local?.some((entry) => entry.path === "~/b"),
      "le seed ne doit pas écraser les ajouts"
    );

    process.env.SSH_FOLDERS_DEV_RESET = "1";
    await prepareDevSandbox(context);
    delete process.env.SSH_FOLDERS_DEV_RESET;
    const afterReset = JSON.parse(
      await fs.readFile(foldersPath, "utf8")
    ) as FoldersFile;
    assert.ok(
      !afterReset.local?.some((entry) => entry.path === "~/b"),
      "reset doit revenir à l'exemple"
    );
    assert.strictEqual(afterReset.local?.length, 1);
  });
});
