import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { isOpenAPIMCPEnabled } from "./mcp-integration.ts";

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
});
