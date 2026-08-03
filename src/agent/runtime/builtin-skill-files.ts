import {
  closeSync,
  constants,
  type Dirent,
  fstatSync,
  lstatSync,
  opendirSync,
  openSync,
  readSync,
  realpathSync,
  type Stats,
} from "node:fs";
import { isAbsolute, relative, resolve, sep } from "node:path";
import {
  SKILL_LOADABLE_REFERENCE_MAX_ENTRIES,
  SKILL_PATH_SEGMENT_MAX_LENGTH,
  SKILL_RELATIVE_PATH_MAX_LENGTH,
  SKILL_ROOT_PATH_MAX_LENGTH,
  SKILL_SUBDIR_MAX_ENTRIES,
  SKILL_TEXT_FILE_MAX_BYTES,
} from "#veryfront/skill/limits.ts";
import {
  isValidStrictSkillName,
  SKILL_READABLE_DIRS,
  SKILL_REFERENCES_DIR,
} from "#veryfront/skill/types.ts";
import { hasControlCharacters, isWellFormedUtf16 } from "#veryfront/skill/string-safety.ts";
import {
  createFileSystem,
  isNotFoundError as isPlatformNotFoundError,
} from "#veryfront/platform/compat/fs.ts";
import type { SkillOperationBudget } from "#veryfront/skill/operation-budget.ts";
import { normalizeStrictRuntimeSkillReferencePath } from "./skill-metadata.ts";

const UTF8_DECODER = new TextDecoder("utf-8", { fatal: true });
const BUILTIN_SKILL_READABLE_DIR_SET = new Set<string>(SKILL_READABLE_DIRS);
const builtinFileSystem = createFileSystem();

async function readBuiltinFileWithinLimit(
  root: string,
  path: string,
  budget: SkillOperationBudget,
): Promise<string | null> {
  try {
    return await budget.run(async () => {
      const reader = builtinFileSystem.readFileSnapshotWithinLimit;
      if (!reader) {
        throw new Error("Runtime filesystem does not support bounded snapshot reads");
      }
      return UTF8_DECODER.decode(
        await reader.call(builtinFileSystem, path, root, SKILL_TEXT_FILE_MAX_BYTES),
      );
    });
  } catch (error) {
    if (isPlatformNotFoundError(error)) return null;
    throw error;
  }
}

/** Result returned from runtime builtin skill entries. */
export type RuntimeBuiltinSkillEntriesResult = { ok: true; entries: Dirent[] } | {
  ok: false;
  errorMessage: string;
};

function isNotFoundError(error: unknown): boolean {
  return (error as NodeJS.ErrnoException | undefined)?.code === "ENOENT";
}

function tryLstat(path: string): Stats | null {
  try {
    return lstatSync(path);
  } catch (error) {
    if (isNotFoundError(error)) return null;
    throw error;
  }
}

function requireBoundedRootPath(path: string): string {
  if (
    typeof path !== "string" ||
    path.length === 0 ||
    path.length > SKILL_ROOT_PATH_MAX_LENGTH ||
    !isWellFormedUtf16(path) ||
    hasControlCharacters(path)
  ) {
    throw new TypeError("Built-in skills root must be a bounded filesystem path");
  }
  return resolve(path);
}

function isPathInside(baseDir: string, targetPath: string): boolean {
  const rel = relative(baseDir, targetPath);
  return rel === "" ||
    (!isAbsolute(rel) && rel !== ".." && !rel.startsWith(`..${sep}`));
}

function requireSafeRoot(skillsDir: string): string | null {
  const root = requireBoundedRootPath(skillsDir);
  const info = tryLstat(root);
  if (!info) return null;
  if (info.isSymbolicLink()) {
    throw new TypeError("Built-in skills root must not be a symlink");
  }
  if (!info.isDirectory()) {
    throw new TypeError("Built-in skills root must be a directory");
  }
  return root;
}

function requireExpectedKind(info: Stats, kind: "file" | "directory"): void {
  if (kind === "file" ? !info.isFile() : !info.isDirectory()) {
    throw new TypeError(`Built-in skill path must point to a ${kind}`);
  }
}

/**
 * Inspect one path below a built-in skills root without following symlinks.
 * Missing paths return null; unsafe or malformed existing paths throw.
 */
function inspectPathWithinRoot(
  skillsDir: string,
  targetPath: string,
  kind: "file" | "directory",
): { root: string; target: string; info: Stats } | null {
  const root = requireSafeRoot(skillsDir);
  if (!root) return null;

  const target = resolve(targetPath);
  if (!isPathInside(root, target) || target === root) {
    throw new TypeError("Built-in skill path escapes its root");
  }

  const rel = relative(root, target);
  const segments = rel.split(sep);
  let current = root;
  let finalInfo: Stats | null = null;

  for (let index = 0; index < segments.length; index += 1) {
    current = resolve(current, segments[index]!);
    const info = tryLstat(current);
    if (!info) return null;
    if (info.isSymbolicLink()) {
      throw new TypeError("Built-in skill path must not contain symlinks");
    }
    if (index < segments.length - 1 && !info.isDirectory()) {
      throw new TypeError("Built-in skill parent path must be a directory");
    }
    finalInfo = info;
  }

  if (!finalInfo) return null;
  requireExpectedKind(finalInfo, kind);

  let realRoot: string;
  let realTarget: string;
  try {
    realRoot = realpathSync(root);
    realTarget = realpathSync(target);
  } catch (error) {
    if (isNotFoundError(error)) return null;
    throw error;
  }
  if (!isPathInside(realRoot, realTarget)) {
    throw new TypeError("Built-in skill path escapes its root");
  }

  return { root, target, info: finalInfo };
}

function isSameFile(left: Stats, right: Stats): boolean {
  return left.dev === right.dev && left.ino === right.ino;
}

function readBoundedTextFile(skillsDir: string, path: string): string | null {
  const inspected = inspectPathWithinRoot(skillsDir, path, "file");
  if (!inspected) return null;

  const noFollow = typeof constants.O_NOFOLLOW === "number" ? constants.O_NOFOLLOW : 0;
  let descriptor: number;
  try {
    descriptor = openSync(inspected.target, constants.O_RDONLY | noFollow);
  } catch (error) {
    if (isNotFoundError(error)) return null;
    throw error;
  }

  try {
    const info = fstatSync(descriptor);
    if (!info.isFile() || !isSameFile(inspected.info, info)) {
      throw new TypeError("Built-in skill file changed during validation");
    }
    if (!Number.isSafeInteger(info.size) || info.size < 0) {
      throw new TypeError("Built-in skill file has an invalid size");
    }
    if (info.size > SKILL_TEXT_FILE_MAX_BYTES) {
      throw new RangeError(
        `Built-in skill file exceeds ${SKILL_TEXT_FILE_MAX_BYTES} bytes`,
      );
    }

    const bytes = new Uint8Array(SKILL_TEXT_FILE_MAX_BYTES + 1);
    let byteLength = 0;
    while (byteLength < bytes.byteLength) {
      const count = readSync(
        descriptor,
        bytes,
        byteLength,
        bytes.byteLength - byteLength,
        null,
      );
      if (count === 0) break;
      byteLength += count;
    }
    if (byteLength > SKILL_TEXT_FILE_MAX_BYTES) {
      throw new RangeError(
        `Built-in skill file exceeds ${SKILL_TEXT_FILE_MAX_BYTES} bytes`,
      );
    }
    try {
      return UTF8_DECODER.decode(bytes.subarray(0, byteLength));
    } catch (error) {
      throw new TypeError(
        "Built-in skill file must contain valid UTF-8",
        { cause: error },
      );
    }
  } finally {
    closeSync(descriptor);
  }
}

function isSafeSkillId(skillId: unknown): skillId is string {
  return isValidStrictSkillName(skillId);
}

function isSafePathSegment(segment: string): boolean {
  return segment.length > 0 &&
    segment.length <= SKILL_PATH_SEGMENT_MAX_LENGTH &&
    segment !== "." &&
    segment !== ".." &&
    !segment.includes("/") &&
    !segment.includes("\\") &&
    isWellFormedUtf16(segment) &&
    !hasControlCharacters(segment);
}

function normalizeBuiltinReferencePath(file: unknown): string | null {
  if (
    typeof file !== "string" ||
    file.length === 0 ||
    file.length > SKILL_RELATIVE_PATH_MAX_LENGTH
  ) {
    return null;
  }

  const normalized = normalizeStrictRuntimeSkillReferencePath(file);
  if (
    !normalized ||
    normalized.length > SKILL_RELATIVE_PATH_MAX_LENGTH
  ) {
    return null;
  }

  const segments = normalized.split("/");
  if (
    !BUILTIN_SKILL_READABLE_DIR_SET.has(segments[0]!) ||
    segments.length < 2 ||
    !segments.every(isSafePathSegment)
  ) {
    return null;
  }
  return normalized;
}

function resolveSkillPath(
  skillsDir: string,
  skillId: unknown,
  kind: "directory" | "flat",
): string | null {
  if (!isSafeSkillId(skillId)) return null;
  const root = requireBoundedRootPath(skillsDir);
  const target = kind === "directory"
    ? resolve(root, skillId, "SKILL.md")
    : resolve(root, `${skillId}.md`);
  return isPathInside(root, target) ? target : null;
}

function hasRuntimeBuiltinSkillFiles(path: string): boolean {
  const root = requireSafeRoot(path);
  if (!root) return false;
  return inspectPathWithinRoot(root, resolve(root, "build.md"), "file") !== null ||
    inspectPathWithinRoot(root, resolve(root, "veryfront", "SKILL.md"), "file") !== null;
}

/** Resolves runtime builtin skills dir. */
export function resolveRuntimeBuiltinSkillsDir(baseDir: string): string {
  const boundedBaseDir = requireBoundedRootPath(baseDir);
  const firstCandidate = resolve(boundedBaseDir, "skills");
  const candidates = [
    firstCandidate,
    resolve(boundedBaseDir, "../skills"),
    resolve(boundedBaseDir, "../../skills"),
    resolve(boundedBaseDir, "../../../skills"),
  ];

  return candidates.find((candidate) => hasRuntimeBuiltinSkillFiles(candidate)) ?? firstCandidate;
}

/** Read runtime builtin skill entries helper. */
export function readRuntimeBuiltinSkillEntries(
  skillsDir: string,
): RuntimeBuiltinSkillEntriesResult {
  try {
    const root = requireSafeRoot(skillsDir);
    if (!root) {
      return { ok: true, entries: [] };
    }

    const entries: Dirent[] = [];
    const directory = opendirSync(root);
    try {
      let entry: Dirent | null;
      while ((entry = directory.readSync()) !== null) {
        if (entries.length === SKILL_SUBDIR_MAX_ENTRIES) {
          throw new RangeError(
            `Built-in skills directory may contain at most ${SKILL_SUBDIR_MAX_ENTRIES} entries`,
          );
        }
        if (entry.isSymbolicLink()) {
          throw new TypeError(
            `Built-in skills directory must not contain symlinks: "${entry.name}"`,
          );
        }
        entries.push(entry);
      }
    } finally {
      directory.closeSync();
    }

    entries.sort((left, right) => left.name < right.name ? -1 : left.name > right.name ? 1 : 0);
    return { ok: true, entries };
  } catch (error) {
    return {
      ok: false,
      errorMessage: error instanceof Error ? error.message : String(error),
    };
  }
}

/** Resolves runtime builtin skill reference file path. */
export function resolveRuntimeBuiltinSkillReferenceFilePath(
  skillsDir: string,
  skillId: string,
  file: string,
): string | null {
  if (!isSafeSkillId(skillId)) return null;
  const normalizedFile = normalizeBuiltinReferencePath(file);
  if (!normalizedFile) return null;

  const root = requireBoundedRootPath(skillsDir);
  const skillDir = resolve(root, skillId);
  const filePath = resolve(skillDir, ...normalizedFile.split("/"));
  if (!isPathInside(root, skillDir) || !isPathInside(skillDir, filePath)) {
    return null;
  }

  // Existing segments are inspected so symlinked roots/directories/files are
  // rejected and missing references retain the public null contract.
  return inspectPathWithinRoot(root, filePath, "file") ? filePath : null;
}

/** Read runtime builtin skill reference file helper. */
export function readRuntimeBuiltinSkillReferenceFile(
  skillsDir: string,
  skillId: string,
  file: string,
): string | null {
  const filePath = resolveRuntimeBuiltinSkillReferenceFilePath(skillsDir, skillId, file);
  if (!filePath) return null;
  return readBoundedTextFile(skillsDir, filePath);
}

/** Read runtime builtin directory skill helper. */
export function readRuntimeBuiltinDirectorySkill(
  skillsDir: string,
  skillId: string,
): string | null {
  const path = resolveSkillPath(skillsDir, skillId, "directory");
  return path ? readBoundedTextFile(skillsDir, path) : null;
}

/** Read runtime builtin flat skill helper. */
export function readRuntimeBuiltinFlatSkill(skillsDir: string, skillId: string): string | null {
  const path = resolveSkillPath(skillsDir, skillId, "flat");
  return path ? readBoundedTextFile(skillsDir, path) : null;
}

/** Read runtime builtin skill helper. */
export function readRuntimeBuiltinSkill(skillsDir: string, skillId: string): string | null {
  return readRuntimeBuiltinDirectorySkill(skillsDir, skillId) ??
    readRuntimeBuiltinFlatSkill(skillsDir, skillId);
}

function listRuntimeBuiltinSkillReadableDirectoryFiles(
  skillsDir: string,
  skillId: string,
  readableDirectory: (typeof SKILL_READABLE_DIRS)[number],
): string[] {
  if (!isSafeSkillId(skillId)) return [];
  const root = requireBoundedRootPath(skillsDir);
  const readableDir = resolve(root, skillId, readableDirectory);
  const inspected = inspectPathWithinRoot(root, readableDir, "directory");
  if (!inspected) return [];

  const files: string[] = [];
  const pendingDirectories: Array<{ absolutePath: string; relativePath: string }> = [{
    absolutePath: inspected.target,
    relativePath: readableDirectory,
  }];
  let entryCount = 0;

  while (pendingDirectories.length > 0) {
    const current = pendingDirectories.pop()!;
    const directory = opendirSync(current.absolutePath);
    try {
      let entry: Dirent | null;
      while ((entry = directory.readSync()) !== null) {
        entryCount += 1;
        if (entryCount > SKILL_SUBDIR_MAX_ENTRIES) {
          throw new RangeError(
            `Built-in skill ${readableDirectory}/ may contain at most ${SKILL_SUBDIR_MAX_ENTRIES} entries`,
          );
        }
        if (!isSafePathSegment(entry.name)) {
          throw new TypeError(`Invalid built-in skill readable-file name: "${entry.name}"`);
        }
        if (entry.isSymbolicLink()) {
          throw new TypeError(
            `Built-in skill readable directories must not contain symlinks: "${entry.name}"`,
          );
        }

        const absolutePath = resolve(current.absolutePath, entry.name);
        const relativePath = `${current.relativePath}/${entry.name}`;
        if (normalizeBuiltinReferencePath(relativePath) !== relativePath) {
          throw new TypeError(`Invalid built-in skill readable-file path: "${relativePath}"`);
        }

        if (entry.isDirectory()) {
          const childDirectory = inspectPathWithinRoot(root, absolutePath, "directory");
          if (!childDirectory) {
            continue;
          }
          pendingDirectories.push({
            absolutePath: childDirectory.target,
            relativePath,
          });
        } else if (entry.isFile()) {
          if (inspectPathWithinRoot(root, absolutePath, "file")) {
            files.push(relativePath);
          }
        }
      }
    } finally {
      directory.closeSync();
    }
  }

  return files.sort((left, right) => left < right ? -1 : left > right ? 1 : 0);
}

/** List immediate files in the legacy references/ directory. */
export function listRuntimeBuiltinSkillReferenceFiles(
  skillsDir: string,
  skillId: string,
): string[] {
  const prefix = `${SKILL_REFERENCES_DIR}/`;
  return listRuntimeBuiltinSkillReadableDirectoryFiles(
    skillsDir,
    skillId,
    SKILL_REFERENCES_DIR,
  ).flatMap((path) => {
    const relativePath = path.slice(prefix.length);
    return relativePath.includes("/") ? [] : [relativePath];
  });
}

/** List runtime builtin skill references. */
export function listRuntimeBuiltinSkillReferences(skillsDir: string, skillId: string): string[] {
  const references = SKILL_READABLE_DIRS.flatMap((directory) =>
    listRuntimeBuiltinSkillReadableDirectoryFiles(skillsDir, skillId, directory)
  );
  if (references.length > SKILL_LOADABLE_REFERENCE_MAX_ENTRIES) {
    throw new RangeError(
      `Built-in skill may advertise at most ${SKILL_LOADABLE_REFERENCE_MAX_ENTRIES} readable files`,
    );
  }
  return references.sort((left, right) => left < right ? -1 : left > right ? 1 : 0);
}

/** Strict bounded runtime read of a built-in skill document. */
export async function readRuntimeBuiltinSkillWithinLimit(
  skillsDir: string,
  skillId: string,
  budget: SkillOperationBudget,
): Promise<string | null> {
  const directoryPath = resolveSkillPath(skillsDir, skillId, "directory");
  if (!directoryPath) return null;
  const directory = await readBuiltinFileWithinLimit(skillsDir, directoryPath, budget);
  if (directory !== null) return directory;
  const flatPath = resolveSkillPath(skillsDir, skillId, "flat");
  return flatPath ? await readBuiltinFileWithinLimit(skillsDir, flatPath, budget) : null;
}

/** Strict bounded runtime read of one advertised built-in reference. */
export async function readRuntimeBuiltinSkillReferenceWithinLimit(
  skillsDir: string,
  skillId: string,
  file: string,
  budget: SkillOperationBudget,
): Promise<string | null> {
  const path = resolveRuntimeBuiltinSkillReferenceFilePath(skillsDir, skillId, file);
  return path ? await readBuiltinFileWithinLimit(skillsDir, path, budget) : null;
}

/** Strict capped and deterministic built-in reference listing. */
export async function listRuntimeBuiltinSkillReferencesWithinLimit(
  skillsDir: string,
  skillId: string,
  budget: SkillOperationBudget,
): Promise<string[]> {
  if (!isSafeSkillId(skillId)) return [];
  const root = requireBoundedRootPath(skillsDir);
  const skillDir = resolve(root, skillId);
  if (!isPathInside(root, skillDir)) return [];

  return await budget.run(async () => {
    const references: string[] = [];
    const pending = SKILL_READABLE_DIRS.map((directory) => ({
      absolutePath: resolve(skillDir, directory),
      relativePath: directory as string,
      readableDirectory: directory,
    }));
    const entryCountByReadableDirectory = new Map<
      (typeof SKILL_READABLE_DIRS)[number],
      number
    >(
      SKILL_READABLE_DIRS.map((directory) => [directory, 0] as const),
    );

    while (pending.length > 0) {
      const current = pending.pop()!;
      try {
        for await (const entry of builtinFileSystem.readDir(current.absolutePath)) {
          const entryCount = entryCountByReadableDirectory.get(current.readableDirectory)! + 1;
          entryCountByReadableDirectory.set(current.readableDirectory, entryCount);
          if (entryCount > SKILL_SUBDIR_MAX_ENTRIES) {
            throw new RangeError(
              `Built-in skill ${current.readableDirectory}/ may contain at most ${SKILL_SUBDIR_MAX_ENTRIES} entries`,
            );
          }
          if (!isSafePathSegment(entry.name)) {
            throw new TypeError(`Invalid built-in skill readable-file name: "${entry.name}"`);
          }
          if (entry.isSymlink) {
            throw new TypeError(
              `Built-in skill readable directories must not contain symlinks: "${entry.name}"`,
            );
          }

          const absolutePath = resolve(current.absolutePath, entry.name);
          const relativePath = `${current.relativePath}/${entry.name}`;
          if (
            !isPathInside(skillDir, absolutePath) ||
            normalizeBuiltinReferencePath(relativePath) !== relativePath
          ) {
            throw new TypeError(`Invalid built-in skill readable-file path: "${relativePath}"`);
          }
          if (entry.isDirectory) {
            pending.push({
              absolutePath,
              relativePath,
              readableDirectory: current.readableDirectory,
            });
          } else if (entry.isFile) {
            references.push(relativePath);
            if (references.length > SKILL_LOADABLE_REFERENCE_MAX_ENTRIES) {
              throw new RangeError(
                `Built-in skill may advertise at most ${SKILL_LOADABLE_REFERENCE_MAX_ENTRIES} readable files`,
              );
            }
          }
        }
      } catch (error) {
        if (isPlatformNotFoundError(error)) continue;
        throw error;
      }
    }
    return references.sort((left, right) => left < right ? -1 : left > right ? 1 : 0);
  });
}
