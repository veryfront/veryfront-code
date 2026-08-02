import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { isNode } from "#veryfront/platform/compat/runtime.ts";
import { createPinnedFetchResponse, fetchWithPinnedAddresses } from "./pinned-fetch.ts";

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
