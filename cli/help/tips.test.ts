import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  getBuildTips,
  getCommandTips,
  getDevTips,
  getInitTemplates,
  getPostDeployTips,
} from "./tips.ts";

describe("cli/help/tips", () => {
  describe("getDevTips", () => {
    it("should return a string containing HMR info", () => {
      const tips = getDevTips();
      assertEquals(typeof tips, "string");
      assertEquals(tips.includes("HMR"), true);
    });

    it("should mention MCP server port", () => {
      assertEquals(getDevTips().includes("3002"), true);
    });

    it("should mention Ctrl+C", () => {
      assertEquals(getDevTips().includes("Ctrl+C"), true);
    });
  });

  describe("getBuildTips", () => {
    it("should return a string containing analyze-chunks info", () => {
      const tips = getBuildTips();
      assertEquals(typeof tips, "string");
      assertEquals(tips.includes("analyze-chunks"), true);
    });

    it("should mention dry-run flag", () => {
      assertEquals(getBuildTips().includes("--dry-run"), true);
    });

    it("should mention veryfront serve", () => {
      assertEquals(getBuildTips().includes("veryfront serve"), true);
    });
  });

  describe("getInitTemplates", () => {
    it("should list all templates", () => {
      const templates = getInitTemplates();
      for (
        const template of [
          "ai-agent",
          "docs-agent",
          "multi-agent-system",
          "agentic-workflow",
          "coding-agent",
          "saas-starter",
          "minimal",
        ]
      ) {
        assertEquals(templates.includes(template), true);
      }
    });
  });

  describe("getPostDeployTips", () => {
    it("should mention veryfront open", () => {
      assertEquals(getPostDeployTips().includes("veryfront open"), true);
      assertEquals(getPostDeployTips().includes("npx"), false);
    });

    it("does not add a generic next-steps block", () => {
      assertEquals(getPostDeployTips().includes("Next steps"), false);
    });
  });

  describe("getCommandTips", () => {
    it("should return dev tips for 'dev' command", () => {
      const tips = getCommandTips("dev");
      assertEquals(typeof tips, "string");
      assertEquals(tips?.includes("HMR"), true);
    });

    it("should return build tips for 'build' command", () => {
      const tips = getCommandTips("build");
      assertEquals(typeof tips, "string");
      assertEquals(tips?.includes("analyze-chunks"), true);
    });

    it("should return init templates for 'init' command", () => {
      const tips = getCommandTips("init");
      assertEquals(typeof tips, "string");
      assertEquals(tips?.includes("ai-agent"), true);
    });

    it("should return undefined for unknown command", () => {
      assertEquals(getCommandTips("nonexistent"), undefined);
    });

    it("should return undefined for empty string", () => {
      assertEquals(getCommandTips(""), undefined);
    });
  });
});
