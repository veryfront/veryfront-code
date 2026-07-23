import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertRejects } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { isDeno } from "#veryfront/platform/compat/runtime.ts";
import { DenoHttpServer } from "./deno-server.ts";

/** Find a free port by temporarily binding to port 0. */
function getFreePort(): number {
  const tmp = Deno.listen({ port: 0 });
  const port = (tmp.addr as Deno.NetAddr).port;
  tmp.close();
  return port;
}

describe("DenoHttpServer", () => {
  describe("serve", () => {
    it("returns native Response instances from handler", async () => {
      if (!isDeno) return;
      const server = new DenoHttpServer();
      const ac = new AbortController();
      const port = getFreePort();

      const responseBody = "hello";
      const handler = () => new Response(responseBody, { status: 200 });

      // Start serve (blocks until abort)
      const servePromise = server.serve(handler, {
        port,
        signal: ac.signal,
      });

      // Wait for the server to be ready
      await new Promise((r) => setTimeout(r, 100));

      try {
        const res = await fetch(`http://127.0.0.1:${port}`);
        assertEquals(res.status, 200);
        assertEquals(await res.text(), responseBody);
      } finally {
        ac.abort();
      }

      await servePromise;
    });

    it("re-wraps non-native Response-like objects as native Response", async () => {
      if (!isDeno) return;
      const server = new DenoHttpServer();
      const ac = new AbortController();
      const port = getFreePort();

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
        port,
        signal: ac.signal,
      });

      await new Promise((r) => setTimeout(r, 100));

      try {
        const res = await fetch(`http://127.0.0.1:${port}`);
        assertEquals(res.status, 201);
        assertEquals(res.headers.get("x-custom"), "test");
        assertEquals(await res.text(), "wrapped body");
      } finally {
        ac.abort();
      }

      await servePromise;
    });

    it("close stops a server that was started with an external signal", async () => {
      if (!isDeno) return;
      const server = new DenoHttpServer();
      const externalController = new AbortController();
      const port = getFreePort();
      let notifyListening: (() => void) | undefined;
      const listening = new Promise<void>((resolve) => {
        notifyListening = resolve;
      });

      let serveSettled = false;
      const servePromise = server.serve(() => new Response("ok"), {
        port,
        signal: externalController.signal,
        onListen: () => notifyListening?.(),
      }).finally(() => {
        serveSettled = true;
      });
      await listening;

      try {
        let timeoutId: ReturnType<typeof setTimeout> | undefined;
        const timeout = new Promise<false>((resolve) => {
          timeoutId = setTimeout(() => resolve(false), 250);
        });
        const closed = await Promise.race([
          server.close().then(() => servePromise).then(() => true),
          timeout,
        ]).finally(() => {
          if (timeoutId) clearTimeout(timeoutId);
        });
        assertEquals(closed, true);
        assertEquals(serveSettled, true);
        assertEquals(externalController.signal.aborted, false);
      } finally {
        externalController.abort();
        await servePromise;
      }
    });

    it("does not report listening when the port cannot be bound", async () => {
      if (!isDeno) return;
      const listener = Deno.listen({ hostname: "127.0.0.1", port: 0 });
      const port = (listener.addr as Deno.NetAddr).port;
      const server = new DenoHttpServer();
      let listenCalls = 0;

      try {
        await assertRejects(() =>
          server.serve(() => new Response("ok"), {
            hostname: "127.0.0.1",
            port,
            onListen: () => listenCalls++,
          })
        );
        assertEquals(listenCalls, 0);
      } finally {
        listener.close();
        await server.close();
      }
    });
  });
});
