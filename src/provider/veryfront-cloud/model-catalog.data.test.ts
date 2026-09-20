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
      catalogData.VERYFRONT_CLOUD_PROVIDER_ALIASES.map(([alias]) => `${alias}/`),
    );
  });

  it("lists every provider exactly once in the labels and the display order", () => {
    const providers = new Set(catalogData.VERYFRONT_CLOUD_PROVIDER_ALIASES.map(([, id]) => id));

    assertEquals(
      [...catalogData.VERYFRONT_CLOUD_PROVIDER_ORDER].sort(),
      [...providers].sort(),
    );
    assertEquals(
      Object.keys(catalogData.VERYFRONT_CLOUD_PROVIDER_LABELS).sort(),
      [...providers].sort(),
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
