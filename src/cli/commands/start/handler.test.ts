import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { handleStartCommand } from "./handler.ts";
import type { ParsedArgs } from "../../shared/types.ts";

const DEFAULT_START_PORT = 8080;
const DEFAULT_MCP_PORT = 9999;

/**
 * Mirrors the start handler's extraction logic for testing.
 */
function extractStartArgs(args: ParsedArgs) {
  const hasExplicitPort = args.__explicit?.port === true;
  const port = hasExplicitPort && typeof args.port === "number" ? args.port : DEFAULT_START_PORT;
  const mcpPort = typeof args["mcp-port"] === "number" ? args["mcp-port"] : DEFAULT_MCP_PORT;
  const projectPath = args.project ? String(args.project) : null;
  const headless = Boolean(args.headless || args["no-tui"]);

  return { port, mcpPort, projectPath, headless };
}

describe("commands/start/handler", () => {
  describe("handleStartCommand", () => {
    it("is exported as a function", () => {
      assertEquals(typeof handleStartCommand, "function");
    });

    it("is an async function", () => {
      assertEquals(handleStartCommand.constructor.name, "AsyncFunction");
    });

    it("accepts a single ParsedArgs parameter", () => {
      assertEquals(handleStartCommand.length, 1);
    });
  });

  describe("port parsing via DEFAULT_START_PORT (8080)", () => {
    it("uses default port 8080 when __explicit.port is not set", () => {
      const result = extractStartArgs({ _: ["start"] });
      assertEquals(result.port, DEFAULT_START_PORT);
    });

    it("uses default port 8080 even when port value is present but not explicit", () => {
      const result = extractStartArgs({ _: ["start"], port: 3000 });
      assertEquals(result.port, DEFAULT_START_PORT);
    });

    it("uses explicit port when __explicit.port is true", () => {
      const result = extractStartArgs({
        _: ["start"],
        port: 4000,
        __explicit: { port: true },
      });
      assertEquals(result.port, 4000);
    });
  });

  describe("mcp-port parsing via DEFAULT_MCP_PORT (9999)", () => {
    it("uses default mcp port 9999 when not specified", () => {
      const result = extractStartArgs({ _: ["start"] });
      assertEquals(result.mcpPort, DEFAULT_MCP_PORT);
    });

    it("uses explicit mcp-port when provided as number", () => {
      const result = extractStartArgs({ _: ["start"], "mcp-port": 7000 });
      assertEquals(result.mcpPort, 7000);
    });

    it("uses default mcp port when value is not a number", () => {
      const result = extractStartArgs({ _: ["start"], "mcp-port": "invalid" });
      assertEquals(result.mcpPort, DEFAULT_MCP_PORT);
    });
  });

  describe("project path extraction", () => {
    it("extracts project path from --project flag", () => {
      const result = extractStartArgs({ _: ["start"], project: "my-project" });
      assertEquals(result.projectPath, "my-project");
    });

    it("returns null when project is not specified", () => {
      const result = extractStartArgs({ _: ["start"] });
      assertEquals(result.projectPath, null);
    });

    it("converts project to string", () => {
      const result = extractStartArgs({ _: ["start"], project: "/absolute/path/to/project" });
      assertEquals(result.projectPath, "/absolute/path/to/project");
    });
  });

  describe("headless flag extraction", () => {
    it("is false when neither --headless nor --no-tui is set", () => {
      const result = extractStartArgs({ _: ["start"] });
      assertEquals(result.headless, false);
    });

    it("is true when --headless is set", () => {
      const result = extractStartArgs({ _: ["start"], headless: true });
      assertEquals(result.headless, true);
    });

    it("is true when --no-tui is set", () => {
      const result = extractStartArgs({ _: ["start"], "no-tui": true });
      assertEquals(result.headless, true);
    });

    it("is true when both --headless and --no-tui are set", () => {
      const result = extractStartArgs({ _: ["start"], headless: true, "no-tui": true });
      assertEquals(result.headless, true);
    });
  });
});
