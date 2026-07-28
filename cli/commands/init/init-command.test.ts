import "#veryfront/schemas/_test-setup.ts";
/**
 * Init Command Tests
 *
 * Tests the init command types and options validation.
 */

import { assertEquals, assertExists } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { exists, makeTempDir, remove } from "#veryfront/testing/deno-compat.ts";
import { cwd } from "veryfront/platform";
import { join } from "veryfront/platform/path";
import { initCommand } from "./init-command.ts";
import type { InitOptions, InitTemplate } from "./types.ts";

describe("InitCommand Types", () => {
  describe("InitTemplate", () => {
    const templates: InitTemplate[] = [
      "ai-agent",
      "docs-agent",
      "multi-agent-system",
      "agentic-workflow",
      "coding-agent",
      "saas-starter",
      "minimal",
    ];

    for (const template of templates) {
      it(`should support '${template}' template`, () => {
        assertEquals(template, template);
      });
    }
  });

  describe("InitOptions", () => {
    it("creates a named project beneath parentDir", async () => {
      const parentDir = await makeTempDir({ prefix: "veryfront-init-parent-" });
      const name = `parent-target-${crypto.randomUUID()}`;
      const cwdTarget = join(cwd(), name);

      try {
        await initCommand({
          name,
          parentDir,
          template: "minimal",
          skipInstall: true,
          skipEnvPrompt: true,
          quiet: true,
        });

        assertEquals(await exists(join(parentDir, name, "app")), true);
        assertEquals(await exists(cwdTarget), false);
      } finally {
        await remove(parentDir, { recursive: true }).catch(() => {});
        await remove(cwdTarget, { recursive: true }).catch(() => {});
      }
    });

    it("should allow empty options", () => {
      const options: InitOptions = {};
      assertExists(options);
    });

    it("should allow name option", () => {
      const options: InitOptions = { name: "my-project" };
      assertEquals(options.name, "my-project");
    });

    it("should allow template option", () => {
      const options: InitOptions = { template: "ai-agent" };
      assertEquals(options.template, "ai-agent");
    });

    it("should allow skipInstall option", () => {
      const options: InitOptions = { skipInstall: true };
      assertEquals(options.skipInstall, true);
    });

    it("should allow skipEnvPrompt option", () => {
      const options: InitOptions = { skipEnvPrompt: true };
      assertEquals(options.skipEnvPrompt, true);
    });

    it("should allow features array", () => {
      const options: InitOptions = { features: [] };
      assertEquals(options.features?.length, 0);
    });

    it("should allow integrations array", () => {
      const options: InitOptions = { integrations: [] };
      assertEquals(options.integrations?.length, 0);
    });

    it("should allow combined options", () => {
      const options: InitOptions = {
        name: "my-ai-app",
        template: "ai-agent",
        skipInstall: false,
        skipEnvPrompt: false,
        features: [],
        integrations: [],
      };

      assertEquals(options.name, "my-ai-app");
      assertEquals(options.template, "ai-agent");
      assertEquals(options.skipInstall, false);
      assertEquals(options.skipEnvPrompt, false);
      assertExists(options.features);
      assertExists(options.integrations);
    });

    it("should allow runtime option", () => {
      const options: InitOptions = { runtime: "deno" };
      assertEquals(options.runtime, "deno");
    });

    it("should accept all three runtime values", () => {
      const node: InitOptions = { runtime: "node" };
      const bun: InitOptions = { runtime: "bun" };
      const deno: InitOptions = { runtime: "deno" };
      assertEquals(node.runtime, "node");
      assertEquals(bun.runtime, "bun");
      assertEquals(deno.runtime, "deno");
    });
  });

  describe("Default behaviors", () => {
    const options: InitOptions = {};

    it("should default template to undefined when not specified", () => {
      assertEquals(options.template, undefined);
    });

    it("should default skipInstall to undefined when not specified", () => {
      assertEquals(options.skipInstall, undefined);
    });

    it("should default skipEnvPrompt to undefined when not specified", () => {
      assertEquals(options.skipEnvPrompt, undefined);
    });

    it("should default features to undefined when not specified", () => {
      assertEquals(options.features, undefined);
    });

    it("should default integrations to undefined when not specified", () => {
      assertEquals(options.integrations, undefined);
    });

    it("should default runtime to undefined when not specified", () => {
      assertEquals(options.runtime, undefined);
    });
  });
});
