import "#veryfront/schemas/_test-setup.ts";
import { assert, assertEquals } from "#veryfront/testing/assert.ts";
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
  });
});
