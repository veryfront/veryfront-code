import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { isNode } from "#veryfront/platform/compat/runtime.ts";
import {
  applyRuntimeDefaultRequestHeaders,
  createPinnedFetchResponse,
  DEFAULT_OUTBOUND_USER_AGENT,
  fetchWithPinnedAddresses,
} from "./pinned-fetch.ts";

describe("fetchWithPinnedAddresses", () => {
  it("preserves Fetch null-body semantics for 204, 205, and 304", async () => {
    for (const status of [204, 205, 304]) {
      const response = createPinnedFetchResponse(
        status,
        "",
        new Headers(),
        new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(new TextEncoder().encode("protocol-invalid-body"));
            controller.close();
          },
        }),
      );
      assertEquals(response.status, status);
      assertEquals(response.body, null);
      assertEquals(await response.text(), "");
    }
  });

  it("preserves HEAD null-body semantics for every response status", async () => {
    for (const status of [200, 404, 500]) {
      const response = createPinnedFetchResponse(
        status,
        "",
        new Headers({ "content-length": "21" }),
        new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(new TextEncoder().encode("protocol-invalid-body"));
            controller.close();
          },
        }),
        "HEAD",
      );
      assertEquals(response.status, status);
      assertEquals(response.headers.get("content-length"), "21");
      assertEquals(response.body, null);
      assertEquals(await response.text(), "");
    }
  });

  it("fills in every request header the runtime's own fetch sends", async () => {
    // The defect this guards: the pinned transport talks to `node:http`
    // directly, so headers `fetch` supplies for free silently go missing.
    //
    // Runs on every runtime by checking the header policy rather than the
    // Node-only transport — `deno task test` is the only lane CI runs, so a
    // check gated on `isNode` would never execute. The baseline comes from a
    // live `fetch` instead of a hardcoded list, so a runtime that starts
    // sending a new default fails here rather than drifting silently.
    const { createServer } = await import("node:http");
    let runtimeSent: Record<string, string | string[] | undefined> = {};
    const server = createServer((request, response) => {
      runtimeSent = request.headers;
      response.writeHead(204);
      response.end();
    });
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", resolve);
    });

    try {
      const address = server.address();
      if (!address || typeof address === "string") {
        throw new Error("Test server did not expose a TCP address");
      }
      await fetch(`http://127.0.0.1:${address.port}/baseline`, {
        method: "POST",
        body: '{"hello":"world"}',
        headers: { "content-type": "application/json" },
      });

      const defaulted = applyRuntimeDefaultRequestHeaders(
        new Headers({ "content-type": "application/json" }),
      );

      // `host` and the framing headers belong to whoever opens the socket.
      const transportOwned = new Set([
        "host",
        "connection",
        "content-length",
        "transfer-encoding",
      ]);
      // Sending more than the runtime does is harmless; sending less is the
      // regression, so assert the absence of gaps rather than an exact match.
      const missing = Object.keys(runtimeSent)
        .filter((name) => !transportOwned.has(name) && !defaulted.has(name))
        .sort();
      assertEquals(missing, []);
      assertEquals(defaulted.get("user-agent"), DEFAULT_OUTBOUND_USER_AGENT);
    } finally {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => error ? reject(error) : resolve());
      });
    }
  });

  it("keeps caller-supplied headers ahead of the runtime defaults", () => {
    const headers = applyRuntimeDefaultRequestHeaders(
      new Headers({ "user-agent": "caller/1.0", accept: "application/json" }),
    );
    assertEquals(headers.get("user-agent"), "caller/1.0");
    assertEquals(headers.get("accept"), "application/json");
    // Untouched defaults still land.
    assertEquals(headers.get("accept-encoding"), "gzip, deflate");
  });

  it("puts the defaults on the wire through the Node transport", async () => {
    if (!isNode) return;

    const { createServer } = await import("node:http");
    let seen: Record<string, string | string[] | undefined> = {};
    const server = createServer((request, response) => {
      seen = request.headers;
      response.writeHead(204);
      response.end();
    });
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", resolve);
    });

    try {
      const address = server.address();
      if (!address || typeof address === "string") {
        throw new Error("Node test server did not expose a TCP address");
      }
      await fetchWithPinnedAddresses(
        new URL(`http://127.0.0.1:${address.port}/resource`),
        ["127.0.0.1"],
        { method: "POST", body: "{}", headers: { "content-type": "application/json" } },
      );
      assertEquals(seen["user-agent"], DEFAULT_OUTBOUND_USER_AGENT);
      assertEquals(seen["accept"], "*/*");
      assertEquals(seen["content-type"], "application/json");
    } finally {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => error ? reject(error) : resolve());
      });
    }
  });

  it("returns a null body for HEAD through the native Node transport", async () => {
    if (!isNode) return;

    const { createServer } = await import("node:http");
    let seenMethod: string | undefined;
    const server = createServer((request, response) => {
      seenMethod = request.method;
      response.writeHead(200, {
        "content-length": "21",
        "content-type": "text/plain",
      });
      response.end("protocol-invalid-body");
    });
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", resolve);
    });

    try {
      const address = server.address();
      if (!address || typeof address === "string") {
        throw new Error("Node test server did not expose a TCP address");
      }
      const response = await fetchWithPinnedAddresses(
        new URL(`http://pinned-head.test:${address.port}/resource`),
        ["127.0.0.1"],
        { method: "HEAD" },
      );
      assertEquals(seenMethod, "HEAD");
      assertEquals(response.status, 200);
      assertEquals(response.headers.get("content-length"), "21");
      assertEquals(response.body, null);
      assertEquals(await response.text(), "");
    } finally {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => error ? reject(error) : resolve());
      });
    }
  });
});
