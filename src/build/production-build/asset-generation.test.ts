import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertRejects } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { copyStaticAssets, discoverStaticAssets, loadClientStyles } from "./asset-generation.ts";
import type { AssetStats } from "./asset-generation.ts";
import type { RuntimeAdapter } from "#veryfront/platform/adapters/base.ts";

const unusedAdapter = {} as RuntimeAdapter;

describe("build/production-build/asset-generation", () => {
  describe("loadClientStyles", () => {
    it("should return a non-empty string", () => {
      const styles = loadClientStyles();
      assertEquals(typeof styles, "string");
      assertEquals(styles.length > 0, true);
    });

    it("should contain error container styles only", () => {
      const styles = loadClientStyles();
      assertEquals(styles.includes(".error-container"), true);
      assertEquals(styles.includes(".prose"), false);
      assertEquals(styles.includes(".loading-container"), false);
    });

    it("should be consistent across calls", () => {
      const styles1 = loadClientStyles();
      const styles2 = loadClientStyles();
      assertEquals(styles1, styles2);
    });

    it("should contain CSS properties", () => {
      const styles = loadClientStyles();
      assertEquals(styles.includes("max-width"), true);
      assertEquals(styles.includes("border-radius"), true);
    });
  });

  describe("AssetStats type", () => {
    it("should have assets and totalSize fields", () => {
      const stats: AssetStats = { assets: 0, totalSize: 0 };
      assertEquals(stats.assets, 0);
      assertEquals(stats.totalSize, 0);
    });

    it("should represent a typical result", () => {
      const stats: AssetStats = { assets: 15, totalSize: 1024000 };
      assertEquals(stats.assets, 15);
      assertEquals(stats.totalSize, 1024000);
    });
  });

  describe("discoverStaticAssets", () => {
    it("returns an empty inventory when public is absent", async () => {
      const projectDir = await Deno.makeTempDir({ prefix: "vf-static-assets-" });
      try {
        assertEquals(await discoverStaticAssets(projectDir), []);
      } finally {
        await Deno.remove(projectDir, { recursive: true });
      }
    });

    it("rejects symbolic links instead of following them", async () => {
      const root = await Deno.makeTempDir({ prefix: "vf-static-assets-" });
      const projectDir = `${root}/project`;
      await Deno.mkdir(`${projectDir}/public`, { recursive: true });
      await Deno.writeTextFile(`${root}/outside.txt`, "secret");
      await Deno.symlink(`${root}/outside.txt`, `${projectDir}/public/link.txt`);
      try {
        await assertRejects(
          () => discoverStaticAssets(projectDir),
          Error,
          "Symbolic links are not supported",
        );
      } finally {
        await Deno.remove(root, { recursive: true });
      }
    });
  });

  describe("copyStaticAssets", () => {
    it("copies binary assets without text decoding", async () => {
      const root = await Deno.makeTempDir({ prefix: "vf-static-assets-" });
      const projectDir = `${root}/project`;
      const outputDir = `${root}/dist`;
      const bytes = new Uint8Array([0, 255, 1, 128, 2]);
      await Deno.mkdir(`${projectDir}/public/images`, { recursive: true });
      await Deno.writeFile(`${projectDir}/public/images/pixel.bin`, bytes);
      try {
        const stats = await copyStaticAssets(unusedAdapter, projectDir, outputDir);
        assertEquals(stats.assets, 1);
        assertEquals(stats.totalSize, bytes.byteLength);
        assertEquals(
          [...await Deno.readFile(`${outputDir}/images/pixel.bin`)],
          [...bytes],
        );
      } finally {
        await Deno.remove(root, { recursive: true });
      }
    });

    it("counts assets without writing during a dry run", async () => {
      const root = await Deno.makeTempDir({ prefix: "vf-static-assets-" });
      const projectDir = `${root}/project`;
      const outputDir = `${root}/dist`;
      await Deno.mkdir(`${projectDir}/public`, { recursive: true });
      await Deno.writeTextFile(`${projectDir}/public/robots.txt`, "hello");
      try {
        const stats = await copyStaticAssets(
          unusedAdapter,
          projectDir,
          outputDir,
          true,
        );
        assertEquals(stats.assets, 1);
        await assertRejects(() => Deno.stat(outputDir), Deno.errors.NotFound);
      } finally {
        await Deno.remove(root, { recursive: true });
      }
    });

    it("refuses to overwrite an existing generated output", async () => {
      const root = await Deno.makeTempDir({ prefix: "vf-static-assets-" });
      const projectDir = `${root}/project`;
      const outputDir = `${root}/dist`;
      await Deno.mkdir(`${projectDir}/public`, { recursive: true });
      await Deno.mkdir(outputDir);
      await Deno.writeTextFile(`${projectDir}/public/sw.js`, "public");
      await Deno.writeTextFile(`${outputDir}/sw.js`, "generated");
      try {
        await assertRejects(
          () => copyStaticAssets(unusedAdapter, projectDir, outputDir),
          Error,
          "would overwrite generated output",
        );
        assertEquals(await Deno.readTextFile(`${outputDir}/sw.js`), "generated");
      } finally {
        await Deno.remove(root, { recursive: true });
      }
    });
  });
});
