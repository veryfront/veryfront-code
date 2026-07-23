import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { getRecommendation } from "./recommendations.ts";

type ExtensionManifest = {
  name?: unknown;
  veryfront?: {
    extension?: unknown;
    contracts?: { provides?: unknown };
  };
};

describe("extensions recommendations", () => {
  it("matches every first-party manifest contract", async () => {
    const extensionsDirectory = new URL("../../extensions/", import.meta.url);
    const expected = new Map<string, string>();

    for await (const entry of Deno.readDir(extensionsDirectory)) {
      if (!entry.isDirectory) continue;
      const manifestUrl = new URL(`${entry.name}/deno.json`, extensionsDirectory);
      const manifest = JSON.parse(await Deno.readTextFile(manifestUrl)) as ExtensionManifest;
      if (manifest.veryfront?.extension !== true || typeof manifest.name !== "string") continue;

      const provided = manifest.veryfront.contracts?.provides;
      if (!Array.isArray(provided)) continue;
      for (const contract of provided) {
        if (typeof contract === "string") expected.set(contract, manifest.name);
      }
    }

    for (const [contract, packageName] of expected) {
      assertEquals(getRecommendation(contract), packageName, contract);
    }
    assertEquals(getRecommendation("UnknownContract"), undefined);
  });
});
