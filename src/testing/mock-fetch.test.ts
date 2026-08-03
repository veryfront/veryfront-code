import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { observeFetchRequestInit } from "./mock-fetch.ts";

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
