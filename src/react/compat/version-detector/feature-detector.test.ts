import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { detectFeatures } from "./feature-detector.ts";

describe("feature-detector", () => {
  describe("detectFeatures", () => {
    it("disables React 18+ features for React 17", () => {
      const features = detectFeatures(17, 0, false);

      assertEquals(features.suspense, false);
      assertEquals(features.streaming, false);
      assertEquals(features.automaticBatching, false);
      assertEquals(features.transitions, false);
      assertEquals(features.serverComponents, false);
      assertEquals(features.useFormStatus, false);
      assertEquals(features.useOptimistic, false);
      assertEquals(features.renderToPipeableStream, false);
      assertEquals(features.renderToReadableStream, false);

      // Basic SSR methods remain available.
      assertEquals(features.renderToString, true);
      assertEquals(features.renderToStaticMarkup, true);
      assertEquals(features.renderToNodeStream, true);
    });

    it("enables React 18 features for major=18", () => {
      const features = detectFeatures(18, 2, false);

      assertEquals(features.suspense, true);
      assertEquals(features.streaming, true);
      assertEquals(features.automaticBatching, true);
      assertEquals(features.transitions, true);
      assertEquals(features.renderToPipeableStream, true);
      assertEquals(features.renderToReadableStream, true);
      assertEquals(features.renderToNodeStream, true);

      // React 19 features still off
      assertEquals(features.useFormStatus, false);
      assertEquals(features.serverActions, false);
    });

    it("enables server components for React 18.3+", () => {
      assertEquals(detectFeatures(18, 3, false).serverComponents, true);
      assertEquals(detectFeatures(18, 2, false).serverComponents, false);
      assertEquals(detectFeatures(18, 0, false).serverComponents, false);
      assertEquals(detectFeatures(19, 0, true).serverComponents, true);
      assertEquals(detectFeatures(20, 0, false).serverComponents, true);
    });

    it("enables React 19 features when isReact19Flag is true", () => {
      const features = detectFeatures(19, 0, true);

      assertEquals(features.useFormStatus, true);
      assertEquals(features.useOptimistic, true);
      assertEquals(features.serverActions, true);
      assertEquals(features.improvedSuspense, true);
      assertEquals(features.enhancedStreaming, true);

      // Also has React 18+ features
      assertEquals(features.suspense, true);
      assertEquals(features.streaming, true);
      assertEquals(features.renderToNodeStream, false);
      assertEquals(detectFeatures(18, 3, true).renderToNodeStream, false);
    });

    it("treats major >= 18 as React 18+ for base features", () => {
      const features = detectFeatures(20, 0, false);

      assertEquals(features.suspense, true);
      assertEquals(features.streaming, true);
      assertEquals(features.serverComponents, true);
      assertEquals(features.renderToNodeStream, false);
    });
  });
});
