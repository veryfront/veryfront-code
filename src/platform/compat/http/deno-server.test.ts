import "#veryfront/schemas/_test-setup.ts";
import { assert, assertEquals, assertNotEquals, assertRejects } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { isDeno } from "#veryfront/platform/compat/runtime.ts";
import { DenoHttpServer } from "./deno-server.ts";

describe("DenoHttpServer", () => {
  describe("serve", () => {
    it("reports the native bound address before accepting requests", async () => {
      if (!isDeno) return;
      const server = new DenoHttpServer();
      const ac = new AbortController();
      let resolveAddress: (address: { hostname: string; port: number }) => void = () => {};
      const listening = new Promise<{ hostname: string; port: number }>((resolve) => {
        resolveAddress = resolve;
      });

      const servePromise = server.serve(() => new Response("ready"), {
        hostname: "127.0.0.1",
        port: 0,
        signal: ac.signal,
        onListen: resolveAddress,
      });

      const address = await listening;
      assertEquals(address.hostname, "127.0.0.1");
      assert(address.port > 0);

      try {
        const response = await fetch(`http://${address.hostname}:${address.port}`);
        assertEquals(await response.text(), "ready");
      } finally {
        ac.abort();
      }

      await servePromise;
    });

    it("returns native Response instances from handler", async () => {
      if (!isDeno) return;
      const server = new DenoHttpServer();
      let resolvePort!: (port: number) => void;
      const listening = new Promise<number>((resolve) => {
        resolvePort = resolve;
      });

      const responseBody = "hello";
      const handler = () => new Response(responseBody, { status: 200 });

      const servePromise = server.serve(handler, {
        port: 0,
        onListen: ({ port }) => resolvePort(port),
      });
      const port = await listening;

      try {
        assertNotEquals(port, 0);
        const res = await fetch(`http://127.0.0.1:${port}`);
        assertEquals(res.status, 200);
        assertEquals(await res.text(), responseBody);
      } finally {
        await server.close();
      }

      await servePromise;
    });

    it("re-wraps non-native Response-like objects as native Response", async () => {
      if (!isDeno) return;
      const server = new DenoHttpServer();
      let resolvePort!: (port: number) => void;
      const listening = new Promise<number>((resolve) => {
        resolvePort = resolve;
      });

      // Simulate what dnt does: create a Response-like object that is NOT
      // an instanceof the native Response class.
      const handler = () => {
        const real = new Response("wrapped body", {
          status: 201,
          statusText: "Created",
          headers: { "x-custom": "test" },
        });
        // Create a plain object that mimics Response but fails instanceof
        return Object.create(null, {
          body: { get: () => real.body },
          status: { get: () => real.status },
          statusText: { get: () => real.statusText },
          headers: { get: () => real.headers },
        }) as Response;
      };

      const servePromise = server.serve(handler, {
        port: 0,
        onListen: ({ port }) => resolvePort(port),
      });
      const port = await listening;

      try {
        const res = await fetch(`http://127.0.0.1:${port}`);
        assertEquals(res.status, 201);
        assertEquals(res.headers.get("x-custom"), "test");
        assertEquals(await res.text(), "wrapped body");
      } finally {
        await server.close();
      }

      await servePromise;
    });

    it("close owns shutdown even when serve receives an external signal", async () => {
      if (!isDeno) return;
      const server = new DenoHttpServer();
      const external = new AbortController();
      let resolvePort!: (port: number) => void;
      const listening = new Promise<number>((resolve) => {
        resolvePort = resolve;
      });
      const servePromise = server.serve(
        () => new Response("ok"),
        {
          port: 0,
          signal: external.signal,
          onListen: ({ port }) => resolvePort(port),
        },
      );
      const port = await listening;
      let timeoutId: number | undefined;

      try {
        await server.close();
        const stopped = await Promise.race([
          servePromise.then(() => true),
          new Promise<false>((resolve) => {
            timeoutId = setTimeout(() => resolve(false), 1_000);
          }),
        ]);
        assertEquals(stopped, true);
        assertNotEquals(port, 0);
      } finally {
        if (timeoutId !== undefined) clearTimeout(timeoutId);
        external.abort();
        await servePromise;
      }
    });

    it("rejects an already-aborted startup before binding", async () => {
      if (!isDeno) return;
      const server = new DenoHttpServer();
      const controller = new AbortController();
      controller.abort(new DOMException("cancelled", "AbortError"));

      await assertRejects(
        () =>
          server.serve(
            () => new Response("unreachable"),
            { port: 0, signal: controller.signal },
          ),
        DOMException,
        "cancelled",
      );
      await server.close();
    });

    it("rejects a startup aborted while binding and cleans up the listener", async () => {
      if (!isDeno) return;
      const server = new DenoHttpServer();
      const controller = new AbortController();

      const servePromise = server.serve(
        () => new Response("unreachable"),
        {
          port: 0,
          signal: controller.signal,
          onListen: () => controller.abort(new DOMException("cancelled", "AbortError")),
        },
      );
      await assertRejects(
        () => servePromise,
        DOMException,
        "cancelled",
        "an abort raised while binding must reject serve() with the abort reason",
      );

      let resolvePort!: (port: number) => void;
      const listening = new Promise<number>((resolve) => {
        resolvePort = resolve;
      });
      const restarted = server.serve(
        () => new Response("restarted"),
        {
          port: 0,
          onListen: ({ port }) => resolvePort(port),
        },
      );
      const port = await listening;
      try {
        assertEquals(
          await (await fetch(`http://127.0.0.1:${port}`)).text(),
          "restarted",
          "the instance must be reusable after an abort during binding",
        );
      } finally {
        await server.close();
        await restarted;
      }
    });

    it("rejects concurrent serve calls without losing the active listener", async () => {
      if (!isDeno) return;
      const server = new DenoHttpServer();
      let resolvePort!: (port: number) => void;
      const listening = new Promise<number>((resolve) => {
        resolvePort = resolve;
      });
      const first = server.serve(
        () => new Response("first"),
        {
          port: 0,
          onListen: ({ port }) => resolvePort(port),
        },
      );
      const port = await listening;

      try {
        await assertRejects(
          () => server.serve(() => new Response("second"), { port: 0 }),
          Error,
          "more than once concurrently",
        );
        assertEquals(
          await (await fetch(`http://127.0.0.1:${port}`)).text(),
          "first",
        );
      } finally {
        await server.close();
        await first;
      }
    });

    it("can be reused after an onListen callback fails and cleanup succeeds", async () => {
      if (!isDeno) return;
      const server = new DenoHttpServer();
      await assertRejects(
        () =>
          server.serve(
            () => new Response("unreachable"),
            {
              port: 0,
              onListen: () => {
                throw new Error("listen callback failed");
              },
            },
          ),
        Error,
        "listen callback failed",
      );

      let resolvePort!: (port: number) => void;
      const listening = new Promise<number>((resolve) => {
        resolvePort = resolve;
      });
      const servePromise = server.serve(
        () => new Response("restarted"),
        {
          port: 0,
          onListen: ({ port }) => resolvePort(port),
        },
      );
      const port = await listening;
      try {
        assertEquals(
          await (await fetch(`http://127.0.0.1:${port}`)).text(),
          "restarted",
        );
      } finally {
        await server.close();
        await servePromise;
      }
    });
  });
});
