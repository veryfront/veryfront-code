/**
 * Tests for standalone MCP server
 */

import { assertEquals, assertExists } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  createStandaloneMCPServer,
  type StandaloneMCPConfig,
  StandaloneMCPServer,
} from "./standalone.ts";

describe("mcp/standalone", () => {
  describe("StandaloneMCPServer class", () => {
    it("is a class", () => {
      assertEquals(typeof StandaloneMCPServer, "function");
    });

    it("can be instantiated with default config", () => {
      const server = new StandaloneMCPServer();
      assertExists(server);
    });

    it("can be instantiated with custom port", () => {
      const config: StandaloneMCPConfig = { port: 9999 };
      const server = new StandaloneMCPServer(config);
      assertExists(server);
    });

    it("has start method", () => {
      const server = new StandaloneMCPServer();
      assertEquals(typeof server.start, "function");
    });

    it("has stop method", () => {
      const server = new StandaloneMCPServer();
      assertEquals(typeof server.stop, "function");
    });
  });

  describe("createStandaloneMCPServer factory", () => {
    it("is a function", () => {
      assertEquals(typeof createStandaloneMCPServer, "function");
    });
  });

  describe("StandaloneMCPConfig interface", () => {
    it("supports optional port", () => {
      const config1: StandaloneMCPConfig = {};
      const config2: StandaloneMCPConfig = { port: 8080 };

      assertEquals(config1.port, undefined);
      assertEquals(config2.port, 8080);
    });
  });
});
