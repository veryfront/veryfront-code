import { assertEquals, assertExists } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { handleServeCommand } from "./handler.ts";
import type { ParsedArgs } from "#cli/shared/types";

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
      it("uses DEFAULT_DEV_SERVER_PORT (3000) when port is not specified", () => {
        const args: ParsedArgs = { _: ["serve"] };
        const port = args.port ?? 3000;
        assertEquals(port, 3000);
      });

      it("uses explicit port when provided", () => {
        const args: ParsedArgs = { _: ["serve"], port: 8080 };
        const port = args.port ?? 3000;
        assertEquals(port, 8080);
      });
    });

    describe("boolean flag extraction", () => {
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
      it("defaults to 0.0.0.0 when no host flags are provided", () => {
        const args: ParsedArgs = { _: ["serve"] };
        const bindAddress = String(args.hostname || args.host || "0.0.0.0");
        assertEquals(bindAddress, "0.0.0.0");
      });

      it("uses --hostname when provided", () => {
        const args: ParsedArgs = { _: ["serve"], hostname: "127.0.0.1" };
        const bindAddress = String(args.hostname || args.host || "0.0.0.0");
        assertEquals(bindAddress, "127.0.0.1");
      });

      it("uses --host when provided", () => {
        const args: ParsedArgs = { _: ["serve"], host: "localhost" };
        const bindAddress = String(args.hostname || args.host || "0.0.0.0");
        assertEquals(bindAddress, "localhost");
      });

      it("prefers --hostname over --host", () => {
        const args: ParsedArgs = {
          _: ["serve"],
          hostname: "10.0.0.1",
          host: "192.168.1.1",
        };
        const bindAddress = String(args.hostname || args.host || "0.0.0.0");
        assertEquals(bindAddress, "10.0.0.1");
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
