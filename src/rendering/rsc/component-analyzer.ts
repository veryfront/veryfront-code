import { join, relative } from "#veryfront/compat/path/index.ts";
import { isNotFoundError } from "#veryfront/platform/compat/fs.ts";
import { serverLogger } from "#veryfront/utils";
import { capitalizeSeparatedWords } from "#veryfront/utils/case-utils.ts";
import { toBase64Url } from "#veryfront/utils/path-utils.ts";
import { runtime } from "#veryfront/platform/adapters/detect.ts";
import type { ClientComponentMeta, ComponentAnalysis, ComponentType } from "./types.ts";
import type { FileSystemAdapter } from "#veryfront/platform/adapters/base.ts";
import { DYNAMIC_ROUTE_ERROR, INVALID_ROUTE_FILE } from "#veryfront/errors";
import { extractExportNames } from "./export-extractor.ts";
import { shortHash } from "#veryfront/utils/hash-utils.ts";
import { hasClientFileName, hasUseClientDirective, hasUseServerDirective } from "./page-island.ts";
import { DEFAULT_MAX_FILE_SIZE_BYTES } from "#veryfront/utils/constants/buffers.ts";
import { MAX_PATH_LENGTH_CHARS } from "#veryfront/utils/constants/limits.ts";
import { containsPathControlCharacters } from "#veryfront/utils/route-path-utils.ts";
import { normalizeProjectRelativeDiscoveryPath } from "#veryfront/utils/discovery-path-policy.ts";

class DuplicateClientComponentIdError extends Error {}

const MAX_COMPONENT_SOURCE_BYTES = DEFAULT_MAX_FILE_SIZE_BYTES;
const MAX_MANIFEST_DIRECTORIES = 1_024;
const MAX_MANIFEST_ENTRIES = 100_000;
const MAX_DIRECTORY_ENTRIES = 10_000;
const MAX_CLIENT_COMPONENTS = 10_000;
const strictUtf8Decoder = new TextDecoder("utf-8", { fatal: true });
const utf8Encoder = new TextEncoder();

type ManifestDirectoryEntry = {
  name: string;
  isFile: boolean;
  isDirectory: boolean;
  isSymlink: boolean;
};

type ManifestTraversalState = {
  directoriesVisited: number;
  entriesInspected: number;
};

export async function analyzeComponent(
  filePath: string,
  fs: FileSystemAdapter,
): Promise<ComponentAnalysis> {
  assertSafeComponentPath(filePath);
  const content = await readComponentSource(filePath, fs);

  const hasUseClient = hasUseClientDirective(content);
  const hasUseServer = hasUseServerDirective(content);

  // Determine component type: directive takes precedence over file naming convention
  const type: ComponentType = hasUseClient || hasClientFileName(filePath) ? "client" : "server";
  const exports = await extractExportNames(content, filePath);

  return {
    type,
    filePath,
    exports,
    id: generateComponentId(filePath),
    contentHash: await shortHash(content),
    hasUseClient,
    hasUseServer,
  };
}

function generateComponentId(filePath: string): string {
  const normalized = filePath
    .replaceAll("\\", "/")
    .replace(/\.(tsx?|jsx?)$/, "")
    .replace(/\.(client|server)$/, "");
  const parts = normalized.split("/");
  const fileName = parts.at(-1);

  if (fileName === "index") {
    return requireComponentId(toPascalCase(parts.at(-2) ?? ""));
  }

  return requireComponentId(toPascalCase(fileName ?? ""));
}

function toPascalCase(str: string): string {
  return capitalizeSeparatedWords(str, /[-_\s]+/, "");
}

export async function buildClientManifest(
  projectDir: string,
  appDir: string = "app",
  fs?: FileSystemAdapter,
): Promise<Map<string, ClientComponentMeta>> {
  const manifest = new Map<string, ClientComponentMeta>();
  assertSafeComponentPath(projectDir);
  const normalizedAppDir = appDir === "." ? "." : normalizeProjectRelativeDiscoveryPath(appDir);
  const appPath = join(projectDir, normalizedAppDir);

  const fsAdapter = fs ?? (await getFsAdapter());
  await walkDirectory(
    appPath,
    async (filePath) => {
      if (!/\.(tsx?|jsx?)$/.test(filePath)) return;

      const analysis = await analyzeComponent(filePath, fsAdapter);
      if (analysis.type !== "client") return;

      const relativePath = relative(projectDir, filePath);
      const normalizedRelativePath = relativePath.replaceAll("\\", "/");
      const existing = manifest.get(analysis.id);
      if (existing && existing.rel !== normalizedRelativePath) {
        throw new DuplicateClientComponentIdError(
          `Duplicate client component ID "${analysis.id}" for "${existing.rel}" and "${normalizedRelativePath}"`,
        );
      }
      if (!existing && manifest.size >= MAX_CLIENT_COMPONENTS) {
        throw DYNAMIC_ROUTE_ERROR.create({
          detail: `Client component manifest exceeds the ${MAX_CLIENT_COMPONENTS}-component limit`,
        });
      }

      manifest.set(analysis.id, {
        id: analysis.id,
        path: `/_veryfront/fs/${toBase64Url(filePath)}`,
        sourcePath: filePath,
        rel: normalizedRelativePath,
        contentHash: analysis.contentHash,
        exports: analysis.exports,
      });

      serverLogger.debug(`Found client component: ${analysis.id} at ${relativePath}`);
    },
    fsAdapter,
    {
      directoriesVisited: 0,
      entriesInspected: 0,
    },
  );

  return manifest;
}

async function getFsAdapter(): Promise<FileSystemAdapter> {
  const adapter = await runtime.get();
  return adapter.fs;
}

async function walkDirectory(
  dir: string,
  callback: (path: string) => Promise<void>,
  fs: FileSystemAdapter,
  state: ManifestTraversalState,
  insideVeryfront = false,
): Promise<void> {
  state.directoriesVisited += 1;
  if (state.directoriesVisited > MAX_MANIFEST_DIRECTORIES) {
    throw DYNAMIC_ROUTE_ERROR.create({
      detail: `Client manifest discovery exceeds the ${MAX_MANIFEST_DIRECTORIES}-directory limit`,
    });
  }

  const entries = await readManifestDirectory(dir, fs, state);
  for (const entry of entries) {
    if (!isSafeDirectoryEntryName(entry.name) || entry.isSymlink) continue;
    const path = join(dir, entry.name);
    assertSafeComponentPath(path);

    if (entry.isDirectory) {
      if (shouldSkipDirectory(entry.name, insideVeryfront)) continue;
      await walkDirectory(
        path,
        callback,
        fs,
        state,
        insideVeryfront || entry.name === ".veryfront",
      );
      continue;
    }

    if (entry.isFile) {
      await callback(path);
    }
  }
}

async function readManifestDirectory(
  dir: string,
  fs: FileSystemAdapter,
  state: ManifestTraversalState,
): Promise<ManifestDirectoryEntry[]> {
  const entries: ManifestDirectoryEntry[] = [];
  try {
    for await (const value of fs.readDir(dir) as AsyncIterable<unknown>) {
      if (entries.length >= MAX_DIRECTORY_ENTRIES) {
        throw DYNAMIC_ROUTE_ERROR.create({
          detail:
            `Client manifest directory listing exceeds the ${MAX_DIRECTORY_ENTRIES}-entry limit`,
        });
      }
      state.entriesInspected += 1;
      if (state.entriesInspected > MAX_MANIFEST_ENTRIES) {
        throw DYNAMIC_ROUTE_ERROR.create({
          detail: `Client manifest discovery exceeds the ${MAX_MANIFEST_ENTRIES}-entry limit`,
        });
      }
      entries.push(snapshotDirectoryEntry(value));
    }
  } catch (error) {
    if (isNotFoundError(error)) return [];
    throw error;
  }
  return entries;
}

function shouldSkipDirectory(name: string, insideVeryfront: boolean): boolean {
  // Skip node_modules and hidden dirs, but allow .veryfront (excluding system subdirs)
  if (name === "node_modules") return true;
  if (name.startsWith(".") && name !== ".veryfront") return true;

  if (!insideVeryfront) return false;

  return ["cache", "compiled", "tmp", "temp", "output", "optimized-images", "css"].includes(name);
}

function requireComponentId(value: string): string {
  if (value.length === 0 || value.length > MAX_PATH_LENGTH_CHARS) {
    throw INVALID_ROUTE_FILE.create({
      detail: "Client component filename does not produce a valid component identifier",
    });
  }
  return value;
}

function assertSafeComponentPath(path: string): void {
  if (
    path.length === 0 ||
    path.length > MAX_PATH_LENGTH_CHARS ||
    containsPathControlCharacters(path)
  ) {
    throw INVALID_ROUTE_FILE.create({
      detail:
        `Client component path must contain between 1 and ${MAX_PATH_LENGTH_CHARS} characters without control characters`,
    });
  }
}

async function readComponentSource(
  filePath: string,
  fs: FileSystemAdapter,
): Promise<string> {
  if (typeof fs.readFileBytesBounded === "function") {
    const bytes = await fs.readFileBytesBounded(
      filePath,
      MAX_COMPONENT_SOURCE_BYTES + 1,
    );
    assertComponentSourceSize(bytes.byteLength);
    try {
      return strictUtf8Decoder.decode(bytes);
    } catch {
      throw INVALID_ROUTE_FILE.create({
        detail: "Client component source must be valid UTF-8",
      });
    }
  }

  const info = await fs.stat(filePath);
  if (Number.isFinite(info.size)) assertComponentSourceSize(info.size);
  const content = await fs.readFile(filePath);
  assertComponentSourceSize(utf8Encoder.encode(content).byteLength);
  return content;
}

function assertComponentSourceSize(size: number): void {
  if (
    !Number.isSafeInteger(size) ||
    size < 0 ||
    size > MAX_COMPONENT_SOURCE_BYTES
  ) {
    throw INVALID_ROUTE_FILE.create({
      detail: `Client component source exceeds the ${MAX_COMPONENT_SOURCE_BYTES}-byte limit`,
    });
  }
}

function isSafeDirectoryEntryName(name: string): boolean {
  return name.length > 0 &&
    name.length <= MAX_PATH_LENGTH_CHARS &&
    name !== "." &&
    name !== ".." &&
    !name.includes("/") &&
    !name.includes("\\") &&
    !containsPathControlCharacters(name);
}

function snapshotDirectoryEntry(value: unknown): ManifestDirectoryEntry {
  if (typeof value !== "object" || value === null) {
    throw DYNAMIC_ROUTE_ERROR.create({
      detail: "Client manifest adapter returned an invalid directory entry",
    });
  }

  const entry = value as Partial<ManifestDirectoryEntry>;
  if (
    typeof entry.name !== "string" ||
    typeof entry.isFile !== "boolean" ||
    typeof entry.isDirectory !== "boolean" ||
    (entry.isSymlink !== undefined && typeof entry.isSymlink !== "boolean")
  ) {
    throw DYNAMIC_ROUTE_ERROR.create({
      detail: "Client manifest adapter returned an invalid directory entry",
    });
  }

  return {
    name: entry.name,
    isFile: entry.isFile,
    isDirectory: entry.isDirectory,
    isSymlink: entry.isSymlink ?? false,
  };
}
