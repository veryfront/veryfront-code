import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import * as router from "./index.tsx";

/**
 * Locks the public `veryfront/router` surface. The router exposes a single
 * `useRouter()` hook; the short-lived `usePathname`/`useParams`/`useSearchParams`
 * hooks were removed (they read the same context, so their granularity was
 * illusory). This guard fails if any of them is reintroduced to the barrel.
 */
describe("veryfront/router public export surface", () => {
  it("exposes the single useRouter() hook and the provider primitives", () => {
    assertEquals(typeof router.useRouter, "function");
    assertEquals(typeof router.RouterProvider, "function");
    assertEquals(typeof router.Router, "function");
    assertEquals(typeof router.Link, "function");
  });

  it("does not re-expose the removed granular hooks", () => {
    const surface = router as Record<string, unknown>;
    assertEquals(surface.usePathname, undefined);
    assertEquals(surface.useParams, undefined);
    assertEquals(surface.useSearchParams, undefined);
  });
});
