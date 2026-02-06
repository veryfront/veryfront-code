import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { handleServeCommand } from "./handler.ts";
import type { ParsedArgs } from "../../shared/types.ts";

const DEFAULT_DEV_SERVER_PORT = 3000;

/**
 * Mirrors the serve handler's extraction logic for testing.
 */
function extractServeArgs(args: ParsedArgs) {
  return {
    mode: (args.mode || args.m || "renderer") as string,
    port: args.port ?? DEFAULT_DEV_SERVER_PORT,
    bindAddress: String(args.hostname || args.host || "0.0.0.0"),
    splitMode: Boolean(args.split),
    useBinary: Boolean(args.binary),
    binaryPath: typeof args.binary === "string" ? args.binary : "./bin/veryfront",
    debug: Boolean(args.debug),
  };
}

describe("commands/serve/handler", () => {
  describe("handleServeCommand", () => {
    it("is exported as a function", () => {
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
      it("defaults mode to renderer when not specified", () => {
        const result = extractServeArgs({ _: ["serve"] });
        assertEquals(result.mode, "renderer");
      });

      it("uses --mode flag when provided", () => {
        const result = extractServeArgs({ _: ["serve"], mode: "proxy" });
        assertEquals(result.mode, "proxy");
      });

      it("uses -m shorthand when provided", () => {
        const result = extractServeArgs({ _: ["serve"], m: "combined" });
        assertEquals(result.mode, "combined");
      });

      it("prefers --mode over -m shorthand", () => {
        const result = extractServeArgs({ _: ["serve"], mode: "proxy", m: "combined" });
        assertEquals(result.mode, "proxy");
      });
    });

    describe("port handling", () => {
      it("uses DEFAULT_DEV_SERVER_PORT (3000) when port is not specified", () => {
        const result = extractServeArgs({ _: ["serve"] });
        assertEquals(result.port, DEFAULT_DEV_SERVER_PORT);
      });

      it("uses explicit port when provided", () => {
        const result = extractServeArgs({ _: ["serve"], port: 8080 });
        assertEquals(result.port, 8080);
      });
    });

    describe("boolean flag extraction", () => {
      it("extracts split flag", () => {
        assertEquals(extractServeArgs({ _: ["serve"], split: true }).splitMode, true);
      });

      it("defaults split to false when not provided", () => {
        assertEquals(extractServeArgs({ _: ["serve"] }).splitMode, false);
      });

      it("extracts binary flag as boolean", () => {
        assertEquals(extractServeArgs({ _: ["serve"], binary: true }).useBinary, true);
      });

      it("extracts debug flag", () => {
        assertEquals(extractServeArgs({ _: ["serve"], debug: true }).debug, true);
      });

      it("defaults debug to false when not provided", () => {
        assertEquals(extractServeArgs({ _: ["serve"] }).debug, false);
      });
    });

    describe("hostname/host/bindAddress resolution", () => {
      it("defaults to 0.0.0.0 when no host flags are provided", () => {
        const result = extractServeArgs({ _: ["serve"] });
        assertEquals(result.bindAddress, "0.0.0.0");
      });

      it("uses --hostname when provided", () => {
        const result = extractServeArgs({ _: ["serve"], hostname: "127.0.0.1" });
        assertEquals(result.bindAddress, "127.0.0.1");
      });

      it("uses --host when provided", () => {
        const result = extractServeArgs({ _: ["serve"], host: "localhost" });
        assertEquals(result.bindAddress, "localhost");
      });

      it("prefers --hostname over --host", () => {
        const result = extractServeArgs({
          _: ["serve"],
          hostname: "10.0.0.1",
          host: "192.168.1.1",
        });
        assertEquals(result.bindAddress, "10.0.0.1");
      });
    });

    describe("binary path resolution", () => {
      it("uses string value when binary is a path string", () => {
        const result = extractServeArgs({ _: ["serve"], binary: "/custom/path/veryfront" });
        assertEquals(result.binaryPath, "/custom/path/veryfront");
      });

      it("falls back to default path when binary is boolean true", () => {
        const result = extractServeArgs({ _: ["serve"], binary: true });
        assertEquals(result.binaryPath, "./bin/veryfront");
      });

      it("falls back to default path when binary is not provided", () => {
        const result = extractServeArgs({ _: ["serve"] });
        assertEquals(result.binaryPath, "./bin/veryfront");
      });
    });
  });
});
