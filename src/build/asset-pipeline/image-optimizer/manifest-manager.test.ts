import { assertEquals } from "jsr:@std/assert@1";
import { join } from "std/path/mod.ts";
import { loadManifest, writeManifest } from "./manifest-manager.ts";
import type { OptimizedImageMetadata } from "./types.ts";

Deno.test("manifest-manager writes and loads manifests via compat fs", async () => {
  const tmpDir = await Deno.makeTempDir();
  const manifest = new Map<string, OptimizedImageMetadata>();

  manifest.set("logo.png", {
    original: "logo.png",
    variants: [
      { format: "webp", size: 400, width: 400, height: 200, path: "logo-400.webp", fileSize: 1234 },
    ],
    defaultFormat: "webp",
    aspectRatio: 2,
  });

  await writeManifest(manifest, tmpDir);

  const manifestPath = join(tmpDir, "image-manifest.json");
  const manifestContent = await Deno.readTextFile(manifestPath);
  const parsed = JSON.parse(manifestContent);

  // Basic sanity check on file contents
  assertEquals(parsed.logo, undefined);
  assertEquals(parsed["logo.png"].defaultFormat, "webp");

  const loaded = await loadManifest(tmpDir);
  assertEquals(loaded.size, 1);
  assertEquals(loaded.get("logo.png")?.defaultFormat, "webp");
});
