import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  EnvVarSchema,
  IntegrationConfigSchema,
  IntegrationEndpointHistoricalSummaryFieldSchema,
  IntegrationEndpointResponseEnrichmentSchema,
  IntegrationEndpointSchema,
  IntegrationSetupGuideSchema,
  OAuthConfigSchema,
} from "./schema.ts";

function minimalTool() {
  return {
    id: "github__list_repos",
    name: "List repos",
    description: "List repositories",
    requiresWrite: false,
  };
}

describe("integration schemas", () => {
  it("rejects unknown connector and tool fields instead of silently stripping typos", () => {
    assertEquals(
      IntegrationConfigSchema.safeParse({
        name: "github",
        displayName: "GitHub",
        description: "GitHub connector",
        auth: { type: "oauth2" },
        tools: [{ ...minimalTool(), requires_write: false }],
      }).success,
      false,
    );
    assertEquals(
      IntegrationConfigSchema.safeParse({
        name: "github",
        displayName: "GitHub",
        description: "GitHub connector",
        auth: { type: "oauth2" },
        tools: [minimalTool()],
        display_name: "GitHub",
      }).success,
      false,
    );
  });

  it("bounds connector collections at the schema boundary", () => {
    assertEquals(
      IntegrationConfigSchema.safeParse({
        name: "github",
        displayName: "GitHub",
        description: "GitHub connector",
        auth: { type: "oauth2" },
        tools: Array.from({ length: 513 }, minimalTool),
      }).success,
      false,
    );
  });

  it("accepts only registry package names and version ranges for generated projects", () => {
    for (
      const npmDependencies of [
        { "../../private": "^1.0.0" },
        { "@missing-scope": "^1.0.0" },
        { package: "file:/private/package" },
        { package: "https://private.test/package.tgz" },
        { package: "git+ssh://private.test/package.git" },
      ]
    ) {
      assertEquals(
        IntegrationConfigSchema.safeParse({
          name: "github",
          displayName: "GitHub",
          description: "GitHub connector",
          auth: { type: "oauth2" },
          npmDependencies,
          tools: [minimalTool()],
        }).success,
        false,
      );
    }

    assertEquals(
      IntegrationConfigSchema.safeParse({
        name: "github",
        displayName: "GitHub",
        description: "GitHub connector",
        auth: { type: "oauth2" },
        npmDependencies: { "@scope/package": ">=1.2.3 <2.0.0 || ^3.0.0" },
        tools: [minimalTool()],
      }).success,
      true,
    );
  });

  it("bounds authentication metadata and dynamic endpoint keys", () => {
    const oversizedKey = "x".repeat(257);
    assertEquals(
      OAuthConfigSchema.safeParse({ type: "api-key", keyName: oversizedKey }).success,
      false,
    );
    assertEquals(
      OAuthConfigSchema.safeParse({
        type: "oauth2",
        additionalParams: { [oversizedKey]: "value" },
      }).success,
      false,
    );
    assertEquals(
      IntegrationEndpointSchema.safeParse({
        method: "GET",
        url: "https://example.test/items",
        params: {
          [oversizedKey]: {
            type: "string",
            in: "query",
            description: "Query value",
          },
        },
      }).success,
      false,
    );
  });

  it("rejects duplicate connector-local tool IDs", () => {
    assertEquals(
      IntegrationConfigSchema.safeParse({
        name: "github",
        displayName: "GitHub",
        description: "GitHub connector",
        auth: { type: "oauth2" },
        tools: [minimalTool(), minimalTool()],
      }).success,
      false,
    );
  });

  it("requires canonical connector-namespaced tool IDs", () => {
    for (const id of ["list_repos", "slack__list_repos", "github__ListRepos", "github__a__b"]) {
      assertEquals(
        IntegrationConfigSchema.safeParse({
          name: "github",
          displayName: "GitHub",
          description: "GitHub connector",
          auth: { type: "oauth2" },
          tools: [{ ...minimalTool(), id }],
        }).success,
        false,
      );
    }
  });

  it("rejects connector icon paths that can escape the connector directory", () => {
    assertEquals(
      IntegrationConfigSchema.safeParse({
        name: "github",
        displayName: "GitHub",
        icon: "../../private.svg",
        description: "GitHub connector",
        auth: { type: "oauth2" },
        tools: [minimalTool()],
      }).success,
      false,
    );
    assertEquals(
      IntegrationConfigSchema.safeParse({
        name: "github",
        displayName: "GitHub",
        description: "GitHub connector",
        auth: { type: "oauth2" },
        tools: [{ ...minimalTool(), file: "../../private.ts" }],
      }).success,
      false,
    );
  });

  it("requires positive integer response limits", () => {
    for (const maxItems of [-1, 0, 1.5]) {
      assertEquals(
        IntegrationEndpointResponseEnrichmentSchema.safeParse({
          type: "gmail-message-metadata",
          url: "https://example.test/messages/{id}",
          maxItems,
        }).success,
        false,
      );
    }
    for (const maxLength of [-1, 0, 1.5]) {
      assertEquals(
        IntegrationEndpointHistoricalSummaryFieldSchema.safeParse({
          name: "summary",
          maxLength,
        }).success,
        false,
      );
    }
  });

  it("enforces the single-field raw and passthrough body contract", () => {
    for (const bodyMode of ["raw", "passthrough"] as const) {
      assertEquals(
        IntegrationEndpointSchema.safeParse({
          method: "POST",
          url: "https://example.test/items",
          bodyMode,
          body: {
            first: { type: "string", description: "First" },
            second: { type: "string", description: "Second" },
          },
        }).success,
        false,
      );
    }
  });

  it("validates endpoint parameter placement and references", () => {
    assertEquals(
      IntegrationEndpointSchema.safeParse({
        method: "GET",
        url: "https://example.test/items",
        params: {
          itemId: {
            type: "string",
            in: "path",
            description: "Item ID",
          },
        },
      }).success,
      false,
    );
    assertEquals(
      IntegrationEndpointSchema.safeParse({
        method: "GET",
        url: "https://example.test/items/{itemId}",
      }).success,
      false,
    );
    assertEquals(
      IntegrationEndpointSchema.safeParse({
        method: "POST",
        url: "https://example.test/files",
        bodyMode: "form-data",
        body: {
          content: {
            type: "string",
            description: "Content",
            encoding: "base64",
            partFilenameField: "filename",
          },
        },
      }).success,
      false,
    );
    assertEquals(
      IntegrationEndpointSchema.safeParse({
        method: "POST",
        url: "https://example.test/files",
        body: {
          content: {
            type: "string",
            description: "Content",
            encoding: "base64",
            partFilenameField: "content",
          },
        },
      }).success,
      false,
    );
  });

  it("rejects non-HTTP provider and endpoint URLs", () => {
    assertEquals(
      OAuthConfigSchema.safeParse({
        type: "oauth2",
        authorizationUrl: "file:///private/authorization",
      }).success,
      false,
    );
    assertEquals(
      IntegrationEndpointSchema.safeParse({
        method: "GET",
        url: "javascript:alert(1)",
      }).success,
      false,
    );
    assertEquals(
      IntegrationEndpointSchema.safeParse({
        method: "GET",
        url: "{{oauth.raw.api_domain}}/items\nPRIVATE_HEADER: value",
      }).success,
      false,
    );
    assertEquals(
      IntegrationEndpointSchema.safeParse({
        method: "GET",
        url: "{{oauth.raw.api_domain}}/items",
      }).success,
      true,
    );
    assertEquals(
      EnvVarSchema.safeParse({
        name: "TOKEN",
        description: "API token",
        required: true,
        docsUrl: "javascript:alert(1)",
      }).success,
      false,
    );
    assertEquals(
      IntegrationSetupGuideSchema.safeParse({
        steps: [{
          title: "Open settings",
          description: "Configure the integration",
          url: "javascript:alert(1)",
        }],
      }).success,
      false,
    );
  });

  it("rejects unsafe callback paths and HTTP metadata", () => {
    for (
      const callbackPath of [
        "https://private.test/callback",
        "//private.test/callback",
        "/ok\nInjected: value",
        "/ok?next=/private",
      ]
    ) {
      assertEquals(
        OAuthConfigSchema.safeParse({ type: "oauth2", callbackPath }).success,
        false,
      );
    }
    for (const headerName of ["Bad Header", "Header\nInjected", "Header:Injected"]) {
      assertEquals(
        OAuthConfigSchema.safeParse({ type: "api-key", headerName }).success,
        false,
      );
      assertEquals(
        IntegrationEndpointSchema.safeParse({
          method: "GET",
          url: "https://example.test/items",
          params: {
            value: {
              type: "string",
              in: "header",
              description: "Header value",
              headerName,
            },
          },
        }).success,
        false,
      );
    }
  });

  it("requires defaults to be bounded JSON values matching their declared type", () => {
    for (const defaultValue of [new Date(), new Map([["key", "value"]]), "x".repeat(8_193)]) {
      assertEquals(
        IntegrationEndpointSchema.safeParse({
          method: "GET",
          url: "https://example.test/items",
          params: {
            options: {
              type: "object",
              in: "query",
              description: "Options",
              default: defaultValue,
            },
          },
        }).success,
        false,
      );
    }
    assertEquals(
      IntegrationEndpointSchema.safeParse({
        method: "POST",
        url: "https://example.test/items",
        body: {
          enabled: {
            type: "boolean",
            description: "Whether the item is enabled",
            default: "yes",
          },
        },
      }).success,
      false,
    );
  });
});
