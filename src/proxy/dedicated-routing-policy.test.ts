import { assertEquals, assertThrows } from "#veryfront/testing/assert";
import { parseRequiredDedicatedRouting, retryDedicatedTarget } from "./dedicated-routing-policy.ts";

Deno.test("dedicated routing host policy", async (t) => {
  await t.step("requires an exact boolean and preserves the default", () => {
    assertEquals(parseRequiredDedicatedRouting(undefined), false);
    assertEquals(parseRequiredDedicatedRouting(""), false);
    assertEquals(parseRequiredDedicatedRouting("false"), false);
    assertEquals(parseRequiredDedicatedRouting("true"), true);
    for (const value of ["1", "TRUE", "yes", " true "]) {
      assertThrows(() => parseRequiredDedicatedRouting(value), TypeError);
    }
  });

  await t.step("strict retries preserve the same assigned dedicated origin", () => {
    const assigned = "http://veryfront-server-1.owned.svc.cluster.local:3001";
    assertEquals(retryDedicatedTarget(assigned, true), {
      pinnedDedicatedUrl: assigned,
      skipDedicated: false,
    });
    assertEquals(retryDedicatedTarget(assigned, false), {
      pinnedDedicatedUrl: null,
      skipDedicated: true,
    });
    assertEquals(retryDedicatedTarget(null, true), {
      pinnedDedicatedUrl: null,
      skipDedicated: false,
    });
  });
});
