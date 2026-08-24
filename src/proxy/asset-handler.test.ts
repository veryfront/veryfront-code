import "#veryfront/schemas/_test-setup.ts";

import { assertEquals } from "#veryfront/testing/assert.ts";
import { afterEach, describe, it } from "#veryfront/testing/bdd.ts";
import {
  clearReleaseAssetProxyCache,
  handleReleaseAssetRequest,
  isReleaseAssetPath,
} from "./asset-handler.ts";
import { computeHashBytes } from "#veryfront/utils/hash-utils.ts";
import { RELEASE_ASSET_MAX_SIZE_BYTES } from "#veryfront/release-assets/constants.ts";

const API_BASE = "https://api.example.com";
const HASH = "a".repeat(64);
const textEncoder = new TextEncoder();

function makeFetch(
  handler: (url: string, init?: RequestInit) => Response | Promise<Response>,
): typeof fetch {
  return ((input: RequestInfo | URL, init?: RequestInit) =>
    Promise.resolve(handler(String(input), init))) as typeof fetch;
}

async function assetUrl(body: string, extension: "js" | "css"): Promise<URL> {
  const hash = await computeHashBytes(textEncoder.encode(body));
  return new URL(`https://site.example/_vf/assets/${hash}.${extension}`);
}

function handle(
  url: URL,
  options: Parameters<typeof handleReleaseAssetRequest>[2],
  method = "GET",
): Promise<Response | null> {
  return handleReleaseAssetRequest(new Request(url, { method }), url, options);
}

function handleWithSignal(
  url: URL,
  options: Parameters<typeof handleReleaseAssetRequest>[2],
  signal: AbortSignal,
): Promise<Response | null> {
  return handleReleaseAssetRequest(new Request(url, { signal }), url, options);
}

async function flushAsyncWork(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

describe("proxy release asset handler", () => {
  afterEach(() => clearReleaseAssetProxyCache());

  it("recognizes the asset path prefix", () => {
    assertEquals(isReleaseAssetPath(`/_vf/assets/${HASH}.js`), true);
    assertEquals(isReleaseAssetPath("/index.html"), false);
  });

  it("returns null for non-asset paths", async () => {
    const url = new URL("https://site.example/page");
    const result = await handle(url, { apiBaseUrl: API_BASE });
    assertEquals(result, null);
  });

  it("serves a JS asset with immutable + nosniff headers (happy path)", async () => {
    const source = "export const x = 1;";
    let requestedUrl = "";
    const fetchImpl = makeFetch((url) => {
      requestedUrl = url;
      return new Response(source, {
        status: 200,
        headers: { "Content-Type": "text/javascript" },
      });
    });
    const hash = await computeHashBytes(textEncoder.encode(source));
    const url = new URL(`https://site.example/_vf/assets/${hash}.js`);

    const res = await handle(url, { apiBaseUrl: API_BASE, fetchImpl });

    assertEquals(res?.status, 200);
    assertEquals(res?.headers.get("Content-Type"), "text/javascript");
    assertEquals(
      res?.headers.get("Cache-Control"),
      "public, max-age=31536000, immutable",
    );
    assertEquals(res?.headers.get("X-Content-Type-Options"), "nosniff");
    assertEquals(await res?.text(), "export const x = 1;");
    assertEquals(
      requestedUrl,
      `https://api.example.com/release-assets/${hash}`,
      "a cold asset load must hit the public release-assets endpoint",
    );
  });

  it("keeps the path prefix of a based asset API URL", async () => {
    const source = "export const based = 1;";
    let requestedUrl = "";
    const fetchImpl = makeFetch((url) => {
      requestedUrl = url;
      return new Response(source, {
        status: 200,
        headers: { "Content-Type": "text/javascript" },
      });
    });
    const hash = await computeHashBytes(textEncoder.encode(source));
    const url = new URL(`https://site.example/_vf/assets/${hash}.js`);

    const res = await handle(url, { apiBaseUrl: "https://api.example.com/v1", fetchImpl });

    assertEquals(res?.status, 200);
    assertEquals(
      requestedUrl,
      `https://api.example.com/v1/release-assets/${hash}`,
      "a based API URL must keep its path prefix",
    );
  });

  it("fails closed on an unsafe asset API base URL", async () => {
    for (
      const apiBaseUrl of [
        "https://user:pass@api.example.com",
        "https://user@api.example.com",
        "file:///etc",
      ]
    ) {
      let fetches = 0;
      const fetchImpl = makeFetch(() => {
        fetches++;
        return new Response("never");
      });
      const url = new URL(`https://site.example/_vf/assets/${HASH}.js`);

      const res = await handle(url, { apiBaseUrl, fetchImpl });

      assertEquals(res?.status, 502, `${apiBaseUrl} must fail closed with 502`);
      assertEquals(fetches, 0, `${apiBaseUrl} must not reach the asset origin`);
    }
  });

  it("serves a CSS asset with the css content type", async () => {
    const source = ".a{color:red}";
    const fetchImpl = makeFetch(() =>
      new Response(source, {
        status: 200,
        headers: { "Content-Type": "text/css" },
      })
    );
    const url = await assetUrl(source, "css");

    const res = await handle(url, { apiBaseUrl: API_BASE, fetchImpl });

    assertEquals(res?.status, 200);
    assertEquals(res?.headers.get("Content-Type"), "text/css");
  });

  it("returns 400 for a bad hash", async () => {
    const url = new URL("https://site.example/_vf/assets/NOTHEX.js");
    const res = await handle(url, {
      apiBaseUrl: API_BASE,
      fetchImpl: makeFetch(() => new Response("nope")),
    });
    assertEquals(res?.status, 400);
  });

  it("returns 400 for a disallowed extension", async () => {
    const url = new URL(`https://site.example/_vf/assets/${HASH}.png`);
    const res = await handle(url, {
      apiBaseUrl: API_BASE,
      fetchImpl: makeFetch(() => new Response("nope")),
    });
    assertEquals(res?.status, 400);
  });

  it("returns a no-cache 404 when upstream is missing", async () => {
    const fetchImpl = makeFetch(() => new Response("missing", { status: 404 }));
    const url = new URL(`https://site.example/_vf/assets/${HASH}.js`);
    const res = await handle(url, { apiBaseUrl: API_BASE, fetchImpl });
    assertEquals(res?.status, 404);
    assertEquals(res?.headers.get("Cache-Control"), "no-cache");
  });

  it("returns 502 when upstream content-type is not allowlisted", async () => {
    const fetchImpl = makeFetch(() =>
      new Response("<html>", { status: 200, headers: { "Content-Type": "text/html" } })
    );
    const url = new URL(`https://site.example/_vf/assets/${HASH}.js`);
    const res = await handle(url, { apiBaseUrl: API_BASE, fetchImpl });
    assertEquals(res?.status, 502);
  });

  it("rejects an upstream content type that does not match the requested extension", async () => {
    const source = "export const x = 1;";
    const fetchImpl = makeFetch(() =>
      new Response(source, { status: 200, headers: { "Content-Type": "text/css" } })
    );
    const url = await assetUrl(source, "js");

    const res = await handle(url, { apiBaseUrl: API_BASE, fetchImpl });
    assertEquals(res?.status, 502);
  });

  it("rejects bytes that do not match the requested content hash and never caches them", async () => {
    let calls = 0;
    const fetchImpl = makeFetch(() => {
      calls++;
      return new Response("tampered", {
        status: 200,
        headers: { "Content-Type": "text/javascript" },
      });
    });
    const url = new URL(`https://site.example/_vf/assets/${HASH}.js`);

    assertEquals((await handle(url, { apiBaseUrl: API_BASE, fetchImpl }))?.status, 502);
    assertEquals((await handle(url, { apiBaseUrl: API_BASE, fetchImpl }))?.status, 502);
    assertEquals(calls, 2);
  });

  it("coalesces concurrent requests for the same content hash", async () => {
    const source = "export const shared = true;";
    const gate = Promise.withResolvers<void>();
    let calls = 0;
    const fetchImpl = makeFetch(async () => {
      calls++;
      await gate.promise;
      return new Response(source, {
        headers: { "Content-Type": "text/javascript" },
      });
    });
    const url = await assetUrl(source, "js");

    const pending = Array.from(
      { length: 20 },
      () => handle(url, { apiBaseUrl: API_BASE, fetchImpl }),
    );
    await flushAsyncWork();
    assertEquals(calls, 1);

    gate.resolve();
    const responses = await Promise.all(pending);
    assertEquals(responses.map((response) => response?.status), Array(20).fill(200));
    assertEquals(calls, 1);
  });

  it("coalesces by hash without serving bytes under the wrong extension", async () => {
    const source = "export const typed = true;";
    const gate = Promise.withResolvers<void>();
    let calls = 0;
    const fetchImpl = makeFetch(async () => {
      calls++;
      await gate.promise;
      return new Response(source, {
        headers: { "Content-Type": "text/javascript" },
      });
    });
    const jsUrl = await assetUrl(source, "js");
    const cssUrl = await assetUrl(source, "css");
    const javascript = handle(jsUrl, { apiBaseUrl: API_BASE, fetchImpl });
    const stylesheet = handle(cssUrl, { apiBaseUrl: API_BASE, fetchImpl });
    await flushAsyncWork();
    assertEquals(calls, 1);

    gate.resolve();
    assertEquals((await javascript)?.status, 200);
    assertEquals((await stylesheet)?.status, 502);
    assertEquals(calls, 1);
  });

  it("lets one follower abort without cancelling surviving consumers", async () => {
    const source = "export const survivor = true;";
    const gate = Promise.withResolvers<void>();
    let calls = 0;
    const upstreamSignals: AbortSignal[] = [];
    const fetchImpl = makeFetch(async (_url, init) => {
      calls++;
      if (init?.signal) upstreamSignals.push(init.signal);
      await gate.promise;
      return new Response(source, {
        headers: { "Content-Type": "text/javascript" },
      });
    });
    const url = await assetUrl(source, "js");
    const survivor = handle(url, { apiBaseUrl: API_BASE, fetchImpl });
    const followerController = new AbortController();
    const follower = handleWithSignal(
      url,
      { apiBaseUrl: API_BASE, fetchImpl },
      followerController.signal,
    );
    await flushAsyncWork();

    followerController.abort(new Error("client disconnected"));
    assertEquals((await follower)?.status, 499);
    assertEquals(upstreamSignals[0]?.aborted, false);

    gate.resolve();
    assertEquals((await survivor)?.status, 200);
    assertEquals(
      (await handle(url, { apiBaseUrl: API_BASE, fetchImpl }))?.status,
      200,
    );
    assertEquals(calls, 1);
  });

  it("times out one follower without cancelling a longer-lived consumer", async () => {
    const source = "export const patientSurvivor = true;";
    const gate = Promise.withResolvers<void>();
    const upstreamSignals: AbortSignal[] = [];
    const fetchImpl = makeFetch(async (_url, init) => {
      if (init?.signal) upstreamSignals.push(init.signal);
      await gate.promise;
      return new Response(source, {
        headers: { "Content-Type": "text/javascript" },
      });
    });
    const url = await assetUrl(source, "js");
    const survivor = handle(url, {
      apiBaseUrl: API_BASE,
      fetchImpl,
      timeoutMs: 100,
    });
    const follower = handle(url, {
      apiBaseUrl: API_BASE,
      fetchImpl,
      timeoutMs: 5,
    });
    const releaseId = setTimeout(() => gate.resolve(), 25);

    assertEquals((await follower)?.status, 504);
    assertEquals(upstreamSignals[0]?.aborted, false);
    assertEquals((await survivor)?.status, 200);
    clearTimeout(releaseId);
  });

  it("lets a longer-lived follower outlast the initiating caller", async () => {
    const source = "export const lateSurvivor = true;";
    const gate = Promise.withResolvers<void>();
    const upstreamSignals: AbortSignal[] = [];
    const fetchImpl = makeFetch(async (_url, init) => {
      if (init?.signal) upstreamSignals.push(init.signal);
      await gate.promise;
      return new Response(source, {
        headers: { "Content-Type": "text/javascript" },
      });
    });
    const url = await assetUrl(source, "js");
    const initiatingCaller = handle(url, {
      apiBaseUrl: API_BASE,
      fetchImpl,
      timeoutMs: 5,
    });
    const follower = handle(url, {
      apiBaseUrl: API_BASE,
      fetchImpl,
      timeoutMs: 100,
    });
    const releaseId = setTimeout(() => gate.resolve(), 25);

    const [initiatingResponse, followerResponse] = await Promise.all([
      initiatingCaller,
      follower,
    ]);
    assertEquals(initiatingResponse?.status, 504);
    assertEquals(followerResponse?.status, 200);
    assertEquals(upstreamSignals[0]?.aborted, false);
    clearTimeout(releaseId);
  });

  it("abandons and replaces an active load after its sole caller aborts", async () => {
    const source = "export const replacement = true;";
    const abandonedResponse = Promise.withResolvers<Response>();
    let calls = 0;
    const abandonedSignals: AbortSignal[] = [];
    const fetchImpl = makeFetch((_url, init) => {
      calls++;
      if (calls === 1) {
        if (init?.signal) abandonedSignals.push(init.signal);
        return abandonedResponse.promise;
      }
      return new Response(source, {
        headers: { "Content-Type": "text/javascript" },
      });
    });
    const url = await assetUrl(source, "js");
    const controller = new AbortController();
    const abandoned = handleWithSignal(
      url,
      { apiBaseUrl: API_BASE, fetchImpl },
      controller.signal,
    );
    await flushAsyncWork();
    assertEquals(calls, 1);

    controller.abort(new Error("sole caller disconnected"));
    assertEquals((await abandoned)?.status, 499);
    assertEquals(abandonedSignals[0]?.aborted, true);
    assertEquals(
      (await handle(url, { apiBaseUrl: API_BASE, fetchImpl }))?.status,
      200,
    );
    assertEquals(calls, 2);

    // The abandoned producer retains its permit until the hostile fetch
    // actually settles; resolve it so this process-global admission pool is
    // clean for subsequent tests.
    abandonedResponse.resolve(new Response(null, { status: 499 }));
    await flushAsyncWork();
  });

  it("cancels a late response when an abandoned upstream fetch ignores abort", async () => {
    const source = "export const abandonedResponse = true;";
    const lateResponse = Promise.withResolvers<Response>();
    let bodyCancelled = false;
    let upstreamSignal: AbortSignal | undefined;
    const fetchImpl = makeFetch((_url, init) => {
      upstreamSignal = init?.signal ?? undefined;
      return lateResponse.promise;
    });
    const url = await assetUrl(source, "js");
    const controller = new AbortController();
    const abandoned = handleWithSignal(
      url,
      { apiBaseUrl: API_BASE, fetchImpl },
      controller.signal,
    );
    await flushAsyncWork();

    controller.abort(new Error("sole caller disconnected"));
    assertEquals((await abandoned)?.status, 499);
    assertEquals(upstreamSignal?.aborted, true);

    lateResponse.resolve(
      new Response(
        new ReadableStream({
          cancel() {
            bodyCancelled = true;
          },
        }),
        { headers: { "Content-Type": "text/javascript" } },
      ),
    );
    await flushAsyncWork();
    assertEquals(bodyCancelled, true);
  });

  it("retains every cold-load permit until abort-ignoring producers settle", async () => {
    const sources = Array.from(
      { length: 5 },
      (_, index) => `export const hostileProducer${index} = ${index};`,
    );
    const urls = await Promise.all(sources.map((source) => assetUrl(source, "js")));
    const lateResponses = Array.from(
      { length: 4 },
      () => Promise.withResolvers<Response>(),
    );
    let calls = 0;
    const fetchImpl = makeFetch(() => {
      const call = calls++;
      if (call < lateResponses.length) return lateResponses[call]!.promise;
      return new Response(sources[4], {
        headers: { "Content-Type": "text/javascript" },
      });
    });

    const timedOut = urls.slice(0, 4).map((url) =>
      handle(url, { apiBaseUrl: API_BASE, fetchImpl, timeoutMs: 5 })
    );
    await flushAsyncWork();
    assertEquals(calls, 4);
    assertEquals((await Promise.all(timedOut)).map((response) => response?.status), [
      504,
      504,
      504,
      504,
    ]);

    // A new caller may wait for capacity, but it must not start a fifth
    // producer while the four aborted fetches remain unresolved.
    assertEquals(
      (await handle(urls[4]!, {
        apiBaseUrl: API_BASE,
        fetchImpl,
        timeoutMs: 1,
      }))?.status,
      504,
    );
    assertEquals(calls, 4);

    for (const late of lateResponses) {
      late.resolve(new Response(null, { status: 499 }));
    }
    await flushAsyncWork();
    await flushAsyncWork();

    assertEquals(
      (await handle(urls[4]!, {
        apiBaseUrl: API_BASE,
        fetchImpl,
        timeoutMs: 100,
      }))?.status,
      200,
    );
    assertEquals(calls, 5);
  });

  it("retains cold-load permits until hostile body cancellation settles", async () => {
    const sources = Array.from(
      { length: 5 },
      (_, index) => `export const hostileBody${index} = ${index};`,
    );
    const urls = await Promise.all(sources.map((source) => assetUrl(source, "js")));
    const cancellationGates = Array.from(
      { length: 4 },
      () => Promise.withResolvers<void>(),
    );
    let calls = 0;
    const fetchImpl = makeFetch(() => {
      const call = calls++;
      if (call >= cancellationGates.length) {
        return new Response(sources[4], {
          headers: { "Content-Type": "text/javascript" },
        });
      }
      return new Response(
        new ReadableStream<Uint8Array>({
          cancel() {
            return cancellationGates[call]!.promise;
          },
        }),
        { headers: { "Content-Type": "text/javascript" } },
      );
    });

    const timedOut = urls.slice(0, 4).map((url) =>
      handle(url, { apiBaseUrl: API_BASE, fetchImpl, timeoutMs: 5 })
    );
    await flushAsyncWork();
    assertEquals(calls, 4);
    assertEquals((await Promise.all(timedOut)).map((response) => response?.status), [
      504,
      504,
      504,
      504,
    ]);
    assertEquals(
      (await handle(urls[4]!, {
        apiBaseUrl: API_BASE,
        fetchImpl,
        timeoutMs: 1,
      }))?.status,
      504,
    );
    assertEquals(calls, 4);

    for (const gate of cancellationGates) gate.resolve();
    await flushAsyncWork();
    await flushAsyncWork();

    assertEquals(
      (await handle(urls[4]!, {
        apiBaseUrl: API_BASE,
        fetchImpl,
        timeoutMs: 100,
      }))?.status,
      200,
    );
    assertEquals(calls, 5);
  });

  it("rejects oversized upstream bodies before buffering declared bytes", async () => {
    const fetchImpl = makeFetch(() =>
      new Response("small", {
        status: 200,
        headers: {
          "Content-Type": "text/javascript",
          "Content-Length": String(RELEASE_ASSET_MAX_SIZE_BYTES + 1),
        },
      })
    );
    const url = new URL(`https://site.example/_vf/assets/${HASH}.js`);

    assertEquals((await handle(url, { apiBaseUrl: API_BASE, fetchImpl }))?.status, 502);
  });

  it("rejects oversized streamed bodies when content-length is absent", async () => {
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(RELEASE_ASSET_MAX_SIZE_BYTES + 1));
        controller.close();
      },
    });
    const fetchImpl = makeFetch(() =>
      new Response(stream, {
        status: 200,
        headers: { "Content-Type": "text/javascript" },
      })
    );
    const url = new URL(`https://site.example/_vf/assets/${HASH}.js`);

    assertEquals((await handle(url, { apiBaseUrl: API_BASE, fetchImpl }))?.status, 502);
  });

  it("bounds an upstream fetch that never settles", async () => {
    let calls = 0;
    const fetchImpl = makeFetch((_url, init) =>
      new Promise<Response>((_resolve, reject) => {
        calls++;
        init?.signal?.addEventListener(
          "abort",
          () => reject(new DOMException("Aborted", "AbortError")),
          { once: true },
        );
      })
    );
    const url = new URL(`https://site.example/_vf/assets/${HASH}.js`);

    assertEquals(
      (await handle(url, { apiBaseUrl: API_BASE, fetchImpl, timeoutMs: 1 }))?.status,
      504,
    );
    assertEquals(
      (await handle(url, { apiBaseUrl: API_BASE, fetchImpl, timeoutMs: 1 }))?.status,
      504,
    );
    assertEquals(calls, 2);
  });

  it("bounds an upstream response body that never settles", async () => {
    const fetchImpl = makeFetch(() =>
      new Response(new ReadableStream<Uint8Array>(), {
        status: 200,
        headers: { "Content-Type": "text/javascript" },
      })
    );
    const url = new URL(`https://site.example/_vf/assets/${HASH}.js`);

    assertEquals(
      (await handle(url, { apiBaseUrl: API_BASE, fetchImpl, timeoutMs: 1 }))?.status,
      504,
    );
  });

  it("queues cold loads past the concurrency bound instead of shedding them", async () => {
    const gate = Promise.withResolvers<void>();
    const sources = Array.from(
      { length: 51 },
      (_, index) => `export const asset${index} = ${index};`,
    );
    const urls = await Promise.all(sources.map((source) => assetUrl(source, "js")));
    const sourceByHash = new Map(
      urls.map((url, index) => [
        url.pathname.slice("/_vf/assets/".length, -".js".length),
        sources[index]!,
      ]),
    );
    let active = 0;
    let maxActive = 0;
    let calls = 0;
    const fetchImpl = makeFetch(async (input) => {
      calls++;
      active++;
      maxActive = Math.max(maxActive, active);
      await gate.promise;
      active--;
      const hash = new URL(input).pathname.split("/").at(-1)!;
      return new Response(sourceByHash.get(hash), {
        headers: { "Content-Type": "text/javascript" },
      });
    });
    const queuedController = new AbortController();
    const pending = urls.slice(0, 50).map((url, index) =>
      index === 4
        ? handleWithSignal(
          url,
          { apiBaseUrl: API_BASE, fetchImpl },
          queuedController.signal,
        )
        : handle(url, { apiBaseUrl: API_BASE, fetchImpl })
    );
    await flushAsyncWork();
    assertEquals(calls, 4);
    assertEquals(maxActive, 4);

    queuedController.abort(new Error("queued caller disconnected"));
    assertEquals((await pending[4])?.status, 499);
    const replacement = handle(urls[50]!, { apiBaseUrl: API_BASE, fetchImpl });

    gate.resolve();
    const responses = await Promise.all(pending);
    assertEquals((await replacement)?.status, 200);
    // Every caller that stayed connected is served. Demand past the permit
    // count waits its turn; it is never shed, because a shed asset is a dead
    // page — browser `import()` does not retry.
    assertEquals(
      responses.filter((response) => response?.status === 200).length,
      49,
    );
    assertEquals(
      responses.filter((response) => response?.status === 503).length,
      0,
    );
    assertEquals(
      responses.filter((response) => response?.status === 499).length,
      1,
    );
    // Queueing must not widen the one bound that guards real memory.
    assertEquals(maxActive, 4);
    // One upstream load per distinct hash, minus the caller that disconnected
    // while queued, plus the replacement.
    assertEquals(calls, 50);

    assertEquals(
      (await handle(urls[49]!, { apiBaseUrl: API_BASE, fetchImpl }))?.status,
      200,
    );
    assertEquals(calls, 50);
  });

  it("serves every same-hash follower from one upstream load", async () => {
    const source = "export const boundedFollowers = true;";
    const gate = Promise.withResolvers<void>();
    let calls = 0;
    const fetchImpl = makeFetch(async () => {
      calls++;
      await gate.promise;
      return new Response(source, {
        headers: { "Content-Type": "text/javascript" },
      });
    });
    const url = await assetUrl(source, "js");
    const pending = Array.from(
      { length: 80 },
      () => handle(url, { apiBaseUrl: API_BASE, fetchImpl }),
    );
    await flushAsyncWork();
    assertEquals(calls, 1);

    gate.resolve();
    const responses = await Promise.all(pending);
    // Followers of a load that already succeeded hold no resource of their
    // own: the bytes are in memory and identical for all of them. Rejecting
    // any of them would protect nothing.
    assertEquals(
      responses.filter((response) => response?.status === 200).length,
      80,
    );
    assertEquals(
      responses.filter((response) => response?.status === 503).length,
      0,
    );
    assertEquals(calls, 1);
  });

  it("allows only GET and HEAD on the immutable asset endpoint", async () => {
    let calls = 0;
    const fetchImpl = makeFetch(() => {
      calls++;
      return new Response("unused");
    });
    const url = new URL(`https://site.example/_vf/assets/${HASH}.js`);

    const response = await handle(url, { apiBaseUrl: API_BASE, fetchImpl }, "POST");
    assertEquals(response?.status, 405);
    assertEquals(response?.headers.get("Allow"), "GET, HEAD");
    assertEquals(calls, 0);
  });

  it("serves HEAD metadata without a response body", async () => {
    const source = "export const x = 1;";
    const fetchImpl = makeFetch(() =>
      new Response(source, {
        status: 200,
        headers: { "Content-Type": "text/javascript" },
      })
    );
    const url = await assetUrl(source, "js");

    const response = await handle(url, { apiBaseUrl: API_BASE, fetchImpl }, "HEAD");
    assertEquals(response?.status, 200);
    assertEquals(response?.body, null);
    assertEquals(response?.headers.get("Content-Type"), "text/javascript");
  });

  it("serves cached bytes on a second request without re-fetching", async () => {
    const source = "export const x = 1;";
    let calls = 0;
    const fetchImpl = makeFetch(() => {
      calls++;
      return new Response(source, {
        status: 200,
        headers: { "Content-Type": "text/javascript" },
      });
    });
    const url = await assetUrl(source, "js");

    await handle(url, { apiBaseUrl: API_BASE, fetchImpl });
    await handle(url, { apiBaseUrl: API_BASE, fetchImpl });
    assertEquals(calls, 1);
  });

  it("evicts completed assets by aggregate byte weight", async () => {
    const bodySize = 8 * 1024 * 1024;
    const sources = Array.from(
      { length: 4 },
      (_, index) => String(index).repeat(bodySize),
    );
    const urls = await Promise.all(sources.map((source) => assetUrl(source, "js")));
    const sourceByHash = new Map(
      urls.map((url, index) => [
        url.pathname.slice("/_vf/assets/".length, -".js".length),
        sources[index]!,
      ]),
    );
    let calls = 0;
    const fetchImpl = makeFetch((input) => {
      calls++;
      const hash = new URL(input).pathname.split("/").at(-1)!;
      return new Response(sourceByHash.get(hash), {
        headers: { "Content-Type": "text/javascript" },
      });
    });

    for (const url of urls) {
      assertEquals(
        (await handle(url, { apiBaseUrl: API_BASE, fetchImpl }))?.status,
        200,
      );
    }
    assertEquals(calls, 4);

    assertEquals(
      (await handle(urls[0]!, { apiBaseUrl: API_BASE, fetchImpl }))?.status,
      200,
    );
    assertEquals(calls, 5);
  });
});
