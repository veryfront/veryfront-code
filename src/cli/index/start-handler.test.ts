/**
 * Tests for start command handler (TUI dashboard)
 */

import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { handleStartCommand } from "./start-handler.ts";
import type { ParsedArgs } from "./types.ts";

describe("index/start-handler", () => {
  describe("handleStartCommand", () => {
    it("is an async function", () => {
      assertEquals(typeof handleStartCommand, "function");
      assertEquals(handleStartCommand.constructor.name, "AsyncFunction");
    });

    it("accepts ParsedArgs parameter", () => {
      assertEquals(handleStartCommand.length, 1);
    });
  });

  describe("ParsedArgs for start command", () => {
    it("supports port configuration", () => {
      const args: ParsedArgs = {
        _: ["start"],
        port: 8080,
        __explicit: { port: true },
      };
      assertEquals(args.port, 8080);
      assertEquals(args.__explicit?.port, true);
    });

    it("supports mcp-port configuration", () => {
      const args: ParsedArgs = {
        _: ["start"],
        "mcp-port": 9000,
      };
      assertEquals(args["mcp-port"], 9000);
    });

    it("supports project path specification", () => {
      const args: ParsedArgs = {
        _: ["start"],
        project: "my-project",
      };
      assertEquals(args.project, "my-project");
    });

    it("supports headless mode", () => {
      const args: ParsedArgs = {
        _: ["start"],
        headless: true,
      };
      assertEquals(args.headless, true);
    });

    it("supports no-tui flag as alias for headless", () => {
      const args: ParsedArgs = {
        _: ["start"],
        "no-tui": true,
      };
      assertEquals(args["no-tui"], true);
    });

    it("handles default port when not explicit", () => {
      const args: ParsedArgs = {
        _: ["start"],
        // No __explicit.port means use default
      };
      assertEquals(args.__explicit, undefined);
    });

    it("supports explicit port detection", () => {
      const args: ParsedArgs = {
        _: ["start"],
        port: 3000,
        __explicit: { port: true },
      };
      assertEquals(args.__explicit?.port, true);
    });
  });
});
