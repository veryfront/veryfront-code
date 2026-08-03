import { assertEquals, assertMatch } from "@std/assert";
import {
  REACT_SSR_RENDERER_BUNDLE_BASE64,
  REACT_SSR_RENDERER_BUNDLE_SHA256,
} from "./worker-renderer-bundle.generated.ts";
import { createIsolatedSsrRenderer } from "./worker-renderer.ts";

Deno.test("React worker bundle is base64-safe and matches its generated digest", async () => {
  assertMatch(REACT_SSR_RENDERER_BUNDLE_BASE64, /^[A-Za-z0-9+/]+={0,2}$/);
  assertEquals(REACT_SSR_RENDERER_BUNDLE_BASE64.includes(")"), false);

  const bundleBytes = Uint8Array.fromBase64(REACT_SSR_RENDERER_BUNDLE_BASE64);
  const digest = new Uint8Array(
    await crypto.subtle.digest("SHA-256", bundleBytes),
  ).toHex();
  assertEquals(digest, REACT_SSR_RENDERER_BUNDLE_SHA256);
});

Deno.test("React worker renderer produces a bounded byte stream", async () => {
  const renderer = createIsolatedSsrRenderer();
  const element = renderer.createElement(
    (props: { message: string }) => props.message,
    { message: "extension-owned React SSR" },
  );
  const stream = await renderer.renderToReadableStream(element);

  assertEquals(await new Response(stream).text(), "extension-owned React SSR");
  assertEquals(Object.isFrozen(renderer), true);
});
