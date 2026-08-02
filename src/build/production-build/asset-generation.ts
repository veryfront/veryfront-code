/**
 * Asset Generation for Build
 * Handles copying static assets from public directory
 */

import { serverLogger } from "#veryfront/utils";
import { join, resolve } from "#veryfront/compat/path/index.ts";
import type { DirEntry, FileInfo, RuntimeAdapter } from "#veryfront/platform/adapters/base.ts";
import { CLIENT_STYLES } from "./templates.ts";
import { isAlreadyExistsError, isNotFoundError } from "#veryfront/platform/compat/fs.ts";
import { BUILD_FAILED } from "#veryfront/errors";
import { hasControlCharacters } from "../utils/string-validation.ts";
import { STATIC_ASSET_MAX_BYTES } from "#veryfront/utils/constants/static-assets.ts";
import {
  captureExclusiveCreateCapability,
  captureSnapshotReadCapability,
} from "#veryfront/platform/adapters/file-system-capabilities.ts";
import { getFixedUint8ArrayByteLength } from "#veryfront/platform/adapters/bounded-text-reader.ts";
import {
  isNativeErrorWithoutHooks,
  readNativeErrorNameWithoutHooks,
} from "#veryfront/platform/compat/error-introspection.ts";
import {
  type BuildOutputOwnership,
  resolveBuildOutputOwnership,
} from "./build/build-publication.ts";

const logger = serverLogger.component("build");
const MAX_STATIC_ASSET_PATH_LENGTH = 4_096;
const MAX_STATIC_ASSET_DEPTH = 64;
const MAX_STATIC_ASSET_ENTRIES = 100_000;
const RESERVED_PUBLIC_ROOTS = new Set(["_veryfront", "_vf"]);
const RESERVED_PUBLIC_FILES = new Set(["sw.js", "_redirects"]);
const getOwnPropertyDescriptor = Object.getOwnPropertyDescriptor;

function hasNoSymlinkSemantics(fileSystem: object): boolean {
  try {
    const descriptor = getOwnPropertyDescriptor(fileSystem, "symlinkSemantics");
    return descriptor !== undefined && "value" in descriptor && descriptor.value === "none";
  } catch {
    return false;
  }
}

export interface AssetStats {
  assets: number;
  totalSize: number;
}

export interface StaticAssetEntry {
  sourcePath: string;
  relativePath: string;
  kind: "file" | "directory";
  size: number;
}

export type StaticAssetCopyTarget =
  | { readonly dryRun: true }
  | { readonly dryRun: false; readonly output: BuildOutputOwnership };

function compareNames(left: { name: string }, right: { name: string }): number {
  if (left.name === right.name) return 0;
  return left.name < right.name ? -1 : 1;
}

function compareAssetEntries(left: StaticAssetEntry, right: StaticAssetEntry): number {
  const depth = left.relativePath.split("/").length -
    right.relativePath.split("/").length;
  if (depth !== 0) return depth;
  if (left.relativePath === right.relativePath) return 0;
  return left.relativePath < right.relativePath ? -1 : 1;
}

function portableNameKey(name: string): string {
  return name.normalize("NFC").toLocaleLowerCase("en-US");
}

async function statPath(
  adapter: RuntimeAdapter,
  path: string,
): Promise<FileInfo> {
  const lstat = adapter.fs.lstat?.bind(adapter.fs);
  if (lstat) return await lstat(path);
  if (hasNoSymlinkSemantics(adapter.fs)) return await adapter.fs.stat(path);
  throw BUILD_FAILED.create({
    detail: `Non-following filesystem metadata is required for static assets: ${path}`,
  });
}

async function statPathIfPresent(
  adapter: RuntimeAdapter,
  path: string,
): Promise<FileInfo | null> {
  try {
    return await statPath(adapter, path);
  } catch (error) {
    if (isNotFoundError(error)) return null;
    throw error;
  }
}

function assertSafeAssetPath(relativePath: string): void {
  if (
    relativePath.length === 0 ||
    relativePath.length > MAX_STATIC_ASSET_PATH_LENGTH ||
    relativePath.startsWith("/") ||
    relativePath.includes("\\") ||
    hasControlCharacters(relativePath) ||
    relativePath.split("/").some((segment) => segment === "" || segment === "." || segment === "..")
  ) {
    throw BUILD_FAILED.create({
      detail: `Invalid public asset path: ${relativePath}`,
    });
  }

  const normalizedPath = relativePath.toLowerCase();
  const firstSegment = normalizedPath.split("/")[0];
  if (
    (firstSegment && RESERVED_PUBLIC_ROOTS.has(firstSegment)) ||
    RESERVED_PUBLIC_FILES.has(normalizedPath)
  ) {
    throw BUILD_FAILED.create({
      detail: `Public asset path is reserved for generated build output: ${relativePath}`,
    });
  }
}

function assertUsableEntry(entry: DirEntry, relativePath: string): void {
  if (
    typeof entry.name !== "string" ||
    entry.name.length === 0 ||
    entry.name === "." ||
    entry.name === ".." ||
    entry.name.includes("/") ||
    entry.name.includes("\\") ||
    hasControlCharacters(entry.name)
  ) {
    throw BUILD_FAILED.create({
      detail: `Invalid public directory entry: ${relativePath}`,
    });
  }
  if (entry.isSymlink !== false) {
    throw BUILD_FAILED.create({
      detail: `Symbolic links are not supported in public assets: ${relativePath}`,
    });
  }
  if (entry.isFile === entry.isDirectory) {
    throw BUILD_FAILED.create({
      detail: `Unsupported public asset type: ${relativePath}`,
    });
  }
}

function assertExpectedInfo(
  info: FileInfo,
  kind: "file" | "directory",
  relativePath: string,
): void {
  if (info.isSymlink) {
    throw BUILD_FAILED.create({
      detail: `Symbolic links are not supported in public assets: ${relativePath}`,
    });
  }
  const matchesKind = kind === "file"
    ? info.isFile && !info.isDirectory
    : info.isDirectory && !info.isFile;
  if (!matchesKind) {
    throw BUILD_FAILED.create({
      detail: `Public asset changed type while being discovered: ${relativePath}`,
    });
  }
  if (!Number.isSafeInteger(info.size) || info.size < 0) {
    throw BUILD_FAILED.create({
      detail: `Public asset has an invalid size: ${relativePath}`,
    });
  }
  if (kind === "file" && info.size > STATIC_ASSET_MAX_BYTES) {
    throw BUILD_FAILED.create({
      detail:
        `Public asset exceeds the ${STATIC_ASSET_MAX_BYTES}-byte static output limit: ${relativePath}`,
    });
  }
}

function assertSafeBuildOutputPath(relativePath: string): void {
  if (
    relativePath.length === 0 ||
    relativePath.length > MAX_STATIC_ASSET_PATH_LENGTH ||
    relativePath.startsWith("/") ||
    relativePath.includes("\\") ||
    hasControlCharacters(relativePath) ||
    relativePath.split("/").some((segment) => segment === "" || segment === "." || segment === "..")
  ) {
    throw BUILD_FAILED.create({ detail: `Invalid build output path: ${relativePath}` });
  }
}

function assertExpectedBuildOutputInfo(
  info: FileInfo,
  kind: "file" | "directory",
  relativePath: string,
): void {
  if (info.isSymlink) {
    throw BUILD_FAILED.create({
      detail: `Symbolic links are not supported in build output: ${relativePath}`,
    });
  }
  const matchesKind = kind === "file"
    ? info.isFile && !info.isDirectory
    : info.isDirectory && !info.isFile;
  if (!matchesKind) {
    throw BUILD_FAILED.create({
      detail: `Build output changed type while being validated: ${relativePath}`,
    });
  }
  if (!Number.isSafeInteger(info.size) || info.size < 0) {
    throw BUILD_FAILED.create({ detail: `Build output has an invalid size: ${relativePath}` });
  }
  if (kind === "file" && info.size > STATIC_ASSET_MAX_BYTES) {
    throw BUILD_FAILED.create({
      detail:
        `Build output exceeds the ${STATIC_ASSET_MAX_BYTES}-byte static asset limit: ${relativePath}`,
    });
  }
}

/** Validate every final build artifact against the runtime static-file ceiling. */
export async function validateStaticBuildOutput(
  adapter: RuntimeAdapter,
  outputDir: string,
): Promise<void> {
  const outputInfo = await statPathIfPresent(adapter, outputDir);
  if (outputInfo === null) {
    throw BUILD_FAILED.create({ detail: `Build output directory does not exist: ${outputDir}` });
  }
  if (outputInfo.isSymlink || !outputInfo.isDirectory || outputInfo.isFile) {
    throw BUILD_FAILED.create({
      detail: `Build output path is not a safe directory: ${outputDir}`,
    });
  }

  let visitedEntries = 0;
  const scan = async (
    directoryPath: string,
    relativeDirectory: string,
    depth: number,
  ): Promise<void> => {
    if (depth > MAX_STATIC_ASSET_DEPTH) {
      throw BUILD_FAILED.create({
        detail: `Build output tree exceeds ${MAX_STATIC_ASSET_DEPTH} directory levels`,
      });
    }

    const entries: DirEntry[] = [];
    const portableNames = new Set<string>();
    for await (const entry of adapter.fs.readDir(directoryPath)) {
      visitedEntries++;
      if (visitedEntries > MAX_STATIC_ASSET_ENTRIES) {
        throw BUILD_FAILED.create({
          detail: `Build output tree exceeds ${MAX_STATIC_ASSET_ENTRIES} entries`,
        });
      }
      const relativePath = relativeDirectory ? `${relativeDirectory}/${entry.name}` : entry.name;
      assertSafeBuildOutputPath(relativePath);
      if (
        typeof entry.name !== "string" ||
        entry.name.length === 0 ||
        entry.name.includes("/") ||
        entry.name.includes("\\") ||
        entry.isSymlink !== false ||
        entry.isFile === entry.isDirectory
      ) {
        throw BUILD_FAILED.create({ detail: `Unsupported build output entry: ${relativePath}` });
      }
      const portableName = portableNameKey(entry.name);
      if (portableNames.has(portableName)) {
        throw BUILD_FAILED.create({
          detail: `Build output contains a portable path collision: ${relativePath}`,
        });
      }
      portableNames.add(portableName);
      entries.push(entry);
    }
    entries.sort(compareNames);

    for (const entry of entries) {
      const relativePath = relativeDirectory ? `${relativeDirectory}/${entry.name}` : entry.name;
      const path = join(directoryPath, entry.name);
      const kind = entry.isDirectory ? "directory" : "file";
      const info = await statPath(adapter, path);
      assertExpectedBuildOutputInfo(info, kind, relativePath);
      if (kind === "directory") await scan(path, relativePath, depth + 1);
    }
  };

  await scan(outputDir, "", 0);
}

export async function discoverStaticAssets(
  adapter: RuntimeAdapter,
  projectDir: string,
): Promise<StaticAssetEntry[]> {
  const publicDir = join(projectDir, "public");

  const publicInfo = await statPathIfPresent(adapter, publicDir);
  if (publicInfo === null) return [];
  if (publicInfo.isSymlink) {
    throw BUILD_FAILED.create({
      detail: `Symbolic links are not supported for the public asset root: ${publicDir}`,
    });
  }
  if (!publicInfo.isDirectory || publicInfo.isFile) {
    throw BUILD_FAILED.create({ detail: `Public asset path is not a directory: ${publicDir}` });
  }

  const entries: StaticAssetEntry[] = [];
  let visitedEntries = 0;

  const scan = async (
    directoryPath: string,
    relativeDirectory: string,
    depth: number,
  ): Promise<void> => {
    if (depth > MAX_STATIC_ASSET_DEPTH) {
      throw BUILD_FAILED.create({
        detail: `Public asset tree exceeds ${MAX_STATIC_ASSET_DEPTH} directory levels`,
      });
    }

    const directoryEntries: DirEntry[] = [];
    const portableNames = new Set<string>();
    for await (const entry of adapter.fs.readDir(directoryPath)) {
      visitedEntries++;
      if (visitedEntries > MAX_STATIC_ASSET_ENTRIES) {
        throw BUILD_FAILED.create({
          detail: `Public asset tree exceeds ${MAX_STATIC_ASSET_ENTRIES} entries`,
        });
      }
      const relativePath = relativeDirectory ? `${relativeDirectory}/${entry.name}` : entry.name;
      assertUsableEntry(entry, relativePath);
      const portableName = portableNameKey(entry.name);
      if (portableNames.has(portableName)) {
        throw BUILD_FAILED.create({
          detail: `Public directory contains a portable path collision: ${relativePath}`,
        });
      }
      portableNames.add(portableName);
      directoryEntries.push(entry);
    }
    directoryEntries.sort(compareNames);

    for (const entry of directoryEntries) {
      const relativePath = relativeDirectory ? `${relativeDirectory}/${entry.name}` : entry.name;
      assertSafeAssetPath(relativePath);
      const sourcePath = join(directoryPath, entry.name);
      const kind = entry.isDirectory ? "directory" : "file";
      const info = await statPath(adapter, sourcePath);
      assertExpectedInfo(info, kind, relativePath);
      entries.push({
        sourcePath,
        relativePath,
        kind,
        size: kind === "file" ? info.size : 0,
      });
      if (kind === "directory") {
        await scan(sourcePath, relativePath, depth + 1);
      }
    }
  };

  await scan(publicDir, "", 0);
  return entries.sort(compareAssetEntries);
}

/**
 * Copy static assets from public directory to output directory
 */
export async function copyStaticAssets(
  adapter: RuntimeAdapter,
  projectDir: string,
  target: StaticAssetCopyTarget,
): Promise<AssetStats> {
  const resolvedTarget = target.dryRun ? { dryRun: true as const } : {
    dryRun: false as const,
    outputDir: resolveBuildOutputOwnership(target.output, adapter.fs),
  };
  const entries = await discoverStaticAssets(adapter, projectDir);
  const fileEntries = entries.filter((entry) => entry.kind === "file");
  const totalSize = fileEntries.reduce((total, entry) => total + entry.size, 0);
  if (!Number.isSafeInteger(totalSize)) {
    throw BUILD_FAILED.create({
      detail: "Public asset inventory exceeds the supported total size",
    });
  }
  const stats: AssetStats = { assets: fileEntries.length, totalSize };
  if (resolvedTarget.dryRun) {
    if (entries.length === 0) {
      logger.debug("No public assets found");
    } else {
      logger.info(`Counted ${stats.assets} static assets`);
    }
    return stats;
  }

  const outputDir = resolvedTarget.outputDir;
  const outputInfo = await statPathIfPresent(adapter, outputDir);
  if (
    outputInfo === null || outputInfo.isSymlink ||
    !outputInfo.isDirectory || outputInfo.isFile
  ) {
    throw BUILD_FAILED.create({
      detail: `Owned build stage is not a safe existing directory: ${outputDir}`,
    });
  }
  if (entries.length === 0) {
    logger.debug("No public assets found");
    return stats;
  }

  let snapshotReader: ReturnType<typeof captureSnapshotReadCapability>;
  let exclusiveCreator: ReturnType<typeof captureExclusiveCreateCapability>;
  try {
    snapshotReader = captureSnapshotReadCapability(
      adapter.fs,
      "Public asset filesystem",
    );
  } catch (cause) {
    throw BUILD_FAILED.create({
      detail: "The selected runtime adapter has invalid stable snapshot read support",
      cause,
    });
  }
  if (fileEntries.length > 0 && snapshotReader === undefined) {
    throw BUILD_FAILED.create({
      detail:
        "The selected runtime adapter must support stable snapshot reads to copy public assets",
    });
  }
  try {
    exclusiveCreator = captureExclusiveCreateCapability(
      adapter.fs,
      "Public asset filesystem",
    );
  } catch (cause) {
    throw BUILD_FAILED.create({
      detail: "The selected runtime adapter has invalid exclusive file creation support",
      cause,
    });
  }
  if (fileEntries.length > 0 && exclusiveCreator === undefined) {
    throw BUILD_FAILED.create({
      detail:
        "The selected runtime adapter must support exclusive file creation to copy public assets",
    });
  }

  const publicDir = join(projectDir, "public");
  let canonicalPublicRoot: string;
  if (hasNoSymlinkSemantics(adapter.fs)) {
    canonicalPublicRoot = resolve(publicDir);
  } else {
    const realPath = adapter.fs.realPath?.bind(adapter.fs);
    if (!realPath) {
      throw BUILD_FAILED.create({
        detail: "The selected runtime adapter must support canonical public root resolution",
      });
    }
    try {
      canonicalPublicRoot = await realPath(publicDir);
    } catch (cause) {
      throw BUILD_FAILED.create({
        detail: `Failed to canonicalize the public asset root: ${publicDir}`,
        cause,
      });
    }
  }

  const destinationInfo = new Map<string, FileInfo | null>();
  for (const entry of entries) {
    const destinationPath = join(outputDir, entry.relativePath);
    const info = await statPathIfPresent(adapter, destinationPath);
    destinationInfo.set(destinationPath, info);
    if (entry.kind === "directory") {
      if (info?.isSymlink || (info && (!info.isDirectory || info.isFile))) {
        throw BUILD_FAILED.create({
          detail: `Public directory collides with generated output: ${entry.relativePath}`,
        });
      }
      continue;
    }
    if (info !== null) {
      throw BUILD_FAILED.create({
        detail: `Public asset would overwrite generated output: ${entry.relativePath}`,
      });
    }
  }

  for (const entry of entries) {
    if (entry.kind !== "directory") continue;
    const destinationPath = join(outputDir, entry.relativePath);
    if (destinationInfo.get(destinationPath) !== null) continue;
    await adapter.fs.mkdir(destinationPath);
  }

  for (const entry of fileEntries) {
    let content: Uint8Array;
    const snapshotSourcePath = join(canonicalPublicRoot, entry.relativePath);
    try {
      content = await snapshotReader!.read(
        snapshotSourcePath,
        canonicalPublicRoot,
        STATIC_ASSET_MAX_BYTES,
      );
    } catch (cause) {
      if (
        isNativeErrorWithoutHooks(cause) &&
        readNativeErrorNameWithoutHooks(cause) === "RangeError"
      ) {
        throw BUILD_FAILED.create({
          detail: `Public asset changed size while being read: ${entry.relativePath}`,
          cause,
        });
      }
      throw cause;
    }
    if (
      getFixedUint8ArrayByteLength(content, `Public asset ${entry.relativePath}`) !==
        entry.size
    ) {
      throw BUILD_FAILED.create({
        detail: `Public asset changed size while being read: ${entry.relativePath}`,
      });
    }
    const destinationPath = join(outputDir, entry.relativePath);
    try {
      await exclusiveCreator!.create(destinationPath, content);
    } catch (cause) {
      if (isAlreadyExistsError(cause)) {
        throw BUILD_FAILED.create({
          detail:
            `Public asset destination changed before exclusive creation: ${entry.relativePath}`,
          cause,
        });
      }
      throw cause;
    }
  }

  logger.debug(`Copied ${stats.assets} static assets`);
  return stats;
}

/**
 * Load CSS template (embedded for npm compatibility)
 */
export function loadClientStyles(): string {
  return CLIENT_STYLES;
}
