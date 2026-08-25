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
      "an exact method export wins over the default export",
    );
    assertEquals(
      resolveRouteHandlerExport({ default: fallback, GET: get }, "HEAD"),
      fallback,
      "the default export wins over the GET fallback",
    );
    assertEquals(
      resolveRouteHandlerExport({ GET: get }, "HEAD"),
      get,
      "GET supplies the conventional HEAD fallback",
    );
    assertEquals(
      resolveRouteHandlerExport({ GET: get }, "POST"),
      undefined,
      "GET backs HEAD only, never POST",
    );
    assertEquals(
      resolveRouteHandlerExport({ GET: get }, "DELETE"),
      undefined,
      "GET backs HEAD only, never DELETE",
    );
  });

  it("uses one bounded token contract for custom execution and discovery", () => {
    const fallback = () => "default";
    const routeModule = { default: fallback };

    assertEquals(
      resolveRouteHandlerExport(routeModule, "propfind"),
      fallback,
      "a default export executes a bounded custom method",
    );
    assertEquals(
      resolveExecutableRouteMethods(routeModule, "propfind"),
      ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS", "PROPFIND"],
      "a default export advertises the full standard surface plus the probed custom method, standard first",
    );

    const oversized = "X".repeat(65);
    assertEquals(normalizeRouteMethod(oversized), null, "an oversized token is not a method");
    assertEquals(
      resolveRouteHandlerExport(routeModule, oversized),
      undefined,
      "an oversized token resolves no handler",
    );
    assertEquals(
      resolveExecutableRouteMethods(routeModule, oversized).includes(oversized),
      false,
      "an oversized token is never advertised",
    );
    assertEquals(normalizeRouteMethod("BAD METHOD"), null, "a token with a space is not a method");
  });

  it("advertises named uppercase exports when the module has no default export", () => {
    const get = () => "get";

    assertEquals(
      resolveExecutableRouteMethods({ GET: get }),
      ["GET", "HEAD", "OPTIONS"],
      "named GET implies HEAD and framework OPTIONS",
    );
    assertEquals(
      resolveExecutableRouteMethods({ GET: get }, undefined, { includeFrameworkOptions: false }),
      ["GET", "HEAD"],
      "framework OPTIONS is opt-out",
    );
  });
});
