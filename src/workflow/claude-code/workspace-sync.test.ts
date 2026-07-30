import "#veryfront/schemas/_test-setup.ts";
/**
 * Tests for WorkspaceSync symlink hardening (VULN-FS-4).
 *
 * These tests exercise resolveSafePath indirectly via the public file methods
 * (writeFile / readFile / deleteFile / fileExists) to verify that:
 *
 *   - Symlinks in the workspace are rejected, even when they point inside
 *     the workspace, to avoid race-susceptible traversal.
 *   - Symlinks at any intermediate path segment are caught.
 *   - Dangling symlinks do not cause the target file to be created.
 *   - Relative symlinks that escape the workspace are rejected.
 *   - Absolute paths and NUL bytes are rejected as bad input.
 *   - Normal deep-nested writes with no symlinks still succeed.
 *   - Portable NFC Unicode paths still succeed.
 */

import { assertEquals, assertRejects, assertThrows } from "#veryfront/testing/assert.ts";
import { afterEach, beforeEach, describe, it } from "#veryfront/testing/bdd.ts";
import { register, unregister } from "../../extensions/contracts.ts";
import { dirname, join } from "@std/path";
import { type ClaudeCodeAgentRuntime, ClaudeCodeAgentRuntimeName } from "./runtime-contract.ts";
import { bugFixTool, claudeCodeTool, createClaudeCodeTool } from "./tool.ts";
import {
  withWorkspace,
  type WorkspacePersistenceContext,
  WorkspaceSync,
  WorkspaceUploadAbortError,
} from "./workspace-sync.ts";

const emptySource = {
  listAll: () => Promise.resolve([]),
  read: () => Promise.reject(new Error("No files")),
};

/** Create an initialized empty workspace through the public lifecycle. */
async function makeWorkspace(baseDir: string): Promise<{
  workspace: WorkspaceSync;
  workspaceDir: string;
}> {
  const runId = "runtest";
  const workspace = new WorkspaceSync({
    baseDir,
    runId,
    source: emptySource,
  });
  const workspaceDir = workspace.workspaceDir;
  await workspace.initialize();
  return { workspace, workspaceDir };
}

async function exists(path: string): Promise<boolean> {
  try {
    await Deno.lstat(path);
    return true;
  } catch (e) {
    if (e instanceof Deno.errors.NotFound) return false;
    throw e;
  }
}

describe("WorkspaceSync symlink hardening (VULN-FS-4)", () => {
  let baseDir: string;
  let escapeDir: string;
  let escapeFile: string;

  beforeEach(async () => {
    baseDir = await Deno.makeTempDir({ prefix: "vf-ws-sync-base-" });
    escapeDir = await Deno.makeTempDir({ prefix: "vf-ws-sync-outside-" });
    escapeFile = join(escapeDir, "victim.txt");
    await Deno.writeTextFile(escapeFile, "original outside content");
  });

  afterEach(async () => {
    for (const dir of [baseDir, escapeDir]) {
      try {
        await Deno.remove(dir, { recursive: true });
      } catch (e) {
        if (!(e instanceof Deno.errors.NotFound)) throw e;
      }
    }
  });

  it("rejects write through a direct symlink pointing outside the workspace", async () => {
    const { workspace, workspaceDir } = await makeWorkspace(baseDir);
    // Pre-existing malicious symlink from a prior run.
    await Deno.symlink(escapeFile, join(workspaceDir, "a.txt"));

    await assertRejects(
      () => workspace.writeFile("a.txt", "PWNED"),
      Error,
    );

    // Victim file is untouched.
    const victimContent = await Deno.readTextFile(escapeFile);
    assertEquals(victimContent, "original outside content");
  });

  it("rejects write when an intermediate directory segment is a symlink", async () => {
    const { workspace, workspaceDir } = await makeWorkspace(baseDir);
    // workspace/sub -> /tmp/<escape>
    await Deno.symlink(escapeDir, join(workspaceDir, "sub"));

    const error = await assertRejects(
      () => workspace.writeFile("sub/x.txt", "PWNED"),
      Error,
    );

    // No file created inside the escape directory.
    assertEquals(await exists(join(escapeDir, "x.txt")), false);
    const message = error instanceof Error ? error.message : String(error);
    assertEquals(message.includes(baseDir), false);
    assertEquals(message.includes(escapeDir), false);
  });

  it("rejects write through a dangling symlink and does NOT create the target", async () => {
    const { workspace, workspaceDir } = await makeWorkspace(baseDir);
    const missingTarget = join(escapeDir, "does-not-exist-yet.txt");
    await Deno.symlink(missingTarget, join(workspaceDir, "dangle.txt"));

    await assertRejects(
      () => workspace.writeFile("dangle.txt", "PWNED"),
      Error,
    );

    // The dangling target must not have been materialised.
    assertEquals(await exists(missingTarget), false);
  });

  it("rejects relative symlinks that resolve outside the workspace", async () => {
    const { workspace, workspaceDir } = await makeWorkspace(baseDir);
    // workspace/a -> ../../etc/hostname (relative escape)
    await Deno.symlink("../../etc/hostname", join(workspaceDir, "a"));
    assertEquals((await Deno.lstat(join(workspaceDir, "a"))).isSymlink, true);

    await assertRejects(
      () => workspace.writeFile("a", "PWNED"),
      Error,
    );
  });

  it("rejects a symlink even when its target is INSIDE the workspace (safer treatment)", async () => {
    const { workspace, workspaceDir } = await makeWorkspace(baseDir);
    const realFile = join(workspaceDir, "real.txt");
    await Deno.writeTextFile(realFile, "original");
    // workspace/alias -> workspace/real.txt
    await Deno.symlink(realFile, join(workspaceDir, "alias"));

    await assertRejects(
      () => workspace.writeFile("alias", "overwritten"),
      Error,
    );

    // Target still has its original content.
    assertEquals(await Deno.readTextFile(realFile), "original");
  });

  it("pre-existing symlink is still caught on the single writeFile call", async () => {
    const { workspace, workspaceDir } = await makeWorkspace(baseDir);
    // Simulate attacker-placed symlink before a single write call.
    await Deno.symlink(escapeFile, join(workspaceDir, "race.txt"));

    await assertRejects(
      () => workspace.writeFile("race.txt", "PWNED"),
      Error,
    );
    assertEquals(await Deno.readTextFile(escapeFile), "original outside content");
  });

  it("rejects a hard-linked file before a write can modify the other link", async () => {
    const { workspace, workspaceDir } = await makeWorkspace(baseDir);
    await Deno.link(escapeFile, join(workspaceDir, "hard-link.txt"));

    await assertRejects(
      () => workspace.writeFile("hard-link.txt", "PWNED"),
      Error,
      "multiple hard links",
    );
    await assertRejects(
      () => workspace.readFile("hard-link.txt"),
      Error,
      "multiple hard links",
    );
    assertEquals(await Deno.readTextFile(escapeFile), "original outside content");
  });

  it("does not materialize a workspace through a symlinked base directory", async () => {
    const realBase = join(baseDir, "real-base");
    const linkedBase = join(baseDir, "linked-base");
    await Deno.mkdir(realBase);
    await Deno.symlink(realBase, linkedBase);
    let listed = 0;
    const workspace = new WorkspaceSync({
      baseDir: linkedBase,
      runId: "linked-run",
      source: {
        listAll: () => {
          listed++;
          return Promise.resolve([]);
        },
        read: () => Promise.resolve("unused"),
      },
    });

    await assertRejects(
      () => workspace.initialize(),
      Error,
      "symlinked baseDir",
    );
    assertEquals(listed, 0);
    assertEquals(await exists(join(realBase, "linked-run")), false);
  });

  it("detects replacement of the claimed workspace before materialization", async () => {
    let workspaceDir = "";
    const displacedDir = join(baseDir, "displaced-workspace");
    const workspace = new WorkspaceSync({
      baseDir,
      runId: "root-replacement",
      source: {
        listAll: () => Promise.resolve([{ path: "/escaped.txt" }]),
        read: async () => {
          await Deno.rename(workspaceDir, displacedDir);
          await Deno.symlink(escapeDir, workspaceDir);
          return "must stay isolated";
        },
      },
    });
    workspaceDir = workspace.workspaceDir;

    await assertRejects(
      () => workspace.initialize(),
      Error,
      "Workspace materialization and cleanup failed",
    );
    assertEquals(await exists(join(escapeDir, "escaped.txt")), false);
  });

  it("does not accept a replaced workspace after an empty source listing", async () => {
    let workspaceDir = "";
    const displacedDir = join(baseDir, "displaced-empty-workspace");
    const workspace = new WorkspaceSync({
      baseDir,
      runId: "empty-root-replacement",
      source: {
        listAll: async () => {
          await Deno.rename(workspaceDir, displacedDir);
          await Deno.symlink(escapeDir, workspaceDir);
          return [];
        },
        read: () => Promise.resolve("unused"),
      },
    });
    workspaceDir = workspace.workspaceDir;

    await assertRejects(
      () => workspace.initialize(),
      Error,
      "Workspace source listing changed the claimed workspace",
    );
    await assertRejects(
      () => workspace.detectChanges(),
      Error,
      "Workspace not initialized",
    );
  });

  it("allows a normal write with no symlinks present", async () => {
    const { workspace, workspaceDir } = await makeWorkspace(baseDir);
    await workspace.writeFile("hello.txt", "world");
    assertEquals(await Deno.readTextFile(join(workspaceDir, "hello.txt")), "world");
  });

  it("supports nested path creation where intermediate dirs do not yet exist", async () => {
    const { workspace, workspaceDir } = await makeWorkspace(baseDir);
    await workspace.writeFile("a/b/c.txt", "deep");
    assertEquals(await Deno.readTextFile(join(workspaceDir, "a", "b", "c.txt")), "deep");
  });

  it("creates private workspace directories and materialized files", async () => {
    if (Deno.build.os === "windows") return;
    const workspace = new WorkspaceSync({
      baseDir,
      runId: "private-materialization",
      source: {
        listAll: () => Promise.resolve([{ path: "/nested/file.txt" }]),
        read: () => Promise.resolve("private"),
      },
    });
    await workspace.initialize();

    for (const path of [workspace.workspaceDir, join(workspace.workspaceDir, "nested")]) {
      const mode = (await Deno.stat(path)).mode;
      if (mode === null) throw new Error("Expected POSIX directory mode");
      assertEquals(mode & 0o077, 0);
    }
    const fileMode = (await Deno.stat(join(workspace.workspaceDir, "nested", "file.txt"))).mode;
    if (fileMode === null) throw new Error("Expected POSIX file mode");
    assertEquals(fileMode & 0o077, 0);
  });

  it("rejects file and persistence operations outside the initialized lifecycle", async () => {
    const workspace = new WorkspaceSync({
      baseDir,
      runId: "lifecycle",
      source: emptySource,
    });

    for (
      const operation of [
        () => workspace.readFile("file.txt"),
        () => workspace.writeFile("file.txt", "content"),
        () => workspace.deleteFile("file.txt"),
        () => workspace.fileExists("file.txt"),
        () => workspace.uploadChanges([]),
      ]
    ) {
      await assertRejects(operation, Error, "Workspace not initialized");
    }

    await workspace.initialize();
    await workspace.cleanup();
    await assertRejects(
      () => workspace.writeFile("file.txt", "content"),
      Error,
      "Workspace not initialized",
    );
  });

  it("cleanup never deletes a directory the instance did not claim", async () => {
    const workspace = new WorkspaceSync({
      baseDir,
      runId: "foreign-cleanup",
      source: emptySource,
    });
    await Deno.mkdir(workspace.workspaceDir);
    await Deno.writeTextFile(join(workspace.workspaceDir, "foreign.txt"), "keep");

    await workspace.cleanup();

    assertEquals(await Deno.readTextFile(join(workspace.workspaceDir, "foreign.txt")), "keep");
  });

  it("repeated cleanup does not delete a later directory at the same path", async () => {
    const workspace = new WorkspaceSync({
      baseDir,
      runId: "repeat-cleanup",
      source: emptySource,
    });
    await workspace.initialize();
    await workspace.cleanup();
    await Deno.mkdir(workspace.workspaceDir);
    await Deno.writeTextFile(join(workspace.workspaceDir, "foreign.txt"), "keep");

    await workspace.cleanup();

    assertEquals(await Deno.readTextFile(join(workspace.workspaceDir, "foreign.txt")), "keep");
  });

  it("reports a claimed workspace that disappeared before cleanup", async () => {
    const workspace = new WorkspaceSync({
      baseDir,
      runId: "renamed-before-cleanup",
      source: emptySource,
    });
    await workspace.initialize();
    const displacedWorkspace = join(baseDir, "displaced-before-cleanup");
    await Deno.rename(workspace.workspaceDir, displacedWorkspace);

    await assertRejects(
      () => workspace.cleanup(),
      Error,
      "Claimed workspace disappeared before cleanup completed",
    );

    assertEquals(await exists(displacedWorkspace), true);
    await assertRejects(
      () => workspace.cleanup(),
      Error,
      "Claimed workspace disappeared before cleanup completed",
    );
  });

  it("does not mistake a missing claimed root for an absent file", async () => {
    const workspace = new WorkspaceSync({
      baseDir,
      runId: "missing-root-is-not-absence",
      source: emptySource,
    });
    await workspace.initialize();
    const displacedWorkspace = join(baseDir, "missing-root-displaced");
    await Deno.rename(workspace.workspaceDir, displacedWorkspace);
    let callbacks = 0;

    await assertRejects(
      () => workspace.fileExists("file.txt"),
      Error,
    );
    await assertRejects(
      () =>
        workspace.uploadChanges(
          [{ path: "/file.txt", type: "deleted" }],
          {
            onDelete: () => {
              callbacks++;
              return Promise.resolve();
            },
          },
        ),
      Error,
    );
    assertEquals(callbacks, 0);
  });

  it("atomically replaces a regular file without leaving write artifacts", async () => {
    const { workspace, workspaceDir } = await makeWorkspace(baseDir);
    await workspace.writeFile("file.txt", "first");
    await workspace.writeFile("file.txt", "second");

    assertEquals(await workspace.readFile("file.txt"), "second");
    const names: string[] = [];
    for await (const entry of Deno.readDir(workspaceDir)) names.push(entry.name);
    assertEquals(names, ["file.txt"]);
  });

  it("rejects empty path and bare '/' that would resolve to the workspace root", async () => {
    const { workspace, workspaceDir } = await makeWorkspace(baseDir);
    await assertRejects(() => workspace.writeFile("", "x"), Error);
    await assertRejects(() => workspace.writeFile("/", "x"), Error);
    // Workspace dir must remain a directory, not be clobbered into a file.
    const info = await Deno.stat(workspaceDir);
    assertEquals(info.isDirectory, true);
  });

  it("rejects paths containing a NUL byte", async () => {
    const { workspace } = await makeWorkspace(baseDir);
    await assertRejects(
      () => workspace.writeFile("bad\0name.txt", "x"),
      Error,
    );
  });

  it("rejects non-canonical path aliases in public file operations", async () => {
    const { workspace } = await makeWorkspace(baseDir);
    for (const path of ["a/../b.txt", "a/./b.txt", "a//b.txt", "a\\b.txt"]) {
      await assertRejects(
        () => workspace.writeFile(path, "x"),
        Error,
        "canonical project path",
      );
    }
  });

  it("accepts portable NFC Unicode paths", async () => {
    const { workspace, workspaceDir } = await makeWorkspace(baseDir);
    const portable = "café/résumé.txt";
    await workspace.writeFile(portable, "unicode ok");
    const expected = join(workspaceDir, "café", "résumé.txt");
    assertEquals(await Deno.readTextFile(expected), "unicode ok");
  });

  it("rejects Windows-style drive-letter absolute paths", async () => {
    const { workspace } = await makeWorkspace(baseDir);
    await assertRejects(
      () => workspace.writeFile("C:\\Windows\\pwn.txt", "x"),
      Error,
    );
  });

  it("rejects UNC-style double-slash paths", async () => {
    const { workspace } = await makeWorkspace(baseDir);
    await assertRejects(
      () => workspace.writeFile("//evil-host/share/pwn.txt", "x"),
      Error,
    );
  });

  it("an absolute-looking Unix path does NOT escape the workspace", async () => {
    // The one-leading-slash API convention treats this as workspace-relative;
    // the critical property is that the write must not land outside.
    const { workspace, workspaceDir } = await makeWorkspace(baseDir);
    const outsidePath = join(escapeDir, "pwned.txt");
    await workspace.writeFile(outsidePath, "x");
    assertEquals(await exists(outsidePath), false);
    // It ends up safely inside the workspace instead.
    assertEquals(
      await exists(join(workspaceDir, outsidePath.replace(/^\/+/, ""))),
      true,
    );
  });

  it("rejects readFile through a symlink", async () => {
    const { workspace, workspaceDir } = await makeWorkspace(baseDir);
    await Deno.symlink(escapeFile, join(workspaceDir, "read.txt"));
    await assertRejects(
      () => workspace.readFile("read.txt"),
      Error,
    );
  });

  it("rejects deleteFile through a symlink and leaves target intact", async () => {
    const { workspace, workspaceDir } = await makeWorkspace(baseDir);
    await Deno.symlink(escapeFile, join(workspaceDir, "del.txt"));
    await assertRejects(
      () => workspace.deleteFile("del.txt"),
      Error,
    );
    assertEquals(await exists(escapeFile), true);
  });

  it("fileExists propagates security violations instead of reporting absence", async () => {
    const { workspace, workspaceDir } = await makeWorkspace(baseDir);
    await Deno.symlink(escapeFile, join(workspaceDir, "probe.txt"));
    await assertRejects(
      () => workspace.fileExists("probe.txt"),
      Error,
      "Refusing to traverse symlink",
    );
  });

  it("symlink planted between writes on same workspace is caught on next write", async () => {
    const { workspace, workspaceDir } = await makeWorkspace(baseDir);
    // First write: clean.
    await workspace.writeFile("file.txt", "first");
    assertEquals(await Deno.readTextFile(join(workspaceDir, "file.txt")), "first");

    // Attacker replaces the file with a symlink mid-session.
    await Deno.remove(join(workspaceDir, "file.txt"));
    await Deno.symlink(escapeFile, join(workspaceDir, "file.txt"));

    await assertRejects(
      () => workspace.writeFile("file.txt", "PWNED"),
      Error,
    );
    assertEquals(await Deno.readTextFile(escapeFile), "original outside content");
  });

  // Sanity: dirname helper is exercised elsewhere too.
  it("dirname of a nested safe path matches the workspace", async () => {
    const { workspaceDir } = await makeWorkspace(baseDir);
    assertEquals(dirname(join(workspaceDir, "a", "b.txt")), join(workspaceDir, "a"));
  });

  it("detectChanges fails closed instead of hiding a symlinked directory", async () => {
    const { workspace, workspaceDir } = await makeWorkspace(baseDir);
    // Seed a legitimate file so initialize()-free harness still has something
    // under the workspace to contrast with.
    await workspace.writeFile("real.txt", "real");

    // Put a secret file in the outside dir. It must not end up in changes.
    const secret = join(escapeDir, "secret.txt");
    await Deno.writeTextFile(secret, "this-must-not-leak");

    // Plant an attacker symlink pointing to the escape directory.
    await Deno.symlink(escapeDir, join(workspaceDir, "outside"));

    await assertRejects(
      () => workspace.detectChanges(),
      Error,
      "Workspace change detection refuses symlink",
    );
  });

  it("rejects non-portable output paths before change persistence", async () => {
    if (Deno.build.os === "windows") return;
    const workspace = new WorkspaceSync({
      baseDir,
      runId: "non-portable-output",
      source: emptySource,
    });
    await workspace.initialize();
    await Deno.writeTextFile(join(workspace.workspaceDir, "CON"), "device alias");

    await assertRejects(
      () => workspace.detectChanges(),
      Error,
      "non-portable project path",
    );
  });

  it("bounds files created by the workspace before change detection reads them", async () => {
    const workspace = new WorkspaceSync({
      baseDir,
      runId: "output-file-budget",
      maxFiles: 1,
      source: emptySource,
    });
    await workspace.initialize();
    await workspace.writeFile("a.txt", "a");
    await workspace.writeFile("b.txt", "b");

    await assertRejects(
      () => workspace.detectChanges(),
      Error,
      "Workspace contents exceed the configured limit of 1 files",
    );
  });

  it("bounds directory entries even when they contain no files", async () => {
    const workspace = new WorkspaceSync({
      baseDir,
      runId: "output-entry-budget",
      maxEntries: 2,
      source: emptySource,
    });
    await workspace.initialize();
    for (const name of ["one", "two", "three"]) {
      await Deno.mkdir(join(workspace.workspaceDir, name));
    }

    await assertRejects(
      () => workspace.detectChanges(),
      Error,
      "Workspace contents exceed the configured limit of 2 entries",
    );
  });

  it("counts excluded output roots but prunes their directory contents", async () => {
    const workspace = new WorkspaceSync({
      baseDir,
      runId: "output-excluded-pruning",
      exclude: ["node_modules/**"],
      maxEntries: 2,
      source: emptySource,
    });
    await workspace.initialize();
    await Deno.mkdir(join(workspace.workspaceDir, "node_modules", "pkg", "deep"), {
      recursive: true,
    });
    await Deno.writeTextFile(
      join(workspace.workspaceDir, "node_modules", "pkg", "deep", "ignored.js"),
      "ignored",
    );
    await Deno.writeTextFile(join(workspace.workspaceDir, "kept.ts"), "kept");

    assertEquals(
      (await workspace.detectChanges()).map((change) => change.path),
      ["/kept.ts"],
    );
  });

  it("charges excluded output roots to the traversal entry budget", async () => {
    const workspace = new WorkspaceSync({
      baseDir,
      runId: "output-excluded-entry-budget",
      exclude: ["one/**", "two/**"],
      maxEntries: 1,
      source: emptySource,
    });
    await workspace.initialize();
    await Deno.mkdir(join(workspace.workspaceDir, "one"));
    await Deno.mkdir(join(workspace.workspaceDir, "two"));

    await assertRejects(
      () => workspace.detectChanges(),
      Error,
      "Workspace contents exceed the configured limit of 1 entries",
    );
  });

  it("applies include and exclude policy before selected output file budgets", async () => {
    const workspace = new WorkspaceSync({
      baseDir,
      runId: "output-bidirectional-policy",
      include: ["*.ts"],
      exclude: ["node_modules/**"],
      maxFiles: 1,
      maxFileSize: 1,
      maxTotalBytes: 1,
      source: emptySource,
    });
    await workspace.initialize();
    await Deno.mkdir(join(workspace.workspaceDir, "node_modules", "pkg"), { recursive: true });
    await Deno.writeTextFile(
      join(workspace.workspaceDir, "node_modules", "pkg", "ignored.js"),
      "far beyond every selected-file byte budget",
    );
    await Deno.writeTextFile(
      join(workspace.workspaceDir, "notes.md"),
      "also beyond every selected-file byte budget",
    );
    await Deno.mkdir(join(workspace.workspaceDir, "src"));
    await Deno.writeTextFile(join(workspace.workspaceDir, "src", "main.ts"), "x");

    assertEquals(
      (await workspace.detectChanges()).map(({ path, type }) => ({ path, type })),
      [{ path: "/src/main.ts", type: "created" }],
    );
  });

  it("rejects a tracked file replaced by a directory", async () => {
    const workspace = new WorkspaceSync({
      baseDir,
      runId: "file-to-directory",
      source: {
        listAll: () => Promise.resolve([{ path: "/tracked.txt" }]),
        read: () => Promise.resolve("original"),
      },
    });
    await workspace.initialize();
    await Deno.remove(join(workspace.workspaceDir, "tracked.txt"));
    await Deno.mkdir(join(workspace.workspaceDir, "tracked.txt"));

    await assertRejects(
      () => workspace.detectChanges(),
      Error,
      "Tracked workspace file became a directory",
    );
  });

  it("fails if an observed tracked file disappears during detection", async () => {
    const workspace = new WorkspaceSync({
      baseDir,
      runId: "tracked-file-disappears-during-detection",
      source: {
        listAll: () => Promise.resolve([{ path: "/tracked.txt" }]),
        read: () => Promise.resolve("original"),
      },
    });
    await workspace.initialize();
    await workspace.writeFile("tracked.txt", "modified");
    const originalReadDir = Deno.readDir;
    const target = join(workspace.workspaceDir, "tracked.txt");
    Deno.readDir = ((path: string | URL) => {
      const iterable = originalReadDir(path);
      if (String(path) !== workspace.workspaceDir) return iterable;
      return (async function* () {
        for await (const entry of iterable) yield entry;
        await Deno.remove(target);
      })();
    }) as typeof Deno.readDir;

    try {
      await assertRejects(
        () => workspace.detectChanges(),
        Error,
        "Tracked workspace file disappeared during change detection",
      );
    } finally {
      Deno.readDir = originalReadDir;
    }
  });

  it("returns changes in canonical path order", async () => {
    const workspace = new WorkspaceSync({
      baseDir,
      runId: "change-order",
      source: emptySource,
    });
    await workspace.initialize();
    await workspace.writeFile("z.txt", "z");
    await workspace.writeFile("a.txt", "a");

    assertEquals(
      (await workspace.detectChanges()).map((change) => change.path),
      ["/a.txt", "/z.txt"],
    );
  });

  it("rejects a created file that portably collides with a tracked deletion", async () => {
    const workspace = new WorkspaceSync({
      baseDir,
      runId: "created-deleted-portable-collision",
      source: {
        listAll: () => Promise.resolve([{ path: "/File.ts" }]),
        read: () => Promise.resolve("original"),
      },
    });
    await workspace.initialize();
    await workspace.deleteFile("File.ts");
    await workspace.writeFile("file.ts", "created");
    // A case-insensitive host addresses both spellings as the same current
    // file and fails through the concurrent-appearance guard instead.
    const caseSensitive = !(await workspace.fileExists("File.ts"));
    if (!caseSensitive) return;

    await assertRejects(
      () => workspace.detectChanges(),
      Error,
      "portable path collision",
    );
  });

  it("bounds aggregate UTF-8 bytes created inside the workspace", async () => {
    const workspace = new WorkspaceSync({
      baseDir,
      runId: "output-byte-budget",
      maxTotalBytes: 3,
      source: emptySource,
    });
    await workspace.initialize();
    await workspace.writeFile("a.txt", "é");
    await workspace.writeFile("b.txt", "é");

    await assertRejects(
      () => workspace.detectChanges(),
      Error,
      "Workspace contents exceed the configured limit of 3 UTF-8 bytes",
    );
  });

  it("rejects an output file that exceeds the per-file byte budget", async () => {
    const workspace = new WorkspaceSync({
      baseDir,
      runId: "output-single-file-budget",
      maxFileSize: 1,
      source: emptySource,
    });
    await workspace.initialize();
    // The external agent writes directly to the admitted workspace, bypassing
    // WorkspaceSync.writeFile's earlier per-file guard.
    await Deno.writeTextFile(join(workspace.workspaceDir, "large.txt"), "é");

    await assertRejects(
      () => workspace.detectChanges(),
      Error,
      "Workspace file exceeds the configured limit of 1 UTF-8 bytes",
    );
  });

  it("bounds direct writes and rejects non-UTF-8 workspace reads", async () => {
    const workspace = new WorkspaceSync({
      baseDir,
      runId: "direct-io-budget",
      maxFileSize: 1,
      source: emptySource,
    });
    await workspace.initialize();

    await assertRejects(
      () => workspace.writeFile("large.txt", "é"),
      Error,
      "Workspace file exceeds the configured limit of 1 UTF-8 bytes",
    );
    assertEquals(await workspace.fileExists("large.txt"), false);

    await Deno.writeFile(join(workspace.workspaceDir, "invalid.txt"), new Uint8Array([0xff]));
    await assertRejects(
      () => workspace.readFile("invalid.txt"),
      Error,
      "valid UTF-8 text",
    );
  });

  it("fails initialization and removes partial state after any source read error", async () => {
    const workspace = new WorkspaceSync({
      baseDir,
      runId: "partial-download",
      source: {
        listAll: () => Promise.resolve([{ path: "/ok.txt" }, { path: "/failed.txt" }]),
        read: (path) =>
          path === "/ok.txt"
            ? Promise.resolve("ok")
            : Promise.reject(new Error("credential details must not leak")),
      },
    });

    const error = await assertRejects(
      () => workspace.initialize(),
      Error,
      "Workspace initialization failed for 1 file(s)",
    );
    assertEquals(String(error).includes("credential details must not leak"), false);
    assertEquals(await exists(workspace.workspaceDir), false);
    await assertRejects(
      () => workspace.detectChanges(),
      Error,
      "Workspace not initialized",
    );
  });

  it("stops source reads as soon as the snapshot becomes incomplete", async () => {
    const reads: string[] = [];
    const workspace = new WorkspaceSync({
      baseDir,
      runId: "fail-fast-download",
      source: {
        listAll: () =>
          Promise.resolve([
            { path: "/a.txt" },
            { path: "/b.txt" },
            { path: "/c.txt" },
          ]),
        read: (path) => {
          reads.push(path);
          return path === "/b.txt"
            ? Promise.reject(new Error("source failed"))
            : Promise.resolve(path);
        },
      },
    });

    await assertRejects(
      () => workspace.initialize(),
      Error,
      "Workspace initialization failed",
    );
    assertEquals(reads, ["/a.txt", "/b.txt"]);
    assertEquals(await exists(workspace.workspaceDir), false);
  });

  it("rejects traversal before exclusions or source reads can observe it", async () => {
    let reads = 0;
    const workspace = new WorkspaceSync({
      baseDir,
      runId: "admission-before-policy",
      exclude: [".env"],
      source: {
        listAll: () => Promise.resolve([{ path: "/safe/../.env" }]),
        read: () => {
          reads++;
          return Promise.resolve("secret");
        },
      },
    });

    await assertRejects(
      () => workspace.initialize(),
      Error,
      "Workspace source path admission failed",
    );
    assertEquals(reads, 0);
    assertEquals(await exists(workspace.workspaceDir), false);
  });

  it("rejects NUL, dot-segment, separator, and backslash aliases before reading", async () => {
    for (const path of ["/bad\0name", "/a/./b", "/a//b", "/a\\b"]) {
      let reads = 0;
      const workspace = new WorkspaceSync({
        baseDir,
        runId: `invalid-${reads}-${path.length}`,
        source: {
          listAll: () => Promise.resolve([{ path }]),
          read: () => {
            reads++;
            return Promise.resolve("unexpected");
          },
        },
      });

      await assertRejects(
        () => workspace.initialize(),
        Error,
        "Workspace source path admission failed",
      );
      assertEquals(reads, 0);
      assertEquals(await exists(workspace.workspaceDir), false);
    }
  });

  it("rejects Windows aliases and non-NFC source paths before reading", async () => {
    const unsafePaths = [
      "/CON",
      "/nested/NUL.txt",
      "/file.txt:stream",
      "/trailing.",
      "/trailing ",
      "/bad<name>.txt",
      "/e\u0301.txt",
      `/${"x".repeat(256)}`,
    ];
    for (let index = 0; index < unsafePaths.length; index++) {
      let reads = 0;
      const workspace = new WorkspaceSync({
        baseDir,
        runId: `portable-source-${index}`,
        source: {
          listAll: () => Promise.resolve([{ path: unsafePaths[index]! }]),
          read: () => {
            reads++;
            return Promise.resolve("unexpected");
          },
        },
      });

      await assertRejects(
        () => workspace.initialize(),
        Error,
        "Workspace source path admission failed",
      );
      assertEquals(reads, 0);
      assertEquals(await exists(workspace.workspaceDir), false);
    }
  });

  it("rejects portable directory collisions before source reads", async () => {
    let reads = 0;
    const workspace = new WorkspaceSync({
      baseDir,
      runId: "portable-source-collision",
      source: {
        listAll: () =>
          Promise.resolve([
            { path: "/Source/a.ts" },
            { path: "/source/b.ts" },
          ]),
        read: () => {
          reads++;
          return Promise.resolve("unexpected");
        },
      },
    });

    await assertRejects(
      () => workspace.initialize(),
      Error,
      "portable path collision",
    );
    assertEquals(reads, 0);
    assertEquals(await exists(workspace.workspaceDir), false);
  });

  it("rejects a selected source file used as another file's parent before reads", async () => {
    let reads = 0;
    const workspace = new WorkspaceSync({
      baseDir,
      runId: "source-file-parent-collision",
      source: {
        listAll: () => Promise.resolve([{ path: "/a" }, { path: "/a/b" }]),
        read: () => {
          reads++;
          return Promise.resolve("unexpected");
        },
      },
    });

    await assertRejects(
      () => workspace.initialize(),
      Error,
      "also a parent",
    );
    assertEquals(reads, 0);
    assertEquals(await exists(workspace.workspaceDir), false);
  });

  it("fails deterministically when different source spellings alias one path", async () => {
    let reads = 0;
    const workspace = new WorkspaceSync({
      baseDir,
      runId: "alias-collision",
      source: {
        listAll: () => Promise.resolve([{ path: "src/main.ts" }, { path: "/src/main.ts" }]),
        read: () => {
          reads++;
          return Promise.resolve("unexpected");
        },
      },
    });

    await assertRejects(
      () => workspace.initialize(),
      Error,
      "Duplicate canonical project file path: /src/main.ts",
    );
    assertEquals(reads, 0);
    assertEquals(await exists(workspace.workspaceDir), false);
  });

  it("filters and reads only admitted canonical paths in deterministic order", async () => {
    const reads: string[] = [];
    const readLimits: number[] = [];
    const workspace = new WorkspaceSync({
      baseDir,
      runId: "canonical-order",
      include: ["src/**"],
      source: {
        listAll: () =>
          Promise.resolve([
            { path: "src/z.ts" },
            { path: "/ignored.txt" },
            { path: "/src/a.ts" },
          ]),
        read: (path, limits) => {
          reads.push(path);
          readLimits.push(limits.maxBytes);
          return Promise.resolve(path);
        },
      },
    });

    const result = await workspace.initialize();
    assertEquals(reads, ["/src/a.ts", "/src/z.ts"]);
    assertEquals(readLimits, [10 * 1024 * 1024, 10 * 1024 * 1024]);
    assertEquals(result.filesDownloaded, 2);
    assertEquals(result.skippedFiles, ["/ignored.txt"]);
  });

  it("matches include and exclude patterns at path-segment boundaries", async () => {
    const reads: string[] = [];
    const workspace = new WorkspaceSync({
      baseDir,
      runId: "pattern-boundaries",
      exclude: ["src/**", "**/secret.ts"],
      source: {
        listAll: () =>
          Promise.resolve([
            { path: "/src/hidden.ts" },
            { path: "/src2/visible.ts" },
            { path: "/notsecret.ts" },
            { path: "/nested/secret.ts" },
          ]),
        read: (path) => {
          reads.push(path);
          return Promise.resolve(path);
        },
      },
    });

    const result = await workspace.initialize();
    assertEquals(reads, ["/notsecret.ts", "/src2/visible.ts"]);
    assertEquals(result.skippedFiles, ["/nested/secret.ts", "/src/hidden.ts"]);
  });

  it("enforces the source file-count budget before any source read", async () => {
    let reads = 0;
    const workspace = new WorkspaceSync({
      baseDir,
      runId: "file-budget",
      maxFiles: 1,
      source: {
        listAll: () => Promise.resolve([{ path: "/a.txt" }, { path: "/b.txt" }]),
        read: () => {
          reads++;
          return Promise.resolve("unexpected");
        },
      },
    });

    await assertRejects(
      () => workspace.initialize(),
      Error,
      "Workspace source exceeds the configured limit of 1 files",
    );
    assertEquals(reads, 0);
    assertEquals(await exists(workspace.workspaceDir), false);
  });

  it("enforces the materialized entry budget before any source read", async () => {
    let reads = 0;
    const workspace = new WorkspaceSync({
      baseDir,
      runId: "source-entry-budget",
      maxEntries: 2,
      source: {
        listAll: () => Promise.resolve([{ path: "/one/two/file.txt" }]),
        read: () => {
          reads++;
          return Promise.resolve("unexpected");
        },
      },
    });

    await assertRejects(
      () => workspace.initialize(),
      Error,
      "Workspace source exceeds the configured limit of 2 entries",
    );
    assertEquals(reads, 0);
    assertEquals(await exists(workspace.workspaceDir), false);
    await assertRejects(
      () => workspace.detectChanges(),
      Error,
      "Workspace not initialized",
    );
  });

  it("does not charge inbound policy omissions to the materialized entry budget", async () => {
    const reads: string[] = [];
    const workspace = new WorkspaceSync({
      baseDir,
      runId: "source-entry-policy",
      exclude: ["ignored/**"],
      maxEntries: 1,
      source: {
        listAll: () =>
          Promise.resolve([
            { path: "/ignored/deep/file.txt" },
            { path: "/kept.txt" },
          ]),
        read: (path) => {
          reads.push(path);
          return Promise.resolve("kept");
        },
      },
    });

    const result = await workspace.initialize();
    assertEquals(reads, ["/kept.txt"]);
    assertEquals(result.skippedFiles, ["/ignored/deep/file.txt"]);
    assertEquals(result.filesDownloaded, 1);
  });

  it("passes source limits and fails before claiming a workspace when aborted", async () => {
    const controller = new AbortController();
    controller.abort(new Error("cancelled by test"));
    let listCalls = 0;
    const workspace = new WorkspaceSync({
      baseDir,
      runId: "source-cancelled",
      maxFiles: 7,
      abortSignal: controller.signal,
      source: {
        listAll: () => {
          listCalls++;
          return Promise.resolve([]);
        },
        read: () => Promise.resolve("unused"),
      },
    });

    await assertRejects(() => workspace.initialize(), Error, "cancelled by test");
    assertEquals(listCalls, 0);
    assertEquals(await exists(workspace.workspaceDir), false);

    const activeController = new AbortController();
    let receivedLimit = 0;
    let listSignal: AbortSignal | undefined;
    let readSignal: AbortSignal | undefined;
    const active = new WorkspaceSync({
      baseDir,
      runId: "source-limit",
      maxFiles: 7,
      abortSignal: activeController.signal,
      source: {
        listAll: ({ maxFiles, abortSignal }) => {
          receivedLimit = maxFiles;
          listSignal = abortSignal;
          return Promise.resolve([{ path: "/file.txt" }]);
        },
        read: (_path, { abortSignal }) => {
          readSignal = abortSignal;
          return Promise.resolve("content");
        },
      },
    });
    await active.initialize();
    assertEquals(receivedLimit, 7);
    assertEquals(listSignal, activeController.signal);
    assertEquals(readSignal, activeController.signal);
  });

  it("does not start source listing when cancellation lands during workspace claim", async () => {
    const controller = new AbortController();
    let listCalls = 0;
    const workspace = new WorkspaceSync({
      baseDir,
      runId: "cancelled-during-claim",
      abortSignal: controller.signal,
      source: {
        listAll: () => {
          listCalls++;
          return Promise.resolve([]);
        },
        read: () => Promise.resolve("unused"),
      },
    });

    const initialization = workspace.initialize();
    queueMicrotask(() => controller.abort(new Error("cancelled during claim")));
    await assertRejects(
      () => initialization,
      Error,
      "cancelled during claim",
    );
    assertEquals(listCalls, 0);
    assertEquals(await exists(workspace.workspaceDir), false);
  });

  it("removes a partial claimed workspace when cancellation lands between source files", async () => {
    const controller = new AbortController();
    const abortReason = new Error("cancelled between source files");
    let reads = 0;
    const workspace = new WorkspaceSync({
      baseDir,
      runId: "cancelled-between-files",
      abortSignal: controller.signal,
      source: {
        listAll: () => Promise.resolve([{ path: "/a.txt" }, { path: "/b.txt" }]),
        read: () => {
          reads++;
          if (reads !== 1) return Promise.resolve("unexpected second read");
          return new Promise<string>((resolve) => {
            queueMicrotask(() => {
              resolve("first file");
              // Promise resolution queues initialize's continuation first. This
              // abort therefore lands during the following async hash/write,
              // after the source-read abort check but before the next file.
              queueMicrotask(() => controller.abort(abortReason));
            });
          });
        },
      },
    });

    await assertRejects(
      () => workspace.initialize(),
      Error,
      "cancelled between source files",
    );

    assertEquals(reads, 1);
    assertEquals(await exists(workspace.workspaceDir), false);
    await assertRejects(
      () => workspace.detectChanges(),
      Error,
      "Workspace not initialized",
    );
  });

  it("enforces the aggregate UTF-8 byte budget and removes partial state", async () => {
    const workspace = new WorkspaceSync({
      baseDir,
      runId: "byte-budget",
      maxTotalBytes: 3,
      source: {
        listAll: () => Promise.resolve([{ path: "/a.txt" }, { path: "/b.txt" }]),
        read: () => Promise.resolve("é"),
      },
    });

    await assertRejects(
      () => workspace.initialize(),
      Error,
      "Workspace source exceeds the configured limit of 3 UTF-8 bytes",
    );
    assertEquals(await exists(workspace.workspaceDir), false);
    await assertRejects(
      () => workspace.detectChanges(),
      Error,
      "Workspace not initialized",
    );
  });

  it("fails rather than silently omitting a source file over its byte budget", async () => {
    const workspace = new WorkspaceSync({
      baseDir,
      runId: "source-file-budget",
      maxFileSize: 1,
      source: {
        listAll: () => Promise.resolve([{ path: "/large.txt" }]),
        // Deliberately violates the bounded source contract so core's second
        // line of defense is exercised.
        read: () => Promise.resolve("é"),
      },
    });

    await assertRejects(
      () => workspace.initialize(),
      Error,
      "Workspace source file exceeds the configured limit of 1 UTF-8 bytes",
    );
    assertEquals(await exists(workspace.workspaceDir), false);
  });

  it("persists deletions through an explicitly composed delete handler", async () => {
    const workspace = new WorkspaceSync({
      baseDir,
      runId: "delete-upload",
      source: {
        listAll: () => Promise.resolve([{ path: "/gone.txt" }, { path: "/kept.txt" }]),
        read: (path) => Promise.resolve(path),
      },
    });
    await workspace.initialize();
    await workspace.deleteFile("/gone.txt");
    await workspace.writeFile("/kept.txt", "changed");
    const changes = await workspace.detectChanges();
    const deleted: string[] = [];
    const uploaded: Array<{ path: string; content: string }> = [];

    const result = await workspace.uploadChanges(changes, {
      onDelete: (path) => {
        deleted.push(path);
        return Promise.resolve();
      },
      onUpload: (path, content) => {
        uploaded.push({ path, content });
        return Promise.resolve();
      },
    });

    assertEquals(deleted, ["/gone.txt"]);
    assertEquals(uploaded, [{ path: "/kept.txt", content: "changed" }]);
    assertEquals(result.uploaded.map((change) => change.type).sort(), ["deleted", "modified"]);
    assertEquals(result.failed, []);
  });

  it("passes a frozen detached detected change to persistence callbacks", async () => {
    const workspace = new WorkspaceSync({
      baseDir,
      runId: "persistence-change-context",
      source: {
        listAll: () => Promise.resolve([{ path: "/file.txt" }]),
        read: () => Promise.resolve("original"),
      },
    });
    await workspace.initialize();
    await workspace.writeFile("file.txt", "modified");
    const changes = await workspace.detectChanges();
    const expectedChange = { ...changes[0]! };
    const contexts: WorkspacePersistenceContext[] = [];

    const upload = workspace.uploadChanges(changes, {
      onUpload: (_path, _content, _type, context) => {
        contexts.push(context);
        assertEquals(Object.isFrozen(context), true);
        assertEquals(Object.isFrozen(context.change), true);
        assertThrows(
          () => {
            (context.change as { path: string }).path = "/callback-mutated.txt";
          },
          TypeError,
        );
        return Promise.resolve();
      },
    });

    // uploadChanges admits and copies the entire change list before its first
    // asynchronous read, so later caller mutations cannot rewrite callback
    // preconditions or result accounting.
    changes[0]!.path = "/caller-mutated.txt";
    changes[0]!.type = "created";
    changes[0]!.originalChecksum = "caller-mutated";
    changes[0]!.newChecksum = "caller-mutated";

    const result = await upload;
    assertEquals(contexts.length, 1);
    assertEquals(contexts[0]!.change, expectedChange);
    assertEquals(contexts[0]!.change === changes[0], false);
    assertEquals(result.uploaded, [expectedChange]);
  });

  it("reports a deletion as unpersisted when no delete handler is composed", async () => {
    const workspace = new WorkspaceSync({
      baseDir,
      runId: "delete-dry-run",
      source: emptySource,
    });
    await workspace.initialize();

    const result = await workspace.uploadChanges([{ path: "/gone.txt", type: "deleted" }]);

    assertEquals(result.uploaded, []);
    assertEquals(result.failed, [{ path: "/gone.txt", error: "Delete handler is not configured" }]);
  });

  it("admits every changed path before invoking persistence callbacks", async () => {
    const workspace = new WorkspaceSync({
      baseDir,
      runId: "upload-admission",
      source: emptySource,
    });
    await workspace.initialize();
    let callbacks = 0;

    await assertRejects(
      () =>
        workspace.uploadChanges(
          [
            { path: "/safe.txt", type: "deleted" },
            { path: "/nested/../outside.txt", type: "deleted" },
          ],
          {
            onDelete: () => {
              callbacks++;
              return Promise.resolve();
            },
          },
        ),
      Error,
      "canonical project path",
    );
    assertEquals(callbacks, 0);

    await assertRejects(
      () =>
        workspace.uploadChanges(
          [
            { path: "same.txt", type: "deleted" },
            { path: "/same.txt", type: "deleted" },
          ],
          {
            onDelete: () => {
              callbacks++;
              return Promise.resolve();
            },
          },
        ),
      Error,
      "Duplicate canonical workspace change path",
    );
    assertEquals(callbacks, 0);

    await assertRejects(
      () =>
        workspace.uploadChanges(
          [
            { path: "/File.ts", type: "deleted" },
            { path: "/file.ts", type: "deleted" },
          ],
          {
            onDelete: () => {
              callbacks++;
              return Promise.resolve();
            },
          },
        ),
      Error,
      "portable path collision",
    );
    assertEquals(callbacks, 0);
  });

  it("persists the full valid detection bound of deletions plus current files", async () => {
    const workspace = new WorkspaceSync({
      baseDir,
      runId: "upload-full-detection-bound",
      maxFiles: 1,
      source: {
        listAll: () => Promise.resolve([{ path: "/deleted.txt" }]),
        read: () => Promise.resolve("original"),
      },
    });
    await workspace.initialize();
    await workspace.deleteFile("deleted.txt");
    await workspace.writeFile("created.txt", "created");
    const changes = await workspace.detectChanges();
    assertEquals(changes.length, 2);
    const callbacks: string[] = [];

    const result = await workspace.uploadChanges(changes, {
      onDelete: (path) => {
        callbacks.push(`delete:${path}`);
        return Promise.resolve();
      },
      onUpload: (path) => {
        callbacks.push(`upload:${path}`);
        return Promise.resolve();
      },
    });

    assertEquals(callbacks, ["upload:/created.txt", "delete:/deleted.txt"]);
    assertEquals(result.uploaded, changes);
    assertEquals(result.failed, []);
  });

  it("rejects persistence changes outside the configured bidirectional policy", async () => {
    const workspace = new WorkspaceSync({
      baseDir,
      runId: "upload-file-policy",
      include: ["*.ts"],
      exclude: ["secret/**"],
      source: emptySource,
    });
    await workspace.initialize();
    let callbacks = 0;

    for (const path of ["/notes.md", "/secret/file.ts"]) {
      await assertRejects(
        () =>
          workspace.uploadChanges(
            [{ path, type: "deleted" }],
            {
              onDelete: () => {
                callbacks++;
                return Promise.resolve();
              },
            },
          ),
        Error,
        "outside the configured file policy",
      );
    }
    assertEquals(callbacks, 0);
  });

  it("settles the aggregate upload budget before invoking callbacks", async () => {
    const workspace = new WorkspaceSync({
      baseDir,
      runId: "upload-byte-budget",
      maxTotalBytes: 3,
      source: emptySource,
    });
    await workspace.initialize();
    await workspace.writeFile("a.txt", "é");
    await workspace.writeFile("b.txt", "é");
    let callbacks = 0;

    await assertRejects(
      () =>
        workspace.uploadChanges(
          [
            { path: "/a.txt", type: "created" },
            { path: "/b.txt", type: "created" },
          ],
          {
            onUpload: () => {
              callbacks++;
              return Promise.resolve();
            },
          },
        ),
      Error,
      "Workspace upload exceeds the configured limit of 3 UTF-8 bytes",
    );
    assertEquals(callbacks, 0);
  });

  it("rejects content changed after detection before persistence callbacks run", async () => {
    const workspace = new WorkspaceSync({
      baseDir,
      runId: "stale-change",
      source: emptySource,
    });
    await workspace.initialize();
    await workspace.writeFile("file.txt", "detected");
    const changes = await workspace.detectChanges();
    await workspace.writeFile("file.txt", "changed again");
    let callbacks = 0;

    await assertRejects(
      () =>
        workspace.uploadChanges(changes, {
          onUpload: () => {
            callbacks++;
            return Promise.resolve();
          },
        }),
      Error,
      "changed after change detection",
    );
    assertEquals(callbacks, 0);
  });

  it("rejects a deletion recreated after detection before callbacks run", async () => {
    const workspace = new WorkspaceSync({
      baseDir,
      runId: "stale-deletion",
      source: {
        listAll: () => Promise.resolve([{ path: "/file.txt" }]),
        read: () => Promise.resolve("original"),
      },
    });
    await workspace.initialize();
    await workspace.deleteFile("file.txt");
    const changes = await workspace.detectChanges();
    await workspace.writeFile("file.txt", "recreated");
    let callbacks = 0;

    await assertRejects(
      () =>
        workspace.uploadChanges(changes, {
          onDelete: () => {
            callbacks++;
            return Promise.resolve();
          },
        }),
      Error,
      "deletion changed after change detection",
    );
    assertEquals(callbacks, 0);
  });

  it("does not persist a later deletion recreated by an earlier callback", async () => {
    const workspace = new WorkspaceSync({
      baseDir,
      runId: "stale-deletion-during-persistence",
      source: {
        listAll: () => Promise.resolve([{ path: "/a.txt" }, { path: "/b.txt" }]),
        read: (path) => Promise.resolve(path),
      },
    });
    await workspace.initialize();
    await workspace.deleteFile("a.txt");
    await workspace.deleteFile("b.txt");
    const changes = await workspace.detectChanges();
    const callbacks: string[] = [];

    const result = await workspace.uploadChanges(changes, {
      onDelete: async (path) => {
        callbacks.push(path);
        if (path === "/a.txt") {
          await workspace.writeFile("b.txt", "recreated during persistence");
        }
      },
    });

    assertEquals(callbacks, ["/a.txt"]);
    assertEquals(result.uploaded.map((change) => change.path), ["/a.txt"]);
    assertEquals(result.failed, [{
      path: "/b.txt",
      error: "Workspace deletion changed before persistence",
    }]);
  });

  it("sanitizes callback failures and continues settling later changes", async () => {
    const workspace = new WorkspaceSync({
      baseDir,
      runId: "persistence-callback-failure",
      source: emptySource,
    });
    await workspace.initialize();
    await workspace.writeFile("a.txt", "a");
    await workspace.writeFile("b.txt", "b");
    const changes = await workspace.detectChanges();
    const callbacks: string[] = [];

    const result = await workspace.uploadChanges(changes, {
      onUpload: (path) => {
        callbacks.push(path);
        return path === "/a.txt"
          ? Promise.reject(new Error("private persistence detail"))
          : Promise.resolve();
      },
    });

    assertEquals(callbacks, ["/a.txt", "/b.txt"]);
    assertEquals(result.uploaded.map((change) => change.path), ["/b.txt"]);
    assertEquals(result.failed, [{
      path: "/a.txt",
      error: "Workspace persistence callback failed",
    }]);
    assertEquals(JSON.stringify(result).includes("private persistence detail"), false);
  });

  it("partitions prior failures, commits, and cancellation-remaining changes", async () => {
    const controller = new AbortController();
    const workspace = new WorkspaceSync({
      baseDir,
      runId: "failure-before-cancelled-persistence",
      abortSignal: controller.signal,
      source: emptySource,
    });
    await workspace.initialize();
    for (const path of ["a.txt", "b.txt", "c.txt"]) {
      await workspace.writeFile(path, path);
    }
    const changes = await workspace.detectChanges();

    let caught: unknown;
    try {
      await workspace.uploadChanges(changes, {
        onUpload: (path) => {
          if (path === "/a.txt") return Promise.reject(new Error("first failed"));
          if (path === "/b.txt") controller.abort(new Error("stop before third"));
          return Promise.resolve();
        },
      });
    } catch (error) {
      caught = error;
    }

    if (!(caught instanceof WorkspaceUploadAbortError)) {
      throw new Error("Expected structured cancellation after a prior failure");
    }
    assertEquals(caught.partialResult.failed, [{
      path: "/a.txt",
      error: "Workspace persistence callback failed",
    }]);
    assertEquals(caught.partialResult.uploaded.map((change) => change.path), ["/b.txt"]);
    assertEquals(caught.remainingChanges.map((change) => change.path), ["/c.txt"]);
  });

  it("reports committed upload progress when cancellation stops a later callback", async () => {
    const controller = new AbortController();
    const abortReason = new Error("stop after first upload");
    const workspace = new WorkspaceSync({
      baseDir,
      runId: "cancelled-upload-batch",
      abortSignal: controller.signal,
      source: emptySource,
    });
    await workspace.initialize();
    await workspace.writeFile("a.txt", "a");
    await workspace.writeFile("b.txt", "b");
    const changes = await workspace.detectChanges();
    const callbacks: string[] = [];

    let caught: unknown;
    try {
      await workspace.uploadChanges(changes, {
        onUpload: (path, _content, _type, { abortSignal }) => {
          assertEquals(abortSignal, controller.signal);
          callbacks.push(path);
          controller.abort(abortReason);
          return Promise.resolve();
        },
      });
    } catch (error) {
      caught = error;
    }

    if (!(caught instanceof WorkspaceUploadAbortError)) {
      throw new Error("Expected a structured workspace upload cancellation");
    }
    assertEquals(caught.name, "AbortError");
    assertEquals(caught.cause, abortReason);
    assertEquals(callbacks, ["/a.txt"]);
    assertEquals(caught.partialResult.uploaded.map((change) => change.path), ["/a.txt"]);
    assertEquals(caught.partialResult.skipped, []);
    assertEquals(caught.partialResult.failed, []);
    assertEquals(caught.remainingChanges.map((change) => change.path), ["/b.txt"]);
    assertEquals(Object.isFrozen(caught.partialResult), true);
    assertEquals(Object.isFrozen(caught.partialResult.uploaded), true);
    assertEquals(Object.isFrozen(caught.partialResult.uploaded[0]), true);
    assertEquals(Object.isFrozen(caught.remainingChanges), true);
    assertEquals(Object.isFrozen(caught.remainingChanges[0]), true);
  });

  it("reports committed deletion progress when cancellation stops a later callback", async () => {
    const controller = new AbortController();
    const abortReason = new Error("stop after first deletion");
    const workspace = new WorkspaceSync({
      baseDir,
      runId: "cancelled-delete-batch",
      abortSignal: controller.signal,
      source: {
        listAll: () => Promise.resolve([{ path: "/a.txt" }, { path: "/b.txt" }]),
        read: (path) => Promise.resolve(path),
      },
    });
    await workspace.initialize();
    await workspace.deleteFile("a.txt");
    await workspace.deleteFile("b.txt");
    const changes = await workspace.detectChanges();
    const callbacks: string[] = [];

    let caught: unknown;
    try {
      await workspace.uploadChanges(changes, {
        onDelete: (path, { abortSignal }) => {
          assertEquals(abortSignal, controller.signal);
          callbacks.push(path);
          controller.abort(abortReason);
          return Promise.resolve();
        },
      });
    } catch (error) {
      caught = error;
    }

    if (!(caught instanceof WorkspaceUploadAbortError)) {
      throw new Error("Expected a structured workspace deletion cancellation");
    }
    assertEquals(caught.name, "AbortError");
    assertEquals(caught.cause, abortReason);
    assertEquals(callbacks, ["/a.txt"]);
    assertEquals(caught.partialResult.uploaded.map((change) => change.path), ["/a.txt"]);
    assertEquals(caught.remainingChanges.map((change) => change.path), ["/b.txt"]);
  });

  it("returns full success when the final committed callback triggers cancellation", async () => {
    const controller = new AbortController();
    const workspace = new WorkspaceSync({
      baseDir,
      runId: "cancelled-after-final-commit",
      abortSignal: controller.signal,
      source: emptySource,
    });
    await workspace.initialize();
    await workspace.writeFile("only.txt", "content");
    const changes = await workspace.detectChanges();

    const result = await workspace.uploadChanges(changes, {
      onUpload: () => {
        controller.abort(new Error("all work is already committed"));
        return Promise.resolve();
      },
    });

    assertEquals(result.uploaded, changes);
    assertEquals(result.skipped, []);
    assertEquals(result.failed, []);
  });

  it("does not invoke withWorkspace work against an incomplete source snapshot", async () => {
    let invoked = false;
    await assertRejects(
      () =>
        withWorkspace(
          {
            baseDir,
            runId: "incomplete-wrapper",
            source: {
              listAll: () => Promise.resolve([{ path: "/failed.txt" }]),
              read: () => Promise.reject(new Error("download failed")),
            },
          },
          () => {
            invoked = true;
            return Promise.resolve("unexpected");
          },
        ),
      Error,
      "Workspace initialization failed",
    );
    assertEquals(invoked, false);
    assertEquals(await exists(join(baseDir, "incomplete-wrapper")), false);
  });

  it("preserves an undefined operation rejection and still cleans the workspace", async () => {
    let rejected = false;
    try {
      await withWorkspace(
        {
          baseDir,
          runId: "undefined-rejection",
          source: emptySource,
        },
        () => Promise.reject(undefined),
      );
    } catch (error) {
      rejected = true;
      assertEquals(error, undefined);
    }

    assertEquals(rejected, true);
    assertEquals(await exists(join(baseDir, "undefined-rejection")), false);
  });

  it("removes the claimed workspace when source listing fails", async () => {
    const workspace = new WorkspaceSync({
      baseDir,
      runId: "failed-list",
      source: {
        listAll: () => Promise.reject(new Error("list credential must not leak")),
        read: () => Promise.resolve("unused"),
      },
    });
    const error = await assertRejects(
      () => workspace.initialize(),
      Error,
      "Workspace source file listing failed",
    );
    assertEquals(String(error).includes("list credential must not leak"), false);
    assertEquals(await exists(workspace.workspaceDir), false);
  });

  it("validates explicit workspace composition", () => {
    assertThrows(
      () => new WorkspaceSync(null as unknown as ConstructorParameters<typeof WorkspaceSync>[0]),
      Error,
      "config must be an object",
    );

    const foreignPlatformAbsolute = Deno.build.os === "windows"
      ? "/tmp/workspaces"
      : "C:/workspaces";
    for (
      const invalidBaseDir of [
        "",
        "relative/path",
        " /tmp/workspaces ",
        `${baseDir}/nested/..`,
        foreignPlatformAbsolute,
      ]
    ) {
      assertThrows(
        () =>
          new WorkspaceSync({
            baseDir: invalidBaseDir,
            runId: "run",
            source: emptySource,
          }),
        Error,
        "baseDir",
      );
    }

    for (
      const [field, value] of [
        ["maxFiles", 0],
        ["maxFiles", 1.5],
        ["maxEntries", 0],
        ["maxTotalBytes", 0],
        ["maxTotalBytes", Number.POSITIVE_INFINITY],
      ] as const
    ) {
      assertThrows(
        () =>
          new WorkspaceSync({
            baseDir,
            runId: "run",
            source: emptySource,
            [field]: value,
          }),
        Error,
        field,
      );
    }

    for (
      const pattern of [
        "**/",
        "**//foo",
        "**/*.ts",
        "src//**",
        "a/../b",
        "a\\b",
        "*.t:s",
        "*.foo\\bar",
        "*.e\u0301",
      ]
    ) {
      assertThrows(
        () =>
          new WorkspaceSync({
            baseDir,
            runId: "run",
            source: emptySource,
            exclude: [pattern],
          }),
        Error,
        "unsupported pattern form",
      );
    }

    for (
      const [field, value] of [
        ["include", "src/**"],
        ["exclude", { pattern: "node_modules/**" }],
        ["debug", "yes"],
      ] as const
    ) {
      assertThrows(
        () =>
          new WorkspaceSync(
            {
              baseDir,
              runId: "run",
              source: emptySource,
              [field]: value,
            } as unknown as ConstructorParameters<typeof WorkspaceSync>[0],
          ),
        Error,
        field,
      );
    }

    assertThrows(
      () =>
        new WorkspaceSync({
          baseDir,
          runId: "CON",
          source: emptySource,
        }),
      Error,
      "runId",
    );
    assertThrows(
      () =>
        new WorkspaceSync({
          baseDir,
          runId: "x".repeat(256),
          source: emptySource,
        }),
      Error,
      "runId",
    );
  });

  it("rejects overlong source paths before reading them", async () => {
    let reads = 0;
    const workspace = new WorkspaceSync({
      baseDir,
      runId: "long-source-path",
      source: {
        listAll: () => Promise.resolve([{ path: `/${"x".repeat(4097)}` }]),
        read: () => {
          reads++;
          return Promise.resolve("unexpected");
        },
      },
    });

    await assertRejects(
      () => workspace.initialize(),
      Error,
      "Workspace source path admission failed",
    );
    assertEquals(reads, 0);
  });
});

describe("Claude Code tool workspace admission", () => {
  const result = {
    success: true as const,
    iterations: 1,
    response: "done",
    filesModified: [],
    commandsExecuted: [],
    executionTime: 1,
  };

  afterEach(() => unregister(ClaudeCodeAgentRuntimeName));

  function captureRuntime(received: string[]): ClaudeCodeAgentRuntime {
    return {
      execute: (_task, config) => {
        received.push(config.cwd ?? "<missing>");
        return Promise.resolve(result);
      },
    };
  }

  it("fails writable built-in execution without a host-admitted directory", async () => {
    register(ClaudeCodeAgentRuntimeName, captureRuntime([]));
    const parsed = bugFixTool.inputSchema.safeParse({ task: "fix it" });
    if (!parsed.success) throw new Error("test input did not parse");

    await assertRejects(
      () => bugFixTool.execute(parsed.data),
      Error,
      "requires an explicit absolute working directory",
    );
  });

  it("forwards the host-admitted directory for writable built-in execution", async () => {
    const received: string[] = [];
    register(ClaudeCodeAgentRuntimeName, captureRuntime(received));
    const parsed = bugFixTool.inputSchema.safeParse({ task: "fix it" });
    if (!parsed.success) throw new Error("test input did not parse");

    await bugFixTool.execute(parsed.data, { cwd: "/srv/workspaces/run-1" });
    assertEquals(received, ["/srv/workspaces/run-1"]);
  });

  it("rejects a relative host directory before invoking the runtime", async () => {
    const received: string[] = [];
    register(ClaudeCodeAgentRuntimeName, captureRuntime(received));
    const parsed = claudeCodeTool.inputSchema.safeParse({ task: "edit", mode: "code" });
    if (!parsed.success) throw new Error("test input did not parse");

    for (const cwd of ["relative/project", "/srv/workspaces/../unadmitted"]) {
      await assertRejects(
        () => claudeCodeTool.execute(parsed.data, { cwd }),
        Error,
        "must be an explicit canonical absolute path",
      );
    }
    assertEquals(received, []);
  });

  it("lets a composed tool own its admitted directory", async () => {
    const received: string[] = [];
    register(ClaudeCodeAgentRuntimeName, captureRuntime(received));
    const tool = createClaudeCodeTool({
      defaultMode: "code",
      cwd: "/srv/workspaces/composed",
    });
    const parsed = tool.inputSchema.safeParse({ task: "edit" });
    if (!parsed.success) throw new Error("test input did not parse");

    await tool.execute(parsed.data);
    assertEquals(received, ["/srv/workspaces/composed"]);
  });
});
