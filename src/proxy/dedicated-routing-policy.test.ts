import { assertEquals, assertThrows } from "#veryfront/testing/assert";
import {
  hasDedicatedAssignmentContext,
  parseRequiredDedicatedRouting,
  retryDedicatedTarget,
  websocketRendererOrigin,
} from "./dedicated-routing-policy.ts";

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

  await t.step("managed project without environment identity cannot share", () => {
    assertEquals(hasDedicatedAssignmentContext("owned-project", undefined, true), false);
    assertEquals(hasDedicatedAssignmentContext("owned-project", "env-owned", true), true);
    assertEquals(hasDedicatedAssignmentContext(undefined, undefined, true), true);
    assertEquals(hasDedicatedAssignmentContext("owned-project", undefined, false), true);
  });

  await t.step("strict WebSocket selects assigned renderer and explicit none stays shared", () => {
    const shared = "http://shared-renderer:20000";
    const assigned = "http://veryfront-server-owned:3001";
    assertEquals(websocketRendererOrigin(shared, assigned, true), assigned);
    assertEquals(websocketRendererOrigin(shared, null, true), shared);
    assertEquals(websocketRendererOrigin(shared, assigned, false), shared);
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
