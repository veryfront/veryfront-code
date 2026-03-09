import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { createServeHandler, stopManagedServer } from "./server-lifecycle.ts";

describe("platform/adapters/runtime/shared/server-lifecycle", () => {
  describe("createServeHandler", () => {
    it("should create a handler that calls createServer and setActive", async () => {
      const fakeServer = {
        stop: () => Promise.resolve(),
        addr: { hostname: "localhost", port: 3000 },
      };

      let setActiveCalled = false;
      let capturedServer: unknown = null;

      const createServer = async (
        _handler: (request: Request) => Promise<Response> | Response,
        _options: unknown,
      ) => {
        return fakeServer;
      };

      const setActive = (server: unknown) => {
        setActiveCalled = true;
        capturedServer = server;
      };

      const serve = createServeHandler(createServer, setActive);
      const handler = (_req: Request) => new Response("ok");
      const server = await serve(handler);

      assertEquals(server, fakeServer);
      assertEquals(setActiveCalled, true);
      assertEquals(capturedServer, fakeServer);
    });

    it("should pass options to createServer", async () => {
      let receivedOptions: unknown = null;
      const fakeServer = {
        stop: () => Promise.resolve(),
        addr: { hostname: "localhost", port: 8080 },
      };

      const createServer = async (_handler: unknown, options: unknown) => {
        receivedOptions = options;
        return fakeServer;
      };

      const serve = createServeHandler(createServer, () => {});
      await serve((_req: Request) => new Response("ok"), { port: 8080 });

      assertEquals((receivedOptions as { port: number }).port, 8080);
    });

    it("should default options to empty object", async () => {
      let receivedOptions: unknown = null;
      const fakeServer = {
        stop: () => Promise.resolve(),
        addr: { hostname: "localhost", port: 3000 },
      };

      const createServer = async (_handler: unknown, options: unknown) => {
        receivedOptions = options;
        return fakeServer;
      };

      const serve = createServeHandler(createServer, () => {});
      await serve((_req: Request) => new Response("ok"));

      assertEquals(receivedOptions, {});
    });
  });

  describe("stopManagedServer", () => {
    it("should return null when server is null", async () => {
      const result = await stopManagedServer(null);
      assertEquals(result, null);
    });

    it("should call stop() and return null", async () => {
      let stopCalled = false;
      const fakeServer = {
        stop: async () => {
          stopCalled = true;
        },
        addr: { hostname: "localhost", port: 3000 },
      };

      const result = await stopManagedServer(fakeServer);
      assertEquals(result, null);
      assertEquals(stopCalled, true);
    });
  });
});
