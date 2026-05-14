import { type Dirent, existsSync, readdirSync, readFileSync } from "node:fs";
import { isAbsolute, relative, resolve } from "node:path";
import { normalizeRuntimeSkillReferencePath } from "./skill-metadata.ts";

export type RuntimeBuiltinSkillEntriesResult = { ok: true; entries: Dirent[] } | {
  ok: false;
  errorMessage: string;
};

function hasRuntimeBuiltinSkillFiles(path: string): boolean {
  return existsSync(resolve(path, "build.md")) ||
    existsSync(resolve(path, "veryfront", "SKILL.md"));
}

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

export function readRuntimeBuiltinSkillEntries(
  skillsDir: string,
): RuntimeBuiltinSkillEntriesResult {
  try {
    return {
      ok: true,
      entries: readdirSync(skillsDir, { withFileTypes: true }),
    };
  } catch (error) {
    return {
      ok: false,
      errorMessage: error instanceof Error ? error.message : String(error),
    };
  }
}

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

export function readRuntimeBuiltinSkillReferenceFile(
  skillsDir: string,
  skillId: string,
  file: string,
): string | null {
  const filePath = resolveRuntimeBuiltinSkillReferenceFilePath(skillsDir, skillId, file);
  if (!filePath || !existsSync(filePath)) {
    return null;
  }

  return readFileSync(filePath, "utf-8");
}

export function readRuntimeBuiltinDirectorySkill(
  skillsDir: string,
  skillId: string,
): string | null {
  const directorySkillPath = resolve(skillsDir, skillId, "SKILL.md");
  if (!existsSync(directorySkillPath)) {
    return null;
  }

  return readFileSync(directorySkillPath, "utf-8");
}

export function readRuntimeBuiltinFlatSkill(skillsDir: string, skillId: string): string | null {
  const flatSkillPath = resolve(skillsDir, `${skillId}.md`);
  if (!existsSync(flatSkillPath)) {
    return null;
  }

  return readFileSync(flatSkillPath, "utf-8");
}

export function readRuntimeBuiltinSkill(skillsDir: string, skillId: string): string | null {
  return readRuntimeBuiltinDirectorySkill(skillsDir, skillId) ??
    readRuntimeBuiltinFlatSkill(skillsDir, skillId);
}

export function listRuntimeBuiltinSkillReferenceFiles(
  skillsDir: string,
  skillId: string,
): string[] {
  const refsDir = resolve(skillsDir, skillId, "references");
  if (!existsSync(refsDir)) {
    return [];
  }

  return readdirSync(refsDir, { withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name)
    .sort();
}

export function listRuntimeBuiltinSkillReferences(skillsDir: string, skillId: string): string[] {
  return listRuntimeBuiltinSkillReferenceFiles(skillsDir, skillId).map((file) =>
    `references/${file}`
  );
}
