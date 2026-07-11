import "#veryfront/schemas/_test-setup.ts";

import { assertEquals, assertExists, assertRejects } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  clearPushReceipt,
  computeSourceDigest,
  normalizeControlPlane,
  type PushReceipt,
  readPushReceipt,
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
      requireClean: true,
    });

    assertEquals(result, RECEIPT.commitSha);
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
          })
        ),
      Error,
      "different branch",
    );
  });

  it("rejects a different or dirty commit for production", async () => {
    await assertRejects(
      () =>
        Promise.resolve().then(() =>
          validatePushReceipt(RECEIPT, {
            controlPlane: RECEIPT.controlPlane,
            projectId: RECEIPT.projectId,
            projectSlug: RECEIPT.projectSlug,
            branch: RECEIPT.branch,
            commitSha: "80719c01c1dded95a6b6df46b0fb17ea37d3ace8",
          })
        ),
      Error,
      "different commit",
    );

    await assertRejects(
      () =>
        Promise.resolve().then(() =>
          validatePushReceipt({ ...RECEIPT, clean: false }, {
            controlPlane: RECEIPT.controlPlane,
            projectId: RECEIPT.projectId,
            projectSlug: RECEIPT.projectSlug,
            branch: RECEIPT.branch,
            commitSha: RECEIPT.commitSha,
            requireClean: true,
          })
        ),
      Error,
      "uncommitted changes",
    );

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
            requireClean: true,
          })
        ),
      Error,
      "uncommitted changes",
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

  it("rejects a tracked Veryfront directory symlink without touching its target", async () => {
    if (Deno.build.os === "windows") return;

    const projectDir = await Deno.makeTempDir();
    const externalDir = await Deno.makeTempDir();
    const externalReceipt = `${externalDir}/push-receipt.json`;
    const runGit = async (...args: string[]) => {
      const result = await new Deno.Command("git", {
        args,
        cwd: projectDir,
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
  it("resolves the committed SHA and detects later working-tree changes", async () => {
    const projectDir = await Deno.makeTempDir();
    const originalGithubSha = Deno.env.get("GITHUB_SHA");
    const originalGitDir = Deno.env.get("GIT_DIR");
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
      Deno.env.delete("GITHUB_SHA");
      await runGit("init", "--quiet");
      await runGit("config", "user.email", "test@veryfront.com");
      await runGit("config", "user.name", "Veryfront Test");
      await Deno.writeTextFile(`${projectDir}/app.ts`, "export const value = 1;\n");
      await runGit("add", ".");
      await runGit("commit", "--quiet", "-m", "initial");
      await writePushReceipt(projectDir, RECEIPT);

      Deno.env.set("GIT_DIR", `${projectDir}/not-a-repository`);
      const clean = await resolveGitSource(projectDir);
      if (originalGitDir === undefined) Deno.env.delete("GIT_DIR");
      else Deno.env.set("GIT_DIR", originalGitDir);
      assertEquals(clean.commitSha?.length, 40);
      assertEquals(clean.clean, true);

      Deno.env.set("GITHUB_SHA", "a".repeat(40));
      const mismatchedCiSource = await resolveGitSource(projectDir);
      assertEquals(mismatchedCiSource.commitSha, null);
      assertEquals(mismatchedCiSource.clean, false);

      Deno.env.set("GITHUB_SHA", "not-a-commit");
      const invalidCiSource = await resolveGitSource(projectDir);
      assertEquals(invalidCiSource.commitSha, null);
      assertEquals(invalidCiSource.clean, false);
      Deno.env.delete("GITHUB_SHA");

      await Deno.writeTextFile(`${projectDir}/.veryfront/other.txt`, "untracked\n");
      const untracked = await resolveGitSource(projectDir);
      assertEquals(untracked.clean, false);
      await Deno.remove(`${projectDir}/.veryfront/other.txt`);

      await Deno.writeTextFile(`${projectDir}/app.ts`, "export const value = 2;\n");
      const dirty = await resolveGitSource(projectDir);
      assertEquals(dirty.commitSha, clean.commitSha);
      assertEquals(dirty.clean, false);
    } finally {
      if (originalGitDir === undefined) Deno.env.delete("GIT_DIR");
      else Deno.env.set("GIT_DIR", originalGitDir);
      if (originalGithubSha === undefined) Deno.env.delete("GITHUB_SHA");
      else Deno.env.set("GITHUB_SHA", originalGithubSha);
      await Deno.remove(projectDir, { recursive: true });
    }
  });
});
