import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import * as catalogData from "./model-catalog.data.ts";
import { VERYFRONT_CLOUD_CHAT_MODELS } from "./model-catalog.ts";

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

  it("keeps one gateway model prefix per provider alias, in alias order", () => {
    assertEquals(
      [...catalogData.VERYFRONT_CLOUD_GATEWAY_MODEL_PROVIDER_PREFIXES],
      Array.from(catalogData.VERYFRONT_CLOUD_PROVIDER_ALIASES.keys(), (alias) => `${alias}/`),
    );
  });

  it("lists every provider exactly once in the labels and the display order", () => {
    const providers = new Set(catalogData.VERYFRONT_CLOUD_PROVIDER_ALIASES.values());

    assertEquals(
      [...catalogData.VERYFRONT_CLOUD_PROVIDER_ORDER].sort(),
      [...providers].sort(),
    );
    assertEquals(
      Object.keys(catalogData.VERYFRONT_CLOUD_PROVIDER_LABELS).sort(),
      [...providers].sort(),
    );
  });

  it("declares a routed surface for every provider, and a version for every surface", () => {
    const providers = new Set(catalogData.VERYFRONT_CLOUD_PROVIDER_ALIASES.values());

    assertEquals(
      [...catalogData.VERYFRONT_CLOUD_PROVIDER_ROUTING.keys()].sort(),
      [...providers].sort(),
    );
    for (const [provider, routing] of catalogData.VERYFRONT_CLOUD_PROVIDER_ROUTING) {
      assertEquals(
        catalogData.VERYFRONT_CLOUD_SURFACE_GATEWAY_API_VERSIONS.has(routing.surface),
        true,
        `no gateway API version for the "${routing.surface}" surface of "${provider}"`,
      );
    }
    assertEquals(
      catalogData.VERYFRONT_CLOUD_SURFACE_GATEWAY_API_VERSIONS.has(
        catalogData.DEFAULT_VERYFRONT_CLOUD_SURFACE,
      ),
      true,
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
