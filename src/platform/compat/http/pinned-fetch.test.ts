import { assertEquals, assertRejects } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { isBun, isDeno, isNode } from "#veryfront/platform/compat/runtime.ts";
import { spawnSync } from "node:child_process";
import process from "node:process";
import {
  applyRuntimeDefaultRequestHeaders,
  createPinnedFetchResponse,
  DEFAULT_OUTBOUND_USER_AGENT,
  fetchWithPinnedAddresses,
  isReplayableRequestBody,
  isRetriableConnectFailure,
  planPinnedConnectAttempts,
} from "./pinned-fetch.ts";
import { copyNativeHeaders } from "./native-request-init.ts";
import {
  installArrayWriteProbe,
  installCredentialProbes,
} from "#veryfront/security/http/credential-probes.test-helpers.ts";

// Probe tests pin what Deno 2.7.7's own Request and fetch call through the
// live prototypes; Node's undici and Bun take different internal paths.
const DENO_INTERNALS = { ignore: !isDeno };

type ClosableNodeTestServer = {
  closeAllConnections?: () => void;
  close: (callback: (error?: Error & { code?: string }) => void) => void;
};

async function closeNodeTestServer(server: ClosableNodeTestServer): Promise<void> {
  server.closeAllConnections?.();
  await new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (!error || error.code === "ERR_SERVER_NOT_RUNNING") {
        resolve();
        return;
      }
      reject(error);
    });
  });
}

describe("fetchWithPinnedAddresses", () => {
  const BEARER = "Bearer vf-pinned-bearer-41c9";

  it("refuses before copying the headers while an index accessor observes array writes", async () => {
    const probe = installArrayWriteProbe("Array.prototype index");
    try {
      await assertRejects(
        () =>
          fetchWithPinnedAddresses(new URL("http://pinned.example.test/"), ["127.0.0.1"], {
            headers: { authorization: BEARER },
          }),
        TypeError,
        "Refused a credential-bearing request",
      );
    } finally {
      probe.restore();
    }
    assertEquals(probe.saw(BEARER), false);
  });

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

  it("uses identity for ranges and derives sec-fetch-mode from the request", async () => {
    // A compressed byte range is ambiguous for the pinned transport to decode,
    // even on runtimes such as Bun that advertise compression for native range
    // requests. Fetch metadata still follows the caller's request mode.
    const { createServer } = await import("node:http");
    const seen = new Map<string, Record<string, string | string[] | undefined>>();
    const server = createServer((request, response) => {
      seen.set(request.url ?? "", request.headers);
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
      const origin = `http://127.0.0.1:${address.port}`;
      await fetch(`${origin}/no-cors`, { mode: "no-cors" });

      const ranged = applyRuntimeDefaultRequestHeaders(
        new Headers({ range: "bytes=0-0" }),
      );
      assertEquals(ranged.get("accept-encoding"), "identity");

      // Fetch metadata is not universal. Deno omits `sec-fetch-mode`, so
      // cross-check it only where the runtime actually emits one.
      const noCors = applyRuntimeDefaultRequestHeaders(new Headers(), "no-cors");
      const runtimeMode = seen.get("/no-cors")?.["sec-fetch-mode"];
      if (runtimeMode !== undefined) {
        assertEquals(noCors.get("sec-fetch-mode"), runtimeMode);
      }
      assertEquals(noCors.get("sec-fetch-mode"), "no-cors");

      // Unranged, default-mode requests keep the compressed-body offer.
      const plain = applyRuntimeDefaultRequestHeaders(new Headers());
      assertEquals(plain.get("accept-encoding"), "gzip, deflate");
      assertEquals(plain.get("sec-fetch-mode"), "cors");
    } finally {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => error ? reject(error) : resolve());
      });
    }
  });

  it(
    "fills in the defaults without a patched intrinsic seeing the credential",
    DENO_INTERNALS,
    () => {
      const bearer = "Bearer vf-pinned-bearer-2e71";
      const headers = copyNativeHeaders({ authorization: bearer });
      const probes = installCredentialProbes();
      try {
        applyRuntimeDefaultRequestHeaders(headers, "cors");
      } finally {
        probes.restore();
      }

      assertEquals(probes.saw(bearer), false);
      assertEquals(headers.get("authorization"), bearer);
      assertEquals(headers.get("sec-fetch-mode"), "cors");
    },
  );

  it("keeps caller-supplied headers ahead of the runtime defaults", () => {
    const headers = applyRuntimeDefaultRequestHeaders(
      new Headers({ "user-agent": "caller/1.0", accept: "application/json" }),
    );
    assertEquals(headers.get("user-agent"), "caller/1.0");
    assertEquals(headers.get("accept"), "application/json");
    // Untouched defaults still land.
    assertEquals(headers.get("accept-encoding"), "gzip, deflate");
  });

  it("sends the origin Host header rather than the dialled address", async () => {
    // Ungated on purpose: node:http is available under Deno too, and the Node
    // lane does not run in CI, so this is the only place the wire is inspected.
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
        new URL(`http://pinned-host.test:${address.port}/resource`),
        ["127.0.0.1"],
        { method: "GET" },
      );
      assertEquals(
        seen["host"],
        `pinned-host.test:${address.port}`,
        "the pinned transport must send the origin Host header, not the dialled IP",
      );
    } finally {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => error ? reject(error) : resolve());
      });
    }
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

  it("sends a closing stream body through the pinned transport", async () => {
    const { createServer } = await import("node:http");
    let received = "";
    const server = createServer((request, response) => {
      request.setEncoding("utf8");
      request.on("data", (chunk) => {
        received += chunk;
      });
      request.on("end", () => {
        response.writeHead(200, { "content-type": "text/plain" });
        response.end(received);
      });
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
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new TextEncoder().encode("hello"));
          controller.close();
        },
      }) as unknown as BodyInit;
      const response = await fetchWithPinnedAddresses(
        new URL(`http://pinned-stream.test:${address.port}/upload`),
        ["127.0.0.1"],
        { method: "POST", body },
      );
      assertEquals(response.status, 200);
      assertEquals(await response.text(), "hello");
      assertEquals(received, "hello");
    } finally {
      await closeNodeTestServer(server);
    }
  });

  it("falls through to the next validated address when the first refuses", async () => {
    if (!isNode) return;

    const { createServer } = await import("node:http");
    const server = createServer((_request, response) => {
      response.writeHead(200, { "content-type": "text/plain" });
      response.end("reached");
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
      // 127.0.0.2 is loopback with nothing listening, so it refuses fast. Only
      // the second validated address serves. autoSelectFamily races IPv4
      // against IPv6 and does nothing for two addresses of the same family, so
      // the transport has to walk the list itself.
      const response = await fetchWithPinnedAddresses(
        new URL(`http://localhost:${address.port}/resource`),
        ["127.0.0.2", "127.0.0.1"],
        { method: "GET" },
      );
      assertEquals(response.status, 200);
      assertEquals(await response.text(), "reached");
    } finally {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => error ? reject(error) : resolve());
      });
    }
  });

  it("cleans up abort listeners when the Node request constructor rejects before assignment", () => {
    if (!isNode) return;

    const script = `
      import { fetchWithPinnedAddresses } from "./src/platform/compat/http/pinned-fetch.ts";
      const abort = new AbortController();
      await fetchWithPinnedAddresses(
        new URL("http://pinned-invalid-method.test/"),
        ["127.0.0.1"],
        { method: "BAD METHOD", signal: abort.signal },
      ).then(
        () => { throw new Error("invalid method unexpectedly succeeded"); },
        (error) => {
          if (!(error instanceof TypeError)) throw error;
        },
      );
      abort.abort(new DOMException("stop", "AbortError"));
      await new Promise((resolve) => setTimeout(resolve, 0));
      console.log("abort-after-constructor-failure-survived");
    `;

    const output = spawnSync(process.execPath, [
      "--import",
      "./tests/node/resolver.mjs",
      "--input-type=module",
      "--eval",
      script,
    ], { encoding: "utf8" });

    assertEquals(output.stdout.trim(), "abort-after-constructor-failure-survived");
    assertEquals(output.stderr, "");
    assertEquals(output.status, 0);
  });

  it("does not invoke a mutated request destroy during late abort teardown", async () => {
    const { ClientRequest, createServer } = await import("node:http");
    let releaseRequest!: () => void;
    const requestSeen = new Promise<void>((resolve) => {
      releaseRequest = resolve;
    });
    const server = createServer((request, _response) => {
      request.resume();
      releaseRequest();
    });
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", resolve);
    });

    const originalDestroy = Object.getOwnPropertyDescriptor(ClientRequest.prototype, "destroy");
    const inheritedDestroy = ClientRequest.prototype.destroy;
    let observedAuthorization: unknown;
    try {
      const address = server.address();
      if (!address || typeof address === "string") {
        throw new Error("Node test server did not expose a TCP address");
      }
      const abort = new AbortController();
      const response = fetchWithPinnedAddresses(
        new URL(`http://pinned-abort.test:${address.port}/resource`),
        ["127.0.0.1"],
        { headers: { authorization: BEARER }, signal: abort.signal },
      );
      await requestSeen;

      Object.defineProperty(ClientRequest.prototype, "destroy", {
        configurable: true,
        writable: true,
        ...originalDestroy,
        value(this: { getHeader(name: string): unknown }, ...args: unknown[]) {
          observedAuthorization ??= this.getHeader("authorization");
          return Reflect.apply(inheritedDestroy, this, args);
        },
      });

      abort.abort(new DOMException("stop", "AbortError"));
      let rejected = false;
      try {
        await response;
      } catch {
        rejected = true;
      }
      assertEquals(rejected, true);
      assertEquals(observedAuthorization, undefined);
    } finally {
      if (originalDestroy) {
        Object.defineProperty(ClientRequest.prototype, "destroy", originalDestroy);
      } else Reflect.deleteProperty(ClientRequest.prototype, "destroy");
      await closeNodeTestServer(server);
    }
  });

  it("contains Bun payload stream errors without exposing credentials", () => {
    if (!isBun) return;

    const script = `
      import { fetchWithPinnedAddresses } from "./src/platform/compat/http/pinned-fetch.ts";
      import { createServer } from "node:http";

      let releaseRequest;
      const requestSeen = new Promise((resolve) => {
        releaseRequest = resolve;
      });
      const server = createServer((request, _response) => {
        request.resume();
        releaseRequest();
      });
      await new Promise((resolve, reject) => {
        server.once("error", reject);
        server.listen(0, "127.0.0.1", resolve);
      });

      const secret = ["bun", "payload", "secret"].join("-");
      const bearer = "Bearer " + secret;
      let bodyController;
      const body = new ReadableStream({
        start(controller) {
          bodyController = controller;
          controller.enqueue(new TextEncoder().encode("prefix"));
        },
      });

      const address = server.address();
      let failureMessage = "";
      const request = fetchWithPinnedAddresses(
        new URL(\`http://pinned-payload.test:\${address.port}/resource\`),
        ["127.0.0.1"],
        { method: "POST", headers: { authorization: bearer }, body },
      ).catch((error) => {
        failureMessage = error instanceof Error ? error.message : String(error);
      });
      await requestSeen;

      bodyController.error(new Error("body failed"));
      await request;
      await new Promise((resolve) => setTimeout(resolve, 20));
      server.closeAllConnections?.();
      await new Promise((resolve, reject) => {
        server.close((error) => {
          if (!error || error.code === "ERR_SERVER_NOT_RUNNING") resolve();
          else reject(error);
        });
      });
      console.log(JSON.stringify({ failureMessage }));
    `;

    const output = spawnSync(process.execPath, [
      "--no-env-file",
      "--preload",
      "./tests/bun/preload.ts",
      "--eval",
      script,
    ], { encoding: "utf8" });

    assertEquals(output.status, 0);
    assertEquals(output.stderr, "");
    assertEquals(JSON.parse(output.stdout).failureMessage, "body failed");
    assertEquals(output.stdout.includes("Bearer bun-payload-secret"), false);
    assertEquals(output.stdout.includes("bun-payload-secret"), false);
  });

  it("rejects guard failures without waiting for body cancellation to finish", async () => {
    const { ClientRequest, createServer } = await import("node:http");
    let releaseRequest!: () => void;
    const requestSeen = new Promise<void>((resolve) => {
      releaseRequest = resolve;
    });
    const server = createServer((request, _response) => {
      request.resume();
      releaseRequest();
    });
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", resolve);
    });

    const originalSetHeader = Object.getOwnPropertyDescriptor(
      ClientRequest.prototype,
      "setHeader",
    );
    let bodyController!: ReadableStreamDefaultController<Uint8Array>;
    let cancelStarted = false;
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        bodyController = controller;
        controller.enqueue(new Uint8Array(1024));
      },
      cancel() {
        cancelStarted = true;
        return new Promise(() => {});
      },
    }) as unknown as BodyInit;

    try {
      const address = server.address();
      if (!address || typeof address === "string") {
        throw new Error("Node test server did not expose a TCP address");
      }
      const response = fetchWithPinnedAddresses(
        new URL(`http://pinned-cancel.test:${address.port}/upload`),
        ["127.0.0.1"],
        { method: "POST", headers: { authorization: BEARER }, body },
      );
      await requestSeen;

      Object.defineProperty(ClientRequest.prototype, "setHeader", {
        configurable: true,
        writable: true,
        ...originalSetHeader,
        value(this: { setHeader(name: string, value: string): unknown }, ...args: unknown[]) {
          return Reflect.apply(originalSetHeader!.value, this, args);
        },
      });
      bodyController.enqueue(new Uint8Array(1024));

      let timeout: ReturnType<typeof setTimeout> | undefined;
      const result = await Promise.race([
        response.then(
          () => "resolved",
          (error) => error instanceof Error ? error.message : String(error),
        ),
        new Promise<string>((resolve) => {
          timeout = setTimeout(() => resolve("timeout"), 250);
        }),
      ]);
      if (timeout !== undefined) clearTimeout(timeout);
      assertEquals(result.includes("setHeader"), true);
      assertEquals(cancelStarted, true);
    } finally {
      if (originalSetHeader) {
        Object.defineProperty(ClientRequest.prototype, "setHeader", originalSetHeader);
      } else Reflect.deleteProperty(ClientRequest.prototype, "setHeader");
      await closeNodeTestServer(server);
    }
  });

  it("cancels a pending body read when abort closes the request", () => {
    if (!isNode) return;

    const script = `
      import { fetchWithPinnedAddresses } from "./src/platform/compat/http/pinned-fetch.ts";
      const abort = new AbortController();
      let cancelReason = "";
      const body = new ReadableStream({
        pull() {
          return new Promise(() => {});
        },
        cancel(reason) {
          cancelReason = reason instanceof Error ? reason.name : String(reason);
        },
      });
      const response = fetchWithPinnedAddresses(
        new URL("http://pinned-abort-pending.test/"),
        ["127.0.0.1"],
        { method: "POST", signal: abort.signal, body },
      );
      await new Promise((resolve) => setTimeout(resolve, 0));
      abort.abort(new DOMException("stop", "AbortError"));
      const result = await response.then(
        () => "resolved",
        (error) => error instanceof Error ? error.name + ":" + error.message : String(error),
      );
      await new Promise((resolve) => setTimeout(resolve, 100));
      console.log(JSON.stringify({ result, cancelReason }));
    `;

    const output = spawnSync(process.execPath, [
      "--import",
      "./tests/node/resolver.mjs",
      "--input-type=module",
      "--eval",
      script,
    ], { encoding: "utf8" });

    assertEquals(output.stderr, "");
    assertEquals(output.status, 0);
    assertEquals(JSON.parse(output.stdout), {
      result: "AbortError:stop",
      cancelReason: "AbortError",
    });
  });

  it("does not invoke a mutated request destroy during payload error teardown", async () => {
    if (isBun) return;

    const { ClientRequest, createServer } = await import("node:http");
    const encoder = new TextEncoder();
    let releaseRequest!: () => void;
    const requestSeen = new Promise<void>((resolve) => {
      releaseRequest = resolve;
    });
    const server = createServer((request, _response) => {
      request.resume();
      releaseRequest();
    });
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", resolve);
    });

    let bodyController!: ReadableStreamDefaultController<Uint8Array>;
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        bodyController = controller;
        controller.enqueue(encoder.encode("prefix"));
      },
    }) as unknown as BodyInit;
    const originalDestroy = Object.getOwnPropertyDescriptor(ClientRequest.prototype, "destroy");
    const inheritedDestroy = ClientRequest.prototype.destroy;
    let observedAuthorization: unknown;
    try {
      const address = server.address();
      if (!address || typeof address === "string") {
        throw new Error("Node test server did not expose a TCP address");
      }
      const response = fetchWithPinnedAddresses(
        new URL(`http://pinned-payload.test:${address.port}/resource`),
        ["127.0.0.1"],
        { method: "POST", headers: { authorization: BEARER }, body },
      );
      await requestSeen;

      Object.defineProperty(ClientRequest.prototype, "destroy", {
        configurable: true,
        writable: true,
        ...originalDestroy,
        value(this: { getHeader(name: string): unknown }, ...args: unknown[]) {
          observedAuthorization ??= this.getHeader("authorization");
          return Reflect.apply(inheritedDestroy, this, args);
        },
      });

      bodyController.error(new Error("body failed"));
      let rejected = false;
      try {
        await response;
      } catch {
        rejected = true;
      }
      assertEquals(rejected, true);
      assertEquals(observedAuthorization, undefined);
    } finally {
      if (originalDestroy) {
        Object.defineProperty(ClientRequest.prototype, "destroy", originalDestroy);
      } else Reflect.deleteProperty(ClientRequest.prototype, "destroy");
      await closeNodeTestServer(server);
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

describe("pinned connect attempts", () => {
  it("keeps a single validated address as one attempt", () => {
    assertEquals(planPinnedConnectAttempts(["203.0.113.7"]), [["203.0.113.7"]]);
  });

  it("dials one address per attempt", () => {
    // Every attempt dials one address; the runtime is never asked to choose.
    const plan = planPinnedConnectAttempts(["2606:4700::1", "104.26.14.209"]);
    assertEquals(plan[0], ["2606:4700::1"]);
    assertEquals(plan.length, 2);
    assertEquals(plan[1], ["104.26.14.209"]);
  });

  it("tries the other address family before a sibling of the failed one", () => {
    const plan = planPinnedConnectAttempts([
      "2606:4700::1",
      "2606:4700::2",
      "104.26.14.209",
    ]);
    // A host with no IPv6 route fails on both AAAA records, so the A record has
    // to come before the second AAAA.
    assertEquals(plan[1], ["104.26.14.209"]);
    assertEquals(plan[2], ["2606:4700::2"]);
  });

  it("retries only connect-level failures", () => {
    assertEquals(isRetriableConnectFailure({ code: "ECONNREFUSED" }), true);
    assertEquals(isRetriableConnectFailure({ code: "ENETUNREACH" }), true);
    assertEquals(isRetriableConnectFailure({ code: "ECONNRESET" }), false);
    assertEquals(isRetriableConnectFailure(new Error("boom")), false);
    assertEquals(isRetriableConnectFailure(null), false);
  });

  it("retries ETIMEDOUT only when it came from connect", () => {
    // A socket timeout after the request was written carries the same code, and
    // replaying it could deliver a non-idempotent request twice.
    assertEquals(
      isRetriableConnectFailure({ code: "ETIMEDOUT", syscall: "connect" }),
      true,
    );
    assertEquals(
      isRetriableConnectFailure({ code: "ETIMEDOUT", syscall: "read" }),
      false,
    );
    assertEquals(isRetriableConnectFailure({ code: "ETIMEDOUT" }), false);
  });

  it("replays only bodies that re-read identically", () => {
    assertEquals(isReplayableRequestBody(null), true);
    assertEquals(isReplayableRequestBody("{}"), true);
    assertEquals(isReplayableRequestBody(new Uint8Array([1, 2])), true);
    assertEquals(isReplayableRequestBody(new URLSearchParams("a=1")), true);
    // Immutable, and writeRequestBody takes a fresh body.stream() per attempt.
    assertEquals(isReplayableRequestBody(new Blob(["x"])), true);
    // Already drained by the attempt that failed, so a retry would send nothing.
    assertEquals(
      isReplayableRequestBody(new Blob(["x"]).stream() as unknown as BodyInit),
      false,
    );
  });
});
