import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertRejects, assertStrictEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { createServeHandler, ManagedServerRegistry } from "./server-lifecycle.ts";

describe("platform/adapters/runtime/shared/server-lifecycle", () => {
  describe("createServeHandler", () => {
    it("starts a tracked server and preserves its public address", async () => {
      const fakeServer = {
        stop: () => Promise.resolve(),
        addr: { hostname: "localhost", port: 3000 },
      };
      const registry = new ManagedServerRegistry();

      const createServer = async (
        _handler: (request: Request) => Promise<Response> | Response,
        _options: unknown,
      ) => {
        return fakeServer;
      };

      const serve = createServeHandler(createServer, registry);
      const handler = (_req: Request) => new Response("ok");
      const server = await serve(handler);

      assertEquals(server.addr, fakeServer.addr);
      await server.stop();
    });

    it("passes explicit and default options to the factory", async () => {
      let receivedOptions: unknown = null;
      const fakeServer = {
        stop: () => Promise.resolve(),
        addr: { hostname: "localhost", port: 8080 },
      };

      const createServer = async (_handler: unknown, options: unknown) => {
        receivedOptions = options;
        return fakeServer;
      };

      const registry = new ManagedServerRegistry();
      const serve = createServeHandler(createServer, registry);
      await serve((_req: Request) => new Response("ok"), { port: 8080 });
      assertEquals((receivedOptions as { port: number }).port, 8080);
      await registry.shutdown();
      await serve((_req: Request) => new Response("ok"));
      assertEquals(receivedOptions, {});
      await registry.shutdown();
    });
  });

  describe("ManagedServerRegistry", () => {
    it("owns every started server and does not stop a directly stopped server twice", async () => {
      const stopCalls = [0, 0];
      let nextServer = 0;
      const registry = new ManagedServerRegistry();
      const serve = createServeHandler(async () => {
        const index = nextServer++;
        return {
          addr: { hostname: "localhost", port: 3000 + index },
          stop: async () => {
            stopCalls[index] = (stopCalls[index] ?? 0) + 1;
          },
        };
      }, registry);

      const first = await serve(() => new Response("first"));
      await serve(() => new Response("second"));
      await first.stop();
      await first.stop();
      await registry.shutdown();
      await registry.shutdown();

      assertEquals(
        stopCalls,
        [1, 1],
        "a directly stopped server must delegate stop() exactly once, even across repeat stop and shutdown calls",
      );
    });

    it("shares concurrent shutdown and retries only servers that failed to stop", async () => {
      let stopCalls = 0;
      const registry = new ManagedServerRegistry();
      const serve = createServeHandler(async () => ({
        addr: { hostname: "localhost", port: 3000 },
        stop: async () => {
          stopCalls++;
          if (stopCalls === 1) throw new Error("transient stop failure");
        },
      }), registry);
      await serve(() => new Response("ok"));

      const first = registry.shutdown();
      const concurrent = registry.shutdown();
      assertStrictEquals(first, concurrent);
      await assertRejects(() => first, AggregateError, "transient stop failure");

      await registry.shutdown();
      assertEquals(stopCalls, 2);
    });

    it("retires a server whose startup completes during shutdown", async () => {
      const startup = Promise.withResolvers<{
        addr: { hostname: string; port: number };
        stop(): Promise<void>;
      }>();
      let stopCalls = 0;
      let factoryCalls = 0;
      const registry = new ManagedServerRegistry();
      const serve = createServeHandler(() => {
        factoryCalls++;
        return startup.promise;
      }, registry);

      const startingServer = serve(() => new Response("ok"));
      const shutdown = registry.shutdown();
      await assertRejects(
        () => serve(() => new Response("too late")),
        DOMException,
        "shutting down",
      );
      assertEquals(factoryCalls, 1);

      startup.resolve({
        addr: { hostname: "localhost", port: 3000 },
        stop: async () => {
          stopCalls++;
        },
      });

      await assertRejects(
        () => startingServer,
        DOMException,
        "shutting down",
      );
      await shutdown;
      assertEquals(stopCalls, 1);
    });
  });
});
