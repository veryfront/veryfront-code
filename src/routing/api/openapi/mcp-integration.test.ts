import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertStrictEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { isOpenAPIMCPEnabled, registerOpenAPIMCP } from "./mcp-integration.ts";
import { clearMCPRegistry, getMCPRegistry, registerTool } from "#veryfront/mcp";
import { generateMCPToolsFromSpec } from "./mcp-tools.ts";
import type { OpenAPISpec } from "./types.ts";

describe("routing/api/openapi/mcp-integration", () => {
  describe("isOpenAPIMCPEnabled()", () => {
    it("should return true when no config is provided", () => {
      assertEquals(isOpenAPIMCPEnabled(), true);
    });

    it("should return true when config is undefined", () => {
      assertEquals(isOpenAPIMCPEnabled(undefined), true);
    });

    it("should return true when openapi is not configured", () => {
      assertEquals(isOpenAPIMCPEnabled({}), true);
    });

    it("should return false when openapi.enabled is false", () => {
      assertEquals(isOpenAPIMCPEnabled({ openapi: { enabled: false } }), false);
    });

    it("should return true when openapi.enabled is true with no mcp config", () => {
      assertEquals(isOpenAPIMCPEnabled({ openapi: { enabled: true } }), true);
    });

    it("should return true when mcp.resource is true", () => {
      assertEquals(
        isOpenAPIMCPEnabled({
          openapi: { mcp: { resource: true, tools: false } },
        }),
        true,
      );
    });

    it("should return true when mcp.tools is true", () => {
      assertEquals(
        isOpenAPIMCPEnabled({
          openapi: { mcp: { resource: false, tools: true } },
        }),
        true,
      );
    });

    it("should return false when both mcp.resource and mcp.tools are false", () => {
      assertEquals(
        isOpenAPIMCPEnabled({
          openapi: { mcp: { resource: false, tools: false } },
        }),
        false,
      );
    });

    it("should return true when mcp config is empty object", () => {
      assertEquals(isOpenAPIMCPEnabled({ openapi: { mcp: {} } }), true);
    });

    it("should return true when only resource is set to true", () => {
      assertEquals(
        isOpenAPIMCPEnabled({ openapi: { mcp: { resource: true } } }),
        true,
      );
    });

    it("should return true when only tools is set to true", () => {
      assertEquals(
        isOpenAPIMCPEnabled({ openapi: { mcp: { tools: true } } }),
        true,
      );
    });
  });

  it("rolls back every generated tool when a later registration conflicts", async () => {
    clearMCPRegistry();
    const existingSpec: OpenAPISpec = {
      openapi: "3.1.0",
      info: { title: "Existing", version: "1.0.0" },
      paths: {
        "/second": {
          get: {
            operationId: "second",
            summary: "Existing second tool",
            responses: { "200": { description: "OK" } },
          },
        },
      },
    };
    const incomingSpec: OpenAPISpec = {
      openapi: "3.1.0",
      info: { title: "Incoming", version: "1.0.0" },
      paths: {
        "/first": {
          get: {
            operationId: "first",
            responses: { "200": { description: "OK" } },
          },
        },
        "/second": {
          get: {
            operationId: "second",
            summary: "Conflicting second tool",
            responses: { "200": { description: "OK" } },
          },
        },
      },
    };
    const [existing] = generateMCPToolsFromSpec(existingSpec, {
      baseUrl: "https://api.example.com",
    });
    registerTool(existing!.id, existing!);

    try {
      const result = await registerOpenAPIMCP(
        () => Promise.resolve(incomingSpec),
        {
          baseUrl: "https://api.example.com",
          resource: false,
        },
      );
      const registry = getMCPRegistry();

      assertEquals(result, { toolIds: [] });
      assertEquals(registry.tools.has("api:first"), false);
      assertStrictEquals(registry.tools.get("api:second"), existing);
    } finally {
      clearMCPRegistry();
    }
  });
});
