import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  getBuildTips,
  getCommandTips,
  getDevTips,
  getInitTemplates,
  getPostBuildTips,
  getPostDeployTips,
  getPostInitTips,
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

  describe("getPostBuildTips", () => {
    it("should mention veryfront serve", () => {
      assertEquals(getPostBuildTips().includes("veryfront serve"), true);
    });

    it("should mention veryfront deploy", () => {
      assertEquals(getPostBuildTips().includes("veryfront deploy"), true);
    });

    it("should contain Next steps header", () => {
      assertEquals(getPostBuildTips().includes("Next steps"), true);
    });
  });

  describe("getPostDeployTips", () => {
    it("should mention veryfront open", () => {
      assertEquals(getPostDeployTips().includes("veryfront open"), true);
    });

    it("should contain Next steps header", () => {
      assertEquals(getPostDeployTips().includes("Next steps"), true);
    });
  });

  describe("getPostInitTips", () => {
    it("should include cd with project name", () => {
      const tips = getPostInitTips("my-app");
      assertEquals(tips.includes("cd"), true);
      assertEquals(tips.includes("my-app"), true);
    });

    it("should mention veryfront dev", () => {
      assertEquals(getPostInitTips("test-project").includes("veryfront dev"), true);
    });

    it("should contain Next steps header", () => {
      assertEquals(getPostInitTips("foo").includes("Next steps"), true);
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
