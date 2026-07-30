import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertRejects } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { join } from "#veryfront/compat/path";
import { FILE_NOT_FOUND } from "#veryfront/errors";
import {
  makeTempDir,
  mkdir,
  remove,
  symlink,
  writeTextFile,
} from "#veryfront/platform/compat/fs.ts";
import {
  listSkillSubdir,
  listStrictSkillSubdir,
  validateSkillPath,
  validateStrictSkillPath,
} from "./path-safety.ts";
import { createSkillTestAdapter } from "./testing.ts";
import { SKILL_ALLOWED_SUBDIR_MAX_ENTRIES, SKILL_SUBDIR_MAX_ENTRIES } from "./limits.ts";
import { createSkillOperationBudget } from "./operation-budget.ts";

async function settlesWithin(promise: Promise<unknown>, timeoutMs = 50): Promise<boolean> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise.then(
        () => true,
        () => true,
      ),
      new Promise<boolean>((resolve) => {
        timeoutId = setTimeout(() => resolve(false), timeoutMs);
      }),
    ]);
  } finally {
    if (timeoutId !== undefined) clearTimeout(timeoutId);
  }
}

describe("src/skill/path-safety", () => {
  describe("validateSkillPath", () => {
    it("should reject absolute paths", async () => {
      try {
        await validateSkillPath("/tmp/skill", "/etc/passwd", ["references"]);
        throw new Error("Should have thrown");
      } catch (e) {
        assertEquals((e as Error).message.includes("validation failed"), true);
      }
    });

    it("should reject parent traversal", async () => {
      try {
        await validateSkillPath("/tmp/skill", "references/../../../etc/passwd", ["references"]);
        throw new Error("Should have thrown");
      } catch (e) {
        assertEquals(e instanceof Error, true);
      }
    });

    it("should reject wrong subdir", async () => {
      try {
        await validateSkillPath("/tmp/skill", "assets/file.txt", ["scripts"]);
        throw new Error("Should have thrown");
      } catch (e) {
        assertEquals(e instanceof Error, true);
      }
    });

    it("allows root files while an empty allowlist still rejects subdirectories", async () => {
      const root = "/project/skills/test";
      const adapter = createSkillTestAdapter({
        [`${root}/SKILL.md`]: "# Test skill",
        [`${root}/references/guide.md`]: "Guide",
      });

      assertEquals(
        await validateSkillPath(root, "SKILL.md", [], adapter),
        `${root}/SKILL.md`,
      );
      assertEquals(
        await validateStrictSkillPath(root, "SKILL.md", [], adapter),
        `${root}/SKILL.md`,
      );
      await assertRejects(
        () => validateSkillPath(root, "references/guide.md", [], adapter),
        Error,
        "allowlist is empty",
      );
      await assertRejects(
        () => validateStrictSkillPath(root, "references/guide.md", [], adapter),
        Error,
        "allowlist is empty",
      );
    });

    it("requires an absolute root while preserving the public allowed-directory contract", async () => {
      await assertRejects(
        () => validateSkillPath("relative/skill", "references/guide.md", ["references"]),
        TypeError,
        "absolute",
      );
      const adapter = createSkillTestAdapter({
        "/project/skills/test/references/guide.md": "Guide",
      });
      const allowedSubdirs = [
        "references",
        ...Array.from(
          { length: SKILL_ALLOWED_SUBDIR_MAX_ENTRIES },
          (_unused, index) => `dir-${index}`,
        ),
      ];
      assertEquals(
        await validateSkillPath(
          "/project/skills/test",
          "references/guide.md",
          allowedSubdirs,
          adapter,
        ),
        "/project/skills/test/references/guide.md",
      );
      await assertRejects(
        () =>
          validateStrictSkillPath(
            "/project/skills/test",
            "references/guide.md",
            allowedSubdirs,
            adapter,
          ),
        RangeError,
        `${SKILL_ALLOWED_SUBDIR_MAX_ENTRIES}`,
      );
    });

    it("should validate existing files with fsAdapter", async () => {
      const adapter = createSkillTestAdapter({
        "/project/skills/test/references/guide.md": "Guide",
      });
      const validated = await validateSkillPath(
        "/project/skills/test",
        "references/guide.md",
        ["references"],
        adapter,
      );
      assertEquals(validated, "/project/skills/test/references/guide.md");
    });

    it("uses adapter lstat and realPath capabilities to reject escapes", async () => {
      const root = "/project/skills/test";
      const file = `${root}/references/guide.md`;
      const adapter = createSkillTestAdapter({ [file]: "Guide" });

      await assertRejects(
        () =>
          validateStrictSkillPath(root, "references/guide.md", ["references"], {
            ...adapter,
            async lstat(path) {
              const info = await adapter.stat(path);
              return {
                ...info,
                isSymlink: path === `${root}/references`,
              };
            },
          }),
        Error,
        "symlink",
      );

      await assertRejects(
        () =>
          validateSkillPath(root, "references/guide.md", ["references"], {
            ...adapter,
            async lstat(path) {
              return await adapter.stat(path);
            },
            async realPath(path) {
              return path === root ? root : `/outside/${path.split("/").at(-1)}`;
            },
          }),
        Error,
        "escapes root",
      );
    });

    it("caps fallback adapter enumeration used for symlink detection", async () => {
      const root = "/project/skills/test";
      const file = `${root}/references/guide.md`;
      const adapter = createSkillTestAdapter({ [file]: "Guide" });

      await assertRejects(
        () =>
          validateStrictSkillPath(root, "references/guide.md", ["references"], {
            ...adapter,
            async *readDir() {
              for (let index = 0; index <= SKILL_SUBDIR_MAX_ENTRIES; index += 1) {
                yield {
                  name: `entry-${index}`,
                  isFile: true,
                  isDirectory: false,
                  isSymlink: false,
                };
              }
            },
          }),
        RangeError,
        `${SKILL_SUBDIR_MAX_ENTRIES}`,
      );
    });

    it("honors a shared cancellation budget during strict validation", async () => {
      const adapter = {
        ...createSkillTestAdapter({}),
        exists: () => new Promise<boolean>(() => {}),
      };
      const controller = new AbortController();
      const budget = createSkillOperationBudget({ abortSignal: controller.signal });
      const validateWithBudget = validateStrictSkillPath as unknown as (
        root: string,
        requestedPath: string,
        allowedSubdirs: readonly string[],
        fsAdapter: typeof adapter,
        options: { budget: typeof budget },
      ) => Promise<string>;

      const validation = validateWithBudget(
        "/project/skills/test",
        "references/guide.md",
        ["references"],
        adapter,
        { budget },
      );
      controller.abort(new Error("cancel strict validation"));

      assertEquals(await settlesWithin(validation), true);
    });

    it("should reject symlinked files in local skills", async () => {
      const tempDir = await makeTempDir({ prefix: "vf-skill-path-" });
      const skillRoot = join(tempDir, "skill");
      const referencesDir = join(skillRoot, "references");
      const outsideFile = join(tempDir, "outside.md");
      const symlinkPath = join(referencesDir, "linked.md");

      try {
        await mkdir(referencesDir, { recursive: true });
        await writeTextFile(outsideFile, "outside");

        try {
          await symlink(outsideFile, symlinkPath);
        } catch {
          // Environments without symlink permissions (e.g. CI containers) can't
          // exercise this test. Log a warning so silent skips are visible in output.
          console.warn("[SKIP] symlink test: OS denied symlink creation — skipping");
          return;
        }

        await assertRejects(
          () => validateSkillPath(skillRoot, "references/linked.md", ["references"]),
          Error,
          "symlink",
        );
      } finally {
        await remove(tempDir, { recursive: true });
      }
    });
  });

  describe("listSkillSubdir", () => {
    it("should return empty array for non-existent directory", async () => {
      const result = await listSkillSubdir("/nonexistent/path", "references");
      assertEquals(result, []);
    });

    it("should return empty array when fsAdapter reports optional directory as file-not-found", async () => {
      const adapter = createSkillTestAdapter({});
      const result = await listSkillSubdir("/project/skills/test", "assets", {
        ...adapter,
        async exists(path: string) {
          throw FILE_NOT_FOUND.create({ detail: `File not found: ${path}` });
        },
      });

      assertEquals(result, []);
    });

    it("should propagate non-not-found fsAdapter errors", async () => {
      const adapter = createSkillTestAdapter({});

      await assertRejects(
        () =>
          listSkillSubdir("/project/skills/test", "assets", {
            ...adapter,
            async exists() {
              throw new Error("adapter unavailable");
            },
          }),
        Error,
        "adapter unavailable",
      );
    });

    it("should list files via fsAdapter", async () => {
      const adapter = createSkillTestAdapter({
        "/project/skills/test/references/a.md": "A",
        "/project/skills/test/references/b.md": "B",
        "/project/skills/test/references/release notes.md": "Notes",
        "/project/skills/test/references/översikt.md": "Overview",
      });
      const result = await listSkillSubdir("/project/skills/test", "references", adapter);
      assertEquals(result, [
        "references/a.md",
        "references/b.md",
        "references/översikt.md",
        "references/release notes.md",
      ]);
    });

    it("rejects traversal in the requested subdirectory before enumeration", async () => {
      const adapter = createSkillTestAdapter({
        "/project/skills/outside/secret.md": "secret",
      });

      await assertRejects(
        () => listSkillSubdir("/project/skills/test", "../outside", adapter),
        Error,
        "subdirectory",
      );
    });

    it("rejects unsafe adapter entry names", async () => {
      const adapter = createSkillTestAdapter({
        "/project/skills/test/references/ok.md": "ok",
      });

      await assertRejects(
        () =>
          listSkillSubdir("/project/skills/test", "references", {
            ...adapter,
            async *readDir() {
              yield {
                name: "../secret.md",
                isFile: true,
                isDirectory: false,
                isSymlink: false,
              };
            },
          }),
        Error,
        "entry name",
      );
    });

    it("preserves public adapter order while strict listings sort deterministically", async () => {
      const adapter = createSkillTestAdapter({
        "/project/skills/test/references/a.md": "A",
      });
      const unorderedAdapter = {
        ...adapter,
        async *readDir() {
          yield { name: "z.md", isFile: true, isDirectory: false, isSymlink: false };
          yield { name: "a.md", isFile: true, isDirectory: false, isSymlink: false };
        },
      };

      assertEquals(
        await listSkillSubdir(
          "/project/skills/test",
          "references",
          unorderedAdapter,
        ),
        ["references/z.md", "references/a.md"],
      );
      assertEquals(
        await listStrictSkillSubdir(
          "/project/skills/test",
          "references",
          unorderedAdapter,
        ),
        ["references/a.md", "references/z.md"],
      );
    });

    it("keeps the entry cap on strict listings only", async () => {
      const adapter = createSkillTestAdapter({
        "/project/skills/test/references/a.md": "A",
      });
      const largeAdapter = {
        ...adapter,
        async *readDir() {
          for (let index = 0; index < 1_001; index++) {
            yield {
              name: `file-${index}.md`,
              isFile: true,
              isDirectory: false,
              isSymlink: false,
            };
          }
        },
      };

      assertEquals(
        (
          await listSkillSubdir(
            "/project/skills/test",
            "references",
            largeAdapter,
          )
        ).length,
        1_001,
      );
      await assertRejects(
        () =>
          listStrictSkillSubdir(
            "/project/skills/test",
            "references",
            largeAdapter,
          ),
        RangeError,
        "at most 1000",
      );
    });

    it("honors a shared cancellation budget during strict listing", async () => {
      const adapter = {
        ...createSkillTestAdapter({}),
        exists: () => new Promise<boolean>(() => {}),
      };
      const controller = new AbortController();
      const budget = createSkillOperationBudget({ abortSignal: controller.signal });
      const listWithBudget = listStrictSkillSubdir as unknown as (
        root: string,
        subdir: string,
        fsAdapter: typeof adapter,
        options: { budget: typeof budget },
      ) => Promise<string[]>;

      const listing = listWithBudget(
        "/project/skills/test",
        "references",
        adapter,
        { budget },
      );
      controller.abort(new Error("cancel strict listing"));

      assertEquals(await settlesWithin(listing), true);
    });

    it("rejects symlinked local subdirectories instead of listing their targets", async () => {
      const tempDir = await makeTempDir({ prefix: "vf-skill-list-" });
      const skillRoot = join(tempDir, "skill");
      const outsideDir = join(tempDir, "outside");
      const linkedDir = join(skillRoot, "references");

      try {
        await mkdir(skillRoot, { recursive: true });
        await mkdir(outsideDir, { recursive: true });
        await writeTextFile(join(outsideDir, "secret.md"), "secret");

        try {
          await symlink(outsideDir, linkedDir);
        } catch {
          console.warn("[SKIP] symlink directory test: OS denied symlink creation — skipping");
          return;
        }

        await assertRejects(
          () => listSkillSubdir(skillRoot, "references"),
          Error,
          "symlink",
        );
      } finally {
        await remove(tempDir, { recursive: true });
      }
    });
  });
});
