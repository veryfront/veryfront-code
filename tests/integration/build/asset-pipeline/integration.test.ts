/**
 * Integration tests for Asset Pipeline
 */

import { assertEquals, assertExists } from "@std/assert";
import {
  type AssetPipelineOptions,
  checkAssetPipelineDependencies,
  getAssetPipelineStatus,
  runAssetPipeline,
} from "../../../../src/build/asset-pipeline/index.ts";

Deno.test("runAssetPipeline - disabled images and CSS", async () => {
  const result = await runAssetPipeline({
    images: { enabled: false },
    css: { enabled: false },
  });

  assertExists(result);
  assertEquals(result.images.enabled, false);
  assertEquals(result.css.enabled, false);
  assertEquals(typeof result.duration, "number");
});

Deno.test("runAssetPipeline - with default options", async () => {
  const result = await runAssetPipeline();

  assertExists(result);
  assertEquals(typeof result.images.enabled, "boolean");
  assertEquals(typeof result.css.enabled, "boolean");
  assertEquals(typeof result.duration, "number");
});

Deno.test("runAssetPipeline - images only", async () => {
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

Deno.test("runAssetPipeline - CSS only", async () => {
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

Deno.test("checkAssetPipelineDependencies", async () => {
  const deps = await checkAssetPipelineDependencies();

  assertExists(deps);
  assertEquals(typeof deps.sharp, "boolean");
  assertEquals(typeof deps.lightningCSS, "boolean");
});

Deno.test("getAssetPipelineStatus", async () => {
  const status = await getAssetPipelineStatus();

  assertExists(status);
  assertExists(status.available);
  assertExists(status.missing);
  assertExists(status.recommendations);

  assertEquals(Array.isArray(status.available), true);
  assertEquals(Array.isArray(status.missing), true);
  assertEquals(Array.isArray(status.recommendations), true);
});

Deno.test("Asset Pipeline - graceful degradation", async () => {
  // Should not throw even if dependencies are missing
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

Deno.test("Asset Pipeline - statistics", async () => {
  const result = await runAssetPipeline();

  // Image stats
  assertEquals(typeof result.images.optimized, "number");
  assertEquals(typeof result.images.variants, "number");
  assertEquals(typeof result.images.totalSize, "number");

  // CSS stats
  assertEquals(typeof result.css.optimized, "number");
  assertEquals(typeof result.css.originalSize, "number");
  assertEquals(typeof result.css.minifiedSize, "number");
  assertEquals(typeof result.css.savings, "number");
});

Deno.test("Asset Pipeline - performance tracking", async () => {
  const startTime = Date.now();

  const result = await runAssetPipeline({
    images: { enabled: false },
    css: { enabled: false },
  });

  const endTime = Date.now();

  // Duration should be reasonable
  assertEquals(result.duration >= 0, true);
  assertEquals(result.duration <= (endTime - startTime) + 100, true);
});

Deno.test("Asset Pipeline - error handling", async () => {
  // Invalid configuration should not crash
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

  // Should complete without throwing
  assertExists(result);
  assertEquals(typeof result.duration, "number");
});

Deno.test("Asset Pipeline - configuration validation", async () => {
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

Deno.test("Asset Pipeline - dependency status messages", async () => {
  const status = await getAssetPipelineStatus();

  // Should provide helpful messages
  if (status.missing.length > 0) {
    assertEquals(status.recommendations.length > 0, true);

    for (const rec of status.recommendations) {
      assertEquals(typeof rec, "string");
      assertEquals(rec.length > 0, true);
    }
  }

  if (status.available.length > 0) {
    for (const avail of status.available) {
      assertEquals(typeof avail, "string");
      assertEquals(avail.length > 0, true);
    }
  }
});
