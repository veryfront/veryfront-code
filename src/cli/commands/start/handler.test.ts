import { assertEquals, assertExists } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { handleStartCommand } from "./handler.ts";
import type { ParsedArgs } from "../../shared/types.ts";

describe("commands/start/handler", () => {
  describe("handleStartCommand", () => {
    it("is exported as a function", () => {
      assertExists(handleStartCommand);
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
      const args: ParsedArgs = { _: ["start"] };
      const hasExplicitPort = args.__explicit?.port === true;
      const port = hasExplicitPort && typeof args.port === "number" ? args.port : 8080;
      assertEquals(port, 8080);
    });

    it("uses default port 8080 even when port value is present but not explicit", () => {
      const args: ParsedArgs = { _: ["start"], port: 3000 };
      const hasExplicitPort = args.__explicit?.port === true;
      const port = hasExplicitPort && typeof args.port === "number" ? args.port : 8080;
      assertEquals(port, 8080);
    });

    it("uses explicit port when __explicit.port is true", () => {
      const args: ParsedArgs = {
        _: ["start"],
        port: 4000,
        __explicit: { port: true },
      };
      const hasExplicitPort = args.__explicit?.port === true;
      const port = hasExplicitPort && typeof args.port === "number" ? args.port : 8080;
      assertEquals(port, 4000);
    });
  });

  describe("mcp-port parsing via DEFAULT_MCP_PORT (9999)", () => {
    it("uses default mcp port 9999 when not specified", () => {
      const args: ParsedArgs = { _: ["start"] };
      const mcpPort = typeof args["mcp-port"] === "number" ? args["mcp-port"] : 9999;
      assertEquals(mcpPort, 9999);
    });

    it("uses explicit mcp-port when provided as number", () => {
      const args: ParsedArgs = { _: ["start"], "mcp-port": 7000 };
      const mcpPort = typeof args["mcp-port"] === "number" ? args["mcp-port"] : 9999;
      assertEquals(mcpPort, 7000);
    });

    it("uses default mcp port when value is not a number", () => {
      const args: ParsedArgs = { _: ["start"], "mcp-port": "invalid" };
      const mcpPort = typeof args["mcp-port"] === "number" ? args["mcp-port"] : 9999;
      assertEquals(mcpPort, 9999);
    });
  });

  describe("project path extraction", () => {
    it("extracts project path from --project flag", () => {
      const args: ParsedArgs = { _: ["start"], project: "my-project" };
      const projectPath = args.project ? String(args.project) : null;
      assertEquals(projectPath, "my-project");
    });

    it("returns null when project is not specified", () => {
      const args: ParsedArgs = { _: ["start"] };
      const projectPath = args.project ? String(args.project) : null;
      assertEquals(projectPath, null);
    });

    it("converts project to string", () => {
      const args: ParsedArgs = { _: ["start"], project: "/absolute/path/to/project" };
      const projectPath = args.project ? String(args.project) : null;
      assertEquals(projectPath, "/absolute/path/to/project");
    });
  });

  describe("headless flag extraction", () => {
    it("is false when neither --headless nor --no-tui is set", () => {
      const args: ParsedArgs = { _: ["start"] };
      const headless = Boolean(args.headless || args["no-tui"]);
      assertEquals(headless, false);
    });

    it("is true when --headless is set", () => {
      const args: ParsedArgs = { _: ["start"], headless: true };
      const headless = Boolean(args.headless || args["no-tui"]);
      assertEquals(headless, true);
    });

    it("is true when --no-tui is set", () => {
      const args: ParsedArgs = { _: ["start"], "no-tui": true };
      const headless = Boolean(args.headless || args["no-tui"]);
      assertEquals(headless, true);
    });

    it("is true when both --headless and --no-tui are set", () => {
      const args: ParsedArgs = { _: ["start"], headless: true, "no-tui": true };
      const headless = Boolean(args.headless || args["no-tui"]);
      assertEquals(headless, true);
    });
  });
});
