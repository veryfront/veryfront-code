import { assertEquals } from "#veryfront/testing/assert.ts";
import { afterEach, beforeEach, describe, it } from "#veryfront/testing/bdd.ts";
import { makeTempDir, mkdir, remove, writeTextFile } from "#veryfront/platform/compat/fs.ts";
import { detectAITools, formatDetectionHint } from "./detect.ts";

describe("detectAITools", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await makeTempDir();
  });

  afterEach(async () => {
    await remove(tempDir, { recursive: true });
  });

  async function detect(): Promise<string[]> {
    return await detectAITools({ cwd: tempDir });
  }

  it("should detect cursor from .cursor directory", async () => {
    await mkdir(`${tempDir}/.cursor`);
    const detected = await detect();
    assertEquals(detected.includes("cursor"), true);
  });

  it("should detect claude-code from .claude directory", async () => {
    await mkdir(`${tempDir}/.claude`);
    const detected = await detect();
    assertEquals(detected.includes("claude-code"), true);
  });

  it("should detect copilot from .github directory", async () => {
    await mkdir(`${tempDir}/.github`);
    const detected = await detect();
    assertEquals(detected.includes("copilot"), true);
  });

  it("should detect windsurf from .windsurfrules file", async () => {
    await writeTextFile(`${tempDir}/.windsurfrules`, "");
    const detected = await detect();
    assertEquals(detected.includes("windsurf"), true);
  });

  it("should always include skill", async () => {
    const detected = await detect();
    assertEquals(detected.includes("skill"), true);
  });

  it("should not auto-detect agents", async () => {
    const detected = await detect();
    assertEquals(detected.includes("agents"), false);
  });

  it("should detect multiple tools", async () => {
    await mkdir(`${tempDir}/.cursor`);
    await mkdir(`${tempDir}/.claude`);
    await mkdir(`${tempDir}/.github`);

    const detected = await detect();
    assertEquals(detected.includes("cursor"), true);
    assertEquals(detected.includes("claude-code"), true);
    assertEquals(detected.includes("copilot"), true);
    assertEquals(detected.includes("skill"), true);
  });

  it("should return skill only when no tools detected", async () => {
    const detected = await detect();
    assertEquals(detected, ["skill"]);
  });
});

describe("formatDetectionHint", () => {
  it("should show no detection message for skill only", () => {
    const hint = formatDetectionHint(["skill"]);
    assertEquals(hint, "No AI tools detected - select the ones you use");
  });

  it("should show single tool detection", () => {
    const hint = formatDetectionHint(["cursor", "skill"]);
    assertEquals(hint, "Auto-detected Cursor from project");
  });

  it("should show multiple tool detection", () => {
    const hint = formatDetectionHint(["cursor", "claude-code", "skill"]);
    assertEquals(hint, "Auto-detected Cursor, Claude Code from project");
  });

  it("should show all detected tools", () => {
    const hint = formatDetectionHint(["cursor", "claude-code", "copilot", "windsurf", "skill"]);
    assertEquals(hint.includes("Cursor"), true);
    assertEquals(hint.includes("Claude Code"), true);
    assertEquals(hint.includes("GitHub Copilot"), true);
    assertEquals(hint.includes("Windsurf"), true);
  });

  it("should handle empty array", () => {
    const hint = formatDetectionHint([]);
    assertEquals(hint, "No AI tools detected - select the ones you use");
  });
});
