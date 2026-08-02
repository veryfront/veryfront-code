import { assertEquals, assertRejects } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { guardedOutboundFetch, OutboundRequestBlockedError } from "./outbound-fetch.ts";

describe("guardedOutboundFetch", () => {
  it("rejects loopback and cloud metadata before invoking fetch", async () => {
    let calls = 0;
    const fetchImpl: typeof fetch = () => {
      calls++;
      return Promise.resolve(new Response("unexpected"));
    };

    await assertRejects(
      () => guardedOutboundFetch("http://127.0.0.1/private", undefined, { fetchImpl }),
      OutboundRequestBlockedError,
      "internal host",
    );
    await assertRejects(
      () => guardedOutboundFetch("http://169.254.169.254/metadata", undefined, { fetchImpl }),
      OutboundRequestBlockedError,
      "internal host",
    );
    assertEquals(calls, 0);
  });

  it("rejects non-HTTP schemes and URL credentials", async () => {
    let calls = 0;
    const fetchImpl: typeof fetch = () => {
      calls++;
      return Promise.resolve(new Response("unexpected"));
    };
    await assertRejects(
      () => guardedOutboundFetch("file:///private/config", undefined, { fetchImpl }),
      OutboundRequestBlockedError,
      "unsupported URL scheme",
    );
    await assertRejects(
      () => guardedOutboundFetch("https://user:secret@93.184.216.34/", undefined, { fetchImpl }),
      OutboundRequestBlockedError,
      "URL credentials are not allowed",
    );
    assertEquals(calls, 0);
  });

  it("rejects a public hostname whose DNS answer is private", async () => {
    let calls = 0;
    await assertRejects(
      () =>
        guardedOutboundFetch("https://public.example/resource", undefined, {
          fetchImpl: () => {
            calls++;
            return Promise.resolve(new Response("unexpected"));
          },
          resolveHost: () => Promise.resolve(["10.0.0.8"]),
        }),
      OutboundRequestBlockedError,
      "blocked for host",
    );
    assertEquals(calls, 0);
  });

  it("applies caller authorization to every redirect destination", async () => {
    const seen: string[] = [];
    const fetchImpl: typeof fetch = (input) => {
      const url = String(input);
      if (url.endsWith("/start")) {
        return Promise.resolve(
          new Response(null, {
            status: 302,
            headers: { location: "https://93.184.216.35/next" },
          }),
        );
      }
      return Promise.resolve(new Response("unexpected"));
    };

    await assertRejects(
      () =>
        guardedOutboundFetch("https://93.184.216.34/start", undefined, {
          fetchImpl,
          authorizeUrl(url) {
            seen.push(url.href);
            if (url.hostname !== "93.184.216.34") {
              throw new OutboundRequestBlockedError("origin is not allowed");
            }
          },
        }),
      OutboundRequestBlockedError,
      "origin is not allowed",
    );
    assertEquals(seen, [
      "https://93.184.216.34/start",
      "https://93.184.216.35/next",
    ]);
  });
});
