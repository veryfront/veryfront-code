import "#veryfront/schemas/_test-setup.ts";
/**
 * Tests for WorkspaceSync symlink hardening (VULN-FS-4).
 *
 * These tests exercise resolveSafePath indirectly via the public file methods
 * (writeFile / readFile / deleteFile / fileExists) to verify that:
 *
 *   - Symlinks in the workspace are rejected — even when they point inside
 *     the workspace — to avoid race-susceptible traversal.
 *   - Symlinks at any intermediate path segment are caught.
 *   - Dangling symlinks do not cause the target file to be created.
 *   - Relative symlinks that escape the workspace are rejected.
 *   - Absolute paths and NUL bytes are rejected as bad input.
 *   - Normal deep-nested writes with no symlinks still succeed.
 *   - Unicode paths with combining characters still succeed.
 */

import { assertEquals, assertRejects } from "#veryfront/testing/assert.ts";
import { afterEach, beforeEach, describe, it } from "#veryfront/testing/bdd.ts";
import { dirname, join } from "@std/path";
import { WorkspaceSync } from "./workspace-sync.ts";
import type { FileChange } from "./workspace-sync.ts";
import type { CapturedTenantContext } from "../types.ts";
import { getWorkflowTenant } from "../executor/step-executor.ts";

function stubTenant(): CapturedTenantContext {
  return {
    projectSlug: "test-project",
    token: "test-token",
    productionMode: false,
  };
}

/**
 * Create a WorkspaceSync whose workspaceDir is an already-prepared temp dir
 * (without going through initialize(), which requires live API calls).
 */
async function makeWorkspace(baseDir: string): Promise<{
  workspace: WorkspaceSync;
  workspaceDir: string;
}> {
  const runId = "runtest";
  const workspace = new WorkspaceSync({
    baseDir,
    runId,
    tenant: stubTenant(),
  });
  const workspaceDir = workspace.workspaceDir;
  await Deno.mkdir(workspaceDir, { recursive: true });
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

    await assertRejects(
      () => workspace.writeFile("sub/x.txt", "PWNED"),
      Error,
    );

    // No file created inside the escape directory.
    assertEquals(await exists(join(escapeDir, "x.txt")), false);
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

  it("accepts Unicode paths with combining characters", async () => {
    const { workspace, workspaceDir } = await makeWorkspace(baseDir);
    // "café" with a combining acute accent (e + U+0301).
    const weird = "cafe\u0301/re\u0301sume\u0301.txt";
    await workspace.writeFile(weird, "unicode ok");
    const expected = join(workspaceDir, "cafe\u0301", "re\u0301sume\u0301.txt");
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

  it("fileExists returns false (does not throw) when a symlink is present", async () => {
    const { workspace, workspaceDir } = await makeWorkspace(baseDir);
    await Deno.symlink(escapeFile, join(workspaceDir, "probe.txt"));
    // fileExists swallows errors by design; it should report "no such safe file"
    // rather than following the symlink.
    const result = await workspace.fileExists("probe.txt");
    assertEquals(result, false);
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

  it("detectChanges does NOT descend into symlinked directories (VULN-FS-4)", async () => {
    const { workspace, workspaceDir } = await makeWorkspace(baseDir);
    // Seed a legitimate file so initialize()-free harness still has something
    // under the workspace to contrast with.
    await workspace.writeFile("real.txt", "real");

    // Put a secret file in the outside dir — it must NOT end up in changes.
    const secret = join(escapeDir, "secret.txt");
    await Deno.writeTextFile(secret, "this-must-not-leak");

    // Plant an attacker symlink pointing to the escape directory.
    await Deno.symlink(escapeDir, join(workspaceDir, "outside"));

    // detectChanges requires initialized=true. Flip it via a tiny cast to
    // bypass the API-dependent initialize() path for this unit test.
    (workspace as unknown as { initialized: boolean }).initialized = true;

    const changes = await workspace.detectChanges();

    // Must see real.txt as created, and NOTHING whose path resolves under
    // the escape directory.
    const leakedPaths = changes.filter((c) => c.path.includes("outside/"));
    assertEquals(leakedPaths, []);
    assertEquals(changes.some((c) => c.path === "/real.txt"), true);
  });
});

describe("WorkspaceSync lifecycle and bounds", () => {
  it("uses defaults when optional configuration properties are explicitly undefined", async () => {
    const workspace = new WorkspaceSync(
      {
        baseDir: undefined,
        runId: "undefined-defaults",
        tenant: stubTenant(),
        maxFileSize: undefined,
        maxFiles: undefined,
        maxTotalBytes: undefined,
        maxDepth: undefined,
        maxPages: undefined,
        debug: undefined,
      },
      {
        files: {
          listAll: () => Promise.resolve([]),
          read: () => Promise.resolve("unused"),
        },
      },
    );

    try {
      const result = await workspace.initialize();
      assertEquals(result.filesDownloaded, 0);
      assertEquals(workspace.workspaceDir.startsWith("/tmp/veryfront-workspaces/"), true);
    } finally {
      await workspace.cleanup();
    }
  });

  it("gives each instance an unpredictable workspace and never cleans an unowned directory", async () => {
    const baseDir = await Deno.makeTempDir({ prefix: "vf-ws-sync-owned-" });
    const first = new WorkspaceSync({ baseDir, runId: "same-run", tenant: stubTenant() });
    const second = new WorkspaceSync({ baseDir, runId: "same-run", tenant: stubTenant() });

    try {
      assertEquals(first.workspaceDir === second.workspaceDir, false);
      await Deno.mkdir(first.workspaceDir);
      await Deno.writeTextFile(join(first.workspaceDir, "preexisting.txt"), "keep");
      await first.cleanup();
      assertEquals(
        await Deno.readTextFile(join(first.workspaceDir, "preexisting.txt")),
        "keep",
      );
    } finally {
      await Deno.remove(baseDir, { recursive: true });
    }
  });

  it("refuses to clean a replacement directory at an owned workspace path", async () => {
    const baseDir = await Deno.makeTempDir({ prefix: "vf-ws-sync-replaced-" });
    const workspace = new WorkspaceSync(
      { baseDir, runId: "replaced", tenant: stubTenant() },
      {
        files: {
          listAll: () => Promise.resolve([]),
          read: () => Promise.resolve("unused"),
        },
      },
    );

    try {
      await workspace.initialize();
      await Deno.remove(workspace.workspaceDir, { recursive: true });
      await Deno.mkdir(workspace.workspaceDir);
      await Deno.writeTextFile(join(workspace.workspaceDir, "replacement.txt"), "keep");
      await assertRejects(() => workspace.cleanup(), Error, "ownership");
      assertEquals(
        await Deno.readTextFile(join(workspace.workspaceDir, "replacement.txt")),
        "keep",
      );
    } finally {
      await Deno.remove(baseDir, { recursive: true });
    }
  });

  it("rejects non-canonical and non-portable paths", async () => {
    const baseDir = await Deno.makeTempDir({ prefix: "vf-ws-sync-paths-" });
    const { workspace } = await makeWorkspace(baseDir);

    try {
      for (const path of [
        "a//b.txt",
        "a/./b.txt",
        "a/../b.txt",
        "a\\b.txt",
        "CON.txt",
        "trailing.",
        "bad:name.txt",
        "control\u0001.txt",
      ]) {
        await assertRejects(() => workspace.writeFile(path, "unsafe"), Error);
      }
      assertEquals((await Array.fromAsync(Deno.readDir(workspace.workspaceDir))).length, 0);
    } finally {
      await Deno.remove(baseDir, { recursive: true });
    }
  });

  it("rejects case-folded and Unicode-normalized aliases before downloading", async () => {
    const baseDir = await Deno.makeTempDir({ prefix: "vf-ws-sync-aliases-" });
    let reads = 0;
    const workspace = new WorkspaceSync(
      { baseDir, runId: "aliases", tenant: stubTenant() },
      {
        files: {
          listAll: () =>
            Promise.resolve([
              { path: "/README.md" },
              { path: "/readme.md" },
              { path: "/caf\u00e9.txt" },
              { path: "/cafe\u0301.txt" },
            ]),
          read: () => {
            reads++;
            return Promise.resolve("content");
          },
        },
      },
    );

    try {
      await assertRejects(() => workspace.initialize(), Error, "alias");
      assertEquals(reads, 0);
      assertEquals(await exists(workspace.workspaceDir), false);
    } finally {
      await Deno.remove(baseDir, { recursive: true });
    }
  });

  it("enforces initialization depth before downloading or creating a workspace", async () => {
    const baseDir = await Deno.makeTempDir({ prefix: "vf-ws-sync-depth-init-" });
    let reads = 0;
    const workspace = new WorkspaceSync(
      { baseDir, runId: "depth-init", tenant: stubTenant(), maxDepth: 1 },
      {
        files: {
          listAll: () => Promise.resolve([{ path: "/one/two/file.txt" }]),
          read: () => {
            reads++;
            return Promise.resolve("content");
          },
        },
      },
    );

    try {
      await assertRejects(() => workspace.initialize(), Error, "directory depth");
      assertEquals(reads, 0);
      assertEquals(await exists(workspace.workspaceDir), false);
    } finally {
      await Deno.remove(baseDir, { recursive: true });
    }
  });

  it("admits the complete download before creating or mutating its workspace", async () => {
    const baseDir = await Deno.makeTempDir({ prefix: "vf-ws-sync-admission-" });
    let existedDuringSecondRead: boolean | undefined;
    let workspace!: WorkspaceSync;
    workspace = new WorkspaceSync(
      {
        baseDir,
        runId: "admission",
        tenant: stubTenant(),
        maxTotalBytes: 3,
      },
      {
        files: {
          listAll: () => Promise.resolve([{ path: "/a.txt" }, { path: "/b.txt" }]),
          read: async (path) => {
            if (path === "/b.txt") existedDuringSecondRead = await exists(workspace.workspaceDir);
            return "aa";
          },
        },
      },
    );

    try {
      await assertRejects(() => workspace.initialize(), Error, "aggregate size");
      assertEquals(existedDuringSecondRead, false);
      assertEquals(await exists(workspace.workspaceDir), false);
    } finally {
      await Deno.remove(baseDir, { recursive: true });
    }
  });

  it("enforces depth, file count, and aggregate size before a public write", async () => {
    const baseDir = await Deno.makeTempDir({ prefix: "vf-ws-sync-write-admission-" });
    const workspace = new WorkspaceSync({
      baseDir,
      runId: "write-admission",
      tenant: stubTenant(),
      maxDepth: 1,
      maxFiles: 1,
      maxTotalBytes: 3,
    });
    await Deno.mkdir(workspace.workspaceDir);
    await Deno.writeTextFile(join(workspace.workspaceDir, "existing.txt"), "aa");

    try {
      await assertRejects(
        () => workspace.writeFile("one/two/too-deep.txt", "x"),
        Error,
        "directory depth",
      );
      await assertRejects(
        () => workspace.writeFile("second.txt", "bb"),
        Error,
        "maximum file count",
      );
      assertEquals(await exists(join(workspace.workspaceDir, "second.txt")), false);

      await workspace.writeFile("existing.txt", "bbb");
      await assertRejects(
        () => workspace.writeFile("existing.txt", "bbbb"),
        Error,
        "maximum aggregate size",
      );
      assertEquals(await Deno.readTextFile(join(workspace.workspaceDir, "existing.txt")), "bbb");
    } finally {
      await Deno.remove(baseDir, { recursive: true });
    }
  });

  it("rejects a case-folded public-write alias", async () => {
    const baseDir = await Deno.makeTempDir({ prefix: "vf-ws-sync-write-alias-" });
    const { workspace, workspaceDir } = await makeWorkspace(baseDir);

    try {
      await workspace.writeFile("README.md", "first");
      await assertRejects(() => workspace.writeFile("readme.md", "second"), Error, "alias");
      assertEquals(await Deno.readTextFile(join(workspaceDir, "README.md")), "first");
      assertEquals(await exists(join(workspaceDir, "readme.md")), false);
    } finally {
      await Deno.remove(baseDir, { recursive: true });
    }
  });

  it("snapshots upload changes before its first await", async () => {
    const baseDir = await Deno.makeTempDir({ prefix: "vf-ws-sync-snapshot-" });
    const workspace = new WorkspaceSync(
      { baseDir, runId: "snapshot", tenant: stubTenant() },
      {
        files: {
          listAll: () => Promise.resolve([]),
          read: () => Promise.resolve("unused"),
        },
      },
    );
    let releaseRead!: (content: string) => void;
    const read = new Promise<string>((resolve) => releaseRead = resolve);
    const uploaded: Array<{ path: string; type: FileChange["type"] }> = [];
    const changes: FileChange[] = [{ path: "/original.txt", type: "created" }];

    try {
      await workspace.initialize();
      workspace.readFile = () => read;
      const upload = workspace.uploadChanges(changes, {
        onUpload: (path, _content, type) => {
          uploaded.push({ path, type });
          return Promise.resolve();
        },
      });
      changes[0].path = "/mutated.txt";
      changes[0].type = "modified";
      releaseRead("content");

      const result = await upload;
      assertEquals(uploaded, [{ path: "/original.txt", type: "created" }]);
      assertEquals(result.uploaded, [{ path: "/original.txt", type: "created" }]);
    } finally {
      await workspace.cleanup();
      await Deno.remove(baseDir, { recursive: true });
    }
  });

  it("creates owned workspace directories and files with private modes", async () => {
    const baseDir = await Deno.makeTempDir({ prefix: "vf-ws-sync-modes-" });
    const workspace = new WorkspaceSync(
      { baseDir, runId: "modes", tenant: stubTenant() },
      {
        files: {
          listAll: () => Promise.resolve([{ path: "/nested/file.txt" }]),
          read: () => Promise.resolve("content"),
        },
      },
    );

    try {
      await workspace.initialize();
      if (Deno.build.os !== "windows") {
        assertEquals((await Deno.stat(workspace.workspaceDir)).mode! & 0o777, 0o700);
        assertEquals((await Deno.stat(join(workspace.workspaceDir, "nested"))).mode! & 0o777, 0o700);
        assertEquals(
          (await Deno.stat(join(workspace.workspaceDir, "nested", "file.txt"))).mode! & 0o777,
          0o600,
        );
      }
    } finally {
      await workspace.cleanup();
      await Deno.remove(baseDir, { recursive: true });
    }
  });

  it("uses the configured tenant and byte counts for the complete download", async () => {
    const baseDir = await Deno.makeTempDir({ prefix: "vf-ws-sync-lifecycle-" });
    const tenant = stubTenant();
    const observedTenants: Array<CapturedTenantContext | undefined> = [];
    const workspace = new WorkspaceSync(
      { baseDir, runId: "tenant-bound", tenant },
      {
        files: {
          listAll: () => {
            observedTenants.push(getWorkflowTenant());
            return Promise.resolve([{ path: "/unicode.txt" }]);
          },
          read: () => {
            observedTenants.push(getWorkflowTenant());
            return Promise.resolve("é");
          },
        },
      },
    );

    try {
      const result = await workspace.initialize();
      assertEquals(observedTenants, [tenant, tenant]);
      assertEquals(result.filesDownloaded, 1);
      assertEquals(result.bytesDownloaded, 2);
      assertEquals(await workspace.readFile("unicode.txt"), "é");
    } finally {
      await workspace.cleanup();
      await Deno.remove(baseDir, { recursive: true });
    }
  });

  it("fails closed and removes the workspace after a partial download", async () => {
    const baseDir = await Deno.makeTempDir({ prefix: "vf-ws-sync-partial-" });
    const workspace = new WorkspaceSync(
      { baseDir, runId: "partial", tenant: stubTenant() },
      {
        files: {
          listAll: () => Promise.resolve([{ path: "/ok.txt" }, { path: "/failed.txt" }]),
          read: (path) =>
            path === "/ok.txt"
              ? Promise.resolve("ok")
              : Promise.reject(new Error("private provider failure")),
        },
      },
    );

    try {
      const error = await assertRejects(
        () => workspace.initialize(),
        Error,
        "Failed to initialize a complete workspace",
      );
      assertEquals(error.message.includes("private provider failure"), false);
      assertEquals(await exists(workspace.workspaceDir), false);
      await assertRejects(() => workspace.detectChanges(), Error, "Workspace not initialized");
    } finally {
      await Deno.remove(baseDir, { recursive: true });
    }
  });

  it("refuses to reuse a pre-existing run directory", async () => {
    const baseDir = await Deno.makeTempDir({ prefix: "vf-ws-sync-stale-" });
    const workspace = new WorkspaceSync(
      { baseDir, runId: "stale", tenant: stubTenant() },
      {
        files: {
          listAll: () => Promise.resolve([]),
          read: () => Promise.resolve("unused"),
        },
      },
    );
    await Deno.mkdir(workspace.workspaceDir);
    await Deno.writeTextFile(join(workspace.workspaceDir, "stale.txt"), "stale");

    try {
      await assertRejects(
        () => workspace.initialize(),
        Error,
        "already exists",
      );
      assertEquals(await Deno.readTextFile(join(workspace.workspaceDir, "stale.txt")), "stale");
    } finally {
      await Deno.remove(baseDir, { recursive: true });
    }
  });

  it("enforces maxFileSize in bytes for downloads and public writes", async () => {
    const baseDir = await Deno.makeTempDir({ prefix: "vf-ws-sync-size-" });
    const workspace = new WorkspaceSync(
      { baseDir, runId: "bounded", tenant: stubTenant(), maxFileSize: 3 },
      {
        files: {
          listAll: () => Promise.resolve([{ path: "/too-large.txt" }]),
          read: () => Promise.resolve("éé"),
        },
      },
    );

    try {
      await assertRejects(
        () => workspace.initialize(),
        Error,
        "maximum file size",
      );
      await Deno.mkdir(workspace.workspaceDir);
      await assertRejects(
        () => workspace.writeFile("too-large.txt", "éé"),
        Error,
        "maximum file size",
      );
    } finally {
      await Deno.remove(baseDir, { recursive: true });
    }
  });

  it("does not classify a security or I/O failure as a deleted file", async () => {
    const baseDir = await Deno.makeTempDir({ prefix: "vf-ws-sync-delete-" });
    const outsideDir = await Deno.makeTempDir({ prefix: "vf-ws-sync-delete-outside-" });
    const outsideFile = join(outsideDir, "outside.txt");
    await Deno.writeTextFile(outsideFile, "outside");
    const workspace = new WorkspaceSync(
      { baseDir, runId: "deletion-check", tenant: stubTenant() },
      {
        files: {
          listAll: () => Promise.resolve([{ path: "/tracked.txt" }]),
          read: () => Promise.resolve("tracked"),
        },
      },
    );

    try {
      await workspace.initialize();
      await Deno.remove(join(workspace.workspaceDir, "tracked.txt"));
      await Deno.symlink(outsideFile, join(workspace.workspaceDir, "tracked.txt"));
      await assertRejects(() => workspace.detectChanges(), Error, "Refusing to traverse symlink");
    } finally {
      await workspace.cleanup();
      await Deno.remove(baseDir, { recursive: true });
      await Deno.remove(outsideDir, { recursive: true });
    }
  });

  it("preflights aggregate upload bounds before invoking callbacks", async () => {
    const baseDir = await Deno.makeTempDir({ prefix: "vf-ws-sync-upload-" });
    const workspace = new WorkspaceSync(
      {
        baseDir,
        runId: "upload-bound",
        tenant: stubTenant(),
        maxFileSize: 3,
        maxTotalBytes: 3,
      },
      {
        files: {
          listAll: () => Promise.resolve([]),
          read: () => Promise.resolve("unused"),
        },
      },
    );
    let uploads = 0;

    try {
      await workspace.initialize();
      await workspace.writeFile("a.txt", "aa");
      await workspace.writeFile("b.txt", "bb");
      await assertRejects(
        () =>
          workspace.uploadChanges(
            [
              { path: "/a.txt", type: "created" },
              { path: "/b.txt", type: "created" },
            ],
            {
              onUpload: () => {
                uploads++;
                return Promise.resolve();
              },
            },
          ),
        Error,
        "maximum aggregate size",
      );
      assertEquals(uploads, 0);
    } finally {
      await workspace.cleanup();
      await Deno.remove(baseDir, { recursive: true });
    }
  });
});
