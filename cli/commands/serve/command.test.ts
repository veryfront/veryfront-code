import { assertEquals, assertExists } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { serveCommand } from "./command.ts";
import type { ServeOptions } from "./command.ts";

describe("commands/serve/command", () => {
  describe("serveCommand", () => {
    it("is exported as a function", () => {
      assertExists(serveCommand);
      assertEquals(typeof serveCommand, "function");
    });

    it("is an async function", () => {
      assertEquals(serveCommand.constructor.name, "AsyncFunction");
    });

    it("accepts a single ServeOptions parameter", () => {
      assertEquals(serveCommand.length, 1);
    });
  });

  describe("ServeOptions interface", () => {
    it("supports renderer mode", () => {
      const options: ServeOptions = {
        mode: "renderer",
        port: 3000,
        bindAddress: "0.0.0.0",
        splitMode: false,
        useBinary: false,
        binaryPath: "./bin/veryfront",
        debug: false,
      };
      assertEquals(options.mode, "renderer");
    });

    it("supports proxy mode", () => {
      const options: ServeOptions = {
        mode: "proxy",
        port: 8080,
        bindAddress: "0.0.0.0",
        splitMode: false,
        useBinary: false,
        binaryPath: "./bin/veryfront",
        debug: false,
      };
      assertEquals(options.mode, "proxy");
    });

    it("supports combined mode", () => {
      const options: ServeOptions = {
        mode: "combined",
        port: 3000,
        bindAddress: "0.0.0.0",
        splitMode: false,
        useBinary: false,
        binaryPath: "./bin/veryfront",
        debug: false,
      };
      assertEquals(options.mode, "combined");
    });

    it("supports split mode configuration", () => {
      const options: ServeOptions = {
        mode: "renderer",
        port: 3000,
        bindAddress: "0.0.0.0",
        splitMode: true,
        useBinary: true,
        binaryPath: "/usr/local/bin/veryfront",
        debug: false,
      };
      assertEquals(options.splitMode, true);
      assertEquals(options.useBinary, true);
      assertEquals(options.binaryPath, "/usr/local/bin/veryfront");
    });

    it("supports debug flag", () => {
      const options: ServeOptions = {
        mode: "renderer",
        port: 3000,
        bindAddress: "0.0.0.0",
        splitMode: false,
        useBinary: false,
        binaryPath: "./bin/veryfront",
        debug: true,
      };
      assertEquals(options.debug, true);
    });

    it("supports custom bind address", () => {
      const options: ServeOptions = {
        mode: "renderer",
        port: 3000,
        bindAddress: "127.0.0.1",
        splitMode: false,
        useBinary: false,
        binaryPath: "./bin/veryfront",
        debug: false,
      };
      assertEquals(options.bindAddress, "127.0.0.1");
    });

    it("includes all required fields", () => {
      const options: ServeOptions = {
        mode: "renderer",
        port: 3000,
        bindAddress: "0.0.0.0",
        splitMode: false,
        useBinary: false,
        binaryPath: "./bin/veryfront",
        debug: false,
      };
      assertEquals(Object.keys(options).length, 7);
    });
  });
});
