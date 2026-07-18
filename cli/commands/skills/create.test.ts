import "#veryfront/schemas/_test-setup.ts";
import {
  assert,
  assertEquals,
  assertRejects,
  assertStringIncludes,
} from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { join } from "#std/path.ts";
import { setJsonMode } from "../../shared/json-output.ts";
import { createSkill } from "./create.ts";

async function exists(path: string): Promise<boolean> {
  try {
    await Deno.stat(path);
    return true;
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) return false;
    throw error;
  }
}

async function withTempProject(fn: (dir: string) => Promise<void>): Promise<void> {
  const dir = await Deno.makeTempDir({ prefix: "vf-skill-create-" });
  try {
    await fn(dir);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
}

async function captureConsoleLog(run: () => Promise<void>): Promise<string> {
  const originalLog = console.log;
  const lines: string[] = [];
  try {
    console.log = (message?: unknown, ...rest: unknown[]) => {
      lines.push([message, ...rest].map(String).join(" "));
    };
    await run();
  } finally {
    console.log = originalLog;
  }
  return lines.join("\n");
}

describe("Skills Create", () => {
  describe("project skill scaffold", () => {
    it("creates a project skill under skills/<id>/SKILL.md", async () => {
      await withTempProject(async (dir) => {
        await createSkill({ _: ["skills", "create", "code-review"] }, dir);

        const skillPath = join(dir, "skills", "code-review", "SKILL.md");
        assert(await exists(skillPath));
        assertEquals(await exists(join(dir, "code-review", "skill.json")), false);
        assertEquals(await exists(join(dir, "code-review", "SKILL.md")), false);

        const content = await Deno.readTextFile(skillPath);
        assertStringIncludes(content, "name: code-review");
        assertStringIncludes(content, "# Code Review");
      });
    });

    it("does not overwrite an existing project skill", async () => {
      await withTempProject(async (dir) => {
        const skillPath = join(dir, "skills", "code-review", "SKILL.md");
        await Deno.mkdir(join(dir, "skills", "code-review"), { recursive: true });
        await Deno.writeTextFile(skillPath, "existing");

        await assertRejects(
          () => createSkill({ _: ["skills", "create", "code-review"] }, dir),
          Error,
          "already exists",
        );
        assertEquals(await Deno.readTextFile(skillPath), "existing");
      });
    });

    it("returns project-relative file paths in JSON output", async () => {
      await withTempProject(async (dir) => {
        setJsonMode(true);
        try {
          const output = await captureConsoleLog(() =>
            createSkill({ _: ["skills", "create", "code-review"] }, dir)
          );
          const payload = JSON.parse(output);

          assertEquals(payload.success, true);
          assertEquals(payload.data.files, ["skills/code-review/SKILL.md"]);
        } finally {
          setJsonMode(false);
        }
      });
    });
  });

  describe("skill name validation", () => {
    const valid = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/;

    it("accepts valid names: lowercase, numbers, hyphens", () => {
      assertEquals(valid.test("my-skill"), true);
      assertEquals(valid.test("deploy-safely"), true);
      assertEquals(valid.test("a1"), true);
      assertEquals(valid.test("a"), true);
      assertEquals(valid.test("abc"), true);
    });

    it("rejects uppercase", () => {
      assertEquals(valid.test("My-Skill"), false);
    });

    it("rejects leading dash", () => {
      assertEquals(valid.test("-starts-with-dash"), false);
    });

    it("rejects trailing dash", () => {
      assertEquals(valid.test("ends-with-"), false);
    });

    it("rejects spaces", () => {
      assertEquals(valid.test("has spaces"), false);
    });

    it("rejects path traversal", () => {
      assertEquals(valid.test("../../path-traversal"), false);
    });

    it("rejects empty string", () => {
      assertEquals(valid.test(""), false);
    });
  });
});
