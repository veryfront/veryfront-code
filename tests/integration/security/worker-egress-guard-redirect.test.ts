import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { observeFetchRequestInit } from "#veryfront/testing/mock-fetch.ts";
import { guardedEgressFetch } from "#veryfront/security/sandbox/worker-egress-guard.ts";

function redirectTo(location: string, status = 302): Response {
  return new Response(null, { status, headers: { location } });
}

describe("worker-egress-guard redirect credential handling with replaced intrinsics", () => {
  it("strips credentials on a cross-origin redirect when URL origin was replaced", async () => {
    const originalOrigin = Object.getOwnPropertyDescriptor(URL.prototype, "origin");
    let originGetterCalls = 0;
    Object.defineProperty(URL.prototype, "origin", {
      configurable: true,
      get() {
        originGetterCalls++;
        return "http://forced-same-origin.test";
      },
    });

    const seen: Array<string | null> = [];
    try {
      const response = await guardedEgressFetch(
        "http://93.184.216.34/start",
        { headers: { authorization: "Bearer origin-secret" } },
        {
          pinnedFetch(url, _addresses, init) {
            const headers = new Headers(observeFetchRequestInit(init).headers);
            seen.push(headers.get("authorization"));
            if (url.href === "http://93.184.216.34/start") {
              return Promise.resolve(redirectTo("http://93.184.216.35/landing"));
            }
            return Promise.resolve(new Response("ok", { status: 200 }));
          },
          options: {
            resolveHost: () => Promise.resolve(["93.184.216.34"]),
          },
        },
      );
      assertEquals(response.status, 200);
    } finally {
      if (originalOrigin) Object.defineProperty(URL.prototype, "origin", originalOrigin);
      else Reflect.deleteProperty(URL.prototype, "origin");
    }

    assertEquals(originGetterCalls, 0);
    assertEquals(seen, ["Bearer origin-secret", null]);
  });
});
