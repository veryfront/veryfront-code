import { assertEquals, assertThrows } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  assertAnthropicMcpRequestContract,
  normalizeAnthropicMcpServers,
} from "./anthropic-mcp-request.ts";

function captureThrownError(fn: () => unknown, expectedType?: typeof Error): Error {
  try {
    fn();
  } catch (error) {
    if (!(error instanceof Error)) throw error;
    const actualName = error.name;
    if (expectedType && !(error instanceof expectedType)) {
      throw new Error(`Expected ${expectedType.name}, received ${actualName}`);
    }
    return error;
  }
  throw new Error("Expected function to throw");
}

describe("ext-llm-anthropic/anthropic-mcp-request", () => {
  it("translates documented MCP server options into current server and toolset objects", () => {
    const normalized = normalizeAnthropicMcpServers([{
      type: "url",
      url: "https://mcp.example.test/sse",
      name: "calendar",
      authorizationToken: "opaque-token",
      toolConfiguration: {
        enabled: true,
        allowedTools: ["search_events", "create_event"],
      },
    }, {
      type: "url",
      url: "https://mcp.example.test/files",
      name: "files",
    }]);

    assertEquals(normalized?.servers, [{
      type: "url",
      url: "https://mcp.example.test/sse",
      name: "calendar",
      authorization_token: "opaque-token",
    }, {
      type: "url",
      url: "https://mcp.example.test/files",
      name: "files",
    }]);
    assertEquals(normalized?.defaultToolsets, [{
      type: "mcp_toolset",
      mcp_server_name: "calendar",
      default_config: { enabled: false },
      configs: {
        search_events: { enabled: true },
        create_event: { enabled: true },
      },
    }, {
      type: "mcp_toolset",
      mcp_server_name: "files",
    }]);
    assertEquals(
      normalized?.legacyConfiguredServerNames.has("calendar"),
      true,
    );
    assertEquals(normalized?.legacyConfiguredServerNames.has("files"), false);
  });

  it("accepts one spelling of each supported camelCase or snake_case input field", () => {
    const normalized = normalizeAnthropicMcpServers([{
      type: "url",
      url: "https://mcp.example.test",
      name: "docs",
      authorization_token: "token",
      tool_configuration: {
        enabled: false,
        allowed_tools: [],
      },
    }]);

    assertEquals(normalized?.servers, [{
      type: "url",
      url: "https://mcp.example.test",
      name: "docs",
      authorization_token: "token",
    }]);
    assertEquals(normalized?.defaultToolsets, [{
      type: "mcp_toolset",
      mcp_server_name: "docs",
      default_config: { enabled: false },
    }]);
  });

  it("fails closed on malformed or ambiguous convenience input without exposing values", () => {
    const privateValue = "PRIVATE_MCP_CREDENTIAL";
    const invalidInputs: unknown[] = [
      "not-an-array",
      [null],
      [{ type: "stdio", url: "https://mcp.example.test", name: "docs" }],
      [{ type: "url", url: "http://mcp.example.test", name: "docs" }],
      [{ type: "url", url: "https://mcp.example.test", name: "" }],
      [{
        type: "url",
        url: "https://mcp.example.test",
        name: "docs",
        authorizationToken: privateValue,
        authorization_token: privateValue,
      }],
      [{
        type: "url",
        url: "https://mcp.example.test",
        name: "docs",
        authorizationToken: "",
      }],
      [{
        type: "url",
        url: "https://mcp.example.test",
        name: "docs",
        secret: privateValue,
      }],
      [{
        type: "url",
        url: "https://mcp.example.test",
        name: "docs",
        toolConfiguration: { enabled: "yes" },
      }],
      [{
        type: "url",
        url: "https://mcp.example.test",
        name: "docs",
        toolConfiguration: {
          enabled: false,
          allowedTools: ["search"],
        },
      }],
      [{
        type: "url",
        url: "https://mcp.example.test",
        name: "docs",
        toolConfiguration: {
          allowedTools: ["search", "search"],
        },
      }],
      [
        { type: "url", url: "https://one.example.test", name: "duplicate" },
        { type: "url", url: "https://two.example.test", name: "duplicate" },
      ],
    ];

    for (const invalidInput of invalidInputs) {
      const error = captureThrownError(
        () => normalizeAnthropicMcpServers(invalidInput),
        TypeError,
      );
      assertEquals(error.message.includes(privateValue), false);
    }
  });

  it("validates the exact current MCP request identity contract", () => {
    assertEquals(
      assertAnthropicMcpRequestContract({
        mcp_servers: [{
          type: "url",
          url: "https://mcp.example.test",
          name: "docs",
          authorization_token: "opaque-token",
        }],
        tools: [{
          type: "mcp_toolset",
          mcp_server_name: "docs",
          default_config: { enabled: false, defer_loading: true },
          configs: {
            search: { enabled: true, defer_loading: false },
          },
          cache_control: { type: "ephemeral", ttl: "1h" },
        }],
      }),
      true,
    );
    assertEquals(assertAnthropicMcpRequestContract({ tools: [] }), false);
    assertEquals(
      assertAnthropicMcpRequestContract({ mcp_servers: [], tools: [] }),
      false,
    );
  });

  it("rejects dangling, duplicate, missing, and malformed MCP toolsets", () => {
    const server = {
      type: "url",
      url: "https://mcp.example.test",
      name: "docs",
    };
    const validToolset = {
      type: "mcp_toolset",
      mcp_server_name: "docs",
    };
    const invalidBodies: Array<Record<string, unknown>> = [
      { tools: [validToolset] },
      { mcp_servers: [server], tools: [] },
      { mcp_servers: [server], tools: [validToolset, validToolset] },
      {
        mcp_servers: [server],
        tools: [{ type: "mcp_toolset", mcp_server_name: "other" }],
      },
      {
        mcp_servers: [{ ...server, tool_configuration: { enabled: true } }],
        tools: [validToolset],
      },
      {
        mcp_servers: [server],
        tools: [{ ...validToolset, name: "not-a-wire-field" }],
      },
      {
        mcp_servers: [server],
        tools: [{ ...validToolset, default_config: { enabled: "yes" } }],
      },
      {
        mcp_servers: [server],
        tools: [{ ...validToolset, configs: { search: { unknown: true } } }],
      },
      {
        mcp_servers: [server],
        tools: [{ ...validToolset, cache_control: { type: "forever" } }],
      },
    ];

    for (const body of invalidBodies) {
      assertThrows(() => assertAnthropicMcpRequestContract(body), TypeError);
    }
  });
});
