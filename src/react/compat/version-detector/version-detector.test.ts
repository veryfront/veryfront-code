import { assert, assertEquals, assertThrows } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  checkVersionCompatibility,
  detectReactVersion,
  getReactVersionInfo,
  getRecommendedSSRMethod,
  hasFeature,
  parseVersion,
} from "./index.ts";
import { __resetReactVersionCacheForTests } from "./version-cache.ts";

describe("React Version Detector", () => {
  describe("Version Parsing", () => {
    it("parses React 19.x version", () => {
      const { major, minor, patch } = parseVersion("19.1.2");
      assertEquals(major, 19);
      assertEquals(minor, 1);
      assertEquals(patch, 2);
    });

    it("parses React 18.x version", () => {
      const { major, minor, patch } = parseVersion("18.2.0");
      assertEquals(major, 18);
      assertEquals(minor, 2);
      assertEquals(patch, 0);
    });

    it("parses React 17.x version", () => {
      const { major, minor, patch } = parseVersion("17.0.2");
      assertEquals(major, 17);
      assertEquals(minor, 0);
      assertEquals(patch, 2);
    });

    it("handles canary versions", () => {
      const { major, minor, patch } = parseVersion("19.0.0-canary.123");
      assertEquals(major, 19);
      assertEquals(minor, 0);
      assertEquals(patch, 0);
    });

    it("throws on invalid version format", () => {
      assertThrows(() => parseVersion("19.x"));
      assertThrows(() => parseVersion("invalid"));
      assertThrows(() => parseVersion("19"));
    });

    it("parses semver correctly with pre-release tags", () => {
      const { major, minor, patch } = parseVersion("18.3.0-rc.1");
      assertEquals(major, 18);
      assertEquals(minor, 3);
      assertEquals(patch, 0);
    });
  });

  describe("Feature Detection", () => {
    it("detects current React version features", () => {
      const info = detectReactVersion();
      assertEquals(typeof info.version, "string");
      assertEquals(typeof info.major, "number");
      assertEquals(typeof info.features.suspense, "boolean");
      assertEquals(typeof info.features.renderToString, "boolean");
    });

    it("identifies React 18+ features", () => {
      const info = getReactVersionInfo();
      if (info.major < 18) return;

      assertEquals(info.features.suspense, true);
      assertEquals(info.features.streaming, true);
      assertEquals(info.features.automaticBatching, true);
      assertEquals(info.features.transitions, true);
      assertEquals(info.features.renderToPipeableStream, true);
      assertEquals(info.features.renderToReadableStream, true);
    });

    it("identifies React 19 features", () => {
      const info = getReactVersionInfo();
      if (!info.isReact19) return;

      assertEquals(info.features.useFormStatus, true);
      assertEquals(info.features.useOptimistic, true);
      assertEquals(info.features.serverActions, true);
      assertEquals(info.features.improvedSuspense, true);
      assertEquals(info.features.enhancedStreaming, true);
    });

    it("all versions have basic SSR capabilities", () => {
      const info = getReactVersionInfo();
      assertEquals(info.features.renderToString, true);
      assertEquals(info.features.renderToStaticMarkup, true);
      assertEquals(info.features.renderToNodeStream, true);
    });

    it("hasFeature checks individual features", () => {
      const info = getReactVersionInfo();

      assertEquals(hasFeature("renderToString"), true);

      if (info.major < 18) return;

      assertEquals(hasFeature("suspense"), true);
      assertEquals(hasFeature("transitions"), true);
    });

    it("server components detection based on version", () => {
      const info = getReactVersionInfo();
      if (info.major < 18) return;

      assertEquals(info.features.serverComponents, info.minor >= 3);
    });
  });

  describe("SSR Method Selection", () => {
    it("recommends readable-stream for React 19", () => {
      const info = getReactVersionInfo();
      if (!info.isReact19) return;

      assertEquals(getRecommendedSSRMethod(), "readable-stream");
    });

    it("recommends readable-stream for React 18 with streaming", () => {
      const info = getReactVersionInfo();
      if (!info.isReact18 || !info.features.renderToReadableStream) return;

      assertEquals(getRecommendedSSRMethod(), "readable-stream");
    });

    it("valid SSR method is always returned", () => {
      const method = getRecommendedSSRMethod();
      const validMethods = ["readable-stream", "stream", "string"];
      assertEquals(validMethods.includes(method), true);
    });

    it("method matches version capabilities", () => {
      const info = getReactVersionInfo();
      const method = getRecommendedSSRMethod();

      if (method === "readable-stream") {
        assertEquals(info.features.renderToReadableStream, true);
        return;
      }

      if (method === "stream") {
        assertEquals(info.features.renderToPipeableStream, true);
      }
    });
  });

  describe("Version Compatibility Checking", () => {
    it("returns valid compatibility report structure", () => {
      const res = checkVersionCompatibility(["suspense", "renderToString"]);
      assertEquals(typeof res.compatible, "boolean");
      assertEquals(Array.isArray(res.warnings), true);
      assertEquals(Array.isArray(res.errors), true);
    });

    it("marks compatible when all features available", () => {
      const res = checkVersionCompatibility(["renderToString"]);
      assertEquals(res.compatible, true);
      assertEquals(res.errors.length, 0);
    });

    it("generates warnings for React 19 features on older versions", () => {
      const info = getReactVersionInfo();
      if (info.isReact19) return;

      const res = checkVersionCompatibility(["useFormStatus"]);
      assertEquals(res.warnings.some((w) => w.includes("useFormStatus")), true);
    });

    it("generates errors for React 18 features on React 17", () => {
      const info = getReactVersionInfo();
      if (info.major >= 18) return;

      const res = checkVersionCompatibility(["streaming"]);
      assertEquals(res.compatible, false);
      assertEquals(res.errors.some((e) => e.includes("streaming")), true);
    });

    it("handles multiple incompatible features", () => {
      const info = getReactVersionInfo();
      if (info.major >= 18) return;

      const res = checkVersionCompatibility([
        "transitions",
        "suspense",
        "renderToReadableStream",
      ]);
      assertEquals(res.compatible, false);
      assert(res.errors.length >= 3);
    });

    it("categorizes React 19 features as warnings not errors", () => {
      const info = getReactVersionInfo();
      if (info.isReact19) return;

      const res = checkVersionCompatibility(["useOptimistic", "serverActions"]);
      assert(res.warnings.length >= 2);
    });
  });

  describe("Caching and State Management", () => {
    it("caches version info across calls", () => {
      const a = getReactVersionInfo();
      const b = getReactVersionInfo();
      assertEquals(a.version, b.version);
      assertEquals(a, b);
    });

    it("cache reset function exists for testing", () => {
      assertEquals(typeof __resetReactVersionCacheForTests, "function");
      __resetReactVersionCacheForTests();
      assert(getReactVersionInfo() !== null);
    });
  });

  describe("Version Flags", () => {
    it("sets correct version flags for detected version", () => {
      const info = getReactVersionInfo();
      const trueCount = [info.isReact17, info.isReact18, info.isReact19].filter(
        Boolean,
      ).length;

      assert(trueCount >= 1);
    });

    it("version number matches version flags", () => {
      const info = getReactVersionInfo();

      if (info.major === 17) {
        assertEquals(info.isReact17, true);
        return;
      }

      if (info.major === 18) {
        assertEquals(info.isReact18, true);
        return;
      }

      if (info.major === 19) {
        assertEquals(info.isReact19, true);
      }
    });
  });
});
