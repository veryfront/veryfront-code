import "#veryfront/schemas/_test-setup.ts";
/**
 * Tests for dev command handler
 */

import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { createInMemoryHostRuntime } from "#veryfront/platform/compat/process.ts";
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
    function parseDevWithEnv(argv: string[], env: Record<string, string>) {
      return parseDevArgs(parseCliArgs(argv), createInMemoryHostRuntime({ env }));
    }

    it("uses PORT env var as the default port when --port is not passed", () => {
      const result = parseDevWithEnv(["dev"], { PORT: "3001" });
      assertEquals(result.success, true, "parsing succeeds");
      if (result.success) assertEquals(result.data.port, 3001, "PORT supplies the default");
    });

    it("--port flag wins over PORT env var", () => {
      const result = parseDevWithEnv(["dev", "--port", "4000"], { PORT: "3001" });
      assertEquals(result.success, true, "parsing succeeds");
      if (result.success) assertEquals(result.data.port, 4000, "the flag wins");
    });

    it("-p alias also wins over PORT env var", () => {
      const result = parseDevWithEnv(["dev", "-p", "4000"], { PORT: "3001" });
      assertEquals(result.success, true, "parsing succeeds");
      if (result.success) assertEquals(result.data.port, 4000, "the alias wins");
    });

    it("uses VERYFRONT_PORT when PORT is not set", () => {
      const result = parseDevWithEnv(["dev"], { VERYFRONT_PORT: "3001" });
      assertEquals(result.success, true, "parsing succeeds");
      if (result.success) assertEquals(result.data.port, 3001, "VERYFRONT_PORT is honoured");
    });

    it("PORT takes precedence over VERYFRONT_PORT", () => {
      const result = parseDevWithEnv(["dev"], { PORT: "4000", VERYFRONT_PORT: "3001" });
      assertEquals(result.success, true, "parsing succeeds");
      if (result.success) assertEquals(result.data.port, 4000, "PORT outranks VERYFRONT_PORT");
    });

    it("falls back to 3000 when PORT is not a valid integer", () => {
      const result = parseDevWithEnv(["dev"], { PORT: "not-a-port" });
      assertEquals(result.success, true, "parsing succeeds");
      if (result.success) assertEquals(result.data.port, 3000, "garbage falls back");
    });

    it("rejects PORT with trailing garbage (PORT=3001abc) — full string must be digits", () => {
      const result = parseDevWithEnv(["dev"], { PORT: "3001abc" });
      assertEquals(result.success, true, "parsing succeeds");
      if (result.success) assertEquals(result.data.port, 3000, "no prefix parsing");
    });

    it("rejects PORT=0 as outside the valid range (1-65535)", () => {
      const result = parseDevWithEnv(["dev"], { PORT: "0" });
      assertEquals(result.success, true, "parsing succeeds");
      if (result.success) assertEquals(result.data.port, 3000, "0 is out of range");
    });

    it("rejects PORT=65536 as outside the valid range (1-65535)", () => {
      const result = parseDevWithEnv(["dev"], { PORT: "65536" });
      assertEquals(result.success, true, "parsing succeeds");
      if (result.success) assertEquals(result.data.port, 3000, "65536 is out of range");
    });

    it("uses default 3000 when neither PORT nor VERYFRONT_PORT are set", () => {
      const result = parseDevWithEnv(["dev"], {});
      assertEquals(result.success, true, "parsing succeeds");
      if (result.success) assertEquals(result.data.port, 3000, "the hardcoded default applies");
    });
  });
});
