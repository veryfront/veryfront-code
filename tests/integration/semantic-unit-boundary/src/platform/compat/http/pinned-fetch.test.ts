// Mutates Response.prototype and exercises the native localhost transport.
import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { isNode } from "#veryfront/platform/compat/runtime.ts";
import {
  createPinnedFetchResponse,
  fetchWithPinnedAddresses,
} from "#veryfront/platform/compat/http/pinned-fetch.ts";

describe("pinned response settlement intrinsics", () => {
  it("seals newly created responses before their first promise resolution", async () => {
    const original = Object.getOwnPropertyDescriptor(Response.prototype, "then");
    let intercepted = false;
    try {
      Object.defineProperty(Response.prototype, "then", {
        configurable: true,
        get() {
          intercepted = true;
          return undefined;
        },
      });
      const response = await Promise.resolve(
        createPinnedFetchResponse(200, "OK", new Headers(), "authenticated content"),
      );
      assertEquals(intercepted, false);
      assertEquals(await response.text(), "authenticated content");
    } finally {
      if (original) Object.defineProperty(Response.prototype, "then", original);
      else Reflect.deleteProperty(Response.prototype, "then");
    }
  });

  it("does not expose authenticated response content through inherited then", async () => {
    // Deno's node:http server itself creates same-realm Responses before transport delivery.
    if (!isNode) return;
    const { createServer } = await import("node:http");
    const server = createServer((_request, response) => {
      response.end("authenticated content");
    });
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", resolve);
    });
    const original = Object.getOwnPropertyDescriptor(Response.prototype, "then");
    let intercepted = false;
    try {
      const address = server.address();
      if (!address || typeof address === "string") throw new Error("Missing test address");
      Object.defineProperty(Response.prototype, "then", {
        configurable: true,
        get() {
          intercepted = true;
          return undefined;
        },
      });
      const response = await fetchWithPinnedAddresses(
        new URL(`http://pinned-host.test:${address.port}/resource`),
        ["127.0.0.1"],
        { headers: { authorization: "Bearer test-token" } },
      );
      assertEquals(intercepted, false);
      assertEquals(await response.text(), "authenticated content");
    } finally {
      if (original) Object.defineProperty(Response.prototype, "then", original);
      else Reflect.deleteProperty(Response.prototype, "then");
      await new Promise<void>((resolve, reject) => {
        server.close((error) => error ? reject(error) : resolve());
      });
    }
  });
});
