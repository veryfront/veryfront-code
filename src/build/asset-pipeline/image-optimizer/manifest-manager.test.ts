import "#veryfront/schemas/_test-setup.ts";
import { join } from "#veryfront/compat/path";
import { assertEquals, assertRejects } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { makeTempDir, readDir, readTextFile } from "#veryfront/testing/deno-compat.ts";
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
    const files = [];
    for await (const entry of readDir(tmpDir)) files.push(entry.name);
    assertEquals(files, ["image-manifest.json"]);
  });

  it("rejects an existing manifest with an invalid structure", async () => {
    const tmpDir = await makeTempDir();
    await Deno.writeTextFile(join(tmpDir, "image-manifest.json"), '{"logo.png":{"variants":[]}}');

    await assertRejects(
      () => loadManifest(tmpDir),
      TypeError,
      "Invalid image manifest",
    );
  });

  it("rejects manifest entries without generated variants", async () => {
    const tmpDir = await makeTempDir();
    const manifest = new Map<string, OptimizedImageMetadata>([
      [
        "logo.png",
        {
          original: "logo.png",
          variants: [],
          defaultFormat: "webp",
          aspectRatio: 2,
        },
      ],
    ]);

    await assertRejects(
      () => writeManifest(manifest, tmpDir),
      TypeError,
      "manifest entry",
    );
  });

  it("rejects blank directories and unsafe manifest paths", async () => {
    await assertRejects(() => writeManifest(new Map(), " "), TypeError, "must not be blank");
    const tmpDir = await makeTempDir();
    const metadata: OptimizedImageMetadata = {
      original: "../logo.png",
      variants: [{
        format: "webp",
        size: 400,
        width: 400,
        height: 200,
        path: "logo-400.webp",
        fileSize: 1234,
      }],
      defaultFormat: "webp",
      aspectRatio: 2,
    };
    await assertRejects(
      () => writeManifest(new Map([["../logo.png", metadata]]), tmpDir),
      TypeError,
      "manifest entry",
    );
  });
});
