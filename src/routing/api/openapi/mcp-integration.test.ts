import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { afterEach, describe, it } from "#veryfront/testing/bdd.ts";
import { isOpenAPIMCPEnabled, registerOpenAPIMCP } from "./mcp-integration.ts";
import { clearMCPRegistry, getMCPRegistry } from "#veryfront/mcp";
import type { OpenAPISpec } from "./types.ts";

describe("routing/api/openapi/mcp-integration", () => {
  afterEach(() => clearMCPRegistry());

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
    it("registers the resource and generated tools together", async () => {
      const spec: OpenAPISpec = {
        openapi: "3.1.0",
        info: { title: "API", version: "1.0.0" },
        paths: {
          "/api/health": {
            get: {
              operationId: "getHealth",
              responses: { "200": { description: "OK" } },
            },
          },
        },
      };

      const result = await registerOpenAPIMCP(() => Promise.resolve(spec), {
        baseUrl: "http://localhost:3000",
      });

      assertEquals(result, { resourceId: "openapi_spec", toolIds: ["api:getHealth"] });
      assertEquals(getMCPRegistry().resources.has("openapi_spec"), true);
      assertEquals(getMCPRegistry().tools.has("api:getHealth"), true);
    });

    it("does not leave a partially registered resource when spec generation fails", async () => {
      let message = "";
      try {
        await registerOpenAPIMCP(() => Promise.reject(new Error("spec failed")), {
          baseUrl: "http://localhost:3000",
        });
      } catch (error) {
        message = error instanceof Error ? error.message : String(error);
      }

      assertEquals(message, "spec failed");
      assertEquals(getMCPRegistry().resources.has("openapi_spec"), false);
      assertEquals(getMCPRegistry().tools.size, 0);
    });
  });
});
