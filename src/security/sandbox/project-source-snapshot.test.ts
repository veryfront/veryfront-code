import { assertEquals, assertRejects } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { createMockAdapter } from "#veryfront/platform/adapters/mock.ts";
import type { FileSystemAdapter } from "#veryfront/platform/adapters/base.ts";
import {
  collectProjectSourceSnapshot,
  createProjectSnapshotFileSystem,
  PROJECT_SOURCE_SNAPSHOT_MAX_FILE_BYTES,
} from "./project-source-snapshot.ts";

describe("security/sandbox/project-source-snapshot", () => {
  it("creates a deterministic snapshot from an unordered source provider", async () => {
    const adapter = createMockAdapter();
    const fs = adapter.fs as unknown as FileSystemAdapter & {
      getAllSourceFiles(): Promise<Array<{ path: string; content?: string }>>;
    };
    fs.getAllSourceFiles = () =>
      Promise.resolve([
        { path: "/tools/search.ts", content: "export const search = true;" },
        { path: "agents/assistant.md", content: "# Assistant" },
      ]);

    const first = await collectProjectSourceSnapshot({
      projectDir: "/",
      fs,
      virtualRoot: true,
    });
    fs.getAllSourceFiles = () =>
      Promise.resolve([
        { path: "agents/assistant.md", content: "# Assistant" },
        { path: "/tools/search.ts", content: "export const search = true;" },
      ]);
    const second = await collectProjectSourceSnapshot({
      projectDir: "/",
      fs,
      virtualRoot: true,
    });

    assertEquals(first.files.map((file) => file.sourcePath), [
      "agents/assistant.md",
      "tools/search.ts",
    ]);
    assertEquals(first.digest, second.digest);
  });

  it("rejects duplicate normalized paths from a source provider", async () => {
    const adapter = createMockAdapter();
    const fs = adapter.fs as unknown as FileSystemAdapter & {
      getAllSourceFiles(): Promise<Array<{ path: string; content?: string }>>;
    };
    fs.getAllSourceFiles = () =>
      Promise.resolve([
        { path: "agents/assistant.md", content: "first" },
        { path: "/agents/assistant.md", content: "second" },
      ]);

    await assertRejects(
      () =>
        collectProjectSourceSnapshot({
          projectDir: "/",
          fs,
          virtualRoot: true,
        }),
      TypeError,
      "duplicate",
    );
  });

  it("rejects traversal, symlinks, and oversized source files", async () => {
    const adapter = createMockAdapter();
    const providerFs = adapter.fs as unknown as FileSystemAdapter & {
      getAllSourceFiles(): Promise<Array<{ path: string; content?: string }>>;
    };
    providerFs.getAllSourceFiles = () =>
      Promise.resolve([{ path: "../outside.ts", content: "export {};" }]);
    await assertRejects(
      () =>
        collectProjectSourceSnapshot({
          projectDir: "/",
          fs: providerFs,
          virtualRoot: true,
        }),
      TypeError,
      "project-relative",
    );

    const oversized = createMockAdapter();
    oversized.fs.files.set(
      "/project/large.ts",
      "x".repeat(PROJECT_SOURCE_SNAPSHOT_MAX_FILE_BYTES + 1),
    );
    await assertRejects(
      () =>
        collectProjectSourceSnapshot({
          projectDir: "/project",
          fs: oversized.fs,
        }),
      RangeError,
      "file exceeds",
    );

    const symlinkBase = createMockAdapter();
    const symlinkFs: FileSystemAdapter = {
      ...symlinkBase.fs,
      exists: () => Promise.resolve(true),
      readDir: async function* () {
        yield { name: "escape", isFile: false, isDirectory: false, isSymlink: true };
      },
      lstat: () =>
        Promise.resolve({
          isFile: false,
          isDirectory: false,
          isSymlink: true,
          size: 0,
          mtime: null,
        }),
    };
    await assertRejects(
      () => collectProjectSourceSnapshot({ projectDir: "/project", fs: symlinkFs }),
      TypeError,
      "symbolic links",
    );
  });

  it("exposes the immutable bytes through a project-confined filesystem", async () => {
    const adapter = createMockAdapter();
    adapter.fs.files.set("/project/data.bin", "payload");
    const snapshot = await collectProjectSourceSnapshot({
      projectDir: "/project",
      fs: adapter.fs,
    });
    const fs = createProjectSnapshotFileSystem(snapshot, "/snapshot");

    assertEquals(await fs.readFile("/snapshot/data.bin"), "payload");
    assertEquals(
      [...(await fs.readFileBytes?.("/snapshot/data.bin"))!],
      [...new TextEncoder().encode("payload")],
    );
    await assertRejects(
      () => fs.readFile("/outside/data.bin"),
      TypeError,
      "outside",
    );
  });
});
