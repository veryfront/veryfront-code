import "#veryfront/schemas/_test-setup.ts";

import { assertEquals, assertExists, assertRejects } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { deleteEnv, getEnv, makeTempDir, setEnv } from "#veryfront/testing/deno-compat.ts";
import {
  clearPushReceipt,
  computeSourceDigest,
  normalizeControlPlane,
  type PushReceipt,
  readPushReceipt,
  resolveDeletedGitSourcePaths,
  resolveGitSource,
  validatePushReceipt,
  writePushReceipt,
} from "./deployment-provenance.ts";

const RECEIPT: PushReceipt = {
  version: 2,
  controlPlane: "https://api.veryfront.com",
  projectId: "550e8400-e29b-41d4-a716-446655440000",
  projectSlug: "veryfront-ops-agent",
  branch: "main",
  commitSha: "90719c01c1dded95a6b6df46b0fb17ea37d3ace8",
  sourceDigest: "sha256:8427243a30c3d9af7609e7d18e06172d6e6edba76a84f4d7f80dfdb4a01e09d7",
  clean: true,
  pushedAt: "2026-07-10T09:20:00.000Z",
};

describe("computeSourceDigest", () => {
  it("is stable across file order and changes when source changes", async () => {
    const first = await computeSourceDigest([
      { path: "app/page.tsx", content: "export default function Page() {}\n" },
      { path: "veryfront.config.ts", content: "export default {};\n" },
    ]);
    const reordered = await computeSourceDigest([
      { path: "veryfront.config.ts", content: "export default {};\n" },
      { path: "app/page.tsx", content: "export default function Page() {}\n" },
    ]);
    const changed = await computeSourceDigest([
      { path: "app/page.tsx", content: "export default function Page() { return null; }\n" },
      { path: "veryfront.config.ts", content: "export default {};\n" },
    ]);

    assertEquals(first, reordered);
    assertEquals(first.startsWith("sha256:"), true);
    assertEquals(first === changed, false);
  });
});

describe("normalizeControlPlane", () => {
  it("normalizes a trailing slash without dropping an API path", () => {
    assertEquals(
      normalizeControlPlane("https://API.VERYFRONT.COM/control-plane/"),
      "https://api.veryfront.com/control-plane",
    );
  });
});

describe("validatePushReceipt", () => {
  it("returns the pushed commit for the same deployment target", () => {
    const result = validatePushReceipt(RECEIPT, {
      controlPlane: "https://api.veryfront.com/",
      projectId: RECEIPT.projectId,
      projectSlug: RECEIPT.projectSlug,
      branch: "main",
      commitSha: RECEIPT.commitSha,
      clean: true,
    });

    assertEquals(result, RECEIPT.commitSha);
  });

  it("rejects a clean push once the checkout has uncommitted changes", async () => {
    await assertRejects(
      () =>
        Promise.resolve().then(() =>
          validatePushReceipt(RECEIPT, {
            controlPlane: RECEIPT.controlPlane,
            projectId: RECEIPT.projectId,
            projectSlug: RECEIPT.projectSlug,
            branch: RECEIPT.branch,
            commitSha: RECEIPT.commitSha,
            clean: false,
          })
        ),
      Error,
      "The latest push came from a clean checkout, but this project has uncommitted changes. " +
        "Run veryfront push again to deploy them.",
    );
  });

  it("rejects a source digest the directory no longer produces", async () => {
    // The refusal does not depend on Git seeing the change: a file .gitignore
    // hides while .vfignore does not is pushed and edited without ever making
    // the checkout dirty.
    await assertRejects(
      () =>
        Promise.resolve().then(() =>
          validatePushReceipt({ ...RECEIPT, localSourceDigest: `sha256:${"1".repeat(64)}` }, {
            controlPlane: RECEIPT.controlPlane,
            projectId: RECEIPT.projectId,
            projectSlug: RECEIPT.projectSlug,
            branch: RECEIPT.branch,
            commitSha: RECEIPT.commitSha,
            clean: true,
            localSourceDigest: `sha256:${"2".repeat(64)}`,
          })
        ),
      Error,
      "This directory no longer holds the source the latest push uploaded. " +
        "Run veryfront push again to deploy the current source.",
    );
  });

  it("rejects a current receipt when its source digest cannot be recomputed", async () => {
    // A directory too broken to scan cannot prove it still holds the pushed
    // source, so the gate refuses instead of degrading to the Git check the
    // digest was added to replace.
    await assertRejects(
      () =>
        Promise.resolve().then(() =>
          validatePushReceipt({ ...RECEIPT, localSourceDigest: `sha256:${"1".repeat(64)}` }, {
            controlPlane: RECEIPT.controlPlane,
            projectId: RECEIPT.projectId,
            projectSlug: RECEIPT.projectSlug,
            branch: RECEIPT.branch,
            commitSha: RECEIPT.commitSha,
            clean: true,
            localSourceDigest: null,
          })
        ),
      Error,
      "Veryfront could not verify that this directory still holds the source the latest push uploaded. " +
        "Run veryfront push again to deploy the current source.",
    );
  });

  it("keeps the Git fallback for a receipt written before digests existed", () => {
    // A pre-PR receipt carries no localSourceDigest, so there is nothing to
    // recompute against and cleanliness is all the evidence there is.
    assertEquals(
      validatePushReceipt(RECEIPT, {
        controlPlane: RECEIPT.controlPlane,
        projectId: RECEIPT.projectId,
        projectSlug: RECEIPT.projectSlug,
        branch: RECEIPT.branch,
        commitSha: RECEIPT.commitSha,
        clean: true,
        localSourceDigest: null,
      }),
      RECEIPT.commitSha,
    );
  });

  it("accepts a matching source digest from a checkout Git reports as dirty", () => {
    // The digest covers exactly the files push uploads, so a tree dirty only
    // outside that set is provably still the pushed source.
    const result = validatePushReceipt(
      { ...RECEIPT, localSourceDigest: `sha256:${"1".repeat(64)}` },
      {
        controlPlane: RECEIPT.controlPlane,
        projectId: RECEIPT.projectId,
        projectSlug: RECEIPT.projectSlug,
        branch: RECEIPT.branch,
        commitSha: RECEIPT.commitSha,
        clean: false,
        localSourceDigest: `sha256:${"1".repeat(64)}`,
      },
    );

    assertEquals(result, RECEIPT.commitSha);
  });

  it("names the missing commit when the project no longer resolves to one", async () => {
    // Same fail-closed refusal, different reason: without a current commit,
    // "uncommitted changes" would misdescribe a project that is no longer a
    // Git checkout at all.
    await assertRejects(
      () =>
        Promise.resolve().then(() =>
          validatePushReceipt(RECEIPT, {
            controlPlane: RECEIPT.controlPlane,
            projectId: RECEIPT.projectId,
            projectSlug: RECEIPT.projectSlug,
            branch: RECEIPT.branch,
            commitSha: null,
            clean: false,
          })
        ),
      Error,
      "The latest push came from a Git commit, but this project no longer resolves to one.",
    );
  });

  it("rejects a matching digest when a Git-backed receipt loses its commit", async () => {
    const localSourceDigest = `sha256:${"1".repeat(64)}`;
    await assertRejects(
      () =>
        Promise.resolve().then(() =>
          validatePushReceipt({ ...RECEIPT, localSourceDigest }, {
            controlPlane: RECEIPT.controlPlane,
            projectId: RECEIPT.projectId,
            projectSlug: RECEIPT.projectSlug,
            branch: RECEIPT.branch,
            commitSha: null,
            clean: false,
            localSourceDigest,
          })
        ),
      Error,
      "no longer resolves to one",
    );
  });

  it("rejects a push from another control plane", async () => {
    await assertRejects(
      () =>
        Promise.resolve().then(() =>
          validatePushReceipt(RECEIPT, {
            controlPlane: "https://api.veryfront.org",
            projectId: RECEIPT.projectId,
            projectSlug: RECEIPT.projectSlug,
            branch: "main",
            commitSha: RECEIPT.commitSha,
            clean: true,
          })
        ),
      Error,
      "different control plane",
    );
  });

  it("rejects a stale project or branch", async () => {
    await assertRejects(
      () =>
        Promise.resolve().then(() =>
          validatePushReceipt(RECEIPT, {
            controlPlane: RECEIPT.controlPlane,
            projectId: "660e8400-e29b-41d4-a716-446655440000",
            projectSlug: "another-project",
            branch: "feature-x",
            commitSha: RECEIPT.commitSha,
            clean: true,
          })
        ),
      Error,
      "different project",
    );

    await assertRejects(
      () =>
        Promise.resolve().then(() =>
          validatePushReceipt(RECEIPT, {
            controlPlane: RECEIPT.controlPlane,
            projectId: RECEIPT.projectId,
            projectSlug: RECEIPT.projectSlug,
            branch: "feature-x",
            commitSha: RECEIPT.commitSha,
            clean: true,
          })
        ),
      Error,
      'The latest push is for branch "main", but deploy targets "feature-x". ' +
        "Run veryfront deploy --branch main to deploy the latest push, " +
        "or veryfront push --branch feature-x to preview feature-x first.",
    );
  });

  it("rejects a different commit when one is required", async () => {
    await assertRejects(
      () =>
        Promise.resolve().then(() =>
          validatePushReceipt(RECEIPT, {
            controlPlane: RECEIPT.controlPlane,
            projectId: RECEIPT.projectId,
            projectSlug: RECEIPT.projectSlug,
            branch: RECEIPT.branch,
            commitSha: "80719c01c1dded95a6b6df46b0fb17ea37d3ace8",
            clean: true,
          })
        ),
      Error,
      "different commit",
    );
  });

  it("accepts dirty metadata for the same deployment target and commit", () => {
    const result = validatePushReceipt({ ...RECEIPT, clean: false }, {
      controlPlane: RECEIPT.controlPlane,
      projectId: RECEIPT.projectId,
      projectSlug: RECEIPT.projectSlug,
      branch: RECEIPT.branch,
      commitSha: RECEIPT.commitSha,
      clean: false,
    });

    assertEquals(result, RECEIPT.commitSha);
  });

  it("accepts a digest-only first push when the project has no Git source", () => {
    const result = validatePushReceipt({ ...RECEIPT, commitSha: null, clean: false }, {
      controlPlane: RECEIPT.controlPlane,
      projectId: RECEIPT.projectId,
      projectSlug: RECEIPT.projectSlug,
      branch: RECEIPT.branch,
      commitSha: null,
      clean: false,
    });

    assertEquals(result, null);
  });

  it("rejects a digest-only receipt when the current project has a Git commit", async () => {
    await assertRejects(
      () =>
        Promise.resolve().then(() =>
          validatePushReceipt({ ...RECEIPT, commitSha: null, clean: false }, {
            controlPlane: RECEIPT.controlPlane,
            projectId: RECEIPT.projectId,
            projectSlug: RECEIPT.projectSlug,
            branch: RECEIPT.branch,
            commitSha: RECEIPT.commitSha,
            clean: true,
          })
        ),
      Error,
      "no Git commit SHA",
    );
  });
});

describe("push receipt persistence", () => {
  it("round-trips a receipt in the ignored Veryfront directory", async () => {
    const projectDir = await Deno.makeTempDir();
    try {
      await writePushReceipt(projectDir, {
        ...RECEIPT,
        controlPlane: "https://api.veryfront.com/",
      });

      const receipt = await readPushReceipt(projectDir);
      assertExists(receipt);
      assertEquals(receipt, RECEIPT);

      await clearPushReceipt(projectDir);
      assertEquals(await readPushReceipt(projectDir), null);
    } finally {
      await Deno.remove(projectDir, { recursive: true });
    }
  });

  it("returns null for a missing receipt", async () => {
    const projectDir = await Deno.makeTempDir();
    try {
      assertEquals(await readPushReceipt(projectDir), null);
    } finally {
      await Deno.remove(projectDir, { recursive: true });
    }
  });

  it("rejects a malformed existing receipt with recovery guidance", async () => {
    const projectDir = await Deno.makeTempDir();
    try {
      await Deno.mkdir(`${projectDir}/.veryfront`);
      await Deno.writeTextFile(`${projectDir}/.veryfront/push-receipt.json`, "{not json");

      const error = await assertRejects(
        () => readPushReceipt(projectDir),
        Error,
        ".veryfront/push-receipt.json",
      );
      assertEquals(String(error).includes(projectDir), false);
      await assertRejects(
        () => readPushReceipt(projectDir),
        Error,
        "remove it and run veryfront push again",
      );
    } finally {
      await Deno.remove(projectDir, { recursive: true });
    }
  });

  it("rejects an unsupported existing receipt with recovery guidance", async () => {
    const projectDir = await Deno.makeTempDir();
    try {
      await Deno.mkdir(`${projectDir}/.veryfront`);
      await Deno.writeTextFile(
        `${projectDir}/.veryfront/push-receipt.json`,
        `${JSON.stringify({ ...RECEIPT, version: 1 }, null, 2)}\n`,
      );

      await assertRejects(
        () => readPushReceipt(projectDir),
        Error,
        ".veryfront/push-receipt.json",
      );
      await assertRejects(
        () => readPushReceipt(projectDir),
        Error,
        "remove it and run veryfront push again",
      );
    } finally {
      await Deno.remove(projectDir, { recursive: true });
    }
  });

  it("rejects an unreadable existing receipt with recovery guidance", async () => {
    if (Deno.build.os === "windows") return;

    const projectDir = await Deno.makeTempDir();
    const receiptPath = `${projectDir}/.veryfront/push-receipt.json`;
    try {
      await Deno.mkdir(`${projectDir}/.veryfront`);
      await Deno.writeTextFile(receiptPath, `${JSON.stringify(RECEIPT, null, 2)}\n`);
      await Deno.chmod(receiptPath, 0);

      await assertRejects(
        () => readPushReceipt(projectDir),
        Error,
        ".veryfront/push-receipt.json",
      );
      await assertRejects(
        () => readPushReceipt(projectDir),
        Error,
        "remove it and run veryfront push again",
      );
    } finally {
      try {
        await Deno.chmod(receiptPath, 0o600);
      } catch {
        // Best effort cleanup after permission-focused assertion.
      }
      await Deno.remove(projectDir, { recursive: true });
    }
  });

  it("rejects a tracked Veryfront directory symlink without touching its target", async () => {
    if (Deno.build.os === "windows") return;

    const projectDir = await Deno.makeTempDir();
    const externalDir = await Deno.makeTempDir();
    const externalReceipt = `${externalDir}/push-receipt.json`;
    const runGit = async (...args: string[]) => {
      const result = await new Deno.Command("git", {
        args,
        cwd: projectDir,
        clearEnv: true,
        env: Object.fromEntries(
          Object.entries(Deno.env.toObject()).filter(([key]) => !key.startsWith("GIT_")),
        ),
        stdout: "null",
        stderr: "piped",
      }).output();
      assertEquals(result.success, true, new TextDecoder().decode(result.stderr));
    };

    try {
      await Deno.writeTextFile(externalReceipt, "sentinel\n");
      await Deno.symlink(externalDir, `${projectDir}/.veryfront`);
      await runGit("init", "--quiet");
      await runGit("config", "user.email", "test@veryfront.com");
      await runGit("config", "user.name", "Veryfront Test");
      await runGit("add", ".veryfront");
      await runGit("commit", "--quiet", "-m", "track receipt directory link");

      for (
        const operation of [
          () => readPushReceipt(projectDir),
          () => clearPushReceipt(projectDir),
          () => writePushReceipt(projectDir, RECEIPT),
        ]
      ) {
        await assertRejects(operation, Error, "through a symbolic link");
      }
      assertEquals(await Deno.readTextFile(externalReceipt), "sentinel\n");
    } finally {
      await Deno.remove(projectDir, { recursive: true });
      await Deno.remove(externalDir, { recursive: true });
    }
  });

  it("rejects a receipt file symlink without touching its target", async () => {
    if (Deno.build.os === "windows") return;

    const projectDir = await Deno.makeTempDir();
    const externalDir = await Deno.makeTempDir();
    const externalReceipt = `${externalDir}/receipt.json`;
    try {
      await Deno.mkdir(`${projectDir}/.veryfront`);
      await Deno.writeTextFile(externalReceipt, "sentinel\n");
      await Deno.symlink(externalReceipt, `${projectDir}/.veryfront/push-receipt.json`);

      for (
        const operation of [
          () => readPushReceipt(projectDir),
          () => clearPushReceipt(projectDir),
          () => writePushReceipt(projectDir, RECEIPT),
        ]
      ) {
        await assertRejects(operation, Error, "Remove the link");
      }
      assertEquals(await Deno.readTextFile(externalReceipt), "sentinel\n");
    } finally {
      await Deno.remove(projectDir, { recursive: true });
      await Deno.remove(externalDir, { recursive: true });
    }
  });
});

describe("resolveGitSource", () => {
  it("treats an unavailable Git executable outside a repository as non-Git", async () => {
    const projectDir = await makeTempDir();
    const originalGithubSha = getEnv("GITHUB_SHA");
    const originalPath = getEnv("PATH");
    try {
      deleteEnv("GITHUB_SHA");
      setEnv("PATH", projectDir);

      assertEquals(await resolveGitSource(projectDir), {
        commitSha: null,
        clean: false,
        repositoryAvailable: false,
      });
    } finally {
      if (originalGithubSha === undefined) deleteEnv("GITHUB_SHA");
      else setEnv("GITHUB_SHA", originalGithubSha);
      if (originalPath === undefined) deleteEnv("PATH");
      else setEnv("PATH", originalPath);
      await Deno.remove(projectDir, { recursive: true });
    }
  });

  it("marks failed probes with local Git metadata as indeterminate", async () => {
    const projectDir = await makeTempDir();
    try {
      await Deno.writeTextFile(`${projectDir}/.git`, "invalid git metadata\n");
      const source = await resolveGitSource(projectDir);

      assertEquals(source.commitSha, null);
      assertEquals(source.clean, false);
      assertEquals(source.repositoryAvailable, true);
      assertEquals(source.indeterminate, true);
    } finally {
      await Deno.remove(projectDir, { recursive: true });
    }
  });

  it("distinguishes non-Git directories from unborn repositories", async () => {
    const nonGitDir = await makeTempDir();
    const unbornDir = await makeTempDir();
    const originalGithubSha = getEnv("GITHUB_SHA");
    try {
      deleteEnv("GITHUB_SHA");
      assertEquals((await resolveGitSource(nonGitDir)).repositoryAvailable, false);
      const initialized = await new Deno.Command("git", {
        args: ["init", "--quiet"],
        cwd: unbornDir,
        stdout: "null",
        stderr: "piped",
      }).output();
      assertEquals(initialized.success, true, new TextDecoder().decode(initialized.stderr));
      const unborn = await resolveGitSource(unbornDir);
      assertEquals(unborn.commitSha, null);
      assertEquals(unborn.repositoryAvailable, true);
      assertEquals(unborn.indeterminate, undefined);
    } finally {
      if (originalGithubSha === undefined) deleteEnv("GITHUB_SHA");
      else setEnv("GITHUB_SHA", originalGithubSha);
      await Deno.remove(nonGitDir, { recursive: true });
      await Deno.remove(unbornDir, { recursive: true });
    }
  });

  it("resolves the committed SHA and detects later working-tree changes", async () => {
    const projectDir = await Deno.makeTempDir();
    const originalGithubSha = getEnv("GITHUB_SHA");
    const originalGitDir = getEnv("GIT_DIR");
    const runGit = async (...args: string[]) => {
      const result = await new Deno.Command("git", {
        args,
        cwd: projectDir,
        clearEnv: true,
        env: Object.fromEntries(
          Object.entries(Deno.env.toObject()).filter(([key]) => !key.startsWith("GIT_")),
        ),
        stdout: "null",
        stderr: "piped",
      }).output();
      assertEquals(result.success, true, new TextDecoder().decode(result.stderr));
    };

    try {
      deleteEnv("GITHUB_SHA");
      await runGit("init", "--quiet");
      await runGit("config", "user.email", "test@veryfront.com");
      await runGit("config", "user.name", "Veryfront Test");
      await Deno.writeTextFile(`${projectDir}/app.ts`, "export const value = 1;\n");
      await runGit("add", ".");
      await runGit("commit", "--quiet", "-m", "initial");
      await writePushReceipt(projectDir, RECEIPT);

      setEnv("GIT_DIR", `${projectDir}/not-a-repository`);
      const clean = await resolveGitSource(projectDir);
      if (originalGitDir === undefined) deleteEnv("GIT_DIR");
      else setEnv("GIT_DIR", originalGitDir);
      assertEquals(clean.commitSha?.length, 40);
      assertEquals(clean.clean, true);

      setEnv("GITHUB_SHA", "a".repeat(40));
      const mismatchedCiSource = await resolveGitSource(projectDir);
      assertEquals(mismatchedCiSource.commitSha, null);
      assertEquals(mismatchedCiSource.clean, false);
      assertEquals(mismatchedCiSource.indeterminate, true);

      setEnv("GITHUB_SHA", "not-a-commit");
      const invalidCiSource = await resolveGitSource(projectDir);
      assertEquals(invalidCiSource.commitSha, null);
      assertEquals(invalidCiSource.clean, false);
      assertEquals(invalidCiSource.indeterminate, true);
      deleteEnv("GITHUB_SHA");

      // The CLI writes its own bookkeeping (the project link, the receipt)
      // under .veryfront/, and none of it is ever uploaded, so a project that
      // does not Git-ignore the directory must not read as changed source.
      await Deno.writeTextFile(`${projectDir}/.veryfront/project.json`, "{}\n");
      const cliState = await resolveGitSource(projectDir);
      assertEquals(cliState.clean, true);
      await Deno.remove(`${projectDir}/.veryfront/project.json`);

      await Deno.writeTextFile(`${projectDir}/untracked.ts`, "export const extra = 1;\n");
      const untracked = await resolveGitSource(projectDir);
      assertEquals(untracked.clean, false);
      await Deno.remove(`${projectDir}/untracked.ts`);

      await Deno.writeTextFile(`${projectDir}/app.ts`, "export const value = 2;\n");
      const dirty = await resolveGitSource(projectDir);
      assertEquals(dirty.commitSha, clean.commitSha);
      assertEquals(dirty.clean, false);
    } finally {
      if (originalGitDir === undefined) deleteEnv("GIT_DIR");
      else setEnv("GIT_DIR", originalGitDir);
      if (originalGithubSha === undefined) deleteEnv("GITHUB_SHA");
      else setEnv("GITHUB_SHA", originalGithubSha);
      await Deno.remove(projectDir, { recursive: true });
    }
  });

  it("scopes cleanliness to the project directory and reports its deletions", async () => {
    // The scratch repository below has its own HEAD, which never matches the
    // GITHUB_SHA that CI exports for the run executing this suite. Left set,
    // resolveGitSource reports a CI/checkout mismatch and every checkout here
    // reads as dirty, hiding what this test is about.
    const originalGithubSha = getEnv("GITHUB_SHA");
    deleteEnv("GITHUB_SHA");
    const repositoryDir = await makeTempDir();
    const projectDir = `${repositoryDir}/packages/site`;
    const runGit = async (...args: string[]) => {
      const result = await new Deno.Command("git", {
        args,
        cwd: repositoryDir,
        clearEnv: true,
        env: Object.fromEntries(
          Object.entries(Deno.env.toObject()).filter(([key]) => !key.startsWith("GIT_")),
        ),
        stdout: "null",
        stderr: "piped",
      }).output();
      assertEquals(result.success, true, new TextDecoder().decode(result.stderr));
    };

    try {
      const siblingDir = `${repositoryDir}/packages/api`;
      await Deno.mkdir(projectDir, { recursive: true });
      await Deno.mkdir(siblingDir, { recursive: true });
      await Deno.writeTextFile(`${projectDir}/app.ts`, "export const value = 1;\n");
      await Deno.writeTextFile(`${siblingDir}/server.ts`, "export const port = 1;\n");
      await runGit("init", "--quiet");
      await runGit("config", "user.email", "test@veryfront.com");
      await runGit("config", "user.name", "Veryfront Test");
      await runGit("add", ".");
      await runGit("commit", "--quiet", "-m", "initial");

      await Deno.mkdir(`${projectDir}/.veryfront`, { recursive: true });
      await Deno.writeTextFile(`${projectDir}/.veryfront/project.json`, "{}\n");
      assertEquals((await resolveGitSource(projectDir)).clean, true);

      // Only projectDir is uploaded, so an edit in a sibling package cannot
      // change the pushed source and must not report this project as changed.
      // The repository root, deployed as its own project, still sees it.
      await Deno.writeTextFile(`${siblingDir}/server.ts`, "export const port = 2;\n");
      assertEquals((await resolveGitSource(projectDir)).clean, true);
      assertEquals((await resolveGitSource(repositoryDir)).clean, false);
      assertEquals(await resolveDeletedGitSourcePaths(projectDir), []);

      await Deno.rename(`${projectDir}/app.ts`, `${projectDir}/renamed.ts`);
      await runGit("add", "--all");
      assertEquals((await resolveGitSource(projectDir)).clean, false);
      assertEquals(await resolveDeletedGitSourcePaths(projectDir), ["app.ts"]);
    } finally {
      if (originalGithubSha === undefined) deleteEnv("GITHUB_SHA");
      else setEnv("GITHUB_SHA", originalGithubSha);
      await Deno.remove(repositoryDir, { recursive: true });
    }
  });

  it("refuses a CI SHA when HEAD cannot be resolved", async () => {
    // `git status` succeeds in an unborn repository but `git rev-parse HEAD`
    // does not. Trusting GITHUB_SHA here would hand back a commit that was
    // never verified locally, letting a Git-backed receipt carrying the same
    // SHA validate against a checkout that cannot prove it.
    const projectDir = await makeTempDir();
    const originalGithubSha = getEnv("GITHUB_SHA");
    try {
      const runGit = async (...args: string[]) => {
        const command = new Deno.Command("git", {
          args,
          cwd: projectDir,
          stdout: "null",
          stderr: "null",
        });
        await command.output();
      };
      await runGit("init", "--quiet");
      await runGit("config", "user.email", "test@veryfront.com");
      await runGit("config", "user.name", "Veryfront Test");

      setEnv("GITHUB_SHA", "b".repeat(40));
      const source = await resolveGitSource(projectDir);

      assertEquals(source.commitSha, null);
      assertEquals(source.indeterminate, true);
    } finally {
      if (originalGithubSha === undefined) deleteEnv("GITHUB_SHA");
      else setEnv("GITHUB_SHA", originalGithubSha);
      await Deno.remove(projectDir, { recursive: true });
    }
  });

  it("rejects deletion discovery when Git cannot inspect the project", async () => {
    const projectDir = await makeTempDir();
    try {
      await assertRejects(
        () => resolveDeletedGitSourcePaths(projectDir),
        Error,
        "Could not determine deleted Git source paths",
      );
    } finally {
      await Deno.remove(projectDir, { recursive: true });
    }
  });
});
