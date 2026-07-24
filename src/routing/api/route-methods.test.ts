import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  normalizeRouteMethod,
  resolveExecutableRouteMethods,
  resolveRouteHandlerExport,
} from "./route-methods.ts";

describe("routing/api/route-methods", () => {
  it("uses exact, default, then GET resolution order for HEAD", () => {
    const exact = () => "exact";
    const fallback = () => "default";
    const get = () => "get";

    assertEquals(
      resolveRouteHandlerExport({ HEAD: exact, default: fallback, GET: get }, "HEAD"),
      exact,
    );
    assertEquals(
      resolveRouteHandlerExport({ default: fallback, GET: get }, "HEAD"),
      fallback,
    );
    assertEquals(resolveRouteHandlerExport({ GET: get }, "HEAD"), get);
  });

  it("uses one bounded token contract for custom execution and discovery", () => {
    const fallback = () => "default";
    const routeModule = { default: fallback };

    assertEquals(resolveRouteHandlerExport(routeModule, "propfind"), fallback);
    assertEquals(
      resolveExecutableRouteMethods(routeModule, "propfind").includes("PROPFIND"),
      true,
    );

    const oversized = "X".repeat(65);
    assertEquals(normalizeRouteMethod(oversized), null);
    assertEquals(resolveRouteHandlerExport(routeModule, oversized), undefined);
    assertEquals(
      resolveExecutableRouteMethods(routeModule, oversized).includes(oversized),
      false,
    );
    assertEquals(normalizeRouteMethod("BAD METHOD"), null);
  });
});
