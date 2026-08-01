/**
 * Integration tests for Asset Pipeline
 */

import "../../../_helpers/contract-init.ts";
import { assertEquals, assertExists, assertRejects } from "#veryfront/testing/assert";
import { describe, it } from "#veryfront/testing/bdd";
import {
  type AssetPipelineOptions,
  checkAssetPipelineDependencies,
  getAssetPipelineStatus,
  runAssetPipeline,
} from "../../../../src/build/asset-pipeline/index.ts";
import {
  createTestCSSOptimizationEngine,
  withTestCSSOptimizationEngine,
} from "../../../_helpers/css-optimization-engine.ts";

const optimizationEngine = createTestCSSOptimizationEngine();

async function withCSSProject(
  run: (projectDir: string) => Promise<void>,
  engine = optimizationEngine,
): Promise<void> {
  const projectDir = await Deno.makeTempDir();
  try {
    await Deno.mkdir(`${projectDir}/styles`);
    await Deno.writeTextFile(
      `${projectDir}/styles/main.css`,
      ".main { color: red; }",
    );
    await withTestCSSOptimizationEngine(
      engine,
      () => run(projectDir),
    );
  } finally {
    await Deno.remove(projectDir, { recursive: true });
  }
}

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
      assertEquals(result.images.enabled, false);
      assertEquals(result.css.enabled, false);
      assertEquals(typeof result.duration, "number");
    });

    it("rejects a failing explicitly requested image stage", async () => {
      await assertRejects(() =>
        runAssetPipeline({
          images: {
            enabled: true,
            inputDir: "./.veryfront/test-images-nonexistent",
          },
          css: { enabled: false },
        })
      );
    });

    it("runs an explicitly composed CSS stage", async () => {
      await withCSSProject(async (projectDir) => {
        const result = await runAssetPipeline({
          images: { enabled: false },
          css: {
            enabled: true,
            projectDir,
            inputDir: "styles",
            outputDir: ".veryfront/css",
          },
        });

        assertEquals(result.images.enabled, false);
        assertEquals(result.css.enabled, true);
        assertEquals(result.css.optimized, 1);
      });
    });

    it("rejects overlapping Tailwind and CSS outputs before either stage writes", async () => {
      const projectDir = await Deno.makeTempDir();
      const outputDir = `${projectDir}/.veryfront/shared-css`;
      try {
        await Deno.mkdir(`${projectDir}/styles`);
        await Deno.writeTextFile(
          `${projectDir}/styles/main.css`,
          '@import "tailwindcss";\n.main { color: red; }',
        );

        await withTestCSSOptimizationEngine(
          optimizationEngine,
          () =>
            assertRejects(
              () =>
                runAssetPipeline({
                  images: { enabled: false },
                  tailwind: {
                    enabled: true,
                    projectDir,
                    sourceDir: "styles",
                    outputDir: ".veryfront/shared-css",
                  },
                  css: {
                    enabled: true,
                    projectDir,
                    inputDir: "styles",
                    outputDir: ".veryfront/shared-css",
                  },
                }),
              TypeError,
              "output directories for tailwind and css must not overlap physically",
            ),
        );

        await assertRejects(
          () => Deno.stat(outputDir),
          Deno.errors.NotFound,
        );
      } finally {
        await Deno.remove(projectDir, { recursive: true });
      }
    });

    it("rejects nested Tailwind and CSS output directories", async () => {
      const projectDir = await Deno.makeTempDir();
      const outputDir = `${projectDir}/.veryfront/css`;
      try {
        await Deno.mkdir(`${projectDir}/styles`);
        await Deno.writeTextFile(
          `${projectDir}/styles/main.css`,
          '@import "tailwindcss";\n.main { color: red; }',
        );

        await withTestCSSOptimizationEngine(
          optimizationEngine,
          () =>
            assertRejects(
              () =>
                runAssetPipeline({
                  images: { enabled: false },
                  tailwind: {
                    enabled: true,
                    projectDir,
                    sourceDir: "styles",
                    outputDir: ".veryfront/css/tailwind",
                  },
                  css: {
                    enabled: true,
                    projectDir,
                    inputDir: "styles",
                    outputDir: ".veryfront/css",
                  },
                }),
              TypeError,
              "output directories for tailwind and css must not overlap physically",
            ),
        );

        await assertRejects(
          () => Deno.stat(outputDir),
          Deno.errors.NotFound,
        );
      } finally {
        await Deno.remove(projectDir, { recursive: true });
      }
    });

    it("rejects physically aliased output directories without replacing existing files", async () => {
      const projectDir = await Deno.makeTempDir();
      const physicalOutputDir = `${projectDir}/.veryfront/physical-css`;
      const aliasedOutputDir = `${projectDir}/.veryfront/aliased-css`;
      const sentinelPath = `${physicalOutputDir}/sentinel.txt`;
      const generatedPath = `${physicalOutputDir}/main.css`;
      try {
        await Deno.mkdir(`${projectDir}/styles`);
        await Deno.mkdir(physicalOutputDir, { recursive: true });
        await Deno.symlink(physicalOutputDir, aliasedOutputDir, { type: "dir" });
        await Deno.writeTextFile(sentinelPath, "preserve me");
        await Deno.writeTextFile(
          `${projectDir}/styles/main.css`,
          '@import "tailwindcss";\n.main { color: red; }',
        );

        await withTestCSSOptimizationEngine(
          optimizationEngine,
          () =>
            assertRejects(
              () =>
                runAssetPipeline({
                  images: { enabled: false },
                  tailwind: {
                    enabled: true,
                    projectDir,
                    sourceDir: "styles",
                    outputDir: ".veryfront/aliased-css",
                  },
                  css: {
                    enabled: true,
                    projectDir,
                    inputDir: "styles",
                    outputDir: ".veryfront/physical-css",
                  },
                }),
              TypeError,
              "output directories for tailwind and css must not overlap physically",
            ),
        );

        assertEquals(await Deno.readTextFile(sentinelPath), "preserve me");
        await assertRejects(
          () => Deno.stat(generatedPath),
          Deno.errors.NotFound,
        );
      } finally {
        await Deno.remove(projectDir, { recursive: true });
      }
    });
  });

  describe("checkAssetPipelineDependencies", () => {
    it("returns dependency status", async () => {
      const deps = await checkAssetPipelineDependencies();

      assertExists(deps);
      assertEquals(typeof deps.imageOptimization, "boolean");
      assertEquals(typeof deps.cssOptimization, "boolean");
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

  describe("fail-closed stages", () => {
    it("rejects instead of returning partial success", async () => {
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

      await assertRejects(() => runAssetPipeline(options));
    });

    it("surfaces an explicitly composed CSS provider failure", async () => {
      const providerFailure = new Error("CSS provider failed");
      const failingEngine = createTestCSSOptimizationEngine(() => {
        throw providerFailure;
      });

      await withCSSProject(
        async (projectDir) => {
          await assertRejects(
            () =>
              runAssetPipeline({
                images: { enabled: false },
                css: {
                  enabled: true,
                  projectDir,
                  inputDir: "styles",
                  outputDir: ".veryfront/css",
                },
              }),
            Error,
            "CSS provider failed",
          );
        },
        failingEngine,
      );
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
    it("rejects output paths outside the project boundary", async () => {
      await assertRejects(
        () =>
          runAssetPipeline({
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
          }),
        TypeError,
        "must be inside its project",
      );
    });
  });

  describe("configuration validation", () => {
    it("accepts valid configuration options", async () => {
      await withCSSProject(async (projectDir) => {
        const result = await runAssetPipeline({
          images: { enabled: false },
          css: {
            enabled: true,
            projectDir,
            inputDir: "styles",
            outputDir: ".veryfront/css",
            minify: true,
            purge: false,
          },
        });

        assertExists(result);
        assertEquals(result.images.enabled, false);
        assertEquals(result.css.enabled, true);
      });
    });
  });
});
