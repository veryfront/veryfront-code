import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { getBuildTips, getCommandTips, getDevTips, getInitTemplates } from "./tips.ts";

describe("cli/help/tips", () => {
  describe("getDevTips", () => {
    it("should return a string containing HMR info", () => {
      const tips = getDevTips();
      assertEquals(typeof tips, "string");
      assertEquals(tips.includes("HMR"), true);
    });

    it("should mention MCP server port", () => {
      const tips = getDevTips();
      assertEquals(tips.includes("9999"), true);
    });

    it("should mention Ctrl+C", () => {
      const tips = getDevTips();
      assertEquals(tips.includes("Ctrl+C"), true);
    });
  });

  describe("getBuildTips", () => {
    it("should return a string containing analyze-chunks info", () => {
      const tips = getBuildTips();
      assertEquals(typeof tips, "string");
      assertEquals(tips.includes("analyze-chunks"), true);
    });

    it("should mention dry-run flag", () => {
      const tips = getBuildTips();
      assertEquals(tips.includes("--dry-run"), true);
    });

    it("should mention veryfront serve", () => {
      const tips = getBuildTips();
      assertEquals(tips.includes("veryfront serve"), true);
    });
  });

  describe("getInitTemplates", () => {
    it("should list all templates", () => {
      const templates = getInitTemplates();
      assertEquals(templates.includes("ai"), true);
      assertEquals(templates.includes("app"), true);
      assertEquals(templates.includes("blog"), true);
      assertEquals(templates.includes("docs"), true);
      assertEquals(templates.includes("minimal"), true);
    });
  });

  describe("getCommandTips", () => {
    it("should return dev tips for 'dev' command", () => {
      const tips = getCommandTips("dev");
      assertEquals(typeof tips, "string");
      assertEquals(tips!.includes("HMR"), true);
    });

    it("should return build tips for 'build' command", () => {
      const tips = getCommandTips("build");
      assertEquals(typeof tips, "string");
      assertEquals(tips!.includes("analyze-chunks"), true);
    });

    it("should return init templates for 'init' command", () => {
      const tips = getCommandTips("init");
      assertEquals(typeof tips, "string");
      assertEquals(tips!.includes("ai"), true);
    });

    it("should return undefined for unknown command", () => {
      const tips = getCommandTips("nonexistent");
      assertEquals(tips, undefined);
    });

    it("should return undefined for empty string", () => {
      const tips = getCommandTips("");
      assertEquals(tips, undefined);
    });
  });
});
