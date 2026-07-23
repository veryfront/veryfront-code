import "#veryfront/schemas/_test-setup.ts";

import { assertEquals } from "#veryfront/testing/assert.ts";
import { afterEach, describe, it } from "#veryfront/testing/bdd.ts";
import {
  clearReleaseAssetProxyCache,
  handleReleaseAssetRequest,
  isReleaseAssetPath,
} from "./asset-handler.ts";
import { RELEASE_ASSET_MAX_SIZE_BYTES } from "#veryfront/release-assets/constants.ts";
import { sha256Hex } from "#veryfront/release-assets/hash.ts";

const API_BASE = "https://api.example.com";
const HASH = "a".repeat(64);
const JS_BODY = "export const x = 1;";
const JS_HASH = await sha256Hex(JS_BODY);
const CSS_BODY = ".a{color:red}";
const CSS_HASH = await sha256Hex(CSS_BODY);

function makeFetch(
  handler: (url: string) => Response | Promise<Response>,
): typeof fetch {
  return ((input: RequestInfo | URL) => Promise.resolve(handler(String(input)))) as typeof fetch;
}

describe("proxy release asset handler", () => {
  afterEach(() => clearReleaseAssetProxyCache());

  it("recognizes the asset path prefix", () => {
    assertEquals(isReleaseAssetPath(`/_vf/assets/${HASH}.js`), true);
    assertEquals(isReleaseAssetPath("/index.html"), false);
  });

  it("returns null for non-asset paths", async () => {
    const result = await handleReleaseAssetRequest(
      new URL("https://site.example/page"),
      { apiBaseUrl: API_BASE },
    );
    assertEquals(result, null);
  });

  it("serves a JS asset with immutable + nosniff headers (happy path)", async () => {
    const fetchImpl = makeFetch(() =>
      new Response(JS_BODY, {
        status: 200,
        headers: { "Content-Type": "text/javascript" },
      })
    );

    const res = await handleReleaseAssetRequest(
      new URL(`https://site.example/_vf/assets/${JS_HASH}.js`),
      { apiBaseUrl: API_BASE, fetchImpl },
    );

    assertEquals(res?.status, 200);
    assertEquals(res?.headers.get("Content-Type"), "text/javascript");
    assertEquals(
      res?.headers.get("Cache-Control"),
      "public, max-age=31536000, immutable",
    );
    assertEquals(res?.headers.get("X-Content-Type-Options"), "nosniff");
    assertEquals(await res?.text(), JS_BODY);
  });

  it("serves a CSS asset with the css content type", async () => {
    const fetchImpl = makeFetch(() =>
      new Response(CSS_BODY, {
        status: 200,
        headers: { "Content-Type": "text/css" },
      })
    );

    const res = await handleReleaseAssetRequest(
      new URL(`https://site.example/_vf/assets/${CSS_HASH}.css`),
      { apiBaseUrl: API_BASE, fetchImpl },
    );

    assertEquals(res?.status, 200);
    assertEquals(res?.headers.get("Content-Type"), "text/css");
  });

  it("returns 400 for a bad hash", async () => {
    const res = await handleReleaseAssetRequest(
      new URL("https://site.example/_vf/assets/NOTHEX.js"),
      { apiBaseUrl: API_BASE, fetchImpl: makeFetch(() => new Response("nope")) },
    );
    assertEquals(res?.status, 400);
  });

  it("returns 400 for a disallowed extension", async () => {
    const res = await handleReleaseAssetRequest(
      new URL(`https://site.example/_vf/assets/${HASH}.png`),
      { apiBaseUrl: API_BASE, fetchImpl: makeFetch(() => new Response("nope")) },
    );
    assertEquals(res?.status, 400);
  });

  it("returns a no-cache 404 when upstream is missing", async () => {
    const fetchImpl = makeFetch(() => new Response("missing", { status: 404 }));
    const res = await handleReleaseAssetRequest(
      new URL(`https://site.example/_vf/assets/${HASH}.js`),
      { apiBaseUrl: API_BASE, fetchImpl },
    );
    assertEquals(res?.status, 404);
    assertEquals(res?.headers.get("Cache-Control"), "no-cache");
  });

  it("returns 502 when upstream content-type is not allowlisted", async () => {
    const fetchImpl = makeFetch(() =>
      new Response("<html>", { status: 200, headers: { "Content-Type": "text/html" } })
    );
    const res = await handleReleaseAssetRequest(
      new URL(`https://site.example/_vf/assets/${HASH}.js`),
      { apiBaseUrl: API_BASE, fetchImpl },
    );
    assertEquals(res?.status, 502);
  });

  it("serves cached bytes on a second request without re-fetching", async () => {
    let calls = 0;
    const fetchImpl = makeFetch(() => {
      calls++;
      return new Response(JS_BODY, {
        status: 200,
        headers: { "Content-Type": "text/javascript" },
      });
    });
    const url = new URL(`https://site.example/_vf/assets/${JS_HASH}.js`);

    await handleReleaseAssetRequest(url, { apiBaseUrl: API_BASE, fetchImpl });
    await handleReleaseAssetRequest(url, { apiBaseUrl: API_BASE, fetchImpl });
    assertEquals(calls, 1);
  });

  it("rejects bytes that do not match the content-addressed hash", async () => {
    let calls = 0;
    const fetchImpl = makeFetch(() => {
      calls++;
      return new Response(calls === 1 ? "tampered" : JS_BODY, {
        headers: { "Content-Type": "text/javascript" },
      });
    });
    const url = new URL(`https://site.example/_vf/assets/${JS_HASH}.js`);

    const rejected = await handleReleaseAssetRequest(url, { apiBaseUrl: API_BASE, fetchImpl });
    const recovered = await handleReleaseAssetRequest(url, { apiBaseUrl: API_BASE, fetchImpl });

    assertEquals(rejected?.status, 502);
    assertEquals(recovered?.status, 200);
    assertEquals(await recovered?.text(), JS_BODY);
    assertEquals(calls, 2);
  });

  it("rejects an oversized declared body before buffering it", async () => {
    let cancelled = false;
    const body = new ReadableStream<Uint8Array>({
      pull() {},
      cancel() {
        cancelled = true;
      },
    });
    const fetchImpl = makeFetch(() =>
      new Response(body, {
        headers: {
          "Content-Type": "text/javascript",
          "Content-Length": String(RELEASE_ASSET_MAX_SIZE_BYTES + 1),
        },
      })
    );

    const response = await handleReleaseAssetRequest(
      new URL(`https://site.example/_vf/assets/${HASH}.js`),
      { apiBaseUrl: API_BASE, fetchImpl },
    );

    assertEquals(response?.status, 502);
    assertEquals(cancelled, true);
  });

  it("cancels a chunked body as soon as it exceeds the asset limit", async () => {
    let cancelled = false;
    let chunk = 0;
    const body = new ReadableStream<Uint8Array>(
      {
        pull(controller) {
          controller.enqueue(new Uint8Array(chunk++ === 0 ? RELEASE_ASSET_MAX_SIZE_BYTES : 1));
        },
        cancel() {
          cancelled = true;
        },
      },
      { highWaterMark: 0 },
    );
    const fetchImpl = makeFetch(() =>
      new Response(body, { headers: { "Content-Type": "text/javascript" } })
    );

    const response = await handleReleaseAssetRequest(
      new URL(`https://site.example/_vf/assets/${HASH}.js`),
      { apiBaseUrl: API_BASE, fetchImpl },
    );

    assertEquals(response?.status, 502);
    assertEquals(cancelled, true);
    assertEquals(chunk, 2);
  });
});
