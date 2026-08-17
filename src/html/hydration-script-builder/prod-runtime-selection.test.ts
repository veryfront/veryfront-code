import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertNotStrictEquals, assertRejects } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import type { DirEntry, FileSystemAdapter } from "#veryfront/platform/adapters/base.ts";
import { getProdHydrationModulePath } from "./prod-scripts.ts";
import {
  hasImmutableReleaseHydrationRuntime,
  resolveProdHydrationModulePath,
} from "./prod-runtime-selection.ts";

function releaseFileSystem(filenames: readonly string[]): Pick<FileSystemAdapter, "readDir"> {
  return {
    async *readDir(path: string): AsyncIterable<DirEntry> {
      assertEquals(path, "/project/dist/_veryfront");
      for (const name of filenames) {
        yield {
          name,
          isFile: true,
          isDirectory: false,
          isSymlink: false,
        };
      }
    },
  };
}

function rejectingFileSystem(
  error: Error,
  onRead: () => void = () => {},
): Pick<FileSystemAdapter, "readDir"> {
  return {
    readDir(): AsyncIterable<DirEntry> {
      onRead();
      return {
        [Symbol.asyncIterator](): AsyncIterator<DirEntry> {
          return { next: () => Promise.reject(error) };
        },
      };
    },
  };
}

describe("resolveProdHydrationModulePath", () => {
  it("classifies only non-empty immutable release IDs as release artifacts", () => {
    assertEquals(hasImmutableReleaseHydrationRuntime(undefined), false);
    assertEquals(hasImmutableReleaseHydrationRuntime(""), false);
    assertEquals(hasImmutableReleaseHydrationRuntime("standalone-dev"), false);
    assertEquals(hasImmutableReleaseHydrationRuntime("release-aged"), true);
  });

  it("keeps the serving runtime path outside a release render", async () => {
    let reads = 0;
    const fs = {
      async *readDir(): AsyncIterable<DirEntry> {
        reads += 1;
        yield* [];
      },
    };

    assertEquals(
      await resolveProdHydrationModulePath({ fs, projectDir: "/project" }),
      getProdHydrationModulePath(),
    );
    assertEquals(reads, 0);
  });

  it("keeps standalone source serving independent of stale build artifacts", async () => {
    let reads = 0;
    const fs = {
      async *readDir(): AsyncIterable<DirEntry> {
        reads += 1;
        yield {
          name: "hydration-runtime.1a2b3c4d.js",
          isFile: true,
          isDirectory: false,
          isSymlink: false,
        };
      },
    };

    assertEquals(
      await resolveProdHydrationModulePath({
        fs,
        projectDir: "/project",
        releaseId: "standalone-dev",
      }),
      getProdHydrationModulePath(),
    );
    assertEquals(reads, 0);
  });

  it("selects the content-addressed runtime baked into an aged release", async () => {
    const agedPath = "/_veryfront/hydration-runtime.1a2b3c4d.js";

    assertEquals(
      await resolveProdHydrationModulePath({
        fs: releaseFileSystem([
          "app.js",
          "hydration-runtime.js",
          "hydration-runtime.1a2b3c4d.js",
          "router.js",
        ]),
        projectDir: "/project",
        releaseId: "release-aged",
      }),
      agedPath,
    );
    assertEquals(agedPath === getProdHydrationModulePath(), false);
  });

  it("reads the runtime from the configured build output directory", async () => {
    const agedPath = "/_veryfront/hydration-runtime.1a2b3c4d.js";
    const fs = {
      async *readDir(path: string): AsyncIterable<DirEntry> {
        assertEquals(path, "/project/custom-output/_veryfront");
        yield {
          name: "hydration-runtime.1a2b3c4d.js",
          isFile: true,
          isDirectory: false,
          isSymlink: false,
        };
      },
    };

    assertEquals(
      await resolveProdHydrationModulePath({
        fs,
        projectDir: "/project",
        buildOutDir: "custom-output",
        releaseId: "release-aged",
      }),
      agedPath,
    );
  });

  it("fails closed when a release has no baked content-addressed runtime", async () => {
    const error = await assertRejects(
      () =>
        resolveProdHydrationModulePath({
          fs: releaseFileSystem(["hydration-runtime.js", "router.js"]),
          projectDir: "/project",
          releaseId: "release-incomplete",
        }),
      Error,
    );

    assertEquals((error as { slug?: unknown }).slug, "render-error");
  });

  it("fails closed when an immutable release directory is missing", async () => {
    const error = await assertRejects(
      () =>
        resolveProdHydrationModulePath({
          fs: rejectingFileSystem(
            new Error("missing immutable release"),
          ),
          projectDir: "/project",
          releaseId: "release-missing",
        }),
      Error,
    );

    assertEquals((error as { slug?: unknown }).slug, "render-error");
  });

  it("wraps filesystem errors that merely expose a render-error slug", async () => {
    const filesystemError = Object.assign(new Error("filesystem failure"), {
      slug: "render-error",
    });
    const error = await assertRejects(
      () =>
        resolveProdHydrationModulePath({
          fs: rejectingFileSystem(filesystemError),
          projectDir: "/project",
          releaseId: "release-unreadable",
        }),
      Error,
    );

    assertEquals((error as { slug?: unknown }).slug, "render-error");
    assertNotStrictEquals(error, filesystemError);
  });

  it("fails closed when a release contains ambiguous versioned runtimes", async () => {
    const error = await assertRejects(
      () =>
        resolveProdHydrationModulePath({
          fs: releaseFileSystem([
            "hydration-runtime.1a2b3c4d.js",
            "hydration-runtime.5e6f7a8b.js",
          ]),
          projectDir: "/project",
          releaseId: "release-ambiguous",
        }),
      Error,
    );

    assertEquals((error as { slug?: unknown }).slug, "render-error");
  });
});
