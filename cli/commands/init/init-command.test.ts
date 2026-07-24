import "#veryfront/schemas/_test-setup.ts";
/**
 * Init Command Tests
 *
 * Tests the init command types and options validation.
 */

import { assertEquals, assertExists, assertRejects } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { exists, makeTempDir, remove } from "#veryfront/testing/deno-compat.ts";
import { cwd } from "veryfront/platform";
import { join } from "veryfront/platform/path";
import { initCommand } from "./init-command.ts";
import type { InitOptions, InitTemplate } from "./types.ts";
import { EXPERIMENTAL_INTEGRATIONS_ENV } from "../../../src/integrations/feature-flags.ts";

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

    it("generates a user-scoped integration status route", async () => {
      const parentDir = await makeTempDir({
        prefix: "veryfront-init-oauth-status-",
      });
      const name = `oauth-status-${crypto.randomUUID()}`;

      try {
        await initCommand({
          name,
          parentDir,
          template: "minimal",
          integrations: ["gmail"],
          skipInstall: true,
          skipEnvPrompt: true,
          quiet: true,
        });

        const route = await Deno.readTextFile(
          join(parentDir, name, "app/api/integrations/status/route.ts"),
        );
        assertEquals(route.includes("oauthTokenStore"), true);
        assertEquals(route.includes("requireUserIdFromRequest"), true);
        assertEquals(route.includes('"current-user"'), false);
        assertEquals(route.includes("tokenStore.isConnected"), false);
        assertEquals(route.includes('"Cache-Control": "no-store"'), true);
        assertEquals(route.includes("hasUsableOAuthTokens"), true);
        assertEquals(
          route.includes("token.expiresAt > now || hasRefreshToken"),
          true,
        );
      } finally {
        await remove(parentDir, { recursive: true }).catch(() => {});
      }
    });

    it("requires the complete selected Atlassian grant in shared connection status", async () => {
      const parentDir = await makeTempDir({
        prefix: "veryfront-init-atlassian-status-",
      });
      const name = `atlassian-status-${crypto.randomUUID()}`;

      try {
        await initCommand({
          name,
          parentDir,
          template: "minimal",
          integrations: ["confluence", "jira"],
          skipInstall: true,
          skipEnvPrompt: true,
          quiet: true,
        });

        const route = await Deno.readTextFile(
          join(parentDir, name, "app/api/integrations/status/route.ts"),
        );
        assertEquals(route.includes("satisfiesOAuthScopePolicy"), true);
        assertEquals(route.includes("requiredOAuthScopes"), true);
        assertEquals(route.includes("forbiddenOAuthScopes"), true);
        assertEquals(route.includes("resolveAtlassianCloudId"), true);
        assertEquals(route.includes("integration.atlassianService"), true);
        for (
          const scope of [
            "read:jira-work",
            "write:jira-work",
            "read:jira-user",
            "read:confluence-content.all",
            "write:confluence-content",
            "read:confluence-space.summary",
            "read:confluence-user",
            "search:confluence",
            "read:page:confluence",
            "write:page:confluence",
            "offline_access",
          ]
        ) {
          assertEquals(route.includes(JSON.stringify(scope)), true);
        }
      } finally {
        await remove(parentDir, { recursive: true }).catch(() => {});
      }
    });

    it("rejects stale scopes from an unselected Atlassian product", async () => {
      const parentDir = await makeTempDir({
        prefix: "veryfront-init-atlassian-contraction-",
      });
      const name = `atlassian-contraction-${crypto.randomUUID()}`;

      try {
        await initCommand({
          name,
          parentDir,
          template: "minimal",
          integrations: ["jira"],
          skipInstall: true,
          skipEnvPrompt: true,
          quiet: true,
        });

        const route = await Deno.readTextFile(
          join(parentDir, name, "app/api/integrations/status/route.ts"),
        );
        assertEquals(route.includes('atlassianService: "jira"'), true);
        assertEquals(
          route.includes('"read:confluence-content.all"'),
          true,
        );
        assertEquals(
          route.includes(
            "satisfiesOAuthScopePolicy(token.scope, requiredScopes, forbiddenScopes)",
          ),
          true,
        );
      } finally {
        await remove(parentDir, { recursive: true }).catch(() => {});
      }
    });

    it("generates environment-aware status without loading OAuth storage for API keys", async () => {
      const parentDir = await makeTempDir({
        prefix: "veryfront-init-api-key-status-",
      });
      const name = `api-key-status-${crypto.randomUUID()}`;
      Deno.env.set(EXPERIMENTAL_INTEGRATIONS_ENV, "stripe");

      try {
        await initCommand({
          name,
          parentDir,
          template: "minimal",
          integrations: ["stripe"],
          skipInstall: true,
          skipEnvPrompt: true,
          quiet: true,
        });

        const route = await Deno.readTextFile(
          join(parentDir, name, "app/api/integrations/status/route.ts"),
        );
        assertEquals(route.includes("oauthTokenStore"), false);
        assertEquals(route.includes("readEnvironmentVariable"), true);
        assertEquals(route.includes('authType: "api-key"'), true);
        assertEquals(route.includes('connectionMode: "environment"'), true);
        assertEquals(route.includes("configuration-required"), true);
        assertEquals(route.includes('"Cache-Control": "no-store"'), true);

        const page = await Deno.readTextFile(
          join(parentDir, name, "app/page.tsx"),
        );
        assertEquals(page.includes("connectUrl: string | null"), true);
        assertEquals(page.includes('service.connectUrl ?? "/setup"'), true);
      } finally {
        Deno.env.delete(EXPERIMENTAL_INTEGRATIONS_ENV);
        await remove(parentDir, { recursive: true }).catch(() => {});
      }
    });

    it("aborts invalid integration selection before creating the destination", async () => {
      const parentDir = await makeTempDir({
        prefix: "veryfront-init-invalid-integration-",
      });
      const name = `invalid-integration-${crypto.randomUUID()}`;

      try {
        await assertRejects(
          () =>
            initCommand({
              name,
              parentDir,
              template: "minimal",
              integrations: ["hubspot"],
              skipInstall: true,
              skipEnvPrompt: true,
              quiet: true,
            }),
          Error,
          "Invalid integrations specified",
        );
        assertEquals(await exists(join(parentDir, name)), false);
      } finally {
        await remove(parentDir, { recursive: true }).catch(() => {});
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
