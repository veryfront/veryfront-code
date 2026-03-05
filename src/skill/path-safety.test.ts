import { assertEquals, assertRejects } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { join } from "#veryfront/compat/path";
import {
  makeTempDir,
  mkdir,
  remove,
  symlink,
  writeTextFile,
} from "#veryfront/platform/compat/fs.ts";
import { listSkillSubdir, validateSkillPath } from "./path-safety.ts";
import { createSkillTestAdapter } from "./testing.ts";

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

    it("should list files via fsAdapter", async () => {
      const adapter = createSkillTestAdapter({
        "/project/skills/test/references/a.md": "A",
        "/project/skills/test/references/b.md": "B",
      });
      const result = await listSkillSubdir("/project/skills/test", "references", adapter);
      assertEquals(result.sort(), ["references/a.md", "references/b.md"]);
    });
  });
});
