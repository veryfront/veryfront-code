import { isAbsolute, join, relative } from "#veryfront/compat/path/index.ts";
import { isNotFoundError } from "#veryfront/platform/compat/fs.ts";
import { serverLogger } from "#veryfront/utils";
import { capitalizeSeparatedWords } from "#veryfront/utils/case-utils.ts";
import { toBase64Url } from "#veryfront/utils/path-utils.ts";
import { runtime } from "#veryfront/platform/adapters/detect.ts";
import type { ClientComponentMeta, ComponentAnalysis, ComponentType } from "./types.ts";
import type { FileSystemAdapter } from "#veryfront/platform/adapters/base.ts";
import { extractExportNames } from "./export-extractor.ts";
import { shortHash } from "#veryfront/utils/hash-utils.ts";
import { hasClientFileName, hasUseClientDirective, hasUseServerDirective } from "./page-island.ts";

class DuplicateClientComponentIdError extends Error {}

const MAX_MANIFEST_ENTRIES = 10_000;
const MAX_MANIFEST_DEPTH = 64;

interface WalkState {
  readonly root: string;
  readonly canonicalRoot?: string;
  entries: number;
}

export async function analyzeComponent(
  filePath: string,
  fs: FileSystemAdapter,
): Promise<ComponentAnalysis> {
  const content = await fs.readFile(filePath);

  const hasUseClient = hasUseClientDirective(content);
  const hasUseServer = hasUseServerDirective(content);

  if (hasUseClient && hasUseServer) {
    throw new TypeError("A component cannot declare both 'use client' and 'use server'");
  }

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
  const normalized = filePath.replace(/\.(tsx?|jsx?)$/, "").replace(/\.(client|server)$/, "");
  const parts = normalized.split("/");
  const fileName = parts.at(-1);

  if (fileName === "index") {
    return toPascalCase(parts.at(-2) ?? "Unknown");
  }

  return toPascalCase(fileName ?? "Unknown");
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
  const normalizedAppDir = validateAppDirectory(appDir);
  const appPath = join(projectDir, normalizedAppDir);

  if (!isPathWithin(projectDir, appPath)) {
    throw new TypeError("Client manifest app directory must stay within the project");
  }

  const fsAdapter = fs ?? (await getFsAdapter());

  try {
    if (fsAdapter.lstat) {
      const rootInfo = await fsAdapter.lstat(appPath);
      if (rootInfo.isSymlink) {
        throw new TypeError("Client manifest app directory cannot be a symbolic link");
      }
    }

    const canonicalRoot = fsAdapter.realPath ? await fsAdapter.realPath(appPath) : undefined;
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
      { root: appPath, canonicalRoot, entries: 0 },
      0,
    );
  } catch (error) {
    if (isNotFoundError(error)) return manifest;
    throw error;
  }

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
  state: WalkState,
  depth: number,
): Promise<void> {
  if (depth > MAX_MANIFEST_DEPTH) {
    throw new RangeError("Client manifest directory depth exceeds the supported limit");
  }

  const entries = [];
  for await (const entry of fs.readDir(dir)) entries.push(entry);
  entries.sort((a, b) => a.name.localeCompare(b.name));

  for (const entry of entries) {
    validateDirectoryEntryName(entry.name);
    if (entry.isSymlink) continue;

    state.entries++;
    if (state.entries > MAX_MANIFEST_ENTRIES) {
      throw new RangeError("Client manifest contains too many filesystem entries");
    }

    const path = join(dir, entry.name);
    if (!isPathWithin(state.root, path)) {
      throw new TypeError("Client manifest entry escaped the configured app directory");
    }

    if (fs.lstat) {
      const info = await fs.lstat(path);
      if (info.isSymlink) continue;
    }

    if (fs.realPath && state.canonicalRoot) {
      const canonicalPath = await fs.realPath(path);
      if (!isPathWithin(state.canonicalRoot, canonicalPath)) continue;
    }

    if (entry.isDirectory) {
      if (shouldSkipDirectory(dir, entry.name)) continue;
      await walkDirectory(path, callback, fs, state, depth + 1);
      continue;
    }

    if (entry.isFile) {
      await callback(path);
    }
  }
}

function validateAppDirectory(appDir: string): string {
  const normalized = appDir.replaceAll("\\", "/").replace(/^\.\//, "").replace(/\/+$/, "");
  if (
    !normalized || isAbsolute(normalized) || hasControlCharacters(normalized) ||
    normalized.split("/").some((segment) => !segment || segment === "." || segment === "..")
  ) {
    throw new TypeError("Client manifest app directory must be a normalized project-relative path");
  }
  return normalized;
}

function validateDirectoryEntryName(name: string): void {
  if (
    !name || name === "." || name === ".." || name.includes("/") || name.includes("\\") ||
    hasControlCharacters(name)
  ) {
    throw new TypeError("Client manifest contains an invalid directory entry name");
  }
}

function hasControlCharacters(value: string): boolean {
  for (const character of value) {
    const code = character.charCodeAt(0);
    if (code <= 0x1f || code === 0x7f) return true;
  }
  return false;
}

function isPathWithin(root: string, candidate: string): boolean {
  const relativePath = relative(root, candidate);
  return relativePath === "" ||
    (!isAbsolute(relativePath) && relativePath !== ".." && !relativePath.startsWith("../"));
}

function shouldSkipDirectory(parentDir: string, name: string): boolean {
  // Skip node_modules and hidden dirs, but allow .veryfront (excluding system subdirs)
  if (name === "node_modules") return true;
  if (name.startsWith(".") && name !== ".veryfront") return true;

  if (!parentDir.includes(".veryfront")) return false;

  return ["cache", "compiled", "tmp", "temp", "output", "optimized-images", "css"].includes(name);
}
