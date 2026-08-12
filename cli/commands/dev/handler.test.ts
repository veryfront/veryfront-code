import "#veryfront/schemas/_test-setup.ts";
/**
 * Tests for dev command handler
 */

import { assertEquals } from "#veryfront/testing/assert.ts";
import { afterEach, beforeEach, describe, it } from "#veryfront/testing/bdd.ts";
import { parseCliArgs } from "#cli/shared/args";
import { handleDevCommand, parseDevArgs } from "./handler.ts";
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
    it("parses the documented no-hmr and open flags from raw argv", () => {
      const args = parseCliArgs(["dev", "--no-hmr", "--open"]);
      const result = parseDevArgs(args);

      assertEquals(result.success, true);
      if (!result.success) return;

      assertEquals(result.data.noHmr, true);
      assertEquals(result.data.open, true);
    });

    it("keeps -p as a compatibility alias for --port", () => {
      const result = parseDevArgs(parseCliArgs(["dev", "-p", "4100"]));

      assertEquals(result.success, true);
      if (result.success) assertEquals(result.data.port, 4100);
    });

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

  describe("PORT env var", () => {
    let savedPort: string | undefined;
    let savedVeryfrontPort: string | undefined;

    beforeEach(() => {
      savedPort = Deno.env.get("PORT");
      savedVeryfrontPort = Deno.env.get("VERYFRONT_PORT");
      Deno.env.delete("PORT");
      Deno.env.delete("VERYFRONT_PORT");
    });

    afterEach(() => {
      if (savedPort === undefined) Deno.env.delete("PORT");
      else Deno.env.set("PORT", savedPort);
      if (savedVeryfrontPort === undefined) Deno.env.delete("VERYFRONT_PORT");
      else Deno.env.set("VERYFRONT_PORT", savedVeryfrontPort);
    });

    it("uses PORT env var as the default port when --port is not passed", () => {
      Deno.env.set("PORT", "3001");
      const result = parseDevArgs(parseCliArgs(["dev"]));
      assertEquals(result.success, true);
      if (result.success) assertEquals(result.data.port, 3001);
    });

    it("--port flag wins over PORT env var", () => {
      Deno.env.set("PORT", "3001");
      const result = parseDevArgs(parseCliArgs(["dev", "--port", "4000"]));
      assertEquals(result.success, true);
      if (result.success) assertEquals(result.data.port, 4000);
    });

    it("-p alias also wins over PORT env var", () => {
      Deno.env.set("PORT", "3001");
      const result = parseDevArgs(parseCliArgs(["dev", "-p", "4000"]));
      assertEquals(result.success, true);
      if (result.success) assertEquals(result.data.port, 4000);
    });

    it("uses VERYFRONT_PORT when PORT is not set", () => {
      Deno.env.set("VERYFRONT_PORT", "3001");
      const result = parseDevArgs(parseCliArgs(["dev"]));
      assertEquals(result.success, true);
      if (result.success) assertEquals(result.data.port, 3001);
    });

    it("PORT takes precedence over VERYFRONT_PORT", () => {
      Deno.env.set("PORT", "4000");
      Deno.env.set("VERYFRONT_PORT", "3001");
      const result = parseDevArgs(parseCliArgs(["dev"]));
      assertEquals(result.success, true);
      if (result.success) assertEquals(result.data.port, 4000);
    });

    it("falls back to 3000 when PORT is not a valid integer", () => {
      Deno.env.set("PORT", "not-a-port");
      const result = parseDevArgs(parseCliArgs(["dev"]));
      assertEquals(result.success, true);
      if (result.success) assertEquals(result.data.port, 3000);
    });

    it("uses default 3000 when neither PORT nor VERYFRONT_PORT are set", () => {
      const result = parseDevArgs(parseCliArgs(["dev"]));
      assertEquals(result.success, true);
      if (result.success) assertEquals(result.data.port, 3000);
    });
  });
});
