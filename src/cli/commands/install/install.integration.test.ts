import { assertEquals } from "jsr:@std/assert@1";
import { afterEach, beforeEach, describe, it } from "jsr:@std/testing@1/bdd";
import { join } from "@veryfront/platform/compat/path/index.ts";

describe("install command integration", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await Deno.makeTempDir({ prefix: "veryfront-install-test-" });
  });

  afterEach(async () => {
    await Deno.remove(tempDir, { recursive: true });
  });

  async function runInstall(target: string): Promise<{ code: number; output: string }> {
    const cliPath = new URL("../../main.ts", import.meta.url).pathname;
    const command = new Deno.Command("deno", {
      args: ["run", "--allow-all", cliPath, "install", "--target", target, "--force"],
      cwd: tempDir,
      stdout: "piped",
      stderr: "piped",
    });
    const { code, stdout, stderr } = await command.output();
    const output = new TextDecoder().decode(stdout) + new TextDecoder().decode(stderr);
    return { code, output };
  }

  async function exists(path: string): Promise<boolean> {
    try {
      await Deno.stat(path);
      return true;
    } catch {
      return false;
    }
  }

  describe("cursor", () => {
    it("should install .cursorrules", async () => {
      const { code } = await runInstall("cursor");
      assertEquals(code, 0);
      assertEquals(await exists(join(tempDir, ".cursorrules")), true);

      const content = await Deno.readTextFile(join(tempDir, ".cursorrules"));
      assertEquals(content.includes("Veryfront"), true);
      assertEquals(content.includes("veryfront dev"), true);
      assertEquals(content.includes("src/pages/"), true);
    });
  });

  describe("claude-code", () => {
    it("should install .claude/CLAUDE.md", async () => {
      const { code } = await runInstall("claude-code");
      assertEquals(code, 0);
      assertEquals(await exists(join(tempDir, ".claude/CLAUDE.md")), true);

      const content = await Deno.readTextFile(join(tempDir, ".claude/CLAUDE.md"));
      assertEquals(content.includes("Veryfront"), true);
      assertEquals(content.includes("veryfront dev"), true);
    });
  });

  describe("skill", () => {
    it("should install SKILL.md with YAML frontmatter", async () => {
      const { code } = await runInstall("skill");
      assertEquals(code, 0);
      assertEquals(await exists(join(tempDir, "SKILL.md")), true);

      const content = await Deno.readTextFile(join(tempDir, "SKILL.md"));
      assertEquals(content.startsWith("---"), true);
      assertEquals(content.includes("name: veryfront"), true);
      assertEquals(content.includes("description:"), true);
      assertEquals(content.includes("compatibility:"), true);
    });
  });

  describe("copilot", () => {
    it("should install .github/copilot-instructions.md", async () => {
      const { code } = await runInstall("copilot");
      assertEquals(code, 0);
      assertEquals(await exists(join(tempDir, ".github/copilot-instructions.md")), true);

      const content = await Deno.readTextFile(join(tempDir, ".github/copilot-instructions.md"));
      assertEquals(content.includes("Veryfront"), true);
      assertEquals(content.includes("veryfront dev"), true);
    });
  });

  describe("windsurf", () => {
    it("should install .windsurfrules", async () => {
      const { code } = await runInstall("windsurf");
      assertEquals(code, 0);
      assertEquals(await exists(join(tempDir, ".windsurfrules")), true);

      const content = await Deno.readTextFile(join(tempDir, ".windsurfrules"));
      assertEquals(content.includes("Veryfront"), true);
      assertEquals(content.includes("veryfront dev"), true);
    });
  });

  describe("agents", () => {
    it("should install AGENTS.md", async () => {
      const { code } = await runInstall("agents");
      assertEquals(code, 0);
      assertEquals(await exists(join(tempDir, "AGENTS.md")), true);

      const content = await Deno.readTextFile(join(tempDir, "AGENTS.md"));
      assertEquals(content.includes("Veryfront"), true);
      assertEquals(content.includes("npx veryfront"), true);
    });
  });

  describe("all targets", () => {
    it("should install all tools with --target all", async () => {
      const { code } = await runInstall("all");
      assertEquals(code, 0);

      assertEquals(await exists(join(tempDir, ".cursorrules")), true);
      assertEquals(await exists(join(tempDir, ".claude/CLAUDE.md")), true);
      assertEquals(await exists(join(tempDir, "SKILL.md")), true);
      assertEquals(await exists(join(tempDir, ".github/copilot-instructions.md")), true);
      assertEquals(await exists(join(tempDir, ".windsurfrules")), true);
      assertEquals(await exists(join(tempDir, "AGENTS.md")), true);
    });
  });

  describe("multiple targets", () => {
    it("should install comma-separated targets", async () => {
      const { code } = await runInstall("cursor,claude-code,skill");
      assertEquals(code, 0);

      assertEquals(await exists(join(tempDir, ".cursorrules")), true);
      assertEquals(await exists(join(tempDir, ".claude/CLAUDE.md")), true);
      assertEquals(await exists(join(tempDir, "SKILL.md")), true);
      assertEquals(await exists(join(tempDir, ".windsurfrules")), false);
      assertEquals(await exists(join(tempDir, "AGENTS.md")), false);
    });
  });

  describe("force flag", () => {
    it("should overwrite existing files with --force", async () => {
      await Deno.writeTextFile(join(tempDir, ".cursorrules"), "existing content");

      const { code } = await runInstall("cursor");
      assertEquals(code, 0);

      const content = await Deno.readTextFile(join(tempDir, ".cursorrules"));
      assertEquals(content.includes("Veryfront"), true);
    });
  });
});
