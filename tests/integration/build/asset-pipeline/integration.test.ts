/**
 * Integration tests for Asset Pipeline
 */

import { assertEquals, assertExists } from "@veryfront/testing/assert";
import { describe, it } from "@veryfront/testing/bdd";
import {
  type AssetPipelineOptions,
  checkAssetPipelineDependencies,
  getAssetPipelineStatus,
  runAssetPipeline,
} from "../../../../src/build/asset-pipeline/index.ts";

describe("Asset Pipeline", () => {
  describe("runAssetPipeline", () => {
    it("disabled images and CSS", async () => {
      const result = await runAssetPipeline({
        images: { enabled: false },
        css: { enabled: false },
      });

      assertExists(result);
      assertEquals(result.images.enabled, false);
      assertEquals(result.css.enabled, false);
      assertEquals(typeof result.duration, "number");
    });

    it("with default options", async () => {
      const result = await runAssetPipeline();

      assertExists(result);
      assertEquals(typeof result.images.enabled, "boolean");
      assertEquals(typeof result.css.enabled, "boolean");
      assertEquals(typeof result.duration, "number");
    });

    it("images only", async () => {
      const result = await runAssetPipeline({
        images: {
          enabled: true,
          inputDir: "./.veryfront/test-images-nonexistent",
        },
        css: { enabled: false },
      });

      assertExists(result);
      assertEquals(typeof result.images.optimized, "number");
      assertEquals(result.css.enabled, false);
    });

    it("CSS only", async () => {
      const result = await runAssetPipeline({
        images: { enabled: false },
        css: {
          enabled: true,
          inputDir: "./.veryfront/test-css-nonexistent",
        },
      });

      assertExists(result);
      assertEquals(result.images.enabled, false);
      assertEquals(typeof result.css.optimized, "number");
    });
  });

  describe("checkAssetPipelineDependencies", () => {
    it("returns dependency status", async () => {
      const deps = await checkAssetPipelineDependencies();

      assertExists(deps);
      assertEquals(typeof deps.sharp, "boolean");
      assertEquals(typeof deps.lightningCSS, "boolean");
    });
  });

  describe("getAssetPipelineStatus", () => {
    it("returns status object", async () => {
      const status = await getAssetPipelineStatus();

      assertExists(status);
      assertExists(status.available);
      assertExists(status.missing);
      assertExists(status.recommendations);

      assertEquals(Array.isArray(status.available), true);
      assertEquals(Array.isArray(status.missing), true);
      assertEquals(Array.isArray(status.recommendations), true);
    });

    it("provides helpful messages for missing dependencies", async () => {
      const status = await getAssetPipelineStatus();

      if (status.missing.length > 0) {
        assertEquals(status.recommendations.length > 0, true);

        for (const rec of status.recommendations) {
          assertEquals(typeof rec, "string");
          assertEquals(rec.length > 0, true);
        }
      }

      if (status.available.length === 0) return;

      for (const avail of status.available) {
        assertEquals(typeof avail, "string");
        assertEquals(avail.length > 0, true);
      }
    });
  });

  describe("graceful degradation", () => {
    it("does not throw when dependencies are missing", async () => {
      const options: AssetPipelineOptions = {
        images: {
          enabled: true,
          inputDir: "./nonexistent",
        },
        css: {
          enabled: true,
          inputDir: "./nonexistent",
        },
      };

      const result = await runAssetPipeline(options);

      assertExists(result);
      assertEquals(typeof result.duration, "number");
    });
  });

  describe("statistics", () => {
    it("returns image and CSS stats", async () => {
      const result = await runAssetPipeline();

      assertEquals(typeof result.images.optimized, "number");
      assertEquals(typeof result.images.variants, "number");
      assertEquals(typeof result.images.totalSize, "number");

      assertEquals(typeof result.css.optimized, "number");
      assertEquals(typeof result.css.originalSize, "number");
      assertEquals(typeof result.css.minifiedSize, "number");
      assertEquals(typeof result.css.savings, "number");
    });
  });

  describe("performance tracking", () => {
    it("reports reasonable duration", async () => {
      const startTime = Date.now();

      const result = await runAssetPipeline({
        images: { enabled: false },
        css: { enabled: false },
      });

      const endTime = Date.now();

      assertEquals(result.duration >= 0, true);
      assertEquals(result.duration <= endTime - startTime + 100, true);
    });
  });

  describe("error handling", () => {
    it("handles invalid paths without crashing", async () => {
      const result = await runAssetPipeline({
        images: {
          enabled: true,
          inputDir: "/invalid/path/that/does/not/exist",
          outputDir: "/invalid/output/path",
        },
        css: {
          enabled: true,
          inputDir: "/invalid/css/path",
          outputDir: "/invalid/css/output",
        },
      });

      assertExists(result);
      assertEquals(typeof result.duration, "number");
    });
  });

  describe("configuration validation", () => {
    it("accepts valid configuration options", async () => {
      const result = await runAssetPipeline({
        images: {
          enabled: true,
          formats: ["webp", "avif"],
          sizes: [320, 640, 1024],
          quality: 85,
        },
        css: {
          enabled: true,
          minify: true,
          autoprefixer: true,
          purge: false,
        },
      });

      assertExists(result);
      assertEquals(typeof result.images.enabled, "boolean");
      assertEquals(typeof result.css.enabled, "boolean");
    });
  });
});
