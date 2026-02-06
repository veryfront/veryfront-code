import { assertEquals, assertRejects, assertThrows } from "#veryfront/testing/assert.ts";
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
    assertEquals(targets, ["cursor", "claude-code"]);
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
  let tempDir = "";

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
  let tempDir = "";

  beforeEach(async () => {
    tempDir = await makeTempDir();
  });

  afterEach(async () => {
    await remove(tempDir, { recursive: true });
  });

  it("should remove cursor rules file", async () => {
    const cursorRulesPath = `${tempDir}/.cursorrules`;

    await writeTextFile(cursorRulesPath, "test");
    await uninstallTargets(["cursor"], { cwd: tempDir });

    assertEquals(await exists(cursorRulesPath), false);
  });

  it("should remove claude-code and empty parent directory", async () => {
    const claudeDirPath = `${tempDir}/.claude`;
    const claudeMdPath = `${claudeDirPath}/CLAUDE.md`;

    await mkdir(claudeDirPath);
    await writeTextFile(claudeMdPath, "test");
    await uninstallTargets(["claude-code"], { cwd: tempDir });

    assertEquals(await exists(claudeMdPath), false);
    assertEquals(await exists(claudeDirPath), false);
  });

  it("should not fail when file does not exist", async () => {
    const cursorRulesPath = `${tempDir}/.cursorrules`;

    await uninstallTargets(["cursor"], { cwd: tempDir });
    assertEquals(await exists(cursorRulesPath), false);
  });

  it("should remove multiple targets", async () => {
    const cursorRulesPath = `${tempDir}/.cursorrules`;
    const skillPath = `${tempDir}/SKILL.md`;
    const agentsPath = `${tempDir}/AGENTS.md`;

    await writeTextFile(cursorRulesPath, "test");
    await writeTextFile(skillPath, "test");
    await writeTextFile(agentsPath, "test");

    await uninstallTargets(["cursor", "skill", "agents"], { cwd: tempDir });

    assertEquals(await exists(cursorRulesPath), false);
    assertEquals(await exists(skillPath), false);
    assertEquals(await exists(agentsPath), false);
  });

  it("should throw for empty targets", async () => {
    await assertRejects(() => uninstallTargets([], { cwd: tempDir }), Error);
  });

  it("should throw for invalid targets", async () => {
    await assertRejects(() => uninstallTargets(["invalid" as never], { cwd: tempDir }), Error);
  });
});
