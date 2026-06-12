import "#veryfront/schemas/_test-setup.ts";

import { assertEquals } from "#veryfront/testing/assert.ts";
import { afterEach, describe, it } from "#veryfront/testing/bdd.ts";
import {
  clearReleaseAssetProxyCache,
  handleReleaseAssetRequest,
  isReleaseAssetPath,
} from "./asset-handler.ts";

const API_BASE = "https://api.example.com";
const HASH = "a".repeat(64);

function makeFetch(
  handler: (url: string) => Response | Promise<Response>,
): typeof fetch {
  return ((input: RequestInfo | URL) =>
    Promise.resolve(handler(String(input)))) as typeof fetch;
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
      new Response("export const x = 1;", {
        status: 200,
        headers: { "Content-Type": "text/javascript" },
      })
    );

    const res = await handleReleaseAssetRequest(
      new URL(`https://site.example/_vf/assets/${HASH}.js`),
      { apiBaseUrl: API_BASE, fetchImpl },
    );

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
    const fetchImpl = makeFetch(() =>
      new Response(".a{color:red}", {
        status: 200,
        headers: { "Content-Type": "text/css" },
      })
    );

    const res = await handleReleaseAssetRequest(
      new URL(`https://site.example/_vf/assets/${HASH}.css`),
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
      return new Response("export const x = 1;", {
        status: 200,
        headers: { "Content-Type": "text/javascript" },
      });
    });
    const url = new URL(`https://site.example/_vf/assets/${HASH}.js`);

    await handleReleaseAssetRequest(url, { apiBaseUrl: API_BASE, fetchImpl });
    await handleReleaseAssetRequest(url, { apiBaseUrl: API_BASE, fetchImpl });
    assertEquals(calls, 1);
  });
});
