import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertRejects, assertStringIncludes, assertThrows } from "@std/assert";
import { resolve } from "node:path";
import {
  SKILL_LOADABLE_REFERENCE_MAX_ENTRIES,
  SKILL_RELATIVE_PATH_MAX_LENGTH,
  SKILL_SUBDIR_MAX_ENTRIES,
  SKILL_TEXT_FILE_MAX_BYTES,
} from "#veryfront/skill/limits.ts";
import { createSkillOperationBudget } from "#veryfront/skill/operation-budget.ts";
import { SKILL_STRICT_NAME_REGEX } from "#veryfront/skill/types.ts";
import {
  listRuntimeBuiltinSkillReferenceFiles,
  listRuntimeBuiltinSkillReferences,
  listRuntimeBuiltinSkillReferencesWithinLimit,
  readRuntimeBuiltinDirectorySkill,
  readRuntimeBuiltinFlatSkill,
  readRuntimeBuiltinSkill,
  readRuntimeBuiltinSkillEntries,
  readRuntimeBuiltinSkillReferenceFile,
  resolveRuntimeBuiltinSkillReferenceFilePath,
  resolveRuntimeBuiltinSkillsDir,
} from "./builtin-skill-files.ts";

function withTempDir(fn: (dir: string) => void): void {
  const dir = Deno.makeTempDirSync();
  try {
    fn(dir);
  } finally {
    Deno.removeSync(dir, { recursive: true });
  }
}

async function withTempDirAsync(fn: (dir: string) => Promise<void>): Promise<void> {
  const dir = Deno.makeTempDirSync();
  try {
    await fn(dir);
  } finally {
    Deno.removeSync(dir, { recursive: true });
  }
}

function assertDoesNotExposePath(error: Error, rootDir: string): void {
  assertEquals(error.message.includes(rootDir), false);
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

Deno.test("readRuntimeBuiltinSkillEntries sorts entries and distinguishes missing roots", () => {
  withTempDir((rootDir) => {
    Deno.writeTextFileSync(resolve(rootDir, "build.md"), "body");
    Deno.writeTextFileSync(resolve(rootDir, "zeta.md"), "body");
    Deno.writeTextFileSync(resolve(rootDir, "alpha.md"), "body");

    const result = readRuntimeBuiltinSkillEntries(rootDir);
    assertEquals(result.ok, true);
    if (result.ok) {
      assertEquals(result.entries.map((entry) => entry.name), [
        "alpha.md",
        "build.md",
        "zeta.md",
      ]);
    }

    const missing = readRuntimeBuiltinSkillEntries(resolve(rootDir, "missing"));
    assertEquals(missing, { ok: true, entries: [] });

    const notDirectory = resolve(rootDir, "not-a-directory");
    Deno.writeTextFileSync(notDirectory, "body");
    const invalid = readRuntimeBuiltinSkillEntries(notDirectory);
    assertEquals(invalid.ok, false);
    if (!invalid.ok) {
      assertStringIncludes(invalid.errorMessage, "must be a directory");
      assertEquals(invalid.errorMessage.includes(rootDir), false);
    }
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

Deno.test("runtime built-in skill admission ignores mutation of the public name matcher", () => {
  withTempDir((rootDir) => {
    const invalidId = "invalid_name";
    Deno.mkdirSync(resolve(rootDir, invalidId), { recursive: true });
    Deno.writeTextFileSync(resolve(rootDir, invalidId, "SKILL.md"), "must not load");
    const originalTest = SKILL_STRICT_NAME_REGEX.test;
    try {
      SKILL_STRICT_NAME_REGEX.test = () => true;
      assertEquals(readRuntimeBuiltinSkill(rootDir, invalidId), null);
    } finally {
      SKILL_STRICT_NAME_REGEX.test = originalTest;
    }
  });
});

Deno.test("runtime builtin skill reference helpers reject traversal and read valid files", () => {
  withTempDir((rootDir) => {
    const refsDir = resolve(rootDir, "writer", "references");
    const resourcesDir = resolve(rootDir, "writer", "resources");
    const assetsDir = resolve(rootDir, "writer", "assets");
    Deno.mkdirSync(resolve(refsDir, "nested"), { recursive: true });
    Deno.mkdirSync(resolve(resourcesDir, "schemas"), { recursive: true });
    Deno.mkdirSync(assetsDir, { recursive: true });
    Deno.writeTextFileSync(resolve(refsDir, "guide.md"), "guide");
    Deno.writeTextFileSync(resolve(refsDir, "notes.md"), "notes");
    Deno.writeTextFileSync(resolve(refsDir, "nested", "details.md"), "details");
    Deno.writeTextFileSync(resolve(resourcesDir, "schemas", "input.json"), "schema");
    Deno.writeTextFileSync(resolve(assetsDir, "template.txt"), "template");
    Deno.writeTextFileSync(resolve(assetsDir, "empty.txt"), "");

    assertEquals(
      resolveRuntimeBuiltinSkillReferenceFilePath(rootDir, "writer", "references/guide.md"),
      resolve(refsDir, "guide.md"),
    );
    assertEquals(
      resolveRuntimeBuiltinSkillReferenceFilePath(rootDir, "writer", "../escape.md"),
      null,
    );
    assertEquals(
      resolveRuntimeBuiltinSkillReferenceFilePath(rootDir, "writer", "references/missing.md"),
      null,
    );
    assertEquals(
      readRuntimeBuiltinSkillReferenceFile(rootDir, "writer", "references/guide.md"),
      "guide",
    );
    assertEquals(
      readRuntimeBuiltinSkillReferenceFile(
        rootDir,
        "writer",
        "resources/schemas/input.json",
      ),
      "schema",
    );
    assertEquals(
      readRuntimeBuiltinSkillReferenceFile(rootDir, "writer", "assets/template.txt"),
      "template",
    );
    assertEquals(
      readRuntimeBuiltinSkillReferenceFile(rootDir, "writer", "assets/empty.txt"),
      "",
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
      "assets/empty.txt",
      "assets/template.txt",
      "references/guide.md",
      "references/nested/details.md",
      "references/notes.md",
      "resources/schemas/input.json",
    ]);
  });
});

Deno.test("runtime builtin skill helpers reject invalid and escaping identifiers", () => {
  withTempDir((rootDir) => {
    const skillsDir = resolve(rootDir, "skills");
    const outsideDir = resolve(rootDir, "outside");
    Deno.mkdirSync(outsideDir, { recursive: true });
    Deno.writeTextFileSync(resolve(outsideDir, "SKILL.md"), "outside directory skill");
    Deno.writeTextFileSync(resolve(rootDir, "outside.md"), "outside flat skill");

    const invalidIds = [
      "../outside",
      resolve(rootDir, "outside"),
      "UPPERCASE",
      "under_score",
      "a".repeat(65),
    ];
    for (const skillId of invalidIds) {
      assertEquals(readRuntimeBuiltinDirectorySkill(skillsDir, skillId), null);
      assertEquals(readRuntimeBuiltinFlatSkill(skillsDir, skillId), null);
      assertEquals(readRuntimeBuiltinSkill(skillsDir, skillId), null);
      assertEquals(listRuntimeBuiltinSkillReferenceFiles(skillsDir, skillId), []);
      assertEquals(
        resolveRuntimeBuiltinSkillReferenceFilePath(
          skillsDir,
          skillId,
          "references/guide.md",
        ),
        null,
      );
    }

    for (
      const reference of [
        "../outside.md",
        "references/../../outside.md",
        resolve(rootDir, "outside.md"),
        `references/${"x".repeat(SKILL_RELATIVE_PATH_MAX_LENGTH)}`,
      ]
    ) {
      assertEquals(
        resolveRuntimeBuiltinSkillReferenceFilePath(skillsDir, "writer", reference),
        null,
      );
      assertEquals(
        readRuntimeBuiltinSkillReferenceFile(skillsDir, "writer", reference),
        null,
      );
    }
  });
});

Deno.test("runtime builtin skill reads enforce the shared text-file budget", () => {
  withTempDir((rootDir) => {
    const largeContent = "x".repeat(SKILL_TEXT_FILE_MAX_BYTES + 1);
    Deno.mkdirSync(resolve(rootDir, "directory-skill", "references"), { recursive: true });
    Deno.writeTextFileSync(resolve(rootDir, "directory-skill", "SKILL.md"), largeContent);
    Deno.writeTextFileSync(resolve(rootDir, "flat-skill.md"), largeContent);
    Deno.writeTextFileSync(
      resolve(rootDir, "directory-skill", "references", "large.md"),
      largeContent,
    );

    const directoryError = assertThrows(
      () => readRuntimeBuiltinDirectorySkill(rootDir, "directory-skill"),
      RangeError,
      `exceeds ${SKILL_TEXT_FILE_MAX_BYTES} bytes`,
    );
    const flatError = assertThrows(
      () => readRuntimeBuiltinFlatSkill(rootDir, "flat-skill"),
      RangeError,
      `exceeds ${SKILL_TEXT_FILE_MAX_BYTES} bytes`,
    );
    const referenceError = assertThrows(
      () =>
        readRuntimeBuiltinSkillReferenceFile(
          rootDir,
          "directory-skill",
          "references/large.md",
        ),
      RangeError,
      `exceeds ${SKILL_TEXT_FILE_MAX_BYTES} bytes`,
    );
    for (const error of [directoryError, flatError, referenceError]) {
      assertDoesNotExposePath(error, rootDir);
    }
  });
});

Deno.test("runtime builtin skill reads reject malformed UTF-8", () => {
  withTempDir((rootDir) => {
    Deno.writeFileSync(resolve(rootDir, "writer.md"), new Uint8Array([0xc3, 0x28]));

    const error = assertThrows(
      () => readRuntimeBuiltinFlatSkill(rootDir, "writer"),
      TypeError,
      "must contain valid UTF-8",
    );
    assertDoesNotExposePath(error, rootDir);
  });
});

Deno.test("runtime builtin skill helpers reject symlinked roots, skills, and references", () => {
  if (Deno.build.os === "windows") return;

  withTempDir((rootDir) => {
    const realSkillsDir = resolve(rootDir, "real-skills");
    const linkedSkillsDir = resolve(rootDir, "linked-skills");
    const outsideDir = resolve(rootDir, "outside");
    Deno.mkdirSync(resolve(realSkillsDir, "writer", "references"), { recursive: true });
    Deno.mkdirSync(outsideDir, { recursive: true });
    Deno.writeTextFileSync(resolve(outsideDir, "SKILL.md"), "outside");
    Deno.writeTextFileSync(resolve(outsideDir, "secret.md"), "secret");
    Deno.symlinkSync(realSkillsDir, linkedSkillsDir);
    Deno.symlinkSync(outsideDir, resolve(realSkillsDir, "linked-skill"));
    Deno.symlinkSync(
      resolve(outsideDir, "SKILL.md"),
      resolve(realSkillsDir, "linked-flat.md"),
    );
    Deno.symlinkSync(
      resolve(outsideDir, "secret.md"),
      resolve(realSkillsDir, "writer", "references", "linked.md"),
    );
    Deno.mkdirSync(resolve(realSkillsDir, "linked-references"));
    Deno.symlinkSync(
      outsideDir,
      resolve(realSkillsDir, "linked-references", "references"),
    );

    const linkedRootEntries = readRuntimeBuiltinSkillEntries(linkedSkillsDir);
    assertEquals(linkedRootEntries.ok, false);
    if (!linkedRootEntries.ok) {
      assertEquals(linkedRootEntries.errorMessage.includes(rootDir), false);
    }
    const linkedRootError = assertThrows(
      () => readRuntimeBuiltinSkill(linkedSkillsDir, "writer"),
      TypeError,
      "must not be a symlink",
    );
    assertEquals(linkedRootError.message.includes(rootDir), false);

    assertThrows(
      () => readRuntimeBuiltinDirectorySkill(realSkillsDir, "linked-skill"),
      TypeError,
      "must not contain symlinks",
    );
    assertThrows(
      () => readRuntimeBuiltinFlatSkill(realSkillsDir, "linked-flat"),
      TypeError,
      "must not contain symlinks",
    );
    assertThrows(
      () =>
        resolveRuntimeBuiltinSkillReferenceFilePath(
          realSkillsDir,
          "writer",
          "references/linked.md",
        ),
      TypeError,
      "must not contain symlinks",
    );
    assertThrows(
      () => listRuntimeBuiltinSkillReferenceFiles(realSkillsDir, "writer"),
      TypeError,
      "must not contain symlinks",
    );
    assertThrows(
      () => listRuntimeBuiltinSkillReferenceFiles(realSkillsDir, "linked-references"),
      TypeError,
      "must not contain symlinks",
    );

    const rootEntries = readRuntimeBuiltinSkillEntries(realSkillsDir);
    assertEquals(rootEntries.ok, false);

    const resolverBaseDir = resolve(rootDir, "resolver-base");
    Deno.mkdirSync(resolve(resolverBaseDir, "skills"), { recursive: true });
    Deno.symlinkSync(
      resolve(outsideDir, "secret.md"),
      resolve(resolverBaseDir, "skills", "build.md"),
    );
    assertThrows(
      () => resolveRuntimeBuiltinSkillsDir(resolverBaseDir),
      TypeError,
      "must not contain symlinks",
    );
  });
});

Deno.test("runtime builtin skill directory enumeration is capped", () => {
  withTempDir((rootDir) => {
    const skillsDir = resolve(rootDir, "skills");
    Deno.mkdirSync(skillsDir, { recursive: true });
    for (let index = 0; index <= SKILL_SUBDIR_MAX_ENTRIES; index += 1) {
      Deno.writeTextFileSync(resolve(skillsDir, `skill-${index}.md`), "");
    }

    const entries = readRuntimeBuiltinSkillEntries(skillsDir);
    assertEquals(entries.ok, false);
    if (!entries.ok) {
      assertStringIncludes(
        entries.errorMessage,
        `at most ${SKILL_SUBDIR_MAX_ENTRIES} entries`,
      );
    }
  });
});

Deno.test("runtime builtin reference enumeration is capped", () => {
  withTempDir((rootDir) => {
    const refsDir = resolve(rootDir, "writer", "references");
    Deno.mkdirSync(refsDir, { recursive: true });
    for (let index = 0; index <= SKILL_SUBDIR_MAX_ENTRIES; index += 1) {
      Deno.writeTextFileSync(resolve(refsDir, `reference-${index}.md`), "");
    }

    assertThrows(
      () => listRuntimeBuiltinSkillReferenceFiles(rootDir, "writer"),
      RangeError,
      `at most ${SKILL_SUBDIR_MAX_ENTRIES} entries`,
    );
  });
});

Deno.test("bounded runtime builtin reference enumeration applies limits per readable directory", async () => {
  await withTempDirAsync(async (rootDir) => {
    const skillDir = resolve(rootDir, "writer");
    const filesPerDirectory = Math.floor(SKILL_SUBDIR_MAX_ENTRIES / 2) + 1;
    for (const directory of ["references", "resources"]) {
      const readableDir = resolve(skillDir, directory);
      Deno.mkdirSync(readableDir, { recursive: true });
      for (let index = 0; index < filesPerDirectory; index += 1) {
        Deno.writeTextFileSync(resolve(readableDir, `file-${index}.txt`), "");
      }
    }

    const catalogReferences = listRuntimeBuiltinSkillReferences(rootDir, "writer");
    assertEquals(catalogReferences.length, filesPerDirectory * 2);
    assertEquals(
      catalogReferences.length <= SKILL_LOADABLE_REFERENCE_MAX_ENTRIES,
      true,
    );
    assertEquals(
      await listRuntimeBuiltinSkillReferencesWithinLimit(
        rootDir,
        "writer",
        createSkillOperationBudget(),
      ),
      catalogReferences,
    );
  });
});

Deno.test("bounded runtime builtin reference enumeration retains each directory cap", async () => {
  await withTempDirAsync(async (rootDir) => {
    const refsDir = resolve(rootDir, "writer", "references");
    Deno.mkdirSync(refsDir, { recursive: true });
    for (let index = 0; index <= SKILL_SUBDIR_MAX_ENTRIES; index += 1) {
      Deno.writeTextFileSync(resolve(refsDir, `reference-${index}.md`), "");
    }

    await assertRejects(
      () =>
        listRuntimeBuiltinSkillReferencesWithinLimit(
          rootDir,
          "writer",
          createSkillOperationBudget(),
        ),
      RangeError,
      `references/ may contain at most ${SKILL_SUBDIR_MAX_ENTRIES} entries`,
    );
  });
});
