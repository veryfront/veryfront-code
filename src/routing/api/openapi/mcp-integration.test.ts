import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { beforeEach, describe, it } from "#veryfront/testing/bdd.ts";
import { clearMCPRegistry, getMCPRegistry } from "#veryfront/mcp";
import { isOpenAPIMCPEnabled, registerOpenAPIMCP } from "./mcp-integration.ts";
import type { OpenAPISpec } from "./types.ts";

function makeSpec(): OpenAPISpec {
  return {
    openapi: "3.1.0",
    info: { title: "Test API", version: "1.0.0" },
    paths: {
      "/users": {
        get: {
          operationId: "listUsers",
          responses: { "200": { description: "Successful response" } },
        },
      },
    },
  };
}

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

  describe("registerOpenAPIMCP()", () => {
    beforeEach(() => {
      clearMCPRegistry();
    });

    it("should register the spec resource and one tool per operation", async () => {
      const result = await registerOpenAPIMCP(
        () => Promise.resolve(makeSpec()),
        { baseUrl: "http://localhost:3000" },
      );

      assertEquals(result.resourceId, "openapi_spec", "the spec resource must be registered");
      assertEquals(result.toolIds, ["api:listUsers"], "every spec operation must become a tool");

      const registry = getMCPRegistry();
      assertEquals(
        registry.resources.has("openapi_spec"),
        true,
        "the spec resource must reach the MCP registry",
      );
      assertEquals(
        registry.tools.has("api:listUsers"),
        true,
        "the generated tool must reach the MCP registry",
      );
    });

    it("should skip the spec resource when resource is disabled", async () => {
      const result = await registerOpenAPIMCP(
        () => Promise.resolve(makeSpec()),
        { baseUrl: "http://localhost:3000", resource: false },
      );

      assertEquals(result.resourceId, undefined, "a disabled resource must not be reported");
      assertEquals(
        getMCPRegistry().resources.has("openapi_spec"),
        false,
        "a disabled resource must not reach the MCP registry",
      );
    });

    it("should skip tool generation when tools is disabled", async () => {
      let specCalls = 0;
      const result = await registerOpenAPIMCP(
        () => {
          specCalls++;
          return Promise.resolve(makeSpec());
        },
        { baseUrl: "http://localhost:3000", tools: false },
      );

      assertEquals(result.toolIds, [], "a disabled tools option must register no tools");
      assertEquals(specCalls, 0, "a disabled tools option must not even load the spec");
      assertEquals(
        getMCPRegistry().tools.size,
        0,
        "a disabled tools option must leave the MCP tool registry empty",
      );
    });

    it("should keep the spec resource when tool generation fails", async () => {
      const result = await registerOpenAPIMCP(
        () => Promise.reject(new Error("spec unavailable")),
        { baseUrl: "http://localhost:3000" },
      );

      assertEquals(
        result.resourceId,
        "openapi_spec",
        "a failing spec load must not undo the resource registration",
      );
      assertEquals(result.toolIds, [], "a failing spec load must yield no tools");
    });
  });
});
