import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertRejects } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { promisify } from "node:util";
import { brotliDecompress, gunzip } from "node:zlib";
import { compressBuildOutputs } from "./compression.ts";

const gunzipAsync = promisify(gunzip);
const brotliDecompressAsync = promisify(brotliDecompress);

function replaceRandomUUID(replacement: () => string): () => void {
  const ownDescriptor = Object.getOwnPropertyDescriptor(crypto, "randomUUID");
  Object.defineProperty(crypto, "randomUUID", {
    configurable: true,
    value: replacement,
  });
  return () => {
    if (ownDescriptor) {
      Object.defineProperty(crypto, "randomUUID", ownDescriptor);
    } else {
      Reflect.deleteProperty(crypto, "randomUUID");
    }
  };
}

function nextTick(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

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

  it("rolls back a completed sibling format when the other format fails", async () => {
    const outputDir = await Deno.makeTempDir({ prefix: "vf-compression-" });
    const sourcePath = `${outputDir}/app.js`;
    const gzipId = "00000000-0000-4000-8000-000000000001";
    const brotliId = "00000000-0000-4000-8000-000000000002";
    const callerTemporaryPath = `${sourcePath}.br.tmp-${brotliId}`;
    let identifierIndex = 0;
    const restoreRandomUUID = replaceRandomUUID(
      () => [gzipId, brotliId][identifierIndex++]!,
    );

    try {
      await Deno.writeTextFile(sourcePath, "export const rollback = true;\n".repeat(4_000));
      await Deno.writeTextFile(callerTemporaryPath, "caller-owned");

      await assertRejects(
        () => compressBuildOutputs(outputDir, true, false),
        Error,
        "Failed to create every compression format",
      );
      await assertRejects(() => Deno.stat(`${sourcePath}.gz`), Deno.errors.NotFound);
      await assertRejects(() => Deno.stat(`${sourcePath}.br`), Deno.errors.NotFound);
      assertEquals(await Deno.readTextFile(callerTemporaryPath), "caller-owned");
    } finally {
      restoreRandomUUID();
      await Deno.remove(outputDir, { recursive: true });
    }
  });

  it("rolls back sidecars from earlier sources when the build fails", async () => {
    const outputDir = await Deno.makeTempDir({ prefix: "vf-compression-" });
    const firstPath = `${outputDir}/a.js`;
    const secondPath = `${outputDir}/b.js`;
    const identifiers = [
      "00000000-0000-4000-8000-000000000011",
      "00000000-0000-4000-8000-000000000012",
      "00000000-0000-4000-8000-000000000013",
      "00000000-0000-4000-8000-000000000014",
    ];
    const callerTemporaryPath = `${secondPath}.br.tmp-${identifiers[3]}`;
    let identifierIndex = 0;
    const restoreRandomUUID = replaceRandomUUID(() => identifiers[identifierIndex++]!);

    try {
      await Deno.writeTextFile(firstPath, "export const first = true;\n".repeat(4_000));
      await Deno.writeTextFile(secondPath, "export const second = true;\n".repeat(4_000));
      await Deno.writeTextFile(callerTemporaryPath, "caller-owned");

      await assertRejects(() => compressBuildOutputs(outputDir, true, false));
      for (const path of [firstPath, secondPath]) {
        await assertRejects(() => Deno.stat(`${path}.gz`), Deno.errors.NotFound);
        await assertRejects(() => Deno.stat(`${path}.br`), Deno.errors.NotFound);
      }
      assertEquals(await Deno.readTextFile(callerTemporaryPath), "caller-owned");
    } finally {
      restoreRandomUUID();
      await Deno.remove(outputDir, { recursive: true });
    }
  });

  it("rejects in-place mutation of a temporary output before promotion", async () => {
    const outputDir = await Deno.makeTempDir({ prefix: "vf-compression-temp-guard-" });
    const sourcePath = `${outputDir}/app.js`;
    const gzipId = "00000000-0000-4000-8000-000000000031";
    const brotliId = "00000000-0000-4000-8000-000000000032";
    const gzipTemporaryPath = `${sourcePath}.gz.tmp-${gzipId}`;
    let identifierIndex = 0;
    let tamperTask: Promise<void> | undefined;
    const restoreRandomUUID = replaceRandomUUID(() => {
      const identifier = [gzipId, brotliId][identifierIndex++]!;
      if (!tamperTask) {
        tamperTask = (async () => {
          for (let attempt = 0; attempt < 5_000; attempt++) {
            try {
              const info = await Deno.stat(gzipTemporaryPath);
              if (info.size <= 64) {
                await nextTick();
                continue;
              }
              const file = await Deno.open(gzipTemporaryPath, { write: true });
              try {
                await file.seek(0, Deno.SeekMode.Start);
                await file.write(new Uint8Array(16));
              } finally {
                file.close();
              }
              return;
            } catch (error) {
              if (!(error instanceof Deno.errors.NotFound)) throw error;
            }
            await nextTick();
          }
          throw new Error("Temporary compression output was never available for mutation");
        })();
      }
      return identifier;
    });

    try {
      await Deno.writeTextFile(sourcePath, "export const guarded = true;\n".repeat(100_000));
      const compression = compressBuildOutputs(outputDir, true, false);
      const rejection = assertRejects(
        () => compression,
        Error,
        "Failed to create every compression format",
      );
      while (!tamperTask) await nextTick();
      await tamperTask;
      await rejection;
      await assertRejects(() => Deno.stat(`${sourcePath}.gz`), Deno.errors.NotFound);
      await assertRejects(() => Deno.stat(`${sourcePath}.br`), Deno.errors.NotFound);
    } finally {
      restoreRandomUUID();
      await Deno.remove(outputDir, { recursive: true });
    }
  });

  it("rejects source mutation while compression streams are active", async () => {
    const outputDir = await Deno.makeTempDir({ prefix: "vf-compression-source-guard-" });
    const sourcePath = `${outputDir}/app.js`;
    const gzipId = "00000000-0000-4000-8000-000000000041";
    const brotliId = "00000000-0000-4000-8000-000000000042";
    const gzipTemporaryPath = `${sourcePath}.gz.tmp-${gzipId}`;
    let identifierIndex = 0;
    let mutationTask: Promise<void> | undefined;
    const restoreRandomUUID = replaceRandomUUID(() => {
      const identifier = [gzipId, brotliId][identifierIndex++]!;
      if (!mutationTask) {
        mutationTask = (async () => {
          for (let attempt = 0; attempt < 5_000; attempt++) {
            try {
              if ((await Deno.stat(gzipTemporaryPath)).size > 64) {
                await Deno.writeFile(sourcePath, new Uint8Array([0]), { append: true });
                return;
              }
            } catch (error) {
              if (!(error instanceof Deno.errors.NotFound)) throw error;
            }
            await nextTick();
          }
          throw new Error("Compression stream was never available for source mutation");
        })();
      }
      return identifier;
    });

    try {
      await Deno.writeTextFile(sourcePath, "export const stable = true;\n".repeat(100_000));
      const compression = compressBuildOutputs(outputDir, true, false);
      const rejection = assertRejects(
        () => compression,
        Error,
        "Failed to create every compression format",
      );
      while (!mutationTask) await nextTick();
      await mutationTask;
      await rejection;
      await assertRejects(() => Deno.stat(`${sourcePath}.gz`), Deno.errors.NotFound);
      await assertRejects(() => Deno.stat(`${sourcePath}.br`), Deno.errors.NotFound);
    } finally {
      restoreRandomUUID();
      await Deno.remove(outputDir, { recursive: true });
    }
  });

  it("rejects replacement of a source directory with an external symlink", async () => {
    const root = await Deno.makeTempDir({ prefix: "vf-compression-ancestor-" });
    const outputDir = `${root}/dist`;
    const sourceDir = `${outputDir}/assets`;
    const movedSourceDir = `${outputDir}/moved-assets`;
    const sourcePath = `${sourceDir}/index.html`;
    const externalDir = `${root}/external`;
    const externalSourcePath = `${externalDir}/index.html`;
    let replaced = false;
    let identifier = 20;

    await Deno.mkdir(sourceDir, { recursive: true });
    await Deno.mkdir(externalDir);
    await Deno.writeTextFile(sourcePath, "<main>guard ancestry</main>\n".repeat(4_000));
    const restoreRandomUUID = replaceRandomUUID(() => {
      if (!replaced) {
        replaced = true;
        Deno.renameSync(sourceDir, movedSourceDir);
        Deno.linkSync(`${movedSourceDir}/index.html`, externalSourcePath);
        Deno.symlinkSync(externalDir, sourceDir, { type: "dir" });
      }
      identifier++;
      return `00000000-0000-4000-8000-${String(identifier).padStart(12, "0")}`;
    });

    try {
      await assertRejects(
        () => compressBuildOutputs(outputDir, true, false),
        Error,
        "Failed to create every compression format",
      );
      for (const path of [externalSourcePath, `${movedSourceDir}/index.html`]) {
        await assertRejects(() => Deno.stat(`${path}.gz`), Deno.errors.NotFound);
        await assertRejects(() => Deno.stat(`${path}.br`), Deno.errors.NotFound);
      }
    } finally {
      restoreRandomUUID();
      await Deno.remove(root, { recursive: true });
    }
  });

  it("rejects an ancestor escape that occurs while source guards are captured", async () => {
    const root = await Deno.makeTempDir({ prefix: "vf-compression-capture-" });
    const outputDir = `${root}/dist`;
    const container = `${outputDir}/container`;
    const movedContainer = `${outputDir}/moved-container`;
    const sourceDir = `${container}/assets`;
    const sourcePath = `${sourceDir}/index.html`;
    const external = `${root}/external`;
    const externalSourceDir = `${external}/assets`;
    const externalSourcePath = `${externalSourceDir}/index.html`;
    const lstatDescriptor = Object.getOwnPropertyDescriptor(Deno, "lstat")!;
    const originalLstat = Deno.lstat.bind(Deno);
    let sourceLstatCount = 0;

    await Deno.mkdir(sourceDir, { recursive: true });
    await Deno.mkdir(external);
    await Deno.writeTextFile(sourcePath, "<main>capture guard</main>\n".repeat(4_000));
    Object.defineProperty(Deno, "lstat", {
      ...lstatDescriptor,
      value: async (path: string | URL) => {
        const info = await originalLstat(path);
        if (String(path) === sourcePath && ++sourceLstatCount === 2) {
          Deno.renameSync(container, movedContainer);
          Deno.renameSync(`${movedContainer}/assets`, externalSourceDir);
          Deno.symlinkSync(external, container, { type: "dir" });
        }
        return info;
      },
    });

    try {
      await assertRejects(
        () => compressBuildOutputs(outputDir, true, false),
        Error,
        "Compression source escaped the build output directory",
      );
      await assertRejects(() => Deno.stat(`${externalSourcePath}.gz`), Deno.errors.NotFound);
      await assertRejects(() => Deno.stat(`${externalSourcePath}.br`), Deno.errors.NotFound);
    } finally {
      Object.defineProperty(Deno, "lstat", lstatDescriptor);
      await Deno.remove(root, { recursive: true });
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

  it("rejects a symbolic link used as the output root", async () => {
    const root = await Deno.makeTempDir({ prefix: "vf-compression-" });
    const realOutputDir = `${root}/dist`;
    const linkedOutputDir = `${root}/linked-dist`;
    await Deno.mkdir(realOutputDir);
    await Deno.writeTextFile(`${realOutputDir}/index.html`, "output");
    await Deno.symlink(realOutputDir, linkedOutputDir, { type: "dir" });
    try {
      await assertRejects(
        () => compressBuildOutputs(linkedOutputDir, true, false),
        Error,
        "Refusing to compress symbolic link",
      );
    } finally {
      await Deno.remove(root, { recursive: true });
    }
  });
});
