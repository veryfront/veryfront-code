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
    const fetchImpl = makeFetch(() =>
      new Response(source, {
        status: 200,
        headers: { "Content-Type": "text/javascript" },
      })
    );
    const url = await assetUrl(source, "js");

    const res = await handle(url, { apiBaseUrl: API_BASE, fetchImpl });

    assertEquals(res?.status, 200);
    assertEquals(res?.headers.get("Content-Type"), "text/javascript");
    assertEquals(
      res?.headers.get("Cache-Control"),
      "public, max-age=31536000, immutable",
    );
    assertEquals(res?.headers.get("X-Content-Type-Options"), "nosniff");
    assertEquals(await res?.text(), "export const x = 1;");
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
    const fetchImpl = makeFetch((_url, init) =>
      new Promise<Response>((_resolve, reject) => {
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
      502,
    );
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
      502,
    );
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
});
