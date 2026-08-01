import "#veryfront/schemas/_test-setup.ts";
import { DiskCacheBackend } from "#veryfront/cache/backend.ts";
import { assertEquals, assertRejects } from "#veryfront/testing/assert.ts";
import { afterAll, beforeAll, describe, it } from "#veryfront/testing/bdd.ts";
import {
  cacheCSSAsync,
  cacheCSSInputsAsync,
  clearCSSCache,
  getCSSByHash,
  getCSSByHashAsync,
  resolveRegenerationInputs,
} from "./css-hash-cache.ts";
import { hashCSS } from "./css-identity.ts";

describe("styles-builder/css-hash-cache distributed integrity", () => {
  let sharedCacheDir: string;
  let originalBackend: string | undefined;
  let originalCacheDir: string | undefined;

  beforeAll(async () => {
    originalBackend = Deno.env.get("VF_CACHE_BACKEND");
    originalCacheDir = Deno.env.get("VF_DISK_CACHE_DIR");
    sharedCacheDir = await Deno.makeTempDir();
  });

  afterAll(async () => {
    clearCSSCache();
    if (originalBackend === undefined) Deno.env.delete("VF_CACHE_BACKEND");
    else Deno.env.set("VF_CACHE_BACKEND", originalBackend);
    if (originalCacheDir === undefined) Deno.env.delete("VF_DISK_CACHE_DIR");
    else Deno.env.set("VF_DISK_CACHE_DIR", originalCacheDir);
    await Deno.remove(sharedCacheDir, { recursive: true });
  });

  it("propagates configured backend creation failures and retries after rejection", async () => {
    const css = ".retry-after-init-failure{color:green}";
    const hash = hashCSS(css);
    Deno.env.set("VF_CACHE_BACKEND", "invalid-backend");

    await assertRejects(
      () => cacheCSSAsync(css),
      TypeError,
      "VF_CACHE_BACKEND must be",
    );
    await assertRejects(
      () => cacheCSSInputsAsync(hash, { candidates: ["retry-input"], stylesheet: "" }),
      TypeError,
      "VF_CACHE_BACKEND must be",
    );

    Deno.env.set("VF_CACHE_BACKEND", "disk");
    Deno.env.set("VF_DISK_CACHE_DIR", sharedCacheDir);
    await cacheCSSAsync(css);
    await cacheCSSInputsAsync(hash, { candidates: ["retry-input"], stylesheet: "" });

    const cssDiskCache = new DiskCacheBackend(sharedCacheDir, "css");
    const inputsDiskCache = new DiskCacheBackend(sharedCacheDir, "css-inputs");
    assertEquals((await cssDiskCache.get(`v2:${hash}`)) !== null, true);
    assertEquals((await inputsDiskCache.get(`v2:${hash}`)) !== null, true);
  });

  it("rejects distributed CSS whose payload does not match the requested identity", async () => {
    const originalBackend = Deno.env.get("VF_CACHE_BACKEND");
    const originalCacheDir = Deno.env.get("VF_DISK_CACHE_DIR");
    const expectedCSS = ".expected{color:green}";
    const expectedHash = hashCSS(expectedCSS);
    const cacheKey = `v2:${expectedHash}`;
    const diskCache = new DiskCacheBackend(sharedCacheDir, "css");

    Deno.env.set("VF_CACHE_BACKEND", "disk");
    Deno.env.set("VF_DISK_CACHE_DIR", sharedCacheDir);

    try {
      await diskCache.set(
        cacheKey,
        JSON.stringify({ css: expectedCSS, candidates: [], stylesheet: "" }),
        60,
      );
      assertEquals(await getCSSByHashAsync(expectedHash), expectedCSS);

      clearCSSCache();
      await diskCache.set(
        cacheKey,
        JSON.stringify({ css: ".substituted{color:red}", candidates: [], stylesheet: "" }),
        60,
      );
      assertEquals(await getCSSByHashAsync(expectedHash), undefined);
    } finally {
      clearCSSCache();
      if (originalBackend === undefined) Deno.env.delete("VF_CACHE_BACKEND");
      else Deno.env.set("VF_CACHE_BACKEND", originalBackend);
      if (originalCacheDir === undefined) Deno.env.delete("VF_DISK_CACHE_DIR");
      else Deno.env.set("VF_DISK_CACHE_DIR", originalCacheDir);
    }
  });

  it("rejects nested legacy input graphs before JSON.parse can materialize them", async () => {
    const hash = "f".repeat(64);
    const raw = `{"candidates":[${"[],".repeat(50_000)}[]],"stylesheet":""}`;
    const originalBackend = Deno.env.get("VF_CACHE_BACKEND");
    const originalCacheDir = Deno.env.get("VF_DISK_CACHE_DIR");
    const originalGetWithinLimit = DiskCacheBackend.prototype.getWithinLimit;
    const originalParse = JSON.parse;
    let backendReads = 0;
    let parseCalls = 0;
    DiskCacheBackend.prototype.getWithinLimit = function (): Promise<string | null> {
      backendReads++;
      return Promise.resolve(backendReads === 1 ? null : raw);
    };
    JSON.parse = ((...args: Parameters<typeof JSON.parse>) => {
      parseCalls++;
      return originalParse(...args);
    }) as typeof JSON.parse;
    Deno.env.set("VF_CACHE_BACKEND", "disk");
    Deno.env.set("VF_DISK_CACHE_DIR", sharedCacheDir);

    try {
      clearCSSCache();
      await assertRejects(
        () => resolveRegenerationInputs(hash),
        TypeError,
      );
      assertEquals(parseCalls, 0);
    } finally {
      JSON.parse = originalParse;
      DiskCacheBackend.prototype.getWithinLimit = originalGetWithinLimit;
      clearCSSCache();
      if (originalBackend === undefined) Deno.env.delete("VF_CACHE_BACKEND");
      else Deno.env.set("VF_CACHE_BACKEND", originalBackend);
      if (originalCacheDir === undefined) Deno.env.delete("VF_DISK_CACHE_DIR");
      else Deno.env.set("VF_DISK_CACHE_DIR", originalCacheDir);
    }
  });

  it("does not accept inherited legacy input fields", async () => {
    const hash = "d".repeat(64);
    const originalGetWithinLimit = DiskCacheBackend.prototype.getWithinLimit;
    const inherited = Object.prototype as Record<string, unknown>;
    let backendReads = 0;
    DiskCacheBackend.prototype.getWithinLimit = function (): Promise<string | null> {
      backendReads++;
      return Promise.resolve(backendReads === 1 ? null : "{}");
    };
    Object.defineProperties(inherited, {
      candidates: { configurable: true, value: ["forged-input"] },
      stylesheet: { configurable: true, value: "" },
    });

    try {
      clearCSSCache();
      assertEquals(await resolveRegenerationInputs(hash), undefined);
    } finally {
      delete inherited.candidates;
      delete inherited.stylesheet;
      DiskCacheBackend.prototype.getWithinLimit = originalGetWithinLimit;
      clearCSSCache();
    }
  });

  it("returns defensive regeneration input candidates from both local tiers", async () => {
    const fromLargeParent = (value: string): string => {
      const parent = `${"x".repeat(16 * 1024 * 1024)}${value}`;
      return parent.slice(parent.length - value.length);
    };
    const css = fromLargeParent(".immutable-unified{color:green}");
    const unifiedCandidate = fromLargeParent("immutable-unified");
    const stylesheet = fromLargeParent("@tailwind utilities;");
    const unifiedCandidates = [unifiedCandidate];
    const unifiedInputs = {
      candidates: unifiedCandidates,
      stylesheet,
    };
    const unifiedHash = await cacheCSSAsync(css, undefined, unifiedInputs);
    unifiedCandidates[0] = "caller-mutated-unified";
    unifiedInputs.stylesheet = "caller-mutated-stylesheet";
    const legacyHash = "c".repeat(64);
    const legacyCandidates = [fromLargeParent("immutable-legacy")];
    await cacheCSSInputsAsync(legacyHash, {
      candidates: legacyCandidates,
      stylesheet,
    });
    legacyCandidates[0] = "caller-mutated-legacy";

    try {
      const unifiedFirst = await resolveRegenerationInputs(unifiedHash);
      const legacyFirst = await resolveRegenerationInputs(legacyHash);
      unifiedFirst?.candidates.push("mutated-unified");
      legacyFirst?.candidates.push("mutated-legacy");

      assertEquals((await resolveRegenerationInputs(unifiedHash))?.candidates, [
        "immutable-unified",
      ]);
      assertEquals((await resolveRegenerationInputs(unifiedHash))?.stylesheet, stylesheet);
      assertEquals((await resolveRegenerationInputs(legacyHash))?.candidates, [
        "immutable-legacy",
      ]);
    } finally {
      clearCSSCache();
    }
  });

  it("evicts the least-recently-used CSS entry under retained-byte pressure", async () => {
    const payloadBytes = 7 * 1024 * 1024;
    const cssA = `/*a*/${"a".repeat(payloadBytes)}`;
    const cssB = `/*b*/${"b".repeat(payloadBytes)}`;
    const cssC = `/*c*/${"c".repeat(payloadBytes)}`;

    try {
      clearCSSCache();
      const hashA = await cacheCSSAsync(cssA);
      const hashB = await cacheCSSAsync(cssB);
      assertEquals(getCSSByHash(hashA) !== undefined, true);
      const hashC = await cacheCSSAsync(cssC);

      assertEquals(getCSSByHash(hashA) !== undefined, true);
      assertEquals(getCSSByHash(hashB) === undefined, true);
      assertEquals(getCSSByHash(hashC) !== undefined, true);
    } finally {
      clearCSSCache();
    }
  });

  it("skips a CSS entry that exceeds the local retained-byte admission limit", async () => {
    const css = "x".repeat(9 * 1024 * 1024);

    try {
      clearCSSCache();
      const hash = await cacheCSSAsync(css);
      assertEquals(getCSSByHash(hash) === undefined, true);
    } finally {
      clearCSSCache();
    }
  });

  it("skips oversized regeneration inputs from the local inputs tier", async () => {
    const hash = "e".repeat(64);
    const originalGetWithinLimit = DiskCacheBackend.prototype.getWithinLimit;

    try {
      clearCSSCache();
      await cacheCSSInputsAsync(hash, {
        candidates: ["oversized-input"],
        stylesheet: "x".repeat(9 * 1024 * 1024),
      });
      DiskCacheBackend.prototype.getWithinLimit = () => Promise.resolve(null);

      assertEquals((await resolveRegenerationInputs(hash)) === undefined, true);
    } finally {
      DiskCacheBackend.prototype.getWithinLimit = originalGetWithinLimit;
      clearCSSCache();
    }
  });
});
