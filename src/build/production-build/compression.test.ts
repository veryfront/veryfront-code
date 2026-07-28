import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertRejects } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { promisify } from "node:util";
import { brotliDecompress, gunzip } from "node:zlib";
import { compressBuildOutputs } from "./compression.ts";

const gunzipAsync = promisify(gunzip);
const brotliDecompressAsync = promisify(brotliDecompress);

describe("build/production-build/compression", () => {
  it("creates valid gzip and Brotli sidecars for compressible output", async () => {
    const outputDir = await Deno.makeTempDir({ prefix: "vf-compression-" });
    const content = "<main>production output</main>\n".repeat(1_000);
    const sourcePath = `${outputDir}/index.html`;
    try {
      await Deno.writeTextFile(sourcePath, content);
      const stats = await compressBuildOutputs(outputDir, true, false);

      assertEquals(stats.files, 2);
      assertEquals(
        new TextDecoder().decode(await gunzipAsync(await Deno.readFile(`${sourcePath}.gz`))),
        content,
      );
      assertEquals(
        new TextDecoder().decode(
          await brotliDecompressAsync(await Deno.readFile(`${sourcePath}.br`)),
        ),
        content,
      );
    } finally {
      await Deno.remove(outputDir, { recursive: true });
    }
  });

  it("is deterministic for identical inputs", async () => {
    const root = await Deno.makeTempDir({ prefix: "vf-compression-" });
    const firstDir = `${root}/first`;
    const secondDir = `${root}/second`;
    const content = "const deterministic = true;\n".repeat(1_000);
    await Deno.mkdir(firstDir);
    await Deno.mkdir(secondDir);
    await Deno.writeTextFile(`${firstDir}/app.js`, content);
    await Deno.writeTextFile(`${secondDir}/app.js`, content);
    try {
      await compressBuildOutputs(firstDir, true, false);
      await compressBuildOutputs(secondDir, true, false);
      assertEquals(
        await Deno.readFile(`${firstDir}/app.js.gz`),
        await Deno.readFile(`${secondDir}/app.js.gz`),
      );
      assertEquals(
        await Deno.readFile(`${firstDir}/app.js.br`),
        await Deno.readFile(`${secondDir}/app.js.br`),
      );
    } finally {
      await Deno.remove(root, { recursive: true });
    }
  });

  it("does not write when compression is disabled or during dry runs", async () => {
    const outputDir = await Deno.makeTempDir({ prefix: "vf-compression-" });
    const sourcePath = `${outputDir}/index.html`;
    try {
      await Deno.writeTextFile(sourcePath, "compress me".repeat(1_000));
      assertEquals(
        await compressBuildOutputs(outputDir, false, false),
        { files: 0, sourceBytes: 0, compressedBytes: 0 },
      );
      assertEquals(
        await compressBuildOutputs(outputDir, true, true),
        { files: 0, sourceBytes: 0, compressedBytes: 0 },
      );
      await assertRejects(() => Deno.stat(`${sourcePath}.gz`), Deno.errors.NotFound);
      await assertRejects(() => Deno.stat(`${sourcePath}.br`), Deno.errors.NotFound);
    } finally {
      await Deno.remove(outputDir, { recursive: true });
    }
  });

  it("fails instead of overwriting a caller-provided sidecar", async () => {
    const outputDir = await Deno.makeTempDir({ prefix: "vf-compression-" });
    const sourcePath = `${outputDir}/app.js`;
    try {
      await Deno.writeTextFile(sourcePath, "export const value = 1;\n".repeat(1_000));
      await Deno.writeTextFile(`${sourcePath}.gz`, "caller-owned");

      await assertRejects(
        () => compressBuildOutputs(outputDir, true, false),
        Error,
        "Compression output already exists",
      );
      assertEquals(await Deno.readTextFile(`${sourcePath}.gz`), "caller-owned");
    } finally {
      await Deno.remove(outputDir, { recursive: true });
    }
  });

  it("preflights every sidecar before writing any compressed output", async () => {
    const outputDir = await Deno.makeTempDir({ prefix: "vf-compression-" });
    const firstPath = `${outputDir}/a.html`;
    const secondPath = `${outputDir}/b.js`;
    try {
      await Deno.writeTextFile(firstPath, "<main>first</main>\n".repeat(1_000));
      await Deno.writeTextFile(secondPath, "export const second = true;\n".repeat(1_000));
      await Deno.writeTextFile(`${secondPath}.br`, "caller-owned");

      await assertRejects(
        () => compressBuildOutputs(outputDir, true, false),
        Error,
        "Compression output already exists",
      );
      await assertRejects(() => Deno.stat(`${firstPath}.gz`), Deno.errors.NotFound);
      await assertRejects(() => Deno.stat(`${firstPath}.br`), Deno.errors.NotFound);
      assertEquals(await Deno.readTextFile(`${secondPath}.br`), "caller-owned");
    } finally {
      await Deno.remove(outputDir, { recursive: true });
    }
  });

  it("rejects symbolic links in the output tree", async () => {
    const root = await Deno.makeTempDir({ prefix: "vf-compression-" });
    const outputDir = `${root}/dist`;
    await Deno.mkdir(outputDir);
    await Deno.writeTextFile(`${root}/outside.html`, "outside");
    await Deno.symlink(`${root}/outside.html`, `${outputDir}/linked.html`);
    try {
      await assertRejects(
        () => compressBuildOutputs(outputDir, true, false),
        Error,
        "Refusing to compress symbolic link",
      );
    } finally {
      await Deno.remove(root, { recursive: true });
    }
  });
});
