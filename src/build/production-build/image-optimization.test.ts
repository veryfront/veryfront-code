import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertRejects } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import type { ImageOptimizationSession } from "../asset-pipeline/image-optimizer/optimization-engine.ts";
import { optimizeProductionImages } from "./image-optimization.ts";

const pixel = Uint8Array.from(
  atob(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  ),
  (character) => character.charCodeAt(0),
);

function session(): ImageOptimizationSession {
  const value: ImageOptimizationSession = {
    cacheIdentity: "test-image-engine@1",
    run: (_input, variants) =>
      Promise.resolve({
        sourceWidth: 1,
        sourceHeight: 1,
        variants: variants.map((variant) => ({
          format: variant.format,
          width: variant.width,
          height: variant.width,
          data: new Uint8Array([variant.width % 255 || 1]),
        })),
      }),
  };
  return Object.freeze(value);
}

describe("production image optimization", () => {
  it("publishes variants and a manifest under /_vf/assets/images", async () => {
    const projectDir = await Deno.makeTempDir();
    const outputDir = await Deno.makeTempDir();
    try {
      await Deno.mkdir(`${projectDir}/public/images`, { recursive: true });
      await Deno.writeFile(`${projectDir}/public/images/pixel.png`, pixel);
      const result = await optimizeProductionImages(
        {
          projectDir,
          outputDir,
          dryRun: false,
          config: {
            assetPipeline: {
              images: {
                enabled: true,
                formats: ["webp", "jpeg"],
                sizes: [2, 4],
                quality: 73,
              },
            },
          },
        },
        { optimizationSession: session() },
      );

      assertEquals(result.stats.totalImages, 1);
      assertEquals(result.stats.totalVariants, 4);
      assertEquals(
        result.manifestResolver?.snapshotAll().entries["images/pixel.png"] !== undefined,
        true,
      );
      const manifest = JSON.parse(
        await Deno.readTextFile(
          `${outputDir}/_vf/assets/images/image-manifest.json`,
        ),
      );
      assertEquals(manifest["images/pixel.png"].quality, 73);
      assertEquals(manifest["images/pixel.png"].engineIdentity, "test-image-engine@1");
      assertEquals(
        manifest["images/pixel.png"].variants.map(
          (variant: { path: string }) => variant.path,
        ),
        [
          "images/pixel-2w-q73.webp",
          "images/pixel-2w-q73.jpeg",
          "images/pixel-4w-q73.webp",
          "images/pixel-4w-q73.jpeg",
        ],
      );
    } finally {
      await Deno.remove(projectDir, { recursive: true });
      await Deno.remove(outputDir, { recursive: true });
    }
  });

  it("does not resolve an engine when the stage is absent or disabled", async () => {
    assertEquals(
      (await optimizeProductionImages({
        projectDir: "/project",
        outputDir: "/output",
        dryRun: false,
      })).stats.totalImages,
      0,
    );
    assertEquals(
      (await optimizeProductionImages({
        projectDir: "/project",
        outputDir: "/output",
        dryRun: false,
        config: { assetPipeline: { images: { enabled: false } } },
      })).stats.totalImages,
      0,
    );
  });

  it("rejects build-specific output and cross-project configuration", async () => {
    await assertRejects(
      () =>
        optimizeProductionImages({
          projectDir: "/project",
          outputDir: "/output",
          dryRun: true,
          config: { assetPipeline: { images: { outputDir: "custom" } } },
        }, { optimizationSession: session() }),
      TypeError,
      "publishes at /_vf/assets/images",
    );
    await assertRejects(
      () =>
        optimizeProductionImages({
          projectDir: "/project",
          outputDir: "/output",
          dryRun: true,
          config: { assetPipeline: { images: { projectDir: "/other" } } },
        }, { optimizationSession: session() }),
      TypeError,
      "must match",
    );
  });
});
