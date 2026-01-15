import { assertEquals } from "jsr:@std/assert@1";
import { afterEach, beforeEach, describe, it } from "jsr:@std/testing@1/bdd";
import { join } from "@veryfront/platform/compat/path/index.ts";

describe("uninstall command integration", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await Deno.makeTempDir({ prefix: "veryfront-uninstall-test-" });
  });

  afterEach(async () => {
    await Deno.remove(tempDir, { recursive: true });
  });

  async function runInstall(target: string): Promise<{ code: number }> {
    const cliPath = new URL("../../main.ts", import.meta.url).pathname;
    const command = new Deno.Command("deno", {
      args: ["run", "--allow-all", cliPath, "install", "--target", target],
      cwd: tempDir,
      stdout: "piped",
      stderr: "piped",
    });
    const { code } = await command.output();
    return { code };
  }

  async function runUninstall(target: string): Promise<{ code: number; output: string }> {
    const cliPath = new URL("../../main.ts", import.meta.url).pathname;
    const command = new Deno.Command("deno", {
      args: ["run", "--allow-all", cliPath, "uninstall", "--target", target],
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
    it("should uninstall .cursorrules", async () => {
      await runInstall("cursor");
      assertEquals(await exists(join(tempDir, ".cursorrules")), true);

      const { code } = await runUninstall("cursor");
      assertEquals(code, 0);
      assertEquals(await exists(join(tempDir, ".cursorrules")), false);
    });
  });

  describe("claude-code", () => {
    it("should uninstall .claude/CLAUDE.md and remove empty directory", async () => {
      await runInstall("claude-code");
      assertEquals(await exists(join(tempDir, ".claude/CLAUDE.md")), true);

      const { code } = await runUninstall("claude-code");
      assertEquals(code, 0);
      assertEquals(await exists(join(tempDir, ".claude/CLAUDE.md")), false);
      assertEquals(await exists(join(tempDir, ".claude")), false);
    });
  });

  describe("skill", () => {
    it("should uninstall SKILL.md", async () => {
      await runInstall("skill");
      assertEquals(await exists(join(tempDir, "SKILL.md")), true);

      const { code } = await runUninstall("skill");
      assertEquals(code, 0);
      assertEquals(await exists(join(tempDir, "SKILL.md")), false);
    });
  });

  describe("copilot", () => {
    it("should uninstall .github/copilot-instructions.md", async () => {
      await runInstall("copilot");
      assertEquals(await exists(join(tempDir, ".github/copilot-instructions.md")), true);

      const { code } = await runUninstall("copilot");
      assertEquals(code, 0);
      assertEquals(await exists(join(tempDir, ".github/copilot-instructions.md")), false);
    });
  });

  describe("windsurf", () => {
    it("should uninstall .windsurfrules", async () => {
      await runInstall("windsurf");
      assertEquals(await exists(join(tempDir, ".windsurfrules")), true);

      const { code } = await runUninstall("windsurf");
      assertEquals(code, 0);
      assertEquals(await exists(join(tempDir, ".windsurfrules")), false);
    });
  });

  describe("agents", () => {
    it("should uninstall AGENTS.md", async () => {
      await runInstall("agents");
      assertEquals(await exists(join(tempDir, "AGENTS.md")), true);

      const { code } = await runUninstall("agents");
      assertEquals(code, 0);
      assertEquals(await exists(join(tempDir, "AGENTS.md")), false);
    });
  });

  describe("all targets", () => {
    it("should uninstall all tools with --target all", async () => {
      await runInstall("all");

      const { code } = await runUninstall("all");
      assertEquals(code, 0);

      assertEquals(await exists(join(tempDir, ".cursorrules")), false);
      assertEquals(await exists(join(tempDir, ".claude/CLAUDE.md")), false);
      assertEquals(await exists(join(tempDir, "SKILL.md")), false);
      assertEquals(await exists(join(tempDir, ".github/copilot-instructions.md")), false);
      assertEquals(await exists(join(tempDir, ".windsurfrules")), false);
      assertEquals(await exists(join(tempDir, "AGENTS.md")), false);
    });
  });

  describe("non-existent files", () => {
    it("should succeed even when files do not exist", async () => {
      const { code } = await runUninstall("cursor");
      assertEquals(code, 0);
    });
  });
});
