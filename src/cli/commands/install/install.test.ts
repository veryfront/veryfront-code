import { assertEquals, assertThrows } from "#veryfront/testing/assert.ts";
import { afterEach, beforeEach, describe, it } from "#veryfront/testing/bdd.ts";
import { installTargets, parseTargetFlag } from "./install.ts";
import {
  exists,
  makeTempDir,
  readTextFile,
  remove,
  writeTextFile,
} from "#veryfront/platform/compat/fs.ts";

describe("parseTargetFlag", () => {
  it("should parse single target", () => {
    assertEquals(parseTargetFlag("cursor"), ["cursor"]);
  });

  it("should parse comma-separated targets", () => {
    const targets = parseTargetFlag("cursor,claude-code");
    assertEquals(targets.includes("cursor"), true);
    assertEquals(targets.includes("claude-code"), true);
    assertEquals(targets.length, 2);
  });

  it("should parse all targets", () => {
    const targets = parseTargetFlag("all");
    assertEquals(targets.includes("cursor"), true);
    assertEquals(targets.includes("claude-code"), true);
    assertEquals(targets.includes("skill"), true);
    assertEquals(targets.includes("copilot"), true);
    assertEquals(targets.includes("windsurf"), true);
    assertEquals(targets.includes("agents"), true);
    assertEquals(targets.length, 6);
  });

  it("should handle whitespace", () => {
    const targets = parseTargetFlag("cursor, claude-code, skill");
    assertEquals(targets.includes("cursor"), true);
    assertEquals(targets.includes("claude-code"), true);
    assertEquals(targets.includes("skill"), true);
  });

  it("should filter invalid targets", () => {
    const targets = parseTargetFlag("cursor,invalid,claude-code");
    assertEquals(targets.includes("cursor"), true);
    assertEquals(targets.includes("claude-code"), true);
    assertEquals(targets.includes("invalid" as never), false);
    assertEquals(targets.length, 2);
  });

  it("should throw for all invalid targets", () => {
    assertThrows(() => parseTargetFlag("invalid,unknown"), Error);
  });

  it("should throw for empty string", () => {
    assertThrows(() => parseTargetFlag(""), Error);
  });
});

describe("installTargets", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await makeTempDir();
  });

  afterEach(async () => {
    await remove(tempDir, { recursive: true });
  });

  it("should install cursor rules", async () => {
    await installTargets(["cursor"], { cwd: tempDir, force: true });
    const content = await readTextFile(`${tempDir}/.cursorrules`);
    assertEquals(content.includes("Veryfront"), true);
  });

  it("should install claude-code with nested directory", async () => {
    await installTargets(["claude-code"], { cwd: tempDir, force: true });
    const content = await readTextFile(`${tempDir}/.claude/CLAUDE.md`);
    assertEquals(content.includes("Veryfront"), true);
  });

  it("should install skill.md", async () => {
    await installTargets(["skill"], { cwd: tempDir, force: true });
    const content = await readTextFile(`${tempDir}/SKILL.md`);
    assertEquals(content.startsWith("---"), true);
  });

  it("should install copilot with nested directory", async () => {
    await installTargets(["copilot"], { cwd: tempDir, force: true });
    const content = await readTextFile(`${tempDir}/.github/copilot-instructions.md`);
    assertEquals(content.includes("Veryfront"), true);
  });

  it("should install windsurf rules", async () => {
    await installTargets(["windsurf"], { cwd: tempDir, force: true });
    const content = await readTextFile(`${tempDir}/.windsurfrules`);
    assertEquals(content.includes("Veryfront"), true);
  });

  it("should install agents.md", async () => {
    await installTargets(["agents"], { cwd: tempDir, force: true });
    const content = await readTextFile(`${tempDir}/AGENTS.md`);
    assertEquals(content.includes("Veryfront"), true);
  });

  it("should install multiple targets", async () => {
    await installTargets(["cursor", "claude-code", "skill"], { cwd: tempDir, force: true });
    assertEquals(await exists(`${tempDir}/.cursorrules`), true);
    assertEquals(await exists(`${tempDir}/.claude/CLAUDE.md`), true);
    assertEquals(await exists(`${tempDir}/SKILL.md`), true);
  });

  it("should not overwrite without force", async () => {
    await writeTextFile(`${tempDir}/.cursorrules`, "existing content");
    await installTargets(["cursor"], { cwd: tempDir, force: false });
    const content = await readTextFile(`${tempDir}/.cursorrules`);
    assertEquals(content, "existing content");
  });

  it("should overwrite with force", async () => {
    await writeTextFile(`${tempDir}/.cursorrules`, "existing content");
    await installTargets(["cursor"], { cwd: tempDir, force: true });
    const content = await readTextFile(`${tempDir}/.cursorrules`);
    assertEquals(content.includes("Veryfront"), true);
  });

  it("should throw for empty targets", async () => {
    let error: Error | null = null;
    try {
      await installTargets([], { cwd: tempDir });
    } catch (e) {
      error = e as Error;
    }
    assertEquals(error !== null, true);
  });

  it("should throw for invalid targets", async () => {
    let error: Error | null = null;
    try {
      await installTargets(["invalid" as never], { cwd: tempDir });
    } catch (e) {
      error = e as Error;
    }
    assertEquals(error !== null, true);
  });
});
