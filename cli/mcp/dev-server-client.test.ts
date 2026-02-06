/**
 * Tests for MCP dev server client
 */

import { assertEquals, assertExists } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { DevServerClient, type DevServerClientOptions } from "./dev-server-client.ts";

describe("mcp/dev-server-client", () => {
  describe("DevServerClient", () => {
    it("is a class", () => {
      assertEquals(typeof DevServerClient, "function");
    });

    it("can be instantiated with options", () => {
      const options: DevServerClientOptions = { port: 8080 };
      const client = new DevServerClient(options);
      assertExists(client);
    });

    describe("instance methods", () => {
      let client: DevServerClient;

      const createClient = () => {
        return new DevServerClient({ port: 9999 });
      };

      it("has getLiveErrors method", () => {
        client = createClient();
        assertEquals(typeof client.getLiveErrors, "function");
      });

      it("has getLiveLogs method", () => {
        client = createClient();
        assertEquals(typeof client.getLiveLogs, "function");
      });

      it("has getStats method", () => {
        client = createClient();
        assertEquals(typeof client.getStats, "function");
      });

      it("has triggerHmr method", () => {
        client = createClient();
        assertEquals(typeof client.triggerHmr, "function");
      });
    });

    describe("DevServerClientOptions interface", () => {
      it("requires port property", () => {
        const options: DevServerClientOptions = {
          port: 3000,
        };
        assertEquals(options.port, 3000);
      });
    });
  });
});
