import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertThrows } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import * as catalogData from "./model-catalog.data.ts";
import { requireVeryfrontCloudWireSurface, VERYFRONT_CLOUD_CHAT_MODELS } from "./model-catalog.ts";

/** Whether this package builds requests for a surface the catalog names. */
function speaksSurface(surface: string): boolean {
  try {
    requireVeryfrontCloudWireSurface(surface);
    return true;
  } catch {
    return false;
  }
}

/** Collects the path of every function value reachable from a data export. */
function findFunctionPaths(value: unknown, path: string, seen: Set<unknown>): string[] {
  if (typeof value === "function") return [path];
  if (value === null || typeof value !== "object" || seen.has(value)) return [];
  seen.add(value);

  if (value instanceof Map) {
    return Array.from(value.entries()).flatMap(([key, entry]) => [
      ...findFunctionPaths(key, `${path}<key ${String(key)}>`, seen),
      ...findFunctionPaths(entry, `${path}.get(${String(key)})`, seen),
    ]);
  }
  if (Array.isArray(value)) {
    return value.flatMap((entry, index) => findFunctionPaths(entry, `${path}[${index}]`, seen));
  }
  return Object.entries(value).flatMap(([key, entry]) =>
    findFunctionPaths(entry, `${path}.${key}`, seen)
  );
}

describe("provider/veryfront-cloud/model-catalog.data", () => {
  it("exports data only, so logic cannot move into the data module", () => {
    const functionPaths = Object.entries(catalogData).flatMap(([name, value]) =>
      findFunctionPaths(value, name, new Set())
    );

    assertEquals(functionPaths, []);
  });

  it("lists every provider with a chat model exactly once in the labels and the display order", () => {
    // An alias may also target a provider the catalog lists no chat model for
    // (its ids still resolve through the alias and its routing row); such a
    // provider has no label or display-order row, which only the chat list needs.
    const aliased = new Set(catalogData.VERYFRONT_CLOUD_PROVIDER_ALIASES.map(([, id]) => id));
    const ordered = [...catalogData.VERYFRONT_CLOUD_PROVIDER_ORDER];

    assertEquals(new Set(ordered).size, ordered.length);
    for (const provider of ordered) {
      assertEquals(aliased.has(provider), true, `no alias row for "${provider}"`);
    }
    assertEquals(
      Object.keys(catalogData.VERYFRONT_CLOUD_PROVIDER_LABELS).sort(),
      [...ordered].sort(),
    );
  });

  it("declares a routed surface for every provider, and a version for every surface it speaks", () => {
    const providers = new Set(catalogData.VERYFRONT_CLOUD_PROVIDER_ALIASES.map(([, id]) => id));
    const versionedSurfaces = new Set(
      catalogData.VERYFRONT_CLOUD_SURFACE_GATEWAY_API_VERSIONS.map(([surface]) => surface),
    );

    // Coverage, not equality: the routing table may also carry a provider the
    // catalog no longer lists a chat model for, whose other model ids still
    // route through it.
    const routed = new Set(
      catalogData.VERYFRONT_CLOUD_PROVIDER_ROUTING.map(([provider]) => provider),
    );
    for (const provider of providers) {
      assertEquals(routed.has(provider), true, `no routing declared for "${provider}"`);
    }
    for (const [provider, routing] of catalogData.VERYFRONT_CLOUD_PROVIDER_ROUTING) {
      // A surface this package builds no request for needs no version of its
      // own: the path falls back to the default version and the request is
      // refused before it is built. A surface it does speak must have one.
      if (!speaksSurface(routing.surface)) continue;
      assertEquals(
        versionedSurfaces.has(routing.surface),
        true,
        `no gateway API version for the "${routing.surface}" surface of "${provider}"`,
      );
    }
    assertEquals(versionedSurfaces.has(catalogData.DEFAULT_VERYFRONT_CLOUD_SURFACE), true);
  });

  it("types a routing surface by the surface ID, so an unknown one is refused at call time", () => {
    // The catalog serves the surface, so it can name one a later release
    // builds requests for. Such a value has to type-check here and reach the
    // runtime: refusing it would mean the module failed to import, or failed
    // to generate, rather than the one request failing.
    const routing: catalogData.VeryfrontCloudProviderRouting = {
      surface: "a-later-wire-format",
    };

    assertThrows(
      () => requireVeryfrontCloudWireSurface(routing.surface),
      Error,
      'Veryfront Cloud wire surface "a-later-wire-format" is not supported',
    );
  });

  it("publishes the chat model entries unchanged and in the same order", () => {
    assertEquals(
      VERYFRONT_CLOUD_CHAT_MODELS.map((model) => model.id),
      catalogData.VERYFRONT_CLOUD_CHAT_MODEL_ENTRIES.map((model) => model.id),
    );
    assertEquals(
      [...VERYFRONT_CLOUD_CHAT_MODELS],
      [...catalogData.VERYFRONT_CLOUD_CHAT_MODEL_ENTRIES],
    );
  });
});
