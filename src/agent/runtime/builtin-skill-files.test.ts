import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertThrows } from "@std/assert";
import { resolve } from "node:path";
import {
  listRuntimeBuiltinSkillReferenceFiles,
  listRuntimeBuiltinSkillReferences,
  readRuntimeBuiltinFlatSkill,
  readRuntimeBuiltinSkill,
  readRuntimeBuiltinSkillEntries,
  readRuntimeBuiltinSkillReferenceFile,
  resolveRuntimeBuiltinSkillReferenceFilePath,
  resolveRuntimeBuiltinSkillsDir,
} from "./builtin-skill-files.ts";
import { SKILL_SUBDIR_MAX_ENTRIES, SKILL_TEXT_FILE_MAX_BYTES } from "#veryfront/skill/limits.ts";

function withTempDir(fn: (dir: string) => void): void {
  const dir = Deno.makeTempDirSync();
  try {
    fn(dir);
  } finally {
    Deno.removeSync(dir, { recursive: true });
  }
}

Deno.test("resolveRuntimeBuiltinSkillsDir resolves repo-root skills from dist-like paths", () => {
  withTempDir((rootDir) => {
    const baseDir = resolve(rootDir, "dist", "src", "skills");
    const skillsDir = resolve(rootDir, "skills");
    Deno.mkdirSync(resolve(skillsDir, "veryfront"), { recursive: true });
    Deno.writeTextFileSync(resolve(skillsDir, "veryfront", "SKILL.md"), "body");

    assertEquals(resolveRuntimeBuiltinSkillsDir(baseDir), skillsDir);
  });
});

Deno.test("resolveRuntimeBuiltinSkillsDir resolves root-level skills from cwd base dir", () => {
  withTempDir((rootDir) => {
    const skillsDir = resolve(rootDir, "skills");
    Deno.mkdirSync(resolve(skillsDir, "veryfront"), { recursive: true });
    Deno.writeTextFileSync(resolve(skillsDir, "veryfront", "SKILL.md"), "body");

    assertEquals(resolveRuntimeBuiltinSkillsDir(rootDir), skillsDir);
  });
});

Deno.test("resolveRuntimeBuiltinSkillsDir falls back to the first candidate", () => {
  withTempDir((rootDir) => {
    const baseDir = resolve(rootDir, "app", "src", "skills");

    assertEquals(resolveRuntimeBuiltinSkillsDir(baseDir), resolve(baseDir, "skills"));
  });
});

Deno.test("readRuntimeBuiltinSkillEntries reports entries and read errors", () => {
  withTempDir((rootDir) => {
    Deno.writeTextFileSync(resolve(rootDir, "build.md"), "body");

    const result = readRuntimeBuiltinSkillEntries(rootDir);
    assertEquals(result.ok, true);
    if (result.ok) {
      assertEquals(result.entries.map((entry) => entry.name), ["build.md"]);
    }

    const missing = readRuntimeBuiltinSkillEntries(resolve(rootDir, "missing"));
    assertEquals(missing.ok, false);
  });
});

Deno.test("readRuntimeBuiltinSkill prefers directory skills over flat skills", () => {
  withTempDir((rootDir) => {
    Deno.mkdirSync(resolve(rootDir, "writer"), { recursive: true });
    Deno.writeTextFileSync(resolve(rootDir, "writer", "SKILL.md"), "directory skill");
    Deno.writeTextFileSync(resolve(rootDir, "writer.md"), "flat skill");

    assertEquals(readRuntimeBuiltinSkill(rootDir, "writer"), "directory skill");
    assertEquals(readRuntimeBuiltinFlatSkill(rootDir, "writer"), "flat skill");
  });
});

Deno.test("runtime builtin skill reference helpers reject traversal and read valid files", () => {
  withTempDir((rootDir) => {
    const refsDir = resolve(rootDir, "writer", "references");
    Deno.mkdirSync(refsDir, { recursive: true });
    Deno.writeTextFileSync(resolve(refsDir, "guide.md"), "guide");
    Deno.writeTextFileSync(resolve(refsDir, "notes.md"), "notes");
    Deno.mkdirSync(resolve(refsDir, "nested"));

    assertEquals(
      resolveRuntimeBuiltinSkillReferenceFilePath(rootDir, "writer", "references/guide.md"),
      resolve(refsDir, "guide.md"),
    );
    assertEquals(
      resolveRuntimeBuiltinSkillReferenceFilePath(rootDir, "writer", "../escape.md"),
      null,
    );
    assertEquals(
      readRuntimeBuiltinSkillReferenceFile(rootDir, "writer", "references/guide.md"),
      "guide",
    );
    assertEquals(
      readRuntimeBuiltinSkillReferenceFile(rootDir, "writer", "references/missing.md"),
      null,
    );
    assertEquals(listRuntimeBuiltinSkillReferenceFiles(rootDir, "writer"), [
      "guide.md",
      "notes.md",
    ]);
    assertEquals(listRuntimeBuiltinSkillReferences(rootDir, "writer"), [
      "references/guide.md",
      "references/notes.md",
    ]);
  });
});

Deno.test("runtime builtin compatibility readers fail before unbounded materialization", () => {
  withTempDir((rootDir) => {
    Deno.writeTextFileSync(
      resolve(rootDir, "oversized.md"),
      "x".repeat(SKILL_TEXT_FILE_MAX_BYTES + 1),
    );
    assertThrows(
      () => readRuntimeBuiltinFlatSkill(rootDir, "oversized"),
      RangeError,
      "may contain at most",
    );

    const refsDir = resolve(rootDir, "many", "references");
    Deno.mkdirSync(refsDir, { recursive: true });
    for (let index = 0; index <= SKILL_SUBDIR_MAX_ENTRIES; index += 1) {
      Deno.writeTextFileSync(resolve(refsDir, `${index}.md`), "");
    }
    assertThrows(
      () => listRuntimeBuiltinSkillReferenceFiles(rootDir, "many"),
      RangeError,
      "may contain at most",
    );
  });
});
