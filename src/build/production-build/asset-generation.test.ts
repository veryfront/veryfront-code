import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertRejects } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { copyStaticAssets, loadClientStyles } from "./asset-generation.ts";
import type { AssetStats } from "./asset-generation.ts";
import { runtime } from "#veryfront/platform/adapters/detect.ts";

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

  describe("copyStaticAssets", () => {
    it("does not follow symlinks outside the public directory", async () => {
      const projectDir = await Deno.makeTempDir();
      const outputDir = await Deno.makeTempDir();
      const outsideDir = await Deno.makeTempDir();

      try {
        await Deno.mkdir(`${projectDir}/public`);
        await Deno.writeTextFile(`${outsideDir}/secret.txt`, "not-public");
        await Deno.symlink(`${outsideDir}/secret.txt`, `${projectDir}/public/secret.txt`);

        const adapter = await runtime.get();
        const stats = await copyStaticAssets(adapter, projectDir, outputDir);

        assertEquals(stats, { assets: 0, totalSize: 0 });
        await assertRejects(
          () => Deno.readTextFile(`${outputDir}/secret.txt`),
          Deno.errors.NotFound,
        );
      } finally {
        await Deno.remove(projectDir, { recursive: true });
        await Deno.remove(outputDir, { recursive: true });
        await Deno.remove(outsideDir, { recursive: true });
      }
    });

    it("rejects a public directory that is itself a symbolic link", async () => {
      const projectDir = await Deno.makeTempDir();
      const outputDir = await Deno.makeTempDir();
      const outsideDir = await Deno.makeTempDir();

      try {
        await Deno.writeTextFile(`${outsideDir}/secret.txt`, "not-public");
        await Deno.symlink(outsideDir, `${projectDir}/public`);
        const adapter = await runtime.get();

        await assertRejects(
          () => copyStaticAssets(adapter, projectDir, outputDir),
          TypeError,
          "symbolic link",
        );
      } finally {
        await Deno.remove(projectDir, { recursive: true });
        await Deno.remove(outputDir, { recursive: true });
        await Deno.remove(outsideDir, { recursive: true });
      }
    });

    it("rejects public asset names that cannot map to stable URL paths", async () => {
      const projectDir = await Deno.makeTempDir();
      const outputDir = await Deno.makeTempDir();
      try {
        await Deno.mkdir(`${projectDir}/public`);
        await Deno.writeTextFile(`${projectDir}/public/data?draft.json`, "{}");
        const adapter = await runtime.get();

        await assertRejects(
          () => copyStaticAssets(adapter, projectDir, outputDir),
          TypeError,
          "safe relative paths",
        );
      } finally {
        await Deno.remove(projectDir, { recursive: true });
        await Deno.remove(outputDir, { recursive: true });
      }
    });

    it("rejects public assets that collide with generated runtime files", async () => {
      const projectDir = await Deno.makeTempDir();
      const outputDir = await Deno.makeTempDir();

      try {
        await Deno.mkdir(`${projectDir}/public/_veryfront`, { recursive: true });
        await Deno.writeTextFile(`${projectDir}/public/_veryfront/client.js`, "malicious");
        const adapter = await runtime.get();

        await assertRejects(
          () => copyStaticAssets(adapter, projectDir, outputDir),
          Error,
          "reserved build output",
        );
      } finally {
        await Deno.remove(projectDir, { recursive: true });
        await Deno.remove(outputDir, { recursive: true });
      }
    });

    it("rejects public assets that collide with generated route files", async () => {
      const projectDir = await Deno.makeTempDir();
      const outputDir = await Deno.makeTempDir();

      try {
        await Deno.mkdir(`${projectDir}/public/about`, { recursive: true });
        await Deno.writeTextFile(`${projectDir}/public/about/index.html`, "stale page");
        const adapter = await runtime.get();

        await assertRejects(
          () =>
            copyStaticAssets(
              adapter,
              projectDir,
              outputDir,
              false,
              new Set(["about/index.html"]),
            ),
          Error,
          "reserved build output",
        );
      } finally {
        await Deno.remove(projectDir, { recursive: true });
        await Deno.remove(outputDir, { recursive: true });
      }
    });

    it("rejects a public path that is a file", async () => {
      const projectDir = await Deno.makeTempDir();
      const outputDir = await Deno.makeTempDir();
      try {
        await Deno.writeTextFile(`${projectDir}/public`, "not a directory");
        const adapter = await runtime.get();
        await assertRejects(
          () => copyStaticAssets(adapter, projectDir, outputDir),
          TypeError,
          "public path must be a directory",
        );
      } finally {
        await Deno.remove(projectDir, { recursive: true });
        await Deno.remove(outputDir, { recursive: true });
      }
    });
  });
});
