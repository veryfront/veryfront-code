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

import { assertEquals, assertRejects, assertThrows } from "#veryfront/testing/assert.ts";
import { afterEach, beforeEach, describe, it } from "#veryfront/testing/bdd.ts";
import { dirname, join } from "@std/path";
import { type FileChange, WorkspaceSync } from "./workspace-sync.ts";
import type { CapturedTenantContext } from "../types.ts";
import { getCacheBaseDir } from "#veryfront/utils/cache-dir.ts";
import { withTempDir } from "#veryfront/testing/deno-compat.ts";

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

  it("rejects root-equivalent paths before the workspace exists", async () => {
    const workspace = new WorkspaceSync({
      baseDir,
      runId: "pre-init-root-equivalent",
      tenant: stubTenant(),
    });

    for (const path of [".", "segment/..", "segment/../."]) {
      await assertRejects(() => workspace.writeFile(path, "x"), Error);
    }
    assertEquals(await exists(workspace.workspaceDir), false);
  });

  it("rejects a runId that escapes or splits the workspace path", () => {
    for (const runId of ["../../etc", "a/b", "a\0b", ""]) {
      assertThrows(
        () => new WorkspaceSync({ baseDir, runId, tenant: stubTenant() }),
        Error,
        "Invalid runId",
        `runId ${JSON.stringify(runId)} must be rejected before it can widen workspaceDir`,
      );
    }

    assertEquals(
      new WorkspaceSync({ baseDir, runId: "run_1-ok", tenant: stubTenant() }).workspaceDir,
      `${baseDir}/run_1-ok`,
      "a well-formed runId must still anchor the workspace under the base directory",
    );
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
    for (const path of ["C:\\Windows\\pwn.txt", "/D:/outside/pwn.txt"]) {
      await assertRejects(
        () => workspace.writeFile(path, "x"),
        Error,
      );
    }
  });

  it("rejects UNC-style paths with either separator", async () => {
    const { workspace } = await makeWorkspace(baseDir);
    for (
      const path of [
        "//evil-host/share/pwn.txt",
        String.raw`\\evil-host\share\pwn.txt`,
      ]
    ) {
      await assertRejects(
        () => workspace.writeFile(path, "x"),
        Error,
      );
    }
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

describe("WorkspaceSync uploadChanges", () => {
  let baseDir: string;

  beforeEach(async () => {
    baseDir = await Deno.makeTempDir({ prefix: "vf-ws-sync-upload-" });
  });

  afterEach(async () => {
    try {
      await Deno.remove(baseDir, { recursive: true });
    } catch (e) {
      if (!(e instanceof Deno.errors.NotFound)) throw e;
    }
  });

  it("records a change as skipped when no upload handler is given", async () => {
    const { workspace } = await makeWorkspace(baseDir);
    await workspace.writeFile("a.txt", "workspace content");

    const result = await workspace.uploadChanges([{ path: "a.txt", type: "created" }]);

    assertEquals(result.uploaded, [], "a dry run must not report uploads");
    assertEquals(
      result.skipped.map((change) => change.path),
      ["a.txt"],
      "a dry run must record the change as skipped",
    );
    assertEquals(result.failed, [], "a readable workspace file must not be reported as failed");
  });

  it("uploads through the handler with the current file content", async () => {
    const { workspace } = await makeWorkspace(baseDir);
    await workspace.writeFile("a.txt", "workspace content");
    const change: FileChange = { path: "a.txt", type: "modified" };
    const recorded: Array<[string, string, FileChange["type"]]> = [];

    const result = await workspace.uploadChanges([change], {
      onUpload: (path, content, type) => {
        recorded.push([path, content, type]);
        return Promise.resolve();
      },
    });

    assertEquals(
      recorded,
      [["a.txt", "workspace content", "modified"]],
      "the handler must receive the path, the file's content, and the change type",
    );
    assertEquals(result.uploaded, [change], "a handled change must be reported as uploaded");
    assertEquals(result.skipped, [], "a handled change must not be reported as skipped");
    assertEquals(result.failed, [], "a handled change must not be reported as failed");
  });

  it("reports a deletion as failed because the API cannot delete yet", async () => {
    const { workspace } = await makeWorkspace(baseDir);
    await workspace.writeFile("gone.txt", "workspace content");

    const result = await workspace.uploadChanges([{ path: "gone.txt", type: "deleted" }], {
      onUpload: () => Promise.resolve(),
    });

    assertEquals(
      result.failed,
      [{ path: "gone.txt", error: "Delete not yet supported via API" }],
      "a deletion must be reported as failed while API delete support is missing",
    );
    assertEquals(result.uploaded, [], "a deletion must never be reported as uploaded");
    assertEquals(result.skipped, [], "a deletion must never be reported as skipped");
  });
});

describe("WorkspaceSync default baseDir", () => {
  it("derives the same default workspaceDir from the same runId", () => {
    // This is also what pins the constructor to doing no filesystem I/O. An
    // earlier draft called Deno.makeTempDirSync() there, which performed I/O for
    // an object that may never be initialized and gave each instance its own
    // random directory -- the two paths below could not then be equal.
    const runId = "stable-run-id";
    const first = new WorkspaceSync({ runId, tenant: stubTenant() });
    const second = new WorkspaceSync({ runId, tenant: stubTenant() });

    assertEquals(
      first.workspaceDir,
      second.workspaceDir,
      "the default workspace directory must be derivable from the runId alone",
    );
    assertEquals(
      first.workspaceDir,
      `${join(getCacheBaseDir(), "claude-code-workspaces")}/${runId}`,
      "the default base directory must sit under the Veryfront cache directory",
    );
    assertEquals(
      new WorkspaceSync({ runId: "other-run-id", tenant: stubTenant() }).workspaceDir ===
        first.workspaceDir,
      false,
      "a different runId must still get its own workspace directory",
    );
  });

  it("does not default to a shared temp directory", async () => {
    const workspaceDir = new WorkspaceSync({
      runId: "not-in-tmp",
      tenant: stubTenant(),
    }).workspaceDir;

    assertEquals(
      workspaceDir.startsWith("/tmp/veryfront-workspaces"),
      false,
      "the old fixed /tmp path let any local user pre-create the run directory",
    );

    // The shared temp root itself is world-writable, so nothing under it is a
    // safe default either.
    await withTempDir((probe) => {
      const sharedTempRoot = dirname(probe);
      assertEquals(
        workspaceDir.startsWith(`${sharedTempRoot}/`),
        false,
        "the default workspace directory must not live under the shared temp root",
      );
      return Promise.resolve();
    }, { prefix: "vf-ws-sync-tmp-probe-" });
  });

  it(
    "creates the workspace directory owner-only",
    { ignore: Deno.build.os === "windows" },
    async () => {
      await withTempDir(async (baseDir) => {
        const workspace = new WorkspaceSync({
          baseDir,
          runId: "mode-check",
          tenant: stubTenant(),
        });

        // initialize() creates the directory and then reaches for project files,
        // which fails without a tenant context. The directory is already there.
        await assertRejects(() => workspace.initialize(), Error);

        const info = await Deno.stat(workspace.workspaceDir);
        assertEquals(info.isDirectory, true);
        assertEquals(
          (info.mode ?? 0) & 0o777,
          0o700,
          "the workspace holds synced project files and must not be readable by other users",
        );
      }, { prefix: "vf-ws-sync-mode-" });
    },
  );
});
