// Mutates global String.prototype methods, so it belongs in the semantic
// integration suite rather than a hermetic unit module.
import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  guardedEgressFetch,
  isInternalEgressOverrideEnabled,
} from "#veryfront/security/sandbox/worker-egress-guard.ts";

describe("worker-egress-guard isInternalEgressOverrideEnabled prototype-poisoning boundary", () => {
  it(
    "is not fooled by a poisoned String.prototype.trim into treating a non-enabling value as enabled",
    () => {
      const originalTrim = String.prototype.trim;
      // deno-lint-ignore no-explicit-any
      (String.prototype as any).trim = function () {
        return "true";
      };
      try {
        assertEquals(isInternalEgressOverrideEnabled("false"), false);
      } finally {
        String.prototype.trim = originalTrim;
      }
    },
  );

  it(
    "is not fooled by a poisoned String.prototype.toLowerCase into treating a non-enabling value as enabled",
    () => {
      const originalToLowerCase = String.prototype.toLowerCase;
      // deno-lint-ignore no-explicit-any
      (String.prototype as any).toLowerCase = function () {
        return "true";
      };
      try {
        assertEquals(isInternalEgressOverrideEnabled("FALSE"), false);
      } finally {
        String.prototype.toLowerCase = originalToLowerCase;
      }
    },
  );
});

describe("worker-egress-guard response metadata intrinsics", () => {
  it("seals host responses before abort-aware guard settlement", async () => {
    const pendingResponse = Promise.resolve(new Response("authenticated content"));
    const original = Object.getOwnPropertyDescriptor(Response.prototype, "then");
    let intercepted = false;
    let response: Response;
    Object.defineProperty(Response.prototype, "then", {
      configurable: true,
      get() {
        intercepted = true;
        return undefined;
      },
    });
    try {
      response = await guardedEgressFetch("http://93.184.216.34/file", {
        signal: new AbortController().signal,
        headers: { authorization: "Bearer test-token" },
      }, { fetchImpl: () => pendingResponse, pinnedFetch: () => pendingResponse });
    } finally {
      if (original) Object.defineProperty(Response.prototype, "then", original);
      else Reflect.deleteProperty(Response.prototype, "then");
    }
    assertEquals(intercepted, false);
    assertEquals(await response.text(), "authenticated content");
  });

  it("does not expose a host response to replaced Object.defineProperties", async () => {
    const original = Object.defineProperties;
    const response = new Response("authenticated content");
    const pendingResponse = Promise.resolve(response);
    let intercepted = false;
    Object.defineProperties = (target, descriptors) => {
      if (target === response) intercepted = true;
      return original(target, descriptors);
    };
    let result: Response;
    try {
      result = await guardedEgressFetch("http://93.184.216.34/file", undefined, {
        fetchImpl: () => pendingResponse,
        pinnedFetch: () => pendingResponse,
      });
    } finally {
      Object.defineProperties = original;
    }
    assertEquals(intercepted, false);
    assertEquals(result.url, "http://93.184.216.34/file");
    assertEquals(await result.text(), "authenticated content");
  });
});
