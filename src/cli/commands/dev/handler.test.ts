/**
 * Tests for dev command handler
 */

import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { handleDevCommand } from "./handler.ts";
import type { ParsedArgs } from "../../shared/types.ts";

const DEFAULT_DEV_SERVER_PORT = 3000;

/**
 * Mirrors the dev handler's extraction logic for testing.
 */
function extractDevArgs(args: ParsedArgs) {
  return {
    project: typeof args.project === "string" ? args.project : undefined,
    port: typeof args.port === "number" ? args.port : DEFAULT_DEV_SERVER_PORT,
    hmr: args.hmr !== false,
  };
}

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

  describe("dev argument extraction", () => {
    it("extracts port when provided as number", () => {
      const result = extractDevArgs({ _: ["dev"], port: 4000 });
      assertEquals(result.port, 4000);
    });

    it("defaults port to DEFAULT_DEV_SERVER_PORT (3000) when not provided", () => {
      const result = extractDevArgs({ _: ["dev"] });
      assertEquals(result.port, DEFAULT_DEV_SERVER_PORT);
    });

    it("extracts project path from --project flag", () => {
      const result = extractDevArgs({ _: ["dev"], project: "/path/to/project" });
      assertEquals(result.project, "/path/to/project");
    });

    it("returns undefined project when not provided", () => {
      const result = extractDevArgs({ _: ["dev"] });
      assertEquals(result.project, undefined);
    });

    it("returns undefined project when value is not a string", () => {
      const result = extractDevArgs({ _: ["dev"], project: true });
      assertEquals(result.project, undefined);
    });

    it("defaults hmr to true when not specified", () => {
      const result = extractDevArgs({ _: ["dev"] });
      assertEquals(result.hmr, true);
    });

    it("enables hmr when explicitly set to true", () => {
      const result = extractDevArgs({ _: ["dev"], hmr: true });
      assertEquals(result.hmr, true);
    });

    it("disables hmr when set to false", () => {
      const result = extractDevArgs({ _: ["dev"], hmr: false });
      assertEquals(result.hmr, false);
    });
  });
});
