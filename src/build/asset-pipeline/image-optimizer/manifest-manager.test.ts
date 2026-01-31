import { join } from "#veryfront/compat/path";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { makeTempDir, readTextFile } from "#veryfront/testing/deno-compat.ts";
import { loadManifest, writeManifest } from "./manifest-manager.ts";
import type { OptimizedImageMetadata } from "./types.ts";

describe("manifest-manager", () => {
  it("writes and loads manifests via compat fs", async () => {
    const tmpDir = await makeTempDir();
    const manifest = new Map<string, OptimizedImageMetadata>([
      [
        "logo.png",
        {
          original: "logo.png",
          variants: [
            {
              format: "webp",
              size: 400,
              width: 400,
              height: 200,
              path: "logo-400.webp",
              fileSize: 1234,
            },
          ],
          defaultFormat: "webp",
          aspectRatio: 2,
        },
      ],
    ]);

    await writeManifest(manifest, tmpDir);

    const manifestPath = join(tmpDir, "image-manifest.json");
    const parsed = JSON.parse(await readTextFile(manifestPath)) as Record<
      string,
      OptimizedImageMetadata
    >;

    assertEquals(parsed.logo, undefined);
    assertEquals(parsed["logo.png"]?.defaultFormat, "webp");

    const loaded = await loadManifest(tmpDir);
    assertEquals(loaded.size, 1);
    assertEquals(loaded.get("logo.png")?.defaultFormat, "webp");
  });
});
