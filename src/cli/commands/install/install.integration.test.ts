import { assertEquals } from "#veryfront/testing/assert.ts";
import { afterEach, beforeEach, describe, it } from "#veryfront/testing/bdd.ts";
import { join } from "#veryfront/platform/compat/path/index.ts";
import {
  exists,
  makeTempDir,
  readTextFile,
  remove,
  writeTextFile,
} from "#veryfront/platform/compat/fs.ts";
import { runCommand } from "#veryfront/platform/compat/process.ts";

describe("install command integration", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await makeTempDir({ prefix: "veryfront-install-test-" });
  });

  afterEach(async () => {
    await remove(tempDir, { recursive: true });
  });

  async function runInstall(
    target: string,
  ): Promise<{ code: number; output: string }> {
    const cliPath = new URL("../../main.ts", import.meta.url).pathname;
    const result = await runCommand("deno", {
      args: [
        "run",
        "--allow-all",
        cliPath,
        "install",
        "--target",
        target,
        "--force",
      ],
      cwd: tempDir,
      capture: true,
    });

    return {
      code: result.code,
      output: (result.stdout ?? "") + (result.stderr ?? ""),
    };
  }

  async function assertFileExists(path: string): Promise<void> {
    assertEquals(await exists(path), true);
  }

  async function assertFileNotExists(path: string): Promise<void> {
    assertEquals(await exists(path), false);
  }

  async function assertFileContains(
    path: string,
    substrings: string[],
  ): Promise<void> {
    const content = await readTextFile(path);
    for (const substring of substrings) {
      assertEquals(content.includes(substring), true);
    }
  }

  describe("cursor", () => {
    it("should install .cursorrules", async () => {
      const { code } = await runInstall("cursor");
      assertEquals(code, 0);

      const filePath = join(tempDir, ".cursorrules");
      await assertFileExists(filePath);
      await assertFileContains(filePath, ["Veryfront", "veryfront dev", "src/pages/"]);
    });
  });

  describe("claude-code", () => {
    it("should install .claude/CLAUDE.md", async () => {
      const { code } = await runInstall("claude-code");
      assertEquals(code, 0);

      const filePath = join(tempDir, ".claude/CLAUDE.md");
      await assertFileExists(filePath);
      await assertFileContains(filePath, ["Veryfront", "veryfront dev"]);
    });
  });

  describe("skill", () => {
    it("should install SKILL.md with YAML frontmatter", async () => {
      const { code } = await runInstall("skill");
      assertEquals(code, 0);

      const filePath = join(tempDir, "SKILL.md");
      await assertFileExists(filePath);

      const content = await readTextFile(filePath);
      assertEquals(content.startsWith("---"), true);
      for (
        const substring of [
          "name: veryfront",
          "description:",
          "compatibility:",
        ]
      ) {
        assertEquals(content.includes(substring), true);
      }
    });
  });

  describe("copilot", () => {
    it("should install .github/copilot-instructions.md", async () => {
      const { code } = await runInstall("copilot");
      assertEquals(code, 0);

      const filePath = join(tempDir, ".github/copilot-instructions.md");
      await assertFileExists(filePath);
      await assertFileContains(filePath, ["Veryfront", "veryfront dev"]);
    });
  });

  describe("windsurf", () => {
    it("should install .windsurfrules", async () => {
      const { code } = await runInstall("windsurf");
      assertEquals(code, 0);

      const filePath = join(tempDir, ".windsurfrules");
      await assertFileExists(filePath);
      await assertFileContains(filePath, ["Veryfront", "veryfront dev"]);
    });
  });

  describe("agents", () => {
    it("should install AGENTS.md", async () => {
      const { code } = await runInstall("agents");
      assertEquals(code, 0);

      const filePath = join(tempDir, "AGENTS.md");
      await assertFileExists(filePath);
      await assertFileContains(filePath, ["Veryfront", "npx veryfront"]);
    });
  });

  describe("all targets", () => {
    it("should install all tools with --target all", async () => {
      const { code } = await runInstall("all");
      assertEquals(code, 0);

      await assertFileExists(join(tempDir, ".cursorrules"));
      await assertFileExists(join(tempDir, ".claude/CLAUDE.md"));
      await assertFileExists(join(tempDir, "SKILL.md"));
      await assertFileExists(join(tempDir, ".github/copilot-instructions.md"));
      await assertFileExists(join(tempDir, ".windsurfrules"));
      await assertFileExists(join(tempDir, "AGENTS.md"));
    });
  });

  describe("multiple targets", () => {
    it("should install comma-separated targets", async () => {
      const { code } = await runInstall("cursor,claude-code,skill");
      assertEquals(code, 0);

      await assertFileExists(join(tempDir, ".cursorrules"));
      await assertFileExists(join(tempDir, ".claude/CLAUDE.md"));
      await assertFileExists(join(tempDir, "SKILL.md"));
      await assertFileNotExists(join(tempDir, ".windsurfrules"));
      await assertFileNotExists(join(tempDir, "AGENTS.md"));
    });
  });

  describe("force flag", () => {
    it("should overwrite existing files with --force", async () => {
      const filePath = join(tempDir, ".cursorrules");
      await writeTextFile(filePath, "existing content");

      const { code } = await runInstall("cursor");
      assertEquals(code, 0);

      await assertFileContains(filePath, ["Veryfront"]);
    });
  });
});
