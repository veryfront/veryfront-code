import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  buildInitializeResult,
  MCP_SUPPORTED_VERSIONS,
  negotiateVersion,
  toParamsRecord,
} from "./jsonrpc.ts";

describe("cli/mcp/jsonrpc", () => {
  describe("toParamsRecord", () => {
    it("returns object params as-is", () => {
      const params = { foo: "bar" };
      assertEquals(toParamsRecord(params), { foo: "bar" });
    });

    it("returns empty record for null", () => {
      assertEquals(toParamsRecord(null), {});
    });

    it("returns empty record for undefined", () => {
      assertEquals(toParamsRecord(undefined), {});
    });

    it("returns empty record for array params", () => {
      assertEquals(toParamsRecord([1, 2, 3]), {});
    });

    it("returns empty record for primitive", () => {
      assertEquals(toParamsRecord("string"), {});
      assertEquals(toParamsRecord(42), {});
      assertEquals(toParamsRecord(true), {});
    });
  });

  describe("negotiateVersion", () => {
    it("echoes supported version 2025-11-25", () => {
      assertEquals(negotiateVersion({ protocolVersion: "2025-11-25" }), "2025-11-25");
    });

    it("echoes supported version 2024-11-05", () => {
      assertEquals(negotiateVersion({ protocolVersion: "2024-11-05" }), "2024-11-05");
    });

    it("falls back to newest for unknown version", () => {
      assertEquals(negotiateVersion({ protocolVersion: "1999-01-01" }), MCP_SUPPORTED_VERSIONS[0]);
    });

    it("falls back to newest when no version provided", () => {
      assertEquals(negotiateVersion({}), MCP_SUPPORTED_VERSIONS[0]);
    });

    it("falls back to newest for null params", () => {
      assertEquals(negotiateVersion(null), MCP_SUPPORTED_VERSIONS[0]);
    });

    it("falls back to newest for undefined params", () => {
      assertEquals(negotiateVersion(undefined), MCP_SUPPORTED_VERSIONS[0]);
    });

    it("falls back to newest when protocolVersion is not a string", () => {
      assertEquals(negotiateVersion({ protocolVersion: 123 }), MCP_SUPPORTED_VERSIONS[0]);
    });
  });

  describe("buildInitializeResult", () => {
    const serverInfo = {
      name: "test-server",
      title: "Test MCP Server",
      version: "1.0.0",
      description: "A test server",
    };
    const instructions = "Use this for testing.";

    it("includes negotiated protocol version", () => {
      const result = buildInitializeResult(
        { protocolVersion: "2024-11-05" },
        serverInfo,
        instructions,
      );
      assertEquals(result.protocolVersion, "2024-11-05");
    });

    it("includes serverInfo", () => {
      const result = buildInitializeResult({}, serverInfo, instructions);
      const info = result.serverInfo as Record<string, unknown>;
      assertEquals(info.name, "test-server");
      assertEquals(info.title, "Test MCP Server");
      assertEquals(info.version, "1.0.0");
      assertEquals(info.description, "A test server");
    });

    it("includes instructions", () => {
      const result = buildInitializeResult({}, serverInfo, instructions);
      assertEquals(result.instructions, "Use this for testing.");
    });

    it("includes listChanged capabilities", () => {
      const result = buildInitializeResult({}, serverInfo, instructions);
      const caps = result.capabilities as Record<string, Record<string, unknown>>;
      assertEquals(caps.tools.listChanged, true);
      assertEquals(caps.resources.listChanged, true);
      assertEquals(caps.prompts.listChanged, true);
    });

    it("falls back to newest version for unknown version", () => {
      const result = buildInitializeResult(
        { protocolVersion: "9999-12-31" },
        serverInfo,
        instructions,
      );
      assertEquals(result.protocolVersion, MCP_SUPPORTED_VERSIONS[0]);
    });
  });

  describe("MCP_SUPPORTED_VERSIONS", () => {
    it("has 2025-11-25 as the newest version", () => {
      assertEquals(MCP_SUPPORTED_VERSIONS[0], "2025-11-25");
    });

    it("includes 2024-11-05 for backward compatibility", () => {
      assertEquals(MCP_SUPPORTED_VERSIONS.includes("2024-11-05"), true);
    });

    it("contains at least 2 versions", () => {
      assertEquals(MCP_SUPPORTED_VERSIONS.length >= 2, true);
    });
  });
});
