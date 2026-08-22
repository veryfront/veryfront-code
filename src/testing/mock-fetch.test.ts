import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { guardedOutboundFetch } from "#veryfront/security/http/outbound-fetch.ts";
import {
  installMockFetch,
  observeFetchRequestInit,
  restoreMockFetch,
  withMockFetch,
} from "./mock-fetch.ts";

/**
 * A name reserved by RFC 2606 that no resolver anywhere answers for.
 *
 * A stubbed request that still performs DNS dies on this host, wherever it
 * runs and whatever network permission the suite holds. A stubbed request that
 * performs no DNS reaches the stub.
 */
const UNRESOLVABLE_HOST = "vf-stub-target.invalid";

describe("observeFetchRequestInit", () => {
  it("returns no observed fields when request init is absent", () => {
    assertEquals(observeFetchRequestInit(undefined), {});
  });

  it("preserves the standard fields used by fetch mocks", () => {
    const controller = new AbortController();
    const init: RequestInit = {
      body: "payload",
      headers: { authorization: "Bearer token" },
      method: "POST",
      redirect: "error",
      signal: controller.signal,
    };

    const observed = observeFetchRequestInit(init);
    assertEquals(observed.body, "payload");
    assertEquals(new Headers(observed.headers).get("authorization"), "Bearer token");
    assertEquals(observed.method, "POST");
    assertEquals(observed.redirect, "error");
    assertEquals(observed.signal, controller.signal);
  });
});

describe("mock fetch host resolution", () => {
  it("routes a guarded request without resolving the destination host", async () => {
    let seen: string | undefined;

    const response = await withMockFetch(
      (input: RequestInfo | URL) => {
        seen = input instanceof Request ? input.url : String(input);
        return Promise.resolve(Response.json({ stubbed: true }));
      },
      () => guardedOutboundFetch(`https://${UNRESOLVABLE_HOST}/v1/models`),
    );

    assertEquals(await response.json(), { stubbed: true });
    assertEquals(seen, `https://${UNRESOLVABLE_HOST}/v1/models`);
  });

  it("does the same for the install and restore pair", async () => {
    installMockFetch(() => Promise.resolve(Response.json({ stubbed: true })));

    try {
      const response = await guardedOutboundFetch(`https://${UNRESOLVABLE_HOST}/v1/models`);
      assertEquals(await response.json(), { stubbed: true });
    } finally {
      restoreMockFetch();
    }
  });
});
