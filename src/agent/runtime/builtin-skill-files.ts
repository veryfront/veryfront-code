import { closeSync, type Dirent, existsSync, opendirSync, openSync, readSync } from "node:fs";
import { isAbsolute, relative, resolve } from "node:path";
import { normalizeRuntimeSkillReferencePath } from "./skill-metadata.ts";
import { createFileSystem, isNotFoundError } from "#veryfront/platform/compat/fs.ts";
import type { SkillOperationBudget } from "#veryfront/skill/operation-budget.ts";
import { SKILL_SUBDIR_MAX_ENTRIES, SKILL_TEXT_FILE_MAX_BYTES } from "#veryfront/skill/limits.ts";

const utf8Decoder = new TextDecoder("utf-8", { fatal: true });
const builtinFileSystem = createFileSystem();

function readDirectoryEntriesWithinLimit(path: string): Dirent[] {
  const directory = opendirSync(path);
  const entries: Dirent[] = [];
  try {
    while (true) {
      const entry = directory.readSync();
      if (entry === null) return entries;
      if (entries.length >= SKILL_SUBDIR_MAX_ENTRIES) {
        throw new RangeError(
          `Runtime skill directory may contain at most ${SKILL_SUBDIR_MAX_ENTRIES} entries`,
        );
      }
      entries.push(entry);
    }
  } finally {
    directory.closeSync();
  }
}

function isMissingNodePath(error: unknown): boolean {
  return error instanceof Error && (error as NodeJS.ErrnoException).code === "ENOENT";
}

function readBuiltinFileSyncWithinLimit(path: string): string | null {
  let descriptor: number;
  try {
    descriptor = openSync(path, "r");
  } catch (error) {
    if (isMissingNodePath(error)) return null;
    throw error;
  }
  try {
    const bytes = new Uint8Array(SKILL_TEXT_FILE_MAX_BYTES + 1);
    let offset = 0;
    while (offset < bytes.byteLength) {
      const count = readSync(descriptor, bytes, offset, bytes.byteLength - offset, null);
      if (count === 0) return utf8Decoder.decode(bytes.subarray(0, offset));
      offset += count;
    }
    throw new RangeError(
      `Runtime skill file may contain at most ${SKILL_TEXT_FILE_MAX_BYTES} bytes`,
    );
  } finally {
    closeSync(descriptor);
  }
}

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
      return utf8Decoder.decode(
        await reader.call(builtinFileSystem, path, root, SKILL_TEXT_FILE_MAX_BYTES),
      );
    });
  } catch (error) {
    if (isNotFoundError(error)) return null;
    throw error;
  }
}

/** Result returned from runtime builtin skill entries. */
export type RuntimeBuiltinSkillEntriesResult = { ok: true; entries: Dirent[] } | {
  ok: false;
  errorMessage: string;
};

function hasRuntimeBuiltinSkillFiles(path: string): boolean {
  return existsSync(resolve(path, "build.md")) ||
    existsSync(resolve(path, "veryfront", "SKILL.md"));
}

/** Resolves runtime builtin skills dir. */
export function resolveRuntimeBuiltinSkillsDir(baseDir: string): string {
  const firstCandidate = resolve(baseDir, "skills");
  const candidates = [
    firstCandidate,
    resolve(baseDir, "../skills"),
    resolve(baseDir, "../../skills"),
    resolve(baseDir, "../../../skills"),
  ];

  return candidates.find((candidate) => hasRuntimeBuiltinSkillFiles(candidate)) ?? firstCandidate;
}

/** Read runtime builtin skill entries helper. */
export function readRuntimeBuiltinSkillEntries(
  skillsDir: string,
): RuntimeBuiltinSkillEntriesResult {
  try {
    return {
      ok: true,
      entries: readDirectoryEntriesWithinLimit(skillsDir),
    };
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
  const normalizedFile = normalizeRuntimeSkillReferencePath(file);
  if (!normalizedFile) {
    return null;
  }

  const skillDir = resolve(skillsDir, skillId);
  const filePath = resolve(skillDir, normalizedFile);
  const relativePath = relative(skillDir, filePath);

  if (relativePath.length === 0 || isAbsolute(relativePath) || relativePath.startsWith("..")) {
    return null;
  }

  return filePath;
}

/** Read runtime builtin skill reference file helper. */
export function readRuntimeBuiltinSkillReferenceFile(
  skillsDir: string,
  skillId: string,
  file: string,
): string | null {
  const filePath = resolveRuntimeBuiltinSkillReferenceFilePath(skillsDir, skillId, file);
  return filePath ? readBuiltinFileSyncWithinLimit(filePath) : null;
}

/** Read runtime builtin directory skill helper. */
export function readRuntimeBuiltinDirectorySkill(
  skillsDir: string,
  skillId: string,
): string | null {
  const directorySkillPath = resolve(skillsDir, skillId, "SKILL.md");
  return readBuiltinFileSyncWithinLimit(directorySkillPath);
}

/** Read runtime builtin flat skill helper. */
export function readRuntimeBuiltinFlatSkill(skillsDir: string, skillId: string): string | null {
  const flatSkillPath = resolve(skillsDir, `${skillId}.md`);
  return readBuiltinFileSyncWithinLimit(flatSkillPath);
}

/** Read runtime builtin skill helper. */
export function readRuntimeBuiltinSkill(skillsDir: string, skillId: string): string | null {
  return readRuntimeBuiltinDirectorySkill(skillsDir, skillId) ??
    readRuntimeBuiltinFlatSkill(skillsDir, skillId);
}

/** List runtime builtin skill reference files. */
export function listRuntimeBuiltinSkillReferenceFiles(
  skillsDir: string,
  skillId: string,
): string[] {
  const refsDir = resolve(skillsDir, skillId, "references");
  if (!existsSync(refsDir)) {
    return [];
  }

  return readDirectoryEntriesWithinLimit(refsDir)
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name)
    .sort();
}

/** List runtime builtin skill references. */
export function listRuntimeBuiltinSkillReferences(skillsDir: string, skillId: string): string[] {
  return listRuntimeBuiltinSkillReferenceFiles(skillsDir, skillId).map((file) =>
    `references/${file}`
  );
}

/** Strict bounded runtime read of a built-in skill document. */
export async function readRuntimeBuiltinSkillWithinLimit(
  skillsDir: string,
  skillId: string,
  budget: SkillOperationBudget,
): Promise<string | null> {
  const directoryPath = resolve(skillsDir, skillId, "SKILL.md");
  const directory = await readBuiltinFileWithinLimit(skillsDir, directoryPath, budget);
  if (directory !== null) return directory;
  return await readBuiltinFileWithinLimit(
    skillsDir,
    resolve(skillsDir, `${skillId}.md`),
    budget,
  );
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
  const refsDir = resolve(skillsDir, skillId, "references");
  try {
    return await budget.run(async () => {
      const references: string[] = [];
      let entries = 0;
      for await (const entry of builtinFileSystem.readDir(refsDir)) {
        entries += 1;
        if (entries > SKILL_SUBDIR_MAX_ENTRIES) {
          throw new RangeError(
            `Skill references may contain at most ${SKILL_SUBDIR_MAX_ENTRIES} entries`,
          );
        }
        if (entry.isSymlink) {
          throw new Error(`Skill reference entry must not be a symlink: ${entry.name}`);
        }
        if (entry.isFile) references.push(`references/${entry.name}`);
      }
      return references.sort();
    });
  } catch (error) {
    if (isNotFoundError(error)) return [];
    throw error;
  }
}
