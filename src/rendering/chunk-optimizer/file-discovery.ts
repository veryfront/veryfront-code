import { join } from "#veryfront/compat/path/index.ts";
import { isNotFoundError } from "#veryfront/platform/compat/fs.ts";
import type { ChunkOptimizerFileSystem } from "./contracts.ts";
import { hasControlCharacter, readOwnDataProperty } from "./data-properties.ts";
import {
  MAX_DIRECTORY_ENTRY_NAME_CHARS,
  MAX_PAGE_FILES,
  MAX_PROJECT_PATH_CHARS,
  MAX_SCAN_DEPTH,
  MAX_SCAN_DIRECTORIES,
  MAX_SCAN_ENTRIES,
  MAX_SCANNED_PATH_CHARS,
  MAX_TOTAL_DIRECTORY_ENTRY_NAME_CHARS,
  MAX_TOTAL_SCANNED_PATH_CHARS,
} from "./limits.ts";

/** Build artifacts under `.veryfront` that cannot contain authored pages. */
const VERYFRONT_EXCLUDED_DIRS = new Set([
  "cache",
  "compiled",
  "tmp",
  "temp",
  "output",
  "optimized-images",
  "css",
]);

interface DirectoryEntrySnapshot {
  readonly name: string;
  readonly isFile: boolean;
  readonly isDirectory: boolean;
}

interface PendingDirectory {
  readonly path: string;
  readonly depth: number;
  readonly insideVeryfront: boolean;
  readonly root: boolean;
}

interface ScanBudget {
  entries: number;
  directories: number;
  files: number;
  entryNameChars: number;
  scannedPathChars: number;
}

function hasUnsafePathCharacter(value: string): boolean {
  return value.includes("/") ||
    value.includes("\\") ||
    hasControlCharacter(value);
}

function snapshotDirectoryEntry(value: unknown): DirectoryEntrySnapshot {
  const name = readOwnDataProperty(value, "name");
  const isFile = readOwnDataProperty(value, "isFile");
  const isDirectory = readOwnDataProperty(value, "isDirectory");
  if (
    !name.found ||
    typeof name.value !== "string" ||
    !isFile.found ||
    typeof isFile.value !== "boolean" ||
    !isDirectory.found ||
    typeof isDirectory.value !== "boolean"
  ) {
    throw new TypeError("Chunk analysis received an invalid directory entry");
  }
  if (
    name.value.length === 0 ||
    name.value.length > MAX_DIRECTORY_ENTRY_NAME_CHARS ||
    name.value === "." ||
    name.value === ".." ||
    hasUnsafePathCharacter(name.value)
  ) {
    throw new TypeError("Chunk analysis received an invalid directory entry name");
  }
  if (isFile.value && isDirectory.value) {
    throw new TypeError(
      "Chunk analysis directory entries cannot be both files and directories",
    );
  }
  return Object.freeze({
    name: name.value,
    isFile: isFile.value,
    isDirectory: isDirectory.value,
  });
}

function shouldSkipDirectory(
  name: string,
  insideVeryfront: boolean,
): boolean {
  if (insideVeryfront && VERYFRONT_EXCLUDED_DIRS.has(name)) return true;
  return name.startsWith(".") && name !== ".veryfront";
}

function assertProjectDir(projectDir: string): void {
  if (
    typeof projectDir !== "string" ||
    projectDir.length === 0 ||
    projectDir.length > MAX_PROJECT_PATH_CHARS ||
    hasControlCharacter(projectDir)
  ) {
    throw new TypeError(
      `Chunk analysis projectDir must contain between 1 and ${MAX_PROJECT_PATH_CHARS} characters without control characters`,
    );
  }
}

function assertScannedPath(path: string): void {
  if (path.length > MAX_SCANNED_PATH_CHARS) {
    throw new RangeError(
      `Chunk analysis path exceeds ${MAX_SCANNED_PATH_CHARS} characters`,
    );
  }
}

async function readDirectory(
  fs: ChunkOptimizerFileSystem,
  directory: PendingDirectory,
  budget: ScanBudget,
): Promise<DirectoryEntrySnapshot[]> {
  const entries: DirectoryEntrySnapshot[] = [];
  try {
    for await (const rawEntry of fs.readDir(directory.path)) {
      if (budget.entries >= MAX_SCAN_ENTRIES) {
        throw new RangeError(
          `Chunk analysis directory entry limit of ${MAX_SCAN_ENTRIES} was exceeded`,
        );
      }
      const entry = snapshotDirectoryEntry(rawEntry);
      if (
        entry.name.length >
          MAX_TOTAL_DIRECTORY_ENTRY_NAME_CHARS - budget.entryNameChars
      ) {
        throw new RangeError(
          `Chunk analysis directory-entry name budget of ${MAX_TOTAL_DIRECTORY_ENTRY_NAME_CHARS} characters was exceeded`,
        );
      }
      budget.entries++;
      budget.entryNameChars += entry.name.length;
      entries.push(entry);
    }
  } catch (error) {
    if (
      directory.root &&
      entries.length === 0 &&
      isNotFoundError(error)
    ) {
      return [];
    }
    throw error;
  }

  entries.sort((left, right) => left.name < right.name ? -1 : left.name > right.name ? 1 : 0);
  for (let index = 1; index < entries.length; index++) {
    if (entries[index - 1]!.name === entries[index]!.name) {
      throw new TypeError(
        `Chunk analysis received duplicate directory entry ${entries[index]!.name}`,
      );
    }
  }
  return entries;
}

async function collectPageFiles(
  root: string,
  insideVeryfront: boolean,
  fs: ChunkOptimizerFileSystem,
  budget: ScanBudget,
  output: Set<string>,
): Promise<void> {
  const pending: PendingDirectory[] = [{
    path: root,
    depth: 0,
    insideVeryfront,
    root: true,
  }];

  while (pending.length > 0) {
    const directory = pending.pop()!;
    if (directory.depth > MAX_SCAN_DEPTH) {
      throw new RangeError(
        `Chunk analysis directory depth limit of ${MAX_SCAN_DEPTH} was exceeded`,
      );
    }
    if (budget.directories >= MAX_SCAN_DIRECTORIES) {
      throw new RangeError(
        `Chunk analysis directory limit of ${MAX_SCAN_DIRECTORIES} was exceeded`,
      );
    }
    budget.directories++;

    const entries = await readDirectory(fs, directory, budget);
    const childDirectories: PendingDirectory[] = [];
    for (const entry of entries) {
      const path = join(directory.path, entry.name);
      assertScannedPath(path);
      if (
        path.length > MAX_TOTAL_SCANNED_PATH_CHARS - budget.scannedPathChars
      ) {
        throw new RangeError(
          `Chunk analysis scanned-path budget of ${MAX_TOTAL_SCANNED_PATH_CHARS} characters was exceeded`,
        );
      }
      budget.scannedPathChars += path.length;

      if (entry.isFile) {
        if (!entry.name.endsWith(".mdx") && !entry.name.endsWith(".md")) {
          continue;
        }
        if (!output.has(path)) {
          if (budget.files >= MAX_PAGE_FILES) {
            throw new RangeError(
              `Chunk analysis page-file limit of ${MAX_PAGE_FILES} was exceeded`,
            );
          }
          budget.files++;
          output.add(path);
        }
        continue;
      }
      if (
        !entry.isDirectory ||
        shouldSkipDirectory(entry.name, directory.insideVeryfront)
      ) {
        continue;
      }

      childDirectories.push({
        path,
        depth: directory.depth + 1,
        insideVeryfront: directory.insideVeryfront ||
          entry.name === ".veryfront",
        root: false,
      });
    }

    for (let index = childDirectories.length - 1; index >= 0; index--) {
      pending.push(childDirectories[index]!);
    }
  }
}

export async function discoverPageFiles(
  projectDir: string,
  fs: ChunkOptimizerFileSystem,
): Promise<string[]> {
  assertProjectDir(projectDir);
  const discoveredPaths = new Set<string>();
  const budget: ScanBudget = {
    entries: 0,
    directories: 0,
    files: 0,
    entryNameChars: 0,
    scannedPathChars: 0,
  };

  await collectPageFiles(
    join(projectDir, "pages"),
    false,
    fs,
    budget,
    discoveredPaths,
  );
  await collectPageFiles(
    join(projectDir, ".veryfront"),
    true,
    fs,
    budget,
    discoveredPaths,
  );
  return [...discoveredPaths].sort();
}
