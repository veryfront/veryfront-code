import "#veryfront/schemas/_test-setup.ts";
import { parseCliArgs } from "#cli/shared/args";
import type { ParsedArgs } from "#cli/shared/types";
import { DEFAULT_DEV_SERVER_PORT } from "#cli/utils";
import { createInMemoryHostRuntime } from "#veryfront/platform/compat/process.ts";
import { assertEquals, assertExists } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { handleServeCommand, parseServeArgs } from "./handler.ts";

function serveHost(env: Record<string, string>) {
  return createInMemoryHostRuntime({ env });
}

describe("commands/serve/handler", () => {
  describe("handleServeCommand", () => {
    it("is exported as a function", () => {
      assertExists(handleServeCommand);
      assertEquals(typeof handleServeCommand, "function");
    });

    it("is an async function", () => {
      assertEquals(handleServeCommand.constructor.name, "AsyncFunction");
    });

    it("accepts a single ParsedArgs parameter", () => {
      assertEquals(handleServeCommand.length, 1);
    });
  });

  describe("argument parsing patterns", () => {
    describe("mode resolution", () => {
      it("defaults mode to production when not specified", () => {
        const args: ParsedArgs = { _: ["serve"] };
        const mode = (args.mode || args.m || "production") as string;
        assertEquals(mode, "production");
      });

      it("uses --mode flag when provided", () => {
        const args: ParsedArgs = { _: ["serve"], mode: "proxy" };
        const mode = (args.mode || args.m || "production") as string;
        assertEquals(mode, "proxy");
      });

      it("uses -m shorthand when provided", () => {
        const args: ParsedArgs = { _: ["serve"], m: "combined" };
        const mode = (args.mode || args.m || "production") as string;
        assertEquals(mode, "combined");
      });

      it("prefers --mode over -m shorthand", () => {
        const args: ParsedArgs = { _: ["serve"], mode: "proxy", m: "combined" };
        const mode = (args.mode || args.m || "production") as string;
        assertEquals(mode, "proxy");
      });
    });

    describe("port handling", () => {
      it("uses deployment environment defaults when flags are omitted", () => {
        const parsed = parseServeArgs(
          { _: ["serve"] },
          serveHost({ PORT: "4321", BIND_ADDRESS: "0.0.0.0" }),
        );

        assertEquals(parsed.success, true, "parsing succeeds");
        assertExists(parsed.data);
        assertEquals(parsed.data.port, 4321, "PORT supplies the default port");
        assertEquals(parsed.data.hostname, "0.0.0.0", "BIND_ADDRESS supplies the hostname");
      });

      it("uses VERYFRONT_PORT when PORT is absent", () => {
        const parsed = parseServeArgs({ _: ["serve"] }, serveHost({ VERYFRONT_PORT: "4322" }));

        assertEquals(parsed.success, true, "parsing succeeds");
        assertExists(parsed.data);
        assertEquals(parsed.data.port, 4322, "VERYFRONT_PORT is honoured");
      });

      it("prefers PORT over VERYFRONT_PORT", () => {
        const parsed = parseServeArgs(
          { _: ["serve"] },
          serveHost({ PORT: "4321", VERYFRONT_PORT: "4322" }),
        );

        assertEquals(parsed.success, true, "parsing succeeds");
        assertExists(parsed.data);
        assertEquals(parsed.data.port, 4321, "PORT outranks VERYFRONT_PORT");
      });

      it("keeps explicit network flags ahead of environment defaults", () => {
        const parsed = parseServeArgs(
          {
            _: ["serve"],
            port: 8080,
            hostname: "127.0.0.1",
          },
          serveHost({ PORT: "4321", BIND_ADDRESS: "0.0.0.0" }),
        );

        assertEquals(parsed.success, true, "parsing succeeds");
        assertExists(parsed.data);
        assertEquals(parsed.data.port, 8080, "the port flag wins");
        assertEquals(parsed.data.hostname, "127.0.0.1", "the hostname flag wins");
      });

      it("keeps -p as a compatibility alias for --port", () => {
        const parsed = parseServeArgs(parseCliArgs(["serve", "-p", "8081"]), serveHost({}));

        assertEquals(parsed.success, true);
        assertExists(parsed.data);
        assertEquals(parsed.data.port, 8081);
      });

      it("rejects malformed and out-of-range environment ports", () => {
        for (const value of ["3001abc", "-1", "0", "65536", "", "1e3"]) {
          const parsed = parseServeArgs({ _: ["serve"] }, serveHost({ PORT: value }));

          assertEquals(parsed.success, true, `PORT=${JSON.stringify(value)} parses`);
          assertExists(parsed.data);
          assertEquals(
            parsed.data.port,
            DEFAULT_DEV_SERVER_PORT,
            `PORT=${JSON.stringify(value)} falls back`,
          );
        }
      });

      it("accepts trimmed environment ports at the valid boundaries", () => {
        for (const [value, expected] of [["1", 1], ["65535", 65535], [" 3001 ", 3001]] as const) {
          const parsed = parseServeArgs({ _: ["serve"] }, serveHost({ PORT: value }));

          assertEquals(parsed.success, true, `PORT=${JSON.stringify(value)} parses`);
          assertExists(parsed.data);
          assertEquals(parsed.data.port, expected, `PORT=${JSON.stringify(value)} is accepted`);
        }
      });

      it("falls through an invalid PORT to a valid VERYFRONT_PORT", () => {
        const parsed = parseServeArgs(
          { _: ["serve"] },
          serveHost({ PORT: "invalid", VERYFRONT_PORT: "4322" }),
        );

        assertEquals(parsed.success, true, "parsing succeeds");
        assertExists(parsed.data);
        assertEquals(parsed.data.port, 4322, "the valid lower-precedence port is used");
      });
    });

    describe("boolean flag extraction", () => {
      it("parses --binary without consuming the following positional", () => {
        const args = parseCliArgs(["serve", "--binary", "project"]);
        const parsed = parseServeArgs(args, serveHost({}));

        assertEquals(parsed.success, true);
        assertExists(parsed.data);
        assertEquals(parsed.data.binary, true);
        assertEquals(args._, ["serve", "project"]);
      });

      it("extracts split flag", () => {
        const args: ParsedArgs = { _: ["serve"], split: true };
        assertEquals(Boolean(args.split), true);
      });

      it("defaults split to false when not provided", () => {
        const args: ParsedArgs = { _: ["serve"] };
        assertEquals(Boolean(args.split), false);
      });

      it("extracts binary flag as boolean", () => {
        const args: ParsedArgs = { _: ["serve"], binary: true };
        assertEquals(Boolean(args.binary), true);
      });

      it("extracts debug flag", () => {
        const args: ParsedArgs = { _: ["serve"], debug: true };
        assertEquals(Boolean(args.debug), true);
      });

      it("defaults debug to false when not provided", () => {
        const args: ParsedArgs = { _: ["serve"] };
        assertEquals(Boolean(args.debug), false);
      });
    });

    describe("hostname/host/bindAddress resolution", () => {
      it("defaults production mode to all interfaces", () => {
        const parsed = parseServeArgs({ _: ["serve"] }, serveHost({}));

        assertEquals(parsed.success, true, "parsing succeeds");
        assertExists(parsed.data);
        assertEquals(parsed.data.hostname, "0.0.0.0", "no BIND_ADDRESS binds all interfaces");
      });

      it("ignores a blank BIND_ADDRESS", () => {
        const parsed = parseServeArgs({ _: ["serve"] }, serveHost({ BIND_ADDRESS: "   " }));

        assertEquals(parsed.success, true, "parsing succeeds");
        assertExists(parsed.data);
        assertEquals(parsed.data.hostname, "0.0.0.0", "whitespace falls back to all interfaces");
      });

      it("uses --hostname when provided", () => {
        const args: ParsedArgs = { _: ["serve"], hostname: "127.0.0.1" };
        const parsed = parseServeArgs(args, serveHost({}));
        assertEquals(parsed.success, true);
        assertExists(parsed.data);
        assertEquals(parsed.data.hostname, "127.0.0.1");
      });

      it("uses --host when provided", () => {
        const args: ParsedArgs = { _: ["serve"], host: "localhost" };
        const parsed = parseServeArgs(args, serveHost({}));
        assertEquals(parsed.success, true);
        assertExists(parsed.data);
        assertEquals(parsed.data.hostname, "localhost");
      });

      it("prefers --hostname over --host", () => {
        const args: ParsedArgs = {
          _: ["serve"],
          hostname: "10.0.0.1",
          host: "192.168.1.1",
        };
        const parsed = parseServeArgs(args, serveHost({}));
        assertEquals(parsed.success, true);
        assertExists(parsed.data);
        assertEquals(parsed.data.hostname, "10.0.0.1");
      });
    });

    describe("binary path resolution", () => {
      it("uses string value when binary is a path string", () => {
        const args: ParsedArgs = { _: ["serve"], binary: "/custom/path/veryfront" };
        const binaryPath = typeof args.binary === "string" ? args.binary : "./bin/veryfront";
        assertEquals(binaryPath, "/custom/path/veryfront");
      });

      it("falls back to default path when binary is boolean true", () => {
        const args: ParsedArgs = { _: ["serve"], binary: true };
        const binaryPath = typeof args.binary === "string" ? args.binary : "./bin/veryfront";
        assertEquals(binaryPath, "./bin/veryfront");
      });

      it("falls back to default path when binary is not provided", () => {
        const args: ParsedArgs = { _: ["serve"] };
        const binaryPath = typeof args.binary === "string" ? args.binary : "./bin/veryfront";
        assertEquals(binaryPath, "./bin/veryfront");
      });
    });
  });
});
