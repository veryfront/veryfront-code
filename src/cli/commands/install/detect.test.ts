import { assertEquals } from "jsr:@std/assert@1";
import { afterEach, beforeEach, describe, it } from "jsr:@std/testing@1/bdd";
import { detectAITools, formatDetectionHint } from "./detect.ts";

describe("detectAITools", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await Deno.makeTempDir();
  });

  afterEach(async () => {
    await Deno.remove(tempDir, { recursive: true });
  });

  it("should detect cursor from .cursor directory", async () => {
    await Deno.mkdir(`${tempDir}/.cursor`);
    const detected = await detectAITools({ cwd: tempDir });
    assertEquals(detected.includes("cursor"), true);
  });

  it("should detect claude-code from .claude directory", async () => {
    await Deno.mkdir(`${tempDir}/.claude`);
    const detected = await detectAITools({ cwd: tempDir });
    assertEquals(detected.includes("claude-code"), true);
  });

  it("should detect copilot from .github directory", async () => {
    await Deno.mkdir(`${tempDir}/.github`);
    const detected = await detectAITools({ cwd: tempDir });
    assertEquals(detected.includes("copilot"), true);
  });

  it("should detect windsurf from .windsurfrules file", async () => {
    await Deno.writeTextFile(`${tempDir}/.windsurfrules`, "");
    const detected = await detectAITools({ cwd: tempDir });
    assertEquals(detected.includes("windsurf"), true);
  });

  it("should always include skill", async () => {
    const detected = await detectAITools({ cwd: tempDir });
    assertEquals(detected.includes("skill"), true);
  });

  it("should not auto-detect agents", async () => {
    const detected = await detectAITools({ cwd: tempDir });
    assertEquals(detected.includes("agents"), false);
  });

  it("should detect multiple tools", async () => {
    await Deno.mkdir(`${tempDir}/.cursor`);
    await Deno.mkdir(`${tempDir}/.claude`);
    await Deno.mkdir(`${tempDir}/.github`);
    const detected = await detectAITools({ cwd: tempDir });
    assertEquals(detected.includes("cursor"), true);
    assertEquals(detected.includes("claude-code"), true);
    assertEquals(detected.includes("copilot"), true);
    assertEquals(detected.includes("skill"), true);
  });

  it("should return skill only when no tools detected", async () => {
    const detected = await detectAITools({ cwd: tempDir });
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
