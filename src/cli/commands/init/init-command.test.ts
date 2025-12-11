
import { assertEquals, assertExists } from "std/assert/mod.ts";
import { describe, it } from "std/testing/bdd.ts";
import type { InitOptions, InitTemplate } from "./types.ts";

describe("InitCommand Types", () => {
  describe("InitTemplate", () => {
    it("should support 'ai' template", () => {
      const template: InitTemplate = "ai";
      assertEquals(template, "ai");
    });

    it("should support 'app' template", () => {
      const template: InitTemplate = "app";
      assertEquals(template, "app");
    });

    it("should support 'blog' template", () => {
      const template: InitTemplate = "blog";
      assertEquals(template, "blog");
    });

    it("should support 'docs' template", () => {
      const template: InitTemplate = "docs";
      assertEquals(template, "docs");
    });

    it("should support 'minimal' template", () => {
      const template: InitTemplate = "minimal";
      assertEquals(template, "minimal");
    });
  });

  describe("InitOptions", () => {
    it("should allow empty options", () => {
      const options: InitOptions = {};
      assertExists(options);
    });

    it("should allow name option", () => {
      const options: InitOptions = {
        name: "my-project",
      };
      assertEquals(options.name, "my-project");
    });

    it("should allow template option", () => {
      const options: InitOptions = {
        template: "ai",
      };
      assertEquals(options.template, "ai");
    });

    it("should allow skipInstall option", () => {
      const options: InitOptions = {
        skipInstall: true,
      };
      assertEquals(options.skipInstall, true);
    });

    it("should allow skipEnvPrompt option", () => {
      const options: InitOptions = {
        skipEnvPrompt: true,
      };
      assertEquals(options.skipEnvPrompt, true);
    });

    it("should allow features array", () => {
      const options: InitOptions = {
        features: [],
      };
      assertEquals(options.features?.length, 0);
    });

    it("should allow integrations array", () => {
      const options: InitOptions = {
        integrations: [],
      };
      assertEquals(options.integrations?.length, 0);
    });

    it("should allow combined options", () => {
      const options: InitOptions = {
        name: "my-ai-app",
        template: "ai",
        skipInstall: false,
        skipEnvPrompt: false,
        features: [],
        integrations: [],
      };

      assertEquals(options.name, "my-ai-app");
      assertEquals(options.template, "ai");
      assertEquals(options.skipInstall, false);
      assertEquals(options.skipEnvPrompt, false);
      assertExists(options.features);
      assertExists(options.integrations);
    });
  });

  describe("Default behaviors", () => {
    it("should default template to undefined when not specified", () => {
      const options: InitOptions = {};
      assertEquals(options.template, undefined);
    });

    it("should default skipInstall to undefined when not specified", () => {
      const options: InitOptions = {};
      assertEquals(options.skipInstall, undefined);
    });

    it("should default skipEnvPrompt to undefined when not specified", () => {
      const options: InitOptions = {};
      assertEquals(options.skipEnvPrompt, undefined);
    });

    it("should default features to undefined when not specified", () => {
      const options: InitOptions = {};
      assertEquals(options.features, undefined);
    });

    it("should default integrations to undefined when not specified", () => {
      const options: InitOptions = {};
      assertEquals(options.integrations, undefined);
    });
  });
});
