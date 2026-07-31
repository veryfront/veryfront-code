import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertRejects } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  copyStaticAssets,
  discoverStaticAssets,
  loadClientStyles,
  validateStaticBuildOutput,
} from "./asset-generation.ts";
import type { AssetStats } from "./asset-generation.ts";
import { denoAdapter } from "#veryfront/platform/adapters/runtime/deno/index.ts";
import { createMockAdapter } from "#veryfront/platform/adapters/mock.ts";
import { STATIC_ASSET_MAX_BYTES } from "#veryfront/utils/constants/static-assets.ts";

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
        assertEquals(await discoverStaticAssets(denoAdapter, projectDir), []);
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
          () => discoverStaticAssets(denoAdapter, projectDir),
          Error,
          "Symbolic links are not supported",
        );
      } finally {
        await Deno.remove(root, { recursive: true });
      }
    });

    it("rejects paths reserved for generated build output", async () => {
      const projectDir = await Deno.makeTempDir({ prefix: "vf-static-assets-" });
      await Deno.mkdir(`${projectDir}/public`, { recursive: true });
      await Deno.writeTextFile(`${projectDir}/public/sw.js`, "public");
      try {
        await assertRejects(
          () => discoverStaticAssets(denoAdapter, projectDir),
          Error,
          "reserved for generated build output: sw.js",
        );
      } finally {
        await Deno.remove(projectDir, { recursive: true });
      }
    });

    it("rejects case and Unicode-normalization collisions deterministically", async () => {
      for (
        const names of [
          ["Logo.svg", "logo.svg"],
          ["caf\u00e9.txt", "cafe\u0301.txt"],
        ]
      ) {
        const adapter = createMockAdapter();
        for (const name of names) {
          adapter.fs.files.set(`/project/public/${name}`, name);
        }

        await assertRejects(
          () => discoverStaticAssets(adapter, "/project"),
          Error,
          "portable path collision",
        );
      }
    });

    it("accepts the shared byte boundary and rejects one byte above it", async () => {
      const adapter = createMockAdapter();
      adapter.fs.byteFiles.set("/project/public/large.bin", new Uint8Array([1]));
      const stat = adapter.fs.stat.bind(adapter.fs);
      let declaredSize = STATIC_ASSET_MAX_BYTES;
      adapter.fs.stat = async (path) => {
        const info = await stat(path);
        return path === "/project/public/large.bin" ? { ...info, size: declaredSize } : info;
      };

      assertEquals((await discoverStaticAssets(adapter, "/project"))[0]?.size, declaredSize);
      declaredSize++;
      await assertRejects(
        () => discoverStaticAssets(adapter, "/project"),
        Error,
        `exceeds the ${STATIC_ASSET_MAX_BYTES}-byte static output limit`,
      );
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
        const stats = await copyStaticAssets(denoAdapter, projectDir, outputDir);
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
          denoAdapter,
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
      await Deno.writeTextFile(`${projectDir}/public/index.html`, "public");
      await Deno.writeTextFile(`${outputDir}/index.html`, "generated");
      try {
        await assertRejects(
          () => copyStaticAssets(denoAdapter, projectDir, outputDir),
          Error,
          "would overwrite generated output",
        );
        assertEquals(await Deno.readTextFile(`${outputDir}/index.html`), "generated");
      } finally {
        await Deno.remove(root, { recursive: true });
      }
    });

    it("uses the selected adapter for discovery and binary output", async () => {
      const adapter = createMockAdapter();
      const bytes = new Uint8Array([0, 255, 1, 128, 2]);
      adapter.fs.byteFiles.set("/project/public/images/pixel.bin", bytes);

      const stats = await copyStaticAssets(adapter, "/project", "/output");

      assertEquals(stats, { assets: 1, totalSize: bytes.byteLength });
      assertEquals(
        [...(adapter.fs.byteFiles.get("/output/images/pixel.bin") ?? [])],
        [...bytes],
      );
    });

    it("fails before writing when the selected adapter lacks binary output", async () => {
      const adapter = createMockAdapter();
      adapter.fs.byteFiles.set("/project/public/asset.bin", new Uint8Array([1, 2, 3]));
      adapter.fs.writeFileBytes = undefined;

      await assertRejects(
        () => copyStaticAssets(adapter, "/project", "/output"),
        Error,
        "does not support bounded or fixed-ceiling",
      );

      assertEquals(adapter.fs.directories.has("/output"), false);
    });

    it("rejects an oversized public asset before reading its bytes", async () => {
      const adapter = createMockAdapter();
      adapter.fs.byteFiles.set("/project/public/large.bin", new Uint8Array([1]));
      const stat = adapter.fs.stat.bind(adapter.fs);
      adapter.fs.stat = async (path) => {
        const info = await stat(path);
        return path === "/project/public/large.bin"
          ? { ...info, size: STATIC_ASSET_MAX_BYTES + 1 }
          : info;
      };
      let reads = 0;
      const readFileBytes = adapter.fs.readFileBytes!.bind(adapter.fs);
      adapter.fs.readFileBytes = (path) => {
        reads++;
        return readFileBytes(path);
      };

      await assertRejects(
        () => copyStaticAssets(adapter, "/project", "/output"),
        Error,
        "static output limit",
      );
      assertEquals(reads, 0);
      assertEquals(adapter.fs.directories.has("/output"), false);
    });

    it("uses bounded reads when a public asset grows after its final stat", async () => {
      const adapter = createMockAdapter();
      adapter.fs.byteFiles.set("/project/public/growing.bin", new Uint8Array([1]));
      let boundedReads = 0;
      let wholeReads = 0;
      adapter.fs.readFileBytesBounded = (_path, byteLimit) => {
        boundedReads++;
        assertEquals(byteLimit, 2);
        return Promise.resolve(new Uint8Array([1, 2]));
      };
      adapter.fs.readFileBytes = () => {
        wholeReads++;
        throw new Error("unbounded whole reader must not run");
      };

      await assertRejects(
        () => copyStaticAssets(adapter, "/project", "/output"),
        Error,
        "changed size while being read",
      );
      assertEquals(boundedReads, 1);
      assertEquals(wholeReads, 0);
      assertEquals(adapter.fs.directories.has("/output"), false);
    });

    it("permits whole reads only under a fixed ceiling within the shared limit", async () => {
      const adapter = createMockAdapter();
      adapter.fs.byteFiles.set("/project/public/asset.bin", new Uint8Array([1, 2, 3]));
      adapter.fs.readFileBytesBounded = undefined;
      Object.defineProperty(adapter.fs, "maxWholeFileReadBytes", { value: 3 });

      const stats = await copyStaticAssets(adapter, "/project", "/output");

      assertEquals(stats.assets, 1);
      assertEquals([...(adapter.fs.byteFiles.get("/output/asset.bin") ?? [])], [1, 2, 3]);
    });

    it("rejects an oversized advertised whole-read ceiling before reading", async () => {
      const adapter = createMockAdapter();
      adapter.fs.byteFiles.set("/project/public/asset.bin", new Uint8Array([1]));
      adapter.fs.readFileBytesBounded = undefined;
      Object.defineProperty(adapter.fs, "maxWholeFileReadBytes", {
        value: STATIC_ASSET_MAX_BYTES + 1,
      });
      let wholeReads = 0;
      adapter.fs.readFileBytes = () => {
        wholeReads++;
        return Promise.resolve(new Uint8Array([1]));
      };

      await assertRejects(
        () => copyStaticAssets(adapter, "/project", "/output"),
        Error,
        "does not support bounded or fixed-ceiling",
      );
      assertEquals(wholeReads, 0);
      assertEquals(adapter.fs.directories.has("/output"), false);
    });

    it("preflights every collision before copying any asset", async () => {
      const adapter = createMockAdapter();
      adapter.fs.byteFiles.set("/project/public/a.bin", new Uint8Array([1]));
      adapter.fs.byteFiles.set("/project/public/z.bin", new Uint8Array([2]));
      adapter.fs.byteFiles.set("/output/z.bin", new Uint8Array([9]));

      await assertRejects(
        () => copyStaticAssets(adapter, "/project", "/output"),
        Error,
        "would overwrite generated output: z.bin",
      );

      assertEquals(adapter.fs.byteFiles.has("/output/a.bin"), false);
      assertEquals([...(adapter.fs.byteFiles.get("/output/z.bin") ?? [])], [9]);
    });

    it("rolls back copied files when a later binary write fails", async () => {
      const adapter = createMockAdapter();
      adapter.fs.byteFiles.set("/project/public/a.bin", new Uint8Array([1]));
      adapter.fs.byteFiles.set("/project/public/b.bin", new Uint8Array([2]));
      const writeFileBytes = adapter.fs.writeFileBytes!.bind(adapter.fs);
      let writes = 0;
      adapter.fs.writeFileBytes = (path, content) => {
        writes++;
        return writes === 2
          ? Promise.reject(new Error("storage unavailable"))
          : writeFileBytes(path, content);
      };

      await assertRejects(
        () => copyStaticAssets(adapter, "/project", "/output"),
        Error,
        "storage unavailable",
      );

      assertEquals(adapter.fs.byteFiles.has("/output/a.bin"), false);
      assertEquals(adapter.fs.byteFiles.has("/output/b.bin"), false);
      assertEquals(adapter.fs.directories.has("/output"), false);
    });
  });

  describe("validateStaticBuildOutput", () => {
    it("enforces the shared runtime limit without reading artifact bodies", async () => {
      const adapter = createMockAdapter();
      adapter.fs.byteFiles.set("/output/_veryfront/app.js", new Uint8Array([1]));
      const stat = adapter.fs.stat.bind(adapter.fs);
      let declaredSize = STATIC_ASSET_MAX_BYTES;
      adapter.fs.stat = async (path) => {
        const info = await stat(path);
        return path === "/output/_veryfront/app.js" ? { ...info, size: declaredSize } : info;
      };
      let reads = 0;
      adapter.fs.readFileBytes = () => {
        reads++;
        return Promise.resolve(new Uint8Array());
      };

      await validateStaticBuildOutput(adapter, "/output");
      assertEquals(reads, 0);

      declaredSize++;
      await assertRejects(
        () => validateStaticBuildOutput(adapter, "/output"),
        Error,
        `exceeds the ${STATIC_ASSET_MAX_BYTES}-byte static asset limit`,
      );
      assertEquals(reads, 0);
    });
  });
});
