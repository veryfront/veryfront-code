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
    return detectAITools({ cwd: tempDir });
  }

  async function assertDetected(tool: string, expected: boolean): Promise<void> {
    const detected = await detect();
    assertEquals(detected.includes(tool), expected);
  }

  it("should detect cursor from .cursor directory", async () => {
    await mkdir(`${tempDir}/.cursor`);
    await assertDetected("cursor", true);
  });

  it("should detect claude-code from .claude directory", async () => {
    await mkdir(`${tempDir}/.claude`);
    await assertDetected("claude-code", true);
  });

  it("should detect copilot from .github directory", async () => {
    await mkdir(`${tempDir}/.github`);
    await assertDetected("copilot", true);
  });

  it("should detect windsurf from .windsurfrules file", async () => {
    await writeTextFile(`${tempDir}/.windsurfrules`, "");
    await assertDetected("windsurf", true);
  });

  it("should always include skill", async () => {
    await assertDetected("skill", true);
  });

  it("should not auto-detect agents", async () => {
    await assertDetected("agents", false);
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
    assertEquals(
      formatDetectionHint(["skill"]),
      "No AI tools detected - select the ones you use",
    );
  });

  it("should show single tool detection", () => {
    assertEquals(formatDetectionHint(["cursor", "skill"]), "Auto-detected Cursor from project");
  });

  it("should show multiple tool detection", () => {
    assertEquals(
      formatDetectionHint(["cursor", "claude-code", "skill"]),
      "Auto-detected Cursor, Claude Code from project",
    );
  });

  it("should show all detected tools", () => {
    const hint = formatDetectionHint(["cursor", "claude-code", "copilot", "windsurf", "skill"]);
    assertEquals(hint.includes("Cursor"), true);
    assertEquals(hint.includes("Claude Code"), true);
    assertEquals(hint.includes("GitHub Copilot"), true);
    assertEquals(hint.includes("Windsurf"), true);
  });

  it("should handle empty array", () => {
    assertEquals(formatDetectionHint([]), "No AI tools detected - select the ones you use");
  });
});
