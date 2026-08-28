import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertRejects, assertStrictEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  guardedOutboundFetch,
  OutboundRequestBlockedError,
} from "#veryfront/security/http/outbound-fetch.ts";
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
    let ambientDuringCall: unknown;
    const realFetch = globalThis.fetch;
    const stub = (input: RequestInfo | URL) => {
      seen = input instanceof Request ? input.url : String(input);
      return Promise.resolve(Response.json({ stubbed: true }));
    };

    const response = await withMockFetch(stub, () => {
      ambientDuringCall = globalThis.fetch;
      return guardedOutboundFetch(`https://${UNRESOLVABLE_HOST}/v1/models`);
    });

    assertEquals(await response.json(), { stubbed: true });
    assertEquals(seen, `https://${UNRESOLVABLE_HOST}/v1/models`);
    assertStrictEquals(
      ambientDuringCall,
      stub,
      "withMockFetch installs the stub as the ambient fetch for the callback",
    );
    assertStrictEquals(
      globalThis.fetch,
      realFetch,
      "withMockFetch puts the ambient fetch back once the callback settles",
    );
  });

  it("does not allow the resolver sentinel as a request destination", async () => {
    let calls = 0;
    await withMockFetch(
      () => {
        calls++;
        return Promise.resolve(new Response("unexpected"));
      },
      async () => {
        await assertRejects(
          () => guardedOutboundFetch("https://192.0.2.1/private"),
          OutboundRequestBlockedError,
          "internal host",
        );
      },
    );
    assertEquals(calls, 0);
  });

  it("serializes overlapping callers so each sees only its own stub", async () => {
    const realFetch = globalThis.fetch;
    const enteredA = Promise.withResolvers<void>();
    const enteredB = Promise.withResolvers<void>();
    const gateA = Promise.withResolvers<void>();
    const gateB = Promise.withResolvers<void>();

    const callA = withMockFetch(
      () => Promise.resolve(Response.json({ from: "a" })),
      async () => {
        enteredA.resolve();
        await gateA.promise;
        const response = await guardedOutboundFetch(`https://${UNRESOLVABLE_HOST}/a`);
        assertEquals(await response.json(), { from: "a" }, "call A must see only its own stub");
      },
    );

    await enteredA.promise;

    const callB = withMockFetch(
      () => Promise.resolve(Response.json({ from: "b" })),
      async () => {
        enteredB.resolve();
        await gateB.promise;
        const response = await guardedOutboundFetch(`https://${UNRESOLVABLE_HOST}/b`);
        assertEquals(await response.json(), { from: "b" }, "call B must see only its own stub");
      },
    );

    gateA.resolve();
    await callA;

    await enteredB.promise;
    gateB.resolve();
    await callB;

    assertStrictEquals(
      globalThis.fetch,
      realFetch,
      "both stubs must be uninstalled once the overlapping calls settle",
    );
  });

  it("does the same for the install and restore pair", async () => {
    const realFetch = globalThis.fetch;
    installMockFetch(() => Promise.resolve(Response.json({ stubbed: true })));

    try {
      assertEquals(
        globalThis.fetch === realFetch,
        false,
        "installMockFetch replaces the ambient fetch",
      );
      const response = await guardedOutboundFetch(`https://${UNRESOLVABLE_HOST}/v1/models`);
      assertEquals(await response.json(), { stubbed: true });
    } finally {
      restoreMockFetch();
    }

    assertStrictEquals(
      globalThis.fetch,
      realFetch,
      "restoreMockFetch puts the ambient fetch back",
    );
    await assertRejects(
      () => guardedOutboundFetch(`https://${UNRESOLVABLE_HOST}/v1/models`),
      Error,
      undefined,
      "the stub outbound transport is uninstalled, so the unresolvable host now fails",
    );
  });

  it("restores the pristine state even when the stub is swapped mid-test", async () => {
    const realFetch = globalThis.fetch;
    installMockFetch(() => Promise.resolve(Response.json({ stub: "first" })));
    installMockFetch(() => Promise.resolve(Response.json({ stub: "second" })));

    try {
      const response = await guardedOutboundFetch(`https://${UNRESOLVABLE_HOST}/v1/models`);
      assertEquals(
        await response.json(),
        { stub: "second" },
        "the most recent stub serves the request",
      );
    } finally {
      restoreMockFetch();
    }

    assertStrictEquals(
      globalThis.fetch,
      realFetch,
      "only the first install records the pristine fetch, so one restore is enough",
    );
    await assertRejects(
      () => guardedOutboundFetch(`https://${UNRESOLVABLE_HOST}/v1/models`),
      Error,
      undefined,
      "one restore uninstalls the transport back to the real one, not to the earlier stub",
    );
  });
});
