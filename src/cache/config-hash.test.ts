import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertNotEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { buildDependencyPinningCacheVariant } from "#veryfront/cache/keys/dependency-pinning.ts";
import {
  CSSTYPE_VERSION,
  DEFAULT_REACT_VERSION,
  TAILWIND_VERSION,
} from "#veryfront/transforms/import-rewriter/url-builder.ts";
import { computeHash } from "#veryfront/utils/hash-utils.ts";
import { VERSION } from "#veryfront/utils/version.ts";
import { computeConfigHash, computeConfigHashSync } from "./config-hash.ts";

const CANONICAL_PIN_KEY = "on:z7bg3qnfgtcb";
const CHANGED_CANONICAL_PIN_KEY = "on:z7bg3qnfgtcc";

describe("cache/config-hash", () => {
  describe("computeConfigHash", () => {
    it("preserves the established serialized identity for the default config", async () => {
      const identity = JSON.stringify({
        transformVersion: VERSION,
        reactVersion: DEFAULT_REACT_VERSION,
        jsxImportSource: "react",
        moduleServerUrl: null,
        vendorBundleHash: null,
        apiBaseUrl: null,
        studioEmbed: false,
        dev: false,
        csstype: CSSTYPE_VERSION,
        tailwind: TAILWIND_VERSION,
      });
      assertEquals(
        await computeConfigHash({}),
        await computeHash(identity),
      );
    });

    it("preserves the established serialized identity for a fully scoped config", async () => {
      const dependencyPinningCacheVariant = buildDependencyPinningCacheVariant(
        CANONICAL_PIN_KEY,
        "https://preview.example.test",
      );
      const identity = JSON.stringify({
        transformVersion: VERSION,
        reactVersion: "18.3.1",
        jsxImportSource: "preact",
        moduleServerUrl: "https://modules.example.test/_vf_modules",
        vendorBundleHash: "vendor-a",
        apiBaseUrl: "https://api.example.test",
        studioEmbed: true,
        dev: true,
        ...(dependencyPinningCacheVariant ? { dependencyPinningCacheVariant } : {}),
        csstype: CSSTYPE_VERSION,
        tailwind: TAILWIND_VERSION,
      });
      assertEquals(
        await computeConfigHash({
          reactVersion: "18.3.1",
          jsxImportSource: "preact",
          moduleServerUrl: "https://modules.example.test/_vf_modules",
          moduleServerOrigin: "https://preview.example.test",
          vendorBundleHash: "vendor-a",
          apiBaseUrl: "https://api.example.test",
          studioEmbed: true,
          dev: true,
          dependencyPinningCacheKey: CANONICAL_PIN_KEY,
        }),
        await computeHash(identity),
      );
    });

    it("keeps distinct hashes stable when array push and join are poisoned", async () => {
      const firstConfig = { reactVersion: "18.3.1", dev: false };
      const secondConfig = { reactVersion: "19.2.4", dev: true };
      const firstBaseline = await computeConfigHash(firstConfig);
      const secondBaseline = await computeConfigHash(secondConfig);
      const originalPush = Array.prototype.push;
      const originalJoin = Array.prototype.join;
      let firstPoisoned: string | undefined;
      let secondPoisoned: string | undefined;

      try {
        Reflect.set(Array.prototype, "push", () => 0);
        Reflect.set(Array.prototype, "join", () => "poisoned");
        firstPoisoned = await computeConfigHash(firstConfig);
        secondPoisoned = await computeConfigHash(secondConfig);
      } finally {
        Reflect.set(Array.prototype, "push", originalPush);
        Reflect.set(Array.prototype, "join", originalJoin);
      }

      assertEquals(firstPoisoned, firstBaseline);
      assertEquals(secondPoisoned, secondBaseline);
      assertNotEquals(firstPoisoned, secondPoisoned);
    });

    it("keeps distinct hashes stable when Object.prototype.toJSON is poisoned", async () => {
      const firstConfig = { reactVersion: "18.3.1" };
      const secondConfig = { reactVersion: "19.2.4" };
      const firstBaseline = await computeConfigHash(firstConfig);
      const secondBaseline = await computeConfigHash(secondConfig);
      let firstPoisoned: string | undefined;
      let secondPoisoned: string | undefined;

      // `toJSON` is normally absent from Object.prototype, but restore whatever
      // was there so this test cannot delete a property another test installed.
      const originalToJson = Reflect.getOwnPropertyDescriptor(Object.prototype, "toJSON");

      try {
        Reflect.set(Object.prototype, "toJSON", () => "x");
        firstPoisoned = await computeConfigHash(firstConfig);
        secondPoisoned = await computeConfigHash(secondConfig);
      } finally {
        Reflect.deleteProperty(Object.prototype, "toJSON");
        if (originalToJson) {
          Reflect.defineProperty(Object.prototype, "toJSON", originalToJson);
        }
      }

      assertEquals(
        firstPoisoned,
        firstBaseline,
        "an inherited toJSON hook must not change the config hash",
      );
      assertEquals(
        secondPoisoned,
        secondBaseline,
        "an inherited toJSON hook must not change the config hash",
      );
      assertNotEquals(
        firstPoisoned,
        secondPoisoned,
        "distinct configs must keep distinct hashes under toJSON poisoning",
      );
    });

    it("should return a 64-char hex hash", async () => {
      const hash = await computeConfigHash({});
      assertEquals(hash.length, 64);
      assertEquals(/^[0-9a-f]+$/.test(hash), true);
    });

    it("should be consistent for same config", async () => {
      const config = { reactVersion: "19.1.1", dev: false };
      const h1 = await computeConfigHash(config);
      const h2 = await computeConfigHash(config);
      assertEquals(h1, h2);
    });

    it("should differ for different React versions", async () => {
      const h1 = await computeConfigHash({ reactVersion: "18.3.1" });
      const h2 = await computeConfigHash({ reactVersion: "19.1.1" });
      assertNotEquals(h1, h2);
    });

    it("should differ when the emitted module server base changes", async () => {
      const h1 = await computeConfigHash({
        moduleServerUrl: "/_vf_modules",
        dependencyPinningCacheKey: CANONICAL_PIN_KEY,
      });
      const h2 = await computeConfigHash({
        moduleServerUrl: "https://modules.example.test/_vf_modules",
        dependencyPinningCacheKey: CANONICAL_PIN_KEY,
      });
      assertNotEquals(h1, h2);
    });

    it("should differ when the static module request origin changes", async () => {
      const h1 = await computeConfigHash({
        moduleServerOrigin: "https://preview-a.example",
        dependencyPinningCacheKey: CANONICAL_PIN_KEY,
      });
      const h2 = await computeConfigHash({
        moduleServerOrigin: "https://preview-b.example",
        dependencyPinningCacheKey: CANONICAL_PIN_KEY,
      });
      assertNotEquals(h1, h2);
    });

    it("should differ when the emitted vendor bundle revision changes", async () => {
      const h1 = await computeConfigHash({
        vendorBundleHash: "vendor-a",
        dependencyPinningCacheKey: CANONICAL_PIN_KEY,
      });
      const h2 = await computeConfigHash({
        vendorBundleHash: "vendor-b",
        dependencyPinningCacheKey: CANONICAL_PIN_KEY,
      });
      assertNotEquals(h1, h2);
    });

    it("preserves the mainline hash when dependency pinning is off or unset", async () => {
      const baseConfig = {
        moduleServerUrl: "https://modules.example.test/_vf_modules",
        vendorBundleHash: "vendor-a",
        apiBaseUrl: "https://api.example.test",
      };
      const unkeyed = await computeConfigHash(baseConfig);
      const flagOff = await computeConfigHash({
        ...baseConfig,
        moduleServerOrigin: "https://preview.example",
        dependencyPinningCacheKey: "off",
      });

      assertEquals(flagOff, unkeyed);
    });

    it("should differ when dev mode changes", async () => {
      const h1 = await computeConfigHash({ dev: false });
      const h2 = await computeConfigHash({ dev: true });
      assertNotEquals(h1, h2);
    });

    it("should differ when studioEmbed changes", async () => {
      const h1 = await computeConfigHash({ studioEmbed: false });
      const h2 = await computeConfigHash({ studioEmbed: true });
      assertNotEquals(h1, h2);
    });

    it("should differ when dependency-pin state changes", async () => {
      const h1 = await computeConfigHash({ dependencyPinningCacheKey: "off" });
      const h2 = await computeConfigHash({
        dependencyPinningCacheKey: CANONICAL_PIN_KEY,
      });
      assertNotEquals(h1, h2);
    });

    for (
      const [field, baseValue, changedValue] of [
        ["moduleServerUrl", "https://modules-a.example.test", "https://modules-b.example.test"],
        ["vendorBundleHash", "vendor-a", "vendor-b"],
        ["apiBaseUrl", "https://api-a.example.test", "https://api-b.example.test"],
      ] as const
    ) {
      it(`should differ when ${field} changes`, async () => {
        const h1 = await computeConfigHash({ [field]: baseValue });
        const h2 = await computeConfigHash({ [field]: changedValue });
        assertNotEquals(h1, h2);
      });
    }
  });

  describe("computeConfigHashSync", () => {
    it("matches the golden identity for the default transform config", () => {
      assertEquals(
        computeConfigHashSync({}),
        `v${VERSION}:${DEFAULT_REACT_VERSION}:react`,
      );
    });

    it("matches the golden identity for a fully scoped transform config", () => {
      assertEquals(
        computeConfigHashSync({
          reactVersion: "18.3.1",
          jsxImportSource: "preact",
          moduleServerUrl: "https://modules.example.test/_vf_modules",
          moduleServerOrigin: "https://preview.example.test",
          vendorBundleHash: "vendor-a",
          apiBaseUrl: "https://api.example.test",
          studioEmbed: true,
          dev: true,
          dependencyPinningCacheKey: CANONICAL_PIN_KEY,
        }),
        `v${VERSION}:18.3.1:preact:modules:40:https://modules.example.test/_vf_modules:vendor:8:vendor-a:api:24:https://api.example.test:studio:dev:pins:on:z7bg3qnfgtcb:origin:aHR0cHM6Ly9wcmV2aWV3LmV4YW1wbGUudGVzdA`,
      );
    });

    it("preserves the established identity after array primordial poisoning", () => {
      const originalFilter = Array.prototype.filter;
      const originalJoin = Array.prototype.join;
      const originalPush = Array.prototype.push;
      let identity: string | undefined;
      try {
        Reflect.set(Array.prototype, "filter", () => []);
        Reflect.set(Array.prototype, "join", () => "poisoned");
        Reflect.set(Array.prototype, "push", () => 0);
        identity = computeConfigHashSync({
          moduleServerUrl: "https://modules.example.test/_vf_modules",
          vendorBundleHash: "vendor-a",
          apiBaseUrl: "https://api.example.test",
          studioEmbed: true,
          dev: true,
        });
      } finally {
        Reflect.set(Array.prototype, "filter", originalFilter);
        Reflect.set(Array.prototype, "join", originalJoin);
        Reflect.set(Array.prototype, "push", originalPush);
      }

      assertEquals(
        identity,
        `v${VERSION}:${DEFAULT_REACT_VERSION}:react:modules:40:https://modules.example.test/_vf_modules:vendor:8:vendor-a:api:24:https://api.example.test:studio:dev`,
      );
    });

    it("keeps distinct sync identities stable when array push and join are poisoned", () => {
      const firstConfig = { reactVersion: "18.3.1", dev: false };
      const secondConfig = { reactVersion: "19.2.4", dev: true };
      const firstBaseline = computeConfigHashSync(firstConfig);
      const secondBaseline = computeConfigHashSync(secondConfig);
      const originalPush = Array.prototype.push;
      const originalJoin = Array.prototype.join;
      let firstPoisoned: string | undefined;
      let secondPoisoned: string | undefined;

      try {
        Reflect.set(Array.prototype, "push", () => 0);
        Reflect.set(Array.prototype, "join", () => "poisoned");
        firstPoisoned = computeConfigHashSync(firstConfig);
        secondPoisoned = computeConfigHashSync(secondConfig);
      } finally {
        Reflect.set(Array.prototype, "push", originalPush);
        Reflect.set(Array.prototype, "join", originalJoin);
      }

      assertEquals(firstPoisoned, firstBaseline);
      assertEquals(secondPoisoned, secondBaseline);
      assertNotEquals(firstPoisoned, secondPoisoned);
    });

    it("should return a string", () => {
      const hash = computeConfigHashSync({});
      assertEquals(typeof hash, "string");
      assertEquals(hash.length > 0, true);
    });

    it("should be consistent", () => {
      const config = { dev: true };
      const h1 = computeConfigHashSync(config);
      const h2 = computeConfigHashSync(config);
      assertEquals(h1, h2);
    });

    it("should differ for dev vs non-dev", () => {
      const h1 = computeConfigHashSync({ dev: false });
      const h2 = computeConfigHashSync({ dev: true });
      assertNotEquals(h1, h2);
    });

    it("should differ when module and vendor URL inputs change", () => {
      const h1 = computeConfigHashSync({
        moduleServerUrl: "/_vf_modules",
        moduleServerOrigin: "https://preview-a.example",
        vendorBundleHash: "vendor-a",
        dependencyPinningCacheKey: CANONICAL_PIN_KEY,
      });
      const h2 = computeConfigHashSync({
        moduleServerUrl: "https://modules.example.test/_vf_modules",
        moduleServerOrigin: "https://preview-b.example",
        vendorBundleHash: "vendor-b",
        dependencyPinningCacheKey: CANONICAL_PIN_KEY,
      });
      assertNotEquals(h1, h2);
    });

    it("should differ when the enabled snapshot origin changes", () => {
      const h1 = computeConfigHashSync({
        moduleServerOrigin: "https://preview-a.example",
        dependencyPinningCacheKey: CANONICAL_PIN_KEY,
      });
      const h2 = computeConfigHashSync({
        moduleServerOrigin: "https://preview-b.example",
        dependencyPinningCacheKey: CANONICAL_PIN_KEY,
      });
      assertNotEquals(h1, h2);
    });

    it("preserves the mainline sync hash when dependency pinning is off or unset", () => {
      const baseConfig = {
        moduleServerUrl: "https://modules.example.test/_vf_modules",
        vendorBundleHash: "vendor-a",
        apiBaseUrl: "https://api.example.test",
      };
      const unkeyed = computeConfigHashSync(baseConfig);
      const flagOff = computeConfigHashSync({
        ...baseConfig,
        moduleServerOrigin: "https://preview.example",
        dependencyPinningCacheKey: "off",
      });

      assertEquals(flagOff, unkeyed);
    });

    it("should include version prefix", () => {
      const hash = computeConfigHashSync({});
      assertEquals(hash.startsWith("v"), true);
    });

    it("should differ when dependency-pin state changes", () => {
      const h1 = computeConfigHashSync({
        dependencyPinningCacheKey: CANONICAL_PIN_KEY,
      });
      const h2 = computeConfigHashSync({
        dependencyPinningCacheKey: CHANGED_CANONICAL_PIN_KEY,
      });
      assertNotEquals(h1, h2);
    });

    for (
      const [field, baseValue, changedValue] of [
        ["moduleServerUrl", "https://modules-a.example.test", "https://modules-b.example.test"],
        ["vendorBundleHash", "vendor-a", "vendor-b"],
        ["apiBaseUrl", "https://api-a.example.test", "https://api-b.example.test"],
      ] as const
    ) {
      it(`should differ when ${field} changes`, () => {
        const h1 = computeConfigHashSync({ [field]: baseValue });
        const h2 = computeConfigHashSync({ [field]: changedValue });
        assertNotEquals(h1, h2);
      });
    }
  });
});
