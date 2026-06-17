import "#veryfront/schemas/_test-setup.ts";

import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { removeStickyCookieFromPublicCacheableResponse } from "./response-headers.ts";

function getSetCookies(headers: Headers): string[] {
  const getSetCookie = headers.getSetCookie;
  if (typeof getSetCookie === "function") {
    return getSetCookie.call(headers);
  }

  const values: string[] = [];
  for (const [key, value] of headers) {
    if (key.toLowerCase() === "set-cookie") values.push(value);
  }
  return values;
}

describe("proxy response headers", () => {
  it("removes the load-balancer cookie from public page-data responses", async () => {
    const headers = new Headers({
      "Cache-Control": "public, max-age=60, stale-while-revalidate=1800",
      "Content-Type": "application/json",
    });
    headers.append("Set-Cookie", "lb=server-a; Path=/; HttpOnly; SameSite=Lax");

    const response = removeStickyCookieFromPublicCacheableResponse(
      new Response('{"ok":true}', { headers }),
    );

    assertEquals(getSetCookies(response.headers), []);
    assertEquals(await response.text(), '{"ok":true}');
  });

  it("preserves application cookies while removing lb on public cacheable responses", () => {
    const headers = new Headers({
      "Cache-Control": "public, max-age=31536000, immutable",
      "Content-Type": "text/javascript",
    });
    headers.append("Set-Cookie", "lb=server-a; Path=/; HttpOnly");
    headers.append("Set-Cookie", "session=keep; Path=/; HttpOnly");

    const response = removeStickyCookieFromPublicCacheableResponse(
      new Response("export const ok = true;", { headers }),
    );

    assertEquals(getSetCookies(response.headers), ["session=keep; Path=/; HttpOnly"]);
  });

  it("leaves non-cacheable sticky-cookie responses untouched", () => {
    const headers = new Headers({
      "Cache-Control": "private, no-store",
      "Set-Cookie": "lb=server-a; Path=/; HttpOnly",
    });

    const response = removeStickyCookieFromPublicCacheableResponse(
      new Response("html", { headers }),
    );

    assertEquals(getSetCookies(response.headers), ["lb=server-a; Path=/; HttpOnly"]);
  });
});
