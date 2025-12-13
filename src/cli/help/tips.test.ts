import { describe, it } from "std/testing/bdd.ts";
import { assertEquals, assertExists } from "std/assert/mod.ts";
import {
  getDevTips,
  getBuildTips,
  getInitTemplates,
  getCommandTips,
} from "./tips.ts";

describe("tips", () => {
  describe("getDevTips", () => {
    it("should export getDevTips function", () => {
      assertExists(getDevTips);
      assertEquals(typeof getDevTips, "function");
    });

    it("should return dev tips string", () => {
      const result = getDevTips();
      assertExists(result);
      assertEquals(typeof result, "string");
      assertEquals(result.includes("HMR"), true);
    });
  });

  describe("getBuildTips", () => {
    it("should export getBuildTips function", () => {
      assertExists(getBuildTips);
      assertEquals(typeof getBuildTips, "function");
    });

    it("should return build tips string", () => {
      const result = getBuildTips();
      assertExists(result);
      assertEquals(typeof result, "string");
      assertEquals(result.includes("analyze-chunks"), true);
    });
  });

  describe("getInitTemplates", () => {
    it("should export getInitTemplates function", () => {
      assertExists(getInitTemplates);
      assertEquals(typeof getInitTemplates, "function");
    });

    it("should return template list string", () => {
      const result = getInitTemplates();
      assertExists(result);
      assertEquals(typeof result, "string");
      assertEquals(result.includes("blog"), true);
      assertEquals(result.includes("docs"), true);
    });
  });

  describe("getCommandTips", () => {
    it("should export getCommandTips function", () => {
      assertExists(getCommandTips);
      assertEquals(typeof getCommandTips, "function");
    });

    it("should return dev tips for dev command", () => {
      const result = getCommandTips("dev");
      assertExists(result);
      assertEquals(result!.includes("HMR"), true);
    });

    it("should return build tips for build command", () => {
      const result = getCommandTips("build");
      assertExists(result);
      assertEquals(result!.includes("analyze-chunks"), true);
    });

    it("should return init templates for init command", () => {
      const result = getCommandTips("init");
      assertExists(result);
      assertEquals(result!.includes("blog"), true);
    });

    it("should return undefined for unknown command", () => {
      const result = getCommandTips("unknown");
      assertEquals(result, undefined);
    });
  });
});
