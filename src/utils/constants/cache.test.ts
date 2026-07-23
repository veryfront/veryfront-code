import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  getDistributedCacheTTL,
  MS_PER_HOUR,
  MS_PER_MINUTE,
  MS_PER_SECOND,
  ONE_DAY_MS,
  SECONDS_PER_MINUTE,
} from "./cache.ts";

async function readCacheConstant(
  exportName: string,
  environment: Record<string, string>,
): Promise<number> {
  const moduleUrl = new URL("./cache.ts", import.meta.url).href;
  const script = `import * as cache from ${JSON.stringify(moduleUrl)};
const value = cache[${JSON.stringify(exportName)}];
if (typeof value !== "number") throw new Error("Expected numeric cache constant");
console.log(String(value));`;
  const output = await new Deno.Command(Deno.execPath(), {
    args: ["eval", script],
    clearEnv: true,
    env: environment,
    stdout: "piped",
    stderr: "piped",
  }).output();

  if (!output.success) {
    throw new Error(new TextDecoder().decode(output.stderr));
  }
  return Number(new TextDecoder().decode(output.stdout).trim());
}

describe("constants/cache", () => {
  describe("time constants", () => {
    it("should have correct MS_PER_SECOND", () => {
      assertEquals(MS_PER_SECOND, 1000);
    });

    it("should have correct MS_PER_MINUTE", () => {
      assertEquals(MS_PER_MINUTE, 60_000);
    });

    it("should have correct MS_PER_HOUR", () => {
      assertEquals(MS_PER_HOUR, 3_600_000);
    });

    it("should have correct ONE_DAY_MS", () => {
      assertEquals(ONE_DAY_MS, 86_400_000);
    });
  });

  describe("getDistributedCacheTTL", () => {
    const cacheTypes = ["ssr-module", "transform", "file", "css"] as const;

    it("should return production TTL for ssr-module when production", () => {
      const ttl = getDistributedCacheTTL("ssr-module", true);
      assertEquals(typeof ttl, "number");
      assertEquals(ttl > SECONDS_PER_MINUTE, true);
    });

    it("should return preview TTL for ssr-module when not production", () => {
      const ttl = getDistributedCacheTTL("ssr-module", false);
      assertEquals(typeof ttl, "number");

      // Preview TTL should be shorter than production
      const prodTtl = getDistributedCacheTTL("ssr-module", true);
      assertEquals(ttl < prodTtl, true);
    });

    it("should return values for all cache types", () => {
      for (const type of cacheTypes) {
        const prodTtl = getDistributedCacheTTL(type, true);
        const previewTtl = getDistributedCacheTTL(type, false);

        assertEquals(typeof prodTtl, "number");
        assertEquals(typeof previewTtl, "number");
        assertEquals(prodTtl > 0, true);
        assertEquals(previewTtl > 0, true);
      }
    });

    it("should return production TTL >= preview TTL for all types", () => {
      for (const type of cacheTypes) {
        const prodTtl = getDistributedCacheTTL(type, true);
        const previewTtl = getDistributedCacheTTL(type, false);

        assertEquals(prodTtl >= previewTtl, true);
      }
    });
  });

  describe("environment overrides", () => {
    it("accepts trimmed decimal integers", async () => {
      assertEquals(
        await readCacheConstant("DEFAULT_LRU_MAX_ENTRIES", {
          LRU_DEFAULT_MAX_ENTRIES: " 250 ",
        }),
        250,
      );
    });

    it("rejects partial, fractional, negative, and unsafe entry limits", async () => {
      for (const value of ["12junk", "1.5", "-2", "9007199254740992", "1000001"]) {
        assertEquals(
          await readCacheConstant("DEFAULT_LRU_MAX_ENTRIES", {
            LRU_DEFAULT_MAX_ENTRIES: value,
          }),
          100,
        );
      }
    });

    it("rejects excessive memory and TTL limits", async () => {
      assertEquals(
        await readCacheConstant("LRU_DEFAULT_MAX_SIZE_BYTES", {
          LRU_MAX_SIZE_MB: "4097",
        }),
        200 * 1024 * 1024,
      );
      assertEquals(
        await readCacheConstant("HTTP_MODULE_DISTRIBUTED_TTL_SEC", {
          HTTP_MODULE_DISTRIBUTED_TTL_SEC: "31536001",
        }),
        24 * 60 * 60,
      );
    });

    it("preserves zero as the documented per-project disable value", async () => {
      assertEquals(
        await readCacheConstant("REVALIDATION_PER_PROJECT_LIMIT", {
          REVALIDATION_PER_PROJECT_LIMIT: "0",
        }),
        0,
      );
    });

    it("rejects negative or above-global per-project limits", async () => {
      for (const value of ["-1", "33"]) {
        assertEquals(
          await readCacheConstant("REVALIDATION_PER_PROJECT_LIMIT", {
            MAX_CONCURRENT_REVALIDATIONS: "32",
            REVALIDATION_PER_PROJECT_LIMIT: value,
          }),
          11,
        );
      }
    });
  });
});
