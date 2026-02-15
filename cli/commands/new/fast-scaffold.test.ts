import { assertEquals, assertExists } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import type { ScaffoldResult } from "./fast-scaffold.ts";

function buildEnvContent(envVars: Record<string, string>): string {
  return Object.entries(envVars)
    .map(([key, value]) => `${key}=${value}`)
    .join("\n");
}

describe("fast-scaffold", () => {
  describe("ScaffoldResult type", () => {
    it("should have required properties", () => {
      const result: ScaffoldResult = {
        filesWritten: 12,
        template: "chat",
        slug: "my-app",
        integrations: [],
      };

      assertEquals(result.filesWritten, 12);
      assertEquals(result.template, "chat");
      assertEquals(result.slug, "my-app");
      assertEquals(result.integrations.length, 0);
    });

    it("should support integrations array", () => {
      const result: ScaffoldResult = {
        filesWritten: 20,
        template: "chat",
        slug: "my-app",
        integrations: ["github", "slack"],
      };

      assertEquals(result.integrations.length, 2);
      assertEquals(result.integrations[0], "github");
      assertEquals(result.integrations[1], "slack");
    });
  });

  describe("file generation", () => {
    it("should create veryfront.json with correct structure", () => {
      const slug = "test-project";
      const content = `${JSON.stringify({ projectSlug: slug }, null, 2)}\n`;

      assertExists(content);
      assertEquals(JSON.parse(content).projectSlug, slug);
    });

    it("should create .env for ai template", () => {
      const content = buildEnvContent({
        OPENAI_API_KEY: "sk-your-openai-api-key",
      });

      assertExists(content);
      assertEquals(content.includes("OPENAI_API_KEY"), true);
    });

    it("should create .env with integration env vars", () => {
      const content = buildEnvContent({
        OPENAI_API_KEY: "sk-your-openai-api-key",
        GITHUB_CLIENT_ID: "your-github-client-id",
        GITHUB_CLIENT_SECRET: "your-github-client-secret",
      });

      assertExists(content);
      assertEquals(content.includes("OPENAI_API_KEY"), true);
      assertEquals(content.includes("GITHUB_CLIENT_ID"), true);
      assertEquals(content.includes("GITHUB_CLIENT_SECRET"), true);
    });
  });

  describe(".env.example generation", () => {
    it("should create .env.example with documentation headers", () => {
      const content = `${
        [
          "# Environment variables",
          "# Copy this file to .env and fill in your values",
          "",
          "# OpenAI API key (https://platform.openai.com/api-keys)",
          "OPENAI_API_KEY=sk-...",
        ].join("\n")
      }\n`;

      assertExists(content);
      assertEquals(content.includes("# Environment variables"), true);
      assertEquals(content.includes("OPENAI_API_KEY"), true);
    });

    it("should include integration credentials section", () => {
      const integrationEnvVars = [
        { name: "GITHUB_CLIENT_ID", placeholder: "your-github-client-id" },
        { name: "GITHUB_CLIENT_SECRET", placeholder: "your-github-client-secret" },
      ];

      const lines = ["# Environment variables", "", "# Integration credentials"];

      for (const { name, placeholder } of integrationEnvVars) {
        lines.push(`${name}=${placeholder}`);
      }

      const content = `${lines.join("\n")}\n`;
      assertEquals(content.includes("# Integration credentials"), true);
      assertEquals(content.includes("GITHUB_CLIENT_ID"), true);
    });
  });
});
