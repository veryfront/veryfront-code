import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { afterEach, beforeEach, describe, it } from "#veryfront/testing/bdd.ts";
import { isProxyTopologyTrusted } from "./proxy-topology.ts";

const ENV_KEY = "VERYFRONT_TRUST_FORWARDED_HEADERS";

describe("isProxyTopologyTrusted", () => {
  let previousEnv: string | undefined;

  beforeEach(() => {
    previousEnv = Deno.env.get(ENV_KEY);
    Deno.env.delete(ENV_KEY);
  });

  afterEach(() => {
    if (previousEnv === undefined) {
      Deno.env.delete(ENV_KEY);
    } else {
      Deno.env.set(ENV_KEY, previousEnv);
    }
  });

  it('returns true only when VERYFRONT_TRUST_FORWARDED_HEADERS is exactly "1"', () => {
    Deno.env.set(ENV_KEY, "1");
    assertEquals(isProxyTopologyTrusted(), true);
  });

  it("fails closed for alternative truthy spellings and malformed values", () => {
    for (const value of ["true", "0", "", " 1 "]) {
      Deno.env.set(ENV_KEY, value);
      assertEquals(isProxyTopologyTrusted(), false);
    }
  });

  it("fails closed when the setting is absent", () => {
    assertEquals(isProxyTopologyTrusted(), false);
  });
});
