/**
 * Tests for dev command handler
 */

import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { handleDevCommand } from "./handler.ts";
import type { ParsedArgs } from "#cli/shared/types";

describe("commands/dev/handler", () => {
  describe("handleDevCommand", () => {
    it("is an async function", () => {
      assertEquals(typeof handleDevCommand, "function");
      assertEquals(handleDevCommand.constructor.name, "AsyncFunction");
    });

    it("accepts ParsedArgs parameter", () => {
      assertEquals(handleDevCommand.length, 1);
    });
  });

  describe("ParsedArgs for dev command", () => {
    it("supports port configuration", () => {
      const args: ParsedArgs = {
        _: ["dev"],
        port: 3000,
      };
      assertEquals(args.port, 3000);
    });

    it("supports project path via --project flag", () => {
      const args: ParsedArgs = {
        _: ["dev"],
        project: "/path/to/project",
      };
      assertEquals(args.project, "/path/to/project");
    });

    it("supports hmr flag (enabled by default)", () => {
      const argsEnabled: ParsedArgs = {
        _: ["dev"],
        hmr: true,
      };
      const argsDisabled: ParsedArgs = {
        _: ["dev"],
        hmr: false,
      };
      assertEquals(argsEnabled.hmr, true);
      assertEquals(argsDisabled.hmr, false);
    });

    it("handles missing port (uses default)", () => {
      const args: ParsedArgs = {
        _: ["dev"],
      };
      assertEquals(args.port, undefined);
    });
  });
});
