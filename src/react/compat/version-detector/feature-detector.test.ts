import { describe, it } from "std/testing/bdd.ts";
import { assertEquals } from "std/assert/mod.ts";
import { detectFeatures, detectReactVersion } from "./feature-detector.ts";

describe("feature-detector", () => {
  describe("detectFeatures", () => {
    it("should detect React 17 features", () => {
      const features = detectFeatures(17, 0, false);

      assertEquals(features.suspense, false);
      assertEquals(features.streaming, false);
      assertEquals(features.automaticBatching, false);
      assertEquals(features.transitions, false);
      assertEquals(features.serverComponents, false);

      assertEquals(features.useFormStatus, false);
      assertEquals(features.useOptimistic, false);
      assertEquals(features.serverActions, false);
      assertEquals(features.improvedSuspense, false);
      assertEquals(features.enhancedStreaming, false);

      assertEquals(features.renderToString, true);
      assertEquals(features.renderToStaticMarkup, true);
      assertEquals(features.renderToNodeStream, true);
      assertEquals(features.renderToPipeableStream, false);
      assertEquals(features.renderToReadableStream, false);
    });

    it("should detect React 18 features", () => {
      const features = detectFeatures(18, 2, false);

      assertEquals(features.suspense, true);
      assertEquals(features.streaming, true);
      assertEquals(features.automaticBatching, true);
      assertEquals(features.transitions, true);
      assertEquals(features.serverComponents, false);

      assertEquals(features.useFormStatus, false);
      assertEquals(features.useOptimistic, false);
      assertEquals(features.serverActions, false);

      assertEquals(features.renderToString, true);
      assertEquals(features.renderToPipeableStream, true);
      assertEquals(features.renderToReadableStream, true);
    });

    it("should detect React 18.3+ server components", () => {
      const features = detectFeatures(18, 3, false);

      assertEquals(features.serverComponents, true);
    });

    it("should detect React 19 features", () => {
      const features = detectFeatures(19, 0, true);

      assertEquals(features.suspense, true);
      assertEquals(features.streaming, true);
      assertEquals(features.automaticBatching, true);
      assertEquals(features.transitions, true);
      assertEquals(features.serverComponents, false); // Only true for 18.3+, not for major 19 minor 0

      assertEquals(features.useFormStatus, true);
      assertEquals(features.useOptimistic, true);
      assertEquals(features.serverActions, true);
      assertEquals(features.improvedSuspense, true);
      assertEquals(features.enhancedStreaming, true);
    });

    it("should detect React 19.3+ server components", () => {
      const features = detectFeatures(19, 3, true);

      assertEquals(features.serverComponents, true);
    });
  });

  describe("detectReactVersion", () => {
    it("should detect current React version", () => {
      const info = detectReactVersion();

      assertEquals(typeof info.version, "string");
      assertEquals(typeof info.major, "number");
      assertEquals(typeof info.minor, "number");
      assertEquals(typeof info.patch, "number");
      assertEquals(typeof info.isReact17, "boolean");
      assertEquals(typeof info.isReact18, "boolean");
      assertEquals(typeof info.isReact19, "boolean");
      assertEquals(typeof info.features, "object");
    });

    it("should have mutually exclusive version flags", () => {
      const info = detectReactVersion();

      const versionFlags = [info.isReact17, info.isReact18, info.isReact19];
      const trueCount = versionFlags.filter(Boolean).length;

      assertEquals(trueCount <= 1, true, "Only one version flag should be true");
    });

    it("should have features object with all expected properties", () => {
      const info = detectReactVersion();

      assertEquals("suspense" in info.features, true);
      assertEquals("streaming" in info.features, true);
      assertEquals("automaticBatching" in info.features, true);
      assertEquals("transitions" in info.features, true);
      assertEquals("serverComponents" in info.features, true);
      assertEquals("useFormStatus" in info.features, true);
      assertEquals("useOptimistic" in info.features, true);
      assertEquals("serverActions" in info.features, true);
      assertEquals("renderToString" in info.features, true);
      assertEquals("renderToPipeableStream" in info.features, true);
      assertEquals("renderToReadableStream" in info.features, true);
    });
  });
});
