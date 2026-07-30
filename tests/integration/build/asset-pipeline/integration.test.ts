import "../../../_helpers/contract-init.ts";
import { join } from "#veryfront/compat/path/index.ts";
import { assertEquals, assertRejects, assertStringIncludes } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  createTestCSSOptimizationEngine,
  withTestCSSOptimizationEngine,
} from "../../../_helpers/css-optimization-engine.ts";
import { withTestCSSPurgingEngine } from "../../../_helpers/css-purging-engine.ts";
import { withTestImageOptimizationEngine } from "../../../_helpers/image-optimization-engine.ts";
import {
  checkAssetPipelineDependencies,
  getAssetPipelineStatus,
  runAssetPipeline,
} from "../../../../src/build/asset-pipeline/index.ts";

async function withProject(
  callback: (projectDir: string) => Promise<void>,
): Promise<void> {
  const projectDir = await Deno.makeTempDir();
  try {
    await callback(projectDir);
  } finally {
    await Deno.remove(projectDir, { recursive: true });
  }
}

describe("build/asset-pipeline orchestration", () => {
  it("treats omitted and explicitly disabled stages as no-ops", async () => {
    for (
      const result of [
        await runAssetPipeline(),
        await runAssetPipeline({
          images: { enabled: false },
          css: { enabled: false },
        }),
      ]
    ) {
      assertEquals(result.images.enabled, false);
      assertEquals(result.css.enabled, false);
      assertEquals(result.images.optimized, 0);
      assertEquals(result.css.optimized, 0);
      assertEquals(Number.isSafeInteger(result.duration), true);
      assertEquals(result.duration >= 0, true);
    }
  });

  it("runs explicitly configured CSS optimization without a compiler-specific stage", async () => {
    await withTestCSSOptimizationEngine(
      createTestCSSOptimizationEngine(),
      () =>
        withProject(async (projectDir) => {
          await Deno.mkdir(join(projectDir, "styles"));
          await Deno.writeTextFile(
            join(projectDir, "styles/global.css"),
            ".page { color: rgb(255, 0, 0); }",
          );

          const result = await runAssetPipeline({
            css: {
              projectDir,
              inputDir: "styles",
              outputDir: ".veryfront/css",
            },
          });

          assertEquals(result.css.enabled, true);
          assertEquals(result.css.optimized, 1);
          assertEquals(result.images.enabled, false);
          assertStringIncludes(
            await Deno.readTextFile(
              join(projectDir, ".veryfront/css/global.min.css"),
            ),
            ".page",
          );
        }),
    );
  });

  it("maps successful image optimization statistics", async () => {
    await withTestImageOptimizationEngine(() =>
      withProject(async (projectDir) => {
        await Deno.mkdir(join(projectDir, "public"));
        const pixel = Uint8Array.from(
          atob(
            "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
          ),
          (character) => character.charCodeAt(0),
        );
        await Deno.writeFile(join(projectDir, "public/pixel.png"), pixel);

        const result = await runAssetPipeline({
          images: {
            projectDir,
            inputDir: "public",
            outputDir: ".veryfront/images",
            formats: ["png"],
            sizes: [1],
          },
        });

        assertEquals(result.images.enabled, true);
        assertEquals(result.images.optimized, 1);
        assertEquals(result.images.variants > 0, true);
        assertEquals(result.css.enabled, false);
        assertEquals(
          (
            await Deno.readTextFile(
              join(projectDir, ".veryfront/images/image-manifest.json"),
            )
          ).includes('"pixel.png"'),
          true,
        );
      })
    );
  });

  it("rejects requested stage failures instead of returning partial success", async () => {
    await withTestCSSOptimizationEngine(
      createTestCSSOptimizationEngine(),
      () =>
        withProject(async (projectDir) => {
          await assertRejects(
            () =>
              runAssetPipeline({
                css: {
                  projectDir,
                  inputDir: "missing-styles",
                  outputDir: ".veryfront/css",
                },
              }),
            Error,
          );
        }),
    );
  });

  it("rejects overlapping output trees before running any stage", async () => {
    await withProject(async (projectDir) => {
      await assertRejects(
        () =>
          runAssetPipeline({
            images: {
              projectDir,
              outputDir: ".veryfront/assets",
            },
            css: {
              projectDir,
              outputDir: ".veryfront/assets/css",
            },
          }),
        TypeError,
        "must not overlap",
      );
      await assertRejects(
        () => Deno.stat(join(projectDir, ".veryfront")),
        Deno.errors.NotFound,
      );
    });
  });

  it("rejects malformed runtime options at the public boundary", async () => {
    await assertRejects(
      () => runAssetPipeline(null as never),
      TypeError,
      "must be an object",
    );
    await assertRejects(
      () =>
        runAssetPipeline({
          css: {
            inputFiles: "styles/main.css" as unknown as string[],
          },
        }),
      TypeError,
      "must be an array",
    );
    await assertRejects(
      () =>
        runAssetPipeline({
          tailwind: { enabled: true } as never,
        } as never),
      TypeError,
      "unsupported stage",
    );
  });

  it("reports explicitly composed contracts alongside pinned dependencies", async () => {
    await withTestImageOptimizationEngine(() =>
      withTestCSSOptimizationEngine(
        createTestCSSOptimizationEngine(),
        () =>
          withTestCSSPurgingEngine(async () => {
            const dependencies = await checkAssetPipelineDependencies();
            assertEquals(dependencies.imageOptimizationEngineRegistered, true);
            assertEquals(dependencies.cssOptimizationEngineRegistered, true);
            assertEquals(dependencies.cssPurgingEngineRegistered, true);

            const status = await getAssetPipelineStatus();
            const expectedCapabilities = [
              [
                dependencies.imageOptimizationEngineRegistered,
                "Image optimization engine",
                "Image optimization engine",
              ],
              [
                dependencies.cssOptimizationEngineRegistered,
                "CSS optimization engine",
                "CSS optimization engine",
              ],
              [dependencies.cssPurgingEngineRegistered, "CSS purging engine", "CSS purging engine"],
            ] as const;
            for (const [available, capability, name] of expectedCapabilities) {
              assertEquals(
                available ? status.available.includes(capability) : status.missing.includes(name),
                true,
              );
            }
            assertEquals(
              status.recommendations.length,
              status.missing.length,
            );
          }),
      )
    );

    const withoutEngine = await checkAssetPipelineDependencies();
    assertEquals(withoutEngine.cssOptimizationEngineRegistered, false);
    assertEquals(withoutEngine.cssPurgingEngineRegistered, false);
    assertEquals(withoutEngine.imageOptimizationEngineRegistered, false);
    const missingStatus = await getAssetPipelineStatus();
    assertEquals(
      missingStatus.missing.includes("CSS optimization engine"),
      true,
    );
    assertEquals(
      missingStatus.recommendations.some((recommendation) =>
        recommendation.includes("@veryfront/ext-image-sharp")
      ),
      true,
    );
    assertEquals(
      missingStatus.recommendations.some((recommendation) =>
        recommendation.includes("@veryfront/ext-css-lightning")
      ),
      true,
    );
    assertEquals(
      missingStatus.recommendations.some((recommendation) =>
        recommendation.includes("@veryfront/ext-css-purgecss")
      ),
      true,
    );
  });
});
