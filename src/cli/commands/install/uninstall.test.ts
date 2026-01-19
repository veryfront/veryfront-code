import { assertEquals, assertThrows } from "#veryfront/testing/assert.ts";
import { afterEach, beforeEach, describe, it } from "#veryfront/testing/bdd.ts";
import { findInstalledTools, parseTargetFlag, uninstallTargets } from "./uninstall.ts";
import {
  exists,
  makeTempDir,
  mkdir,
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
    assertEquals(targets.length, 6);
  });

  it("should throw for invalid targets", () => {
    assertThrows(() => parseTargetFlag("invalid"), Error);
  });
});

describe("findInstalledTools", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await makeTempDir();
  });

  afterEach(async () => {
    await remove(tempDir, { recursive: true });
  });

  it("should return empty array when no files exist", async () => {
    const installed = await findInstalledTools({ cwd: tempDir });
    assertEquals(installed, []);
  });

  it("should find installed cursor rules", async () => {
    await writeTextFile(`${tempDir}/.cursorrules`, "test");
    const installed = await findInstalledTools({ cwd: tempDir });
    assertEquals(installed.includes("cursor"), true);
  });

  it("should find multiple installed tools", async () => {
    await writeTextFile(`${tempDir}/.cursorrules`, "test");
    await mkdir(`${tempDir}/.claude`);
    await writeTextFile(`${tempDir}/.claude/CLAUDE.md`, "test");
    await writeTextFile(`${tempDir}/SKILL.md`, "test");

    const installed = await findInstalledTools({ cwd: tempDir });
    assertEquals(installed.includes("cursor"), true);
    assertEquals(installed.includes("claude-code"), true);
    assertEquals(installed.includes("skill"), true);
  });
});

describe("uninstallTargets", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await makeTempDir();
  });

  afterEach(async () => {
    await remove(tempDir, { recursive: true });
  });

  it("should remove cursor rules file", async () => {
    await writeTextFile(`${tempDir}/.cursorrules`, "test");
    await uninstallTargets(["cursor"], { cwd: tempDir });
    assertEquals(await exists(`${tempDir}/.cursorrules`), false);
  });

  it("should remove claude-code and empty parent directory", async () => {
    await mkdir(`${tempDir}/.claude`);
    await writeTextFile(`${tempDir}/.claude/CLAUDE.md`, "test");
    await uninstallTargets(["claude-code"], { cwd: tempDir });
    assertEquals(await exists(`${tempDir}/.claude/CLAUDE.md`), false);
    assertEquals(await exists(`${tempDir}/.claude`), false);
  });

  it("should not fail when file does not exist", async () => {
    await uninstallTargets(["cursor"], { cwd: tempDir });
    assertEquals(await exists(`${tempDir}/.cursorrules`), false);
  });

  it("should remove multiple targets", async () => {
    await writeTextFile(`${tempDir}/.cursorrules`, "test");
    await writeTextFile(`${tempDir}/SKILL.md`, "test");
    await writeTextFile(`${tempDir}/AGENTS.md`, "test");

    await uninstallTargets(["cursor", "skill", "agents"], { cwd: tempDir });

    assertEquals(await exists(`${tempDir}/.cursorrules`), false);
    assertEquals(await exists(`${tempDir}/SKILL.md`), false);
    assertEquals(await exists(`${tempDir}/AGENTS.md`), false);
  });

  it("should throw for empty targets", async () => {
    let error: Error | null = null;
    try {
      await uninstallTargets([], { cwd: tempDir });
    } catch (e) {
      error = e as Error;
    }
    assertEquals(error !== null, true);
  });

  it("should throw for invalid targets", async () => {
    let error: Error | null = null;
    try {
      await uninstallTargets(["invalid" as never], { cwd: tempDir });
    } catch (e) {
      error = e as Error;
    }
    assertEquals(error !== null, true);
  });
});
