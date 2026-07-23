import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  __clearInFlightHttpFetches,
  bundleAccumulatorStorage,
  clearInFlightHttpFetchIfOwned,
  inFlightHttpFetches,
  trackBundleAccumulator,
  waitForInFlightFetch,
} from "./in-flight-manager.ts";
import { makeTempDir, remove, writeTextFile } from "#veryfront/testing/deno-compat.ts";
import { join } from "#veryfront/compat/path/index.ts";

describe("transforms/esm/in-flight-manager", () => {
  describe("__clearInFlightHttpFetches", () => {
    it("clears the in-flight map", () => {
      inFlightHttpFetches.set("test-key", Promise.resolve("value"));
      assertEquals(inFlightHttpFetches.size, 1);
      __clearInFlightHttpFetches();
      assertEquals(inFlightHttpFetches.size, 0);
    });
  });

  describe("inFlightHttpFetches", () => {
    it("is a Map instance", () => {
      assertEquals(inFlightHttpFetches instanceof Map, true);
    });

    it("can store and retrieve promises", () => {
      __clearInFlightHttpFetches();
      const p = Promise.resolve("result");
      inFlightHttpFetches.set("key1", p);
      assertEquals(inFlightHttpFetches.get("key1"), p);
      __clearInFlightHttpFetches();
    });

    it("does not let an older fetch clear a replacement entry", () => {
      __clearInFlightHttpFetches();
      const original = Promise.resolve("original");
      const replacement = Promise.resolve("replacement");
      inFlightHttpFetches.set("shared-key", replacement);

      clearInFlightHttpFetchIfOwned("shared-key", original);
      assertEquals(inFlightHttpFetches.get("shared-key"), replacement);

      clearInFlightHttpFetchIfOwned("shared-key", replacement);
      assertEquals(inFlightHttpFetches.has("shared-key"), false);
    });
  });

  describe("waitForInFlightFetch", () => {
    it("resolves with the promise result", async () => {
      const result = await waitForInFlightFetch(Promise.resolve("/path/to/file.mjs"), "key");
      assertEquals(result, "/path/to/file.mjs");
    });

    it("resolves with null when promise resolves null", async () => {
      const result = await waitForInFlightFetch(Promise.resolve(null), "key");
      assertEquals(result, null);
    });

    it("propagates rejection", async () => {
      let caught: Error | null = null;
      try {
        await waitForInFlightFetch(Promise.reject(new Error("fetch failed")), "key");
      } catch (e) {
        caught = e as Error;
      }
      assertEquals(caught?.message, "fetch failed");
    });

    it("resolves quickly when promise resolves before timeout", async () => {
      const start = Date.now();
      await waitForInFlightFetch(Promise.resolve("fast"), "key");
      const elapsed = Date.now() - start;
      assertEquals(elapsed < 1000, true);
    });
  });

  describe("trackBundleAccumulator", () => {
    it("finishes tracking before returning and deduplicates bundle hashes", async () => {
      const cacheDir = await makeTempDir({ prefix: "vf-bundle-accumulator-" });
      const cachePath = join(cacheDir, "http-bundle.mjs");
      const code = 'export const value = "räksmörgås";';

      try {
        await writeTextFile(cachePath, code);
        await bundleAccumulatorStorage.run([], async () => {
          await trackBundleAccumulator(
            "bundle-hash",
            "https://modules.example.test/value.js",
            cachePath,
          );
          await trackBundleAccumulator(
            "bundle-hash",
            "https://modules.example.test/value.js",
            cachePath,
          );

          const bundles = bundleAccumulatorStorage.getStore();
          assertEquals(bundles?.length, 1);
          assertEquals(bundles?.[0]?.hash, "bundle-hash");
          assertEquals(bundles?.[0]?.sizeBytes, new TextEncoder().encode(code).byteLength);
          assertEquals(bundles?.[0]?.sizeBytes === code.length, false);
        });
      } finally {
        await remove(cacheDir, { recursive: true });
      }
    });
  });
});
