import { describe, it } from "std/testing/bdd.ts";
import { assert, assertEquals } from "std/assert/mod.ts";
import { BunServer, createBunServer } from "./http-server.ts";

describe("platform/adapters/bun/http-server", () => {
  describe("BunServer", () => {
    it("should have stop method", () => {
      // Create a mock Bun server for testing structure
      const mockBunServer = { stop: () => {} };
      const server = new BunServer(mockBunServer as any, "localhost", 3000);

      assert(typeof server.stop === "function", "stop should be a function");
    });

    it("should have addr property", () => {
      const mockBunServer = { stop: () => {} };
      const server = new BunServer(mockBunServer as any, "localhost", 3000);

      assert(server.addr !== undefined, "addr should be defined");
      assertEquals(server.addr.hostname, "localhost");
      assertEquals(server.addr.port, 3000);
    });

    it("should return address with correct hostname and port", () => {
      const mockBunServer = { stop: () => {} };
      const server = new BunServer(mockBunServer as any, "0.0.0.0", 8080);

      assertEquals(server.addr.hostname, "0.0.0.0");
      assertEquals(server.addr.port, 8080);
    });

    it("should resolve stop promise", async () => {
      const mockBunServer = { stop: () => {} };
      const server = new BunServer(mockBunServer as any, "localhost", 3000);

      const result = await server.stop();
      assertEquals(result, undefined, "stop should resolve to undefined");
    });
  });

  describe("createBunServer", () => {
    it("should be a function", () => {
      assert(typeof createBunServer === "function", "createBunServer should be a function");
    });

    it("should accept handler and options parameters", () => {
      // Verify function signature without calling it (requires Bun runtime)
      assertEquals(createBunServer.length, 1, "createBunServer should have 1 required parameter");
    });
  });
});
