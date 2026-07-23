/**
 * File Discovery
 *
 * Utilities for finding TypeScript files in directories.
 */

import type { FileDiscoveryContext } from "./types.ts";
import * as pathHelper from "#veryfront/compat/path";
import { isWithinDirectory } from "#veryfront/security/path-validation/normalization.ts";

const MAX_DISCOVERY_DIRECTORY_DEPTH = 64;
const MAX_DISCOVERY_CANONICAL_COMPONENTS = 256;
const MAX_DISCOVERY_DIRECTORY_ENTRIES = 20_000;
const MAX_DISCOVERY_FILES = 10_000;
const MAX_DISCOVERY_ENTRY_NAME_LENGTH = 255;
const MAX_DISCOVERY_PATH_CHARACTERS = 16 * 1_024 * 1_024;
const MAX_DISCOVERY_TEXT_FILE_BYTES = 2 * 1_024 * 1_024;
const textEncoder = new TextEncoder();

type DiscoveryTraversalState = {
  entries: number;
  files: number;
  pathCharacters: number;
};

type NodeDiscoveryDependencies = {
  fs: typeof import("node:fs");
  path: typeof import("node:path");
};

let nodeDependencies: Promise<NodeDiscoveryDependencies> | undefined;

function hasControlCharacter(value: string): boolean {
  for (let index = 0; index < value.length; index++) {
    const code = value.charCodeAt(index);
    if (code < 32 || code === 127) return true;
  }
  return false;
}

function assertSafeEntryName(name: string): void {
  if (
    !name || name.length > MAX_DISCOVERY_ENTRY_NAME_LENGTH || name === "." || name === ".." ||
    name.includes("/") ||
    name.includes("\\") || hasControlCharacter(name)
  ) {
    throw new TypeError("Discovery directory returned an invalid entry name");
  }
}

function isDiscoverableFile(name: string, extensions: readonly string[]): boolean {
  const normalized = name.toLowerCase();
  if (/\.d\.(?:ts|tsx)$/.test(normalized)) return false;
  return extensions.some((extension) => normalized.endsWith(extension));
}

function assertWithinTraversalLimits(
  state: DiscoveryTraversalState,
  depth: number,
): void {
  if (depth > MAX_DISCOVERY_DIRECTORY_DEPTH) {
    throw new RangeError("Discovery directory depth limit exceeded");
  }
  if (state.entries > MAX_DISCOVERY_DIRECTORY_ENTRIES) {
    throw new RangeError("Discovery directory entry limit exceeded");
  }
  if (state.files > MAX_DISCOVERY_FILES) {
    throw new RangeError("Discovery file limit exceeded");
  }
  if (state.pathCharacters > MAX_DISCOVERY_PATH_CHARACTERS) {
    throw new RangeError("Discovery path data limit exceeded");
  }
}

function isNotFoundError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const code = (error as { code?: unknown }).code;
  return code === "ENOENT" || code === "ENOTDIR";
}

function nodePathExists(fs: typeof import("node:fs"), path: string): boolean {
  try {
    fs.statSync(path);
    return true;
  } catch (error) {
    if (isNotFoundError(error)) return false;
    throw error;
  }
}

function assertCanonicalPathWithinBase(baseDir: string, path: string): void {
  if (!isWithinDirectory(baseDir, path)) {
    throw new TypeError("Discovery path resolves outside the project root");
  }
}

/** Reject a discovery path whose lexical form escapes the configured base directory. */
export function assertDiscoveryPathLexicallyWithinBase(
  path: string,
  context: FileDiscoveryContext,
): void {
  const baseDir = context.baseDir;
  if (baseDir === undefined) return;
  if (baseDir === "") {
    const normalized = path.replaceAll("\\", "/");
    if (
      pathHelper.isAbsolute(normalized) || normalized.split("/").includes("..") ||
      hasControlCharacter(normalized)
    ) {
      throw new TypeError("Discovery path resolves outside the project root");
    }
    return;
  }

  assertCanonicalPathWithinBase(pathHelper.resolve(baseDir), pathHelper.resolve(path));
}

/** Reject a discovery path whose lexical or physical target escapes baseDir. */
export async function assertDiscoveryPathWithinBase(
  path: string,
  context: FileDiscoveryContext,
): Promise<void> {
  const baseDir = context.baseDir;
  if (baseDir === undefined) return;
  assertDiscoveryPathLexicallyWithinBase(path, context);
  if (baseDir === "") return;

  if (context.fsAdapter) {
    if (typeof context.fsAdapter.realPath === "function") {
      const [canonicalBase, canonicalPath] = await Promise.all([
        context.fsAdapter.realPath(baseDir),
        context.fsAdapter.realPath(path),
      ]);
      assertCanonicalPathWithinBase(canonicalBase, canonicalPath);
      return;
    }
    if (typeof context.fsAdapter.lstat === "function") {
      const relativePath = pathHelper.relative(
        pathHelper.resolve(baseDir),
        pathHelper.resolve(path),
      );
      const segments = relativePath.split(/[/\\]/).filter(Boolean);
      if (segments.length > MAX_DISCOVERY_CANONICAL_COMPONENTS) {
        throw new RangeError("Discovery path component limit exceeded");
      }

      let candidate = baseDir;
      const baseInfo = await context.fsAdapter.lstat(candidate);
      if (baseInfo.isSymlink) {
        throw new TypeError("Discovery path cannot be verified within the project root");
      }
      for (const segment of segments) {
        candidate = pathHelper.join(candidate, segment);
        const info = await context.fsAdapter.lstat(candidate);
        if (info.isSymlink) {
          throw new TypeError("Discovery path cannot be verified within the project root");
        }
      }
    }
    return;
  }

  const { fs } = await getNodeDeps();
  const canonicalBase = fs.realpathSync(baseDir);
  const canonicalPath = fs.realpathSync(path);
  assertCanonicalPathWithinBase(canonicalBase, canonicalPath);
}

/** Convert a discovery file marker to the path expected by its filesystem. */
export function discoveryFileUrlToPath(
  fileUrl: string,
  context: FileDiscoveryContext,
): string {
  if (!fileUrl.startsWith("file://")) return fileUrl;
  // Adapter-backed discovery uses file:// as a transport-neutral marker and
  // may intentionally carry relative virtual paths that are not valid URLs.
  if (context.fsAdapter) return fileUrl.slice("file://".length);
  return pathHelper.fromFileUrl(fileUrl);
}

function assertDiscoveryTextWithinLimit(content: string): void {
  if (textEncoder.encode(content).byteLength > MAX_DISCOVERY_TEXT_FILE_BYTES) {
    throw new RangeError("Discovery text file exceeds the size limit");
  }
}

/**
 * Find all TypeScript files in a directory recursively
 */
async function findFilesByExtension(
  dir: string,
  context: FileDiscoveryContext,
  extensions: readonly string[],
  state: DiscoveryTraversalState = { entries: 0, files: 0, pathCharacters: 0 },
  depth = 0,
): Promise<string[]> {
  const files: string[] = [];
  assertWithinTraversalLimits(state, depth);
  assertDiscoveryPathLexicallyWithinBase(dir, context);

  if (context.fsAdapter) {
    if (!(await context.fsAdapter.exists(dir))) return files;
    if (depth === 0) await assertDiscoveryPathWithinBase(dir, context);

    for await (const entry of context.fsAdapter.readDir(dir)) {
      assertSafeEntryName(entry.name);
      state.entries++;
      assertWithinTraversalLimits(state, depth);
      const filePath = `${dir}/${entry.name}`;
      state.pathCharacters += filePath.length;
      assertWithinTraversalLimits(state, depth);

      if (entry.isFile && isDiscoverableFile(entry.name, extensions)) {
        state.files++;
        assertWithinTraversalLimits(state, depth);
        files.push(`file://${filePath}`);
        continue;
      }

      if (entry.isDirectory && !entry.isSymlink) {
        files.push(
          ...(await findFilesByExtension(filePath, context, extensions, state, depth + 1)),
        );
      }
    }

    return files;
  }

  const { fs, path } = await getNodeDeps();
  if (!nodePathExists(fs, dir)) return files;
  if (depth === 0) await assertDiscoveryPathWithinBase(dir, context);

  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    assertSafeEntryName(entry.name);
    state.entries++;
    assertWithinTraversalLimits(state, depth);
    const filePath = path.join(dir, entry.name);
    state.pathCharacters += filePath.length;
    assertWithinTraversalLimits(state, depth);

    if (entry.isFile() && isDiscoverableFile(entry.name, extensions)) {
      state.files++;
      assertWithinTraversalLimits(state, depth);
      files.push(pathHelper.toFileUrl(path.resolve(filePath)).href);
      continue;
    }

    if (entry.isDirectory()) {
      files.push(...(await findFilesByExtension(filePath, context, extensions, state, depth + 1)));
    }
  }

  return files;
}

/**
 * Get lazily loaded Node.js filesystem dependencies.
 *
 * Only called when no fsAdapter is present. Callers must guard accordingly.
 */
async function getNodeDeps(): Promise<NodeDiscoveryDependencies> {
  nodeDependencies ??= Promise.all([import("node:fs"), import("node:path")]).then(
    ([fs, path]) => ({ fs, path }),
  );
  return await nodeDependencies;
}

/**
 * Find all TypeScript files in a directory recursively.
 */
export function findTypeScriptFiles(
  dir: string,
  context: FileDiscoveryContext,
): Promise<string[]> {
  return findFilesByExtension(dir, context, [".ts", ".tsx", ".js", ".jsx", ".mjs"]);
}

/**
 * Find all Markdown files in a directory recursively.
 */
export function findMarkdownFiles(
  dir: string,
  context: FileDiscoveryContext,
): Promise<string[]> {
  return findFilesByExtension(dir, context, [".md"]);
}

export async function readDiscoveryTextFile(
  fileUrl: string,
  context: FileDiscoveryContext,
): Promise<string> {
  const path = discoveryFileUrlToPath(fileUrl, context);
  await assertDiscoveryPathWithinBase(path, context);

  if (context.fsAdapter) {
    if (typeof context.fsAdapter.stat === "function") {
      const info = await context.fsAdapter.stat(path);
      if (info.size > MAX_DISCOVERY_TEXT_FILE_BYTES) {
        throw new RangeError("Discovery text file exceeds the size limit");
      }
    }
    const content = await context.fsAdapter.readFile(path);
    assertDiscoveryTextWithinLimit(content);
    return content;
  }

  const { fs } = await getNodeDeps();
  if (fs.statSync(path).size > MAX_DISCOVERY_TEXT_FILE_BYTES) {
    throw new RangeError("Discovery text file exceeds the size limit");
  }
  const content = fs.readFileSync(path, "utf-8");
  assertDiscoveryTextWithinLimit(content);
  return content;
}

/** A single top-level entry inside a discovery directory. */
export type DiscoveryDirectoryEntry = {
  name: string;
  isFile: boolean;
  isDirectory: boolean;
};

/** Lists the immediate (non-recursive) entries of a discovery directory. */
export async function listDiscoveryDirectoryEntries(
  dir: string,
  context: FileDiscoveryContext,
): Promise<DiscoveryDirectoryEntry[]> {
  const entries: DiscoveryDirectoryEntry[] = [];
  assertDiscoveryPathLexicallyWithinBase(dir, context);

  if (context.fsAdapter) {
    if (!(await context.fsAdapter.exists(dir))) return entries;
    await assertDiscoveryPathWithinBase(dir, context);

    for await (const entry of context.fsAdapter.readDir(dir)) {
      assertSafeEntryName(entry.name);
      if (entries.length >= MAX_DISCOVERY_DIRECTORY_ENTRIES) {
        throw new RangeError("Discovery directory entry limit exceeded");
      }
      entries.push({
        name: entry.name,
        isFile: entry.isFile,
        isDirectory: entry.isDirectory && !entry.isSymlink,
      });
    }

    return entries;
  }

  const { fs } = await getNodeDeps();
  if (!nodePathExists(fs, dir)) return entries;
  await assertDiscoveryPathWithinBase(dir, context);

  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    assertSafeEntryName(entry.name);
    if (entries.length >= MAX_DISCOVERY_DIRECTORY_ENTRIES) {
      throw new RangeError("Discovery directory entry limit exceeded");
    }
    entries.push({
      name: entry.name,
      isFile: entry.isFile(),
      isDirectory: entry.isDirectory(),
    });
  }

  return entries;
}

/** Returns true when a discovery file exists (fsAdapter-aware). */
export async function discoveryFileExists(
  path: string,
  context: FileDiscoveryContext,
): Promise<boolean> {
  assertDiscoveryPathLexicallyWithinBase(path, context);
  if (context.fsAdapter) {
    const exists = await context.fsAdapter.exists(path);
    if (exists) await assertDiscoveryPathWithinBase(path, context);
    return exists;
  }
  const { fs } = await getNodeDeps();
  const exists = nodePathExists(fs, path);
  if (exists) await assertDiscoveryPathWithinBase(path, context);
  return exists;
}
