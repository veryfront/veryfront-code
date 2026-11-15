import "#veryfront/schemas/_test-setup.ts";
/**
 * `veryfront merge` moves this directory's push receipt to the merge target so
 * `veryfront deploy` can promote it (veryfront/veryfront-issue-inbox#4363).
 * These tests read and write the receipt and sync state on disk, so they live
 * outside the hermetic unit suite.
 */

import { assertEquals, assertInstanceOf, assertRejects } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { makeTempDir } from "#veryfront/testing/deno-compat.ts";
import { VeryfrontError } from "veryfront/errors";
import type { ApiClient } from "../../../../../../cli/shared/config.ts";
import { recordMergeInPushReceipt } from "../../../../../../cli/commands/merge/command.ts";
import {
  computeSourceDigest,
  PUSH_RECEIPT_RELATIVE_PATH,
  type PushReceipt,
  readPushReceipt,
  writePushReceipt,
} from "../../../../../../cli/shared/deployment-provenance.ts";
import { resolvePushedSource } from "../../../../../../cli/shared/deployment/deploy-project.ts";
import {
  computeContentDigest,
  readSyncTarget,
  writeSyncTarget,
} from "../../../../../../cli/sync/state.ts";

function createMockClient(get: (url: string) => Promise<unknown>): ApiClient {
  return {
    get,
    post: () => Promise.resolve({}),
    put: () => Promise.resolve({}),
    patch: () => Promise.resolve({}),
    delete: () => Promise.resolve({}),
  } as ApiClient;
}

describe("recordMergeInPushReceipt", () => {
  const CONTROL_PLANE = "https://api.veryfront.org";
  const PAGE = { path: "app/page.tsx", content: "export default () => 'Support desk';\n" };
  const CONFIG = { path: "veryfront.json", content: "{}\n" };
  const PUSHED_FILES = [PAGE, CONFIG];

  async function writeBranchReceipt(projectDir: string, branch: string): Promise<PushReceipt> {
    return await writePushReceipt(projectDir, {
      controlPlane: CONTROL_PLANE,
      projectId: "550e8400-e29b-41d4-a716-446655440000",
      projectSlug: "support-desk",
      branch,
      commitSha: null,
      sourceDigest: await computeSourceDigest(PUSHED_FILES),
      localSourceDigest: await computeSourceDigest(PUSHED_FILES),
      localPaths: PUSHED_FILES.map((file) => file.path),
      clean: false,
      pushedAt: "2026-11-12T09:00:00.000Z",
    });
  }

  function filesClient(
    files: ReadonlyArray<{ path: string; content: unknown; version_id?: string }>,
    urls: string[],
  ) {
    return createMockClient((url) => {
      urls.push(url);
      return Promise.resolve({ data: files });
    });
  }

  it("points the receipt at main once main holds exactly the pushed source", async () => {
    const projectDir = await makeTempDir();
    try {
      const pushed = await writeBranchReceipt(projectDir, "new-headline");
      const urls: string[] = [];

      const recorded = await recordMergeInPushReceipt({
        client: filesClient(PUSHED_FILES, urls),
        controlPlane: CONTROL_PLANE,
        projectSlug: "support-desk",
        projectDir,
        sourceBranch: "new-headline",
        targetBranch: "main",
      });

      assertEquals(recorded, true);
      assertEquals(urls, ["/projects/support-desk/files"]);
      assertEquals(await readPushReceipt(projectDir), { ...pushed, branch: "main" });
      // The push recorded no baseline for new-headline, so main inherits none.
      assertEquals(
        await readSyncTarget(projectDir, {
          controlPlane: CONTROL_PLANE,
          projectId: pushed.projectId,
          branch: "main",
        }),
        null,
      );
    } finally {
      await Deno.remove(projectDir, { recursive: true });
    }
  });

  it("records main's sync baseline so the next push from this directory does not conflict", async () => {
    // A push to new-headline recorded its baseline for that branch only. After
    // the merge main holds the same files, so a later edit pushed to main must
    // compare against them, not against main's pre-merge baseline.
    const projectDir = await makeTempDir();
    try {
      const pushed = await writeBranchReceipt(projectDir, "new-headline");
      const scope = { controlPlane: CONTROL_PLANE, projectId: pushed.projectId };
      const branchFiles: Record<string, { digest: string }> = {};
      for (const file of PUSHED_FILES) {
        branchFiles[file.path] = { digest: await computeContentDigest(file.content) };
      }
      await writeSyncTarget(projectDir, {
        ...scope,
        projectSlug: "support-desk",
        branch: "new-headline",
        files: branchFiles,
      });
      await writeSyncTarget(projectDir, {
        ...scope,
        projectSlug: "support-desk",
        branch: "main",
        files: { "app/page.tsx": { digest: await computeContentDigest("pre-merge\n") } },
      });
      const mainFiles = PUSHED_FILES.map((file, index) => ({
        ...file,
        version_id: `main-version-${index}`,
      }));

      await recordMergeInPushReceipt({
        client: filesClient(mainFiles, []),
        controlPlane: CONTROL_PLANE,
        projectSlug: "support-desk",
        projectDir,
        sourceBranch: "new-headline",
        targetBranch: "main",
      });

      const expected: Record<string, { digest: string; versionId: string }> = {};
      for (const file of mainFiles) {
        expected[file.path] = {
          digest: await computeContentDigest(file.content),
          versionId: file.version_id,
        };
      }
      assertEquals(
        (await readSyncTarget(projectDir, { ...scope, branch: "main" }))?.files,
        expected,
      );
      assertEquals(
        (await readSyncTarget(projectDir, { ...scope, branch: "new-headline" }))?.files,
        branchFiles,
      );
    } finally {
      await Deno.remove(projectDir, { recursive: true });
    }
  });

  it("matches a project selected by id, as VERYFRONT_PROJECT_ID selects it", async () => {
    // The config resolver puts the UUID in projectSlug for an id reference,
    // while the receipt records the resolved slug and the id.
    for (const projectId of [undefined, "550e8400-e29b-41d4-a716-446655440000"]) {
      const projectDir = await makeTempDir();
      try {
        const pushed = await writeBranchReceipt(projectDir, "new-headline");
        const urls: string[] = [];

        const recorded = await recordMergeInPushReceipt({
          client: filesClient(PUSHED_FILES, urls),
          controlPlane: CONTROL_PLANE,
          projectSlug: pushed.projectId,
          projectId,
          projectDir,
          sourceBranch: "new-headline",
          targetBranch: "main",
        });

        assertEquals(recorded, true);
        assertEquals(urls, [`/projects/${pushed.projectId}/files`]);
        assertEquals((await readPushReceipt(projectDir))?.branch, "main");
      } finally {
        await Deno.remove(projectDir, { recursive: true });
      }
    }
  });

  it("reads a non-main target from its branch", async () => {
    const projectDir = await makeTempDir();
    try {
      await writeBranchReceipt(projectDir, "new-headline");
      const urls: string[] = [];

      await recordMergeInPushReceipt({
        client: filesClient(PUSHED_FILES, urls),
        controlPlane: CONTROL_PLANE,
        projectSlug: "support-desk",
        projectDir,
        sourceBranch: "new-headline",
        targetBranch: "staging",
      });

      assertEquals(urls, ["/projects/support-desk/files?ref=branch%3Astaging"]);
      assertEquals((await readPushReceipt(projectDir))?.branch, "staging");
    } finally {
      await Deno.remove(projectDir, { recursive: true });
    }
  });

  it("keeps the receipt when main does not hold exactly the pushed source", async () => {
    const cases: Array<{ name: string; files: Array<{ path: string; content: unknown }> }> = [
      {
        name: "a file this directory never pushed",
        files: [...PUSHED_FILES, { path: "app/about/page.mdx", content: "# About\n" }],
      },
      { name: "a pushed file missing", files: [PAGE] },
      { name: "a pushed file changed", files: [{ ...PAGE, content: "edited\n" }, CONFIG] },
      { name: "a file without readable content", files: [{ ...PAGE, content: null }, CONFIG] },
    ];
    for (const { name, files } of cases) {
      const projectDir = await makeTempDir();
      try {
        const pushed = await writeBranchReceipt(projectDir, "new-headline");
        const scope = { controlPlane: CONTROL_PLANE, projectId: pushed.projectId };
        await writeSyncTarget(projectDir, {
          ...scope,
          projectSlug: "support-desk",
          branch: "new-headline",
          files: { [PAGE.path]: { digest: await computeContentDigest(PAGE.content) } },
        });

        const recorded = await recordMergeInPushReceipt({
          client: filesClient(files, []),
          controlPlane: CONTROL_PLANE,
          projectSlug: "support-desk",
          projectDir,
          sourceBranch: "new-headline",
          targetBranch: "main",
        });

        assertEquals(recorded, false, name);
        assertEquals(await readPushReceipt(projectDir), pushed, name);
        assertEquals(await readSyncTarget(projectDir, { ...scope, branch: "main" }), null, name);
      } finally {
        await Deno.remove(projectDir, { recursive: true });
      }
    }
  });

  it("keeps a receipt for another branch, project, or control plane without reading files", async () => {
    const cases = [
      { sourceBranch: "other-branch", projectSlug: "support-desk", controlPlane: CONTROL_PLANE },
      { sourceBranch: "new-headline", projectSlug: "other-project", controlPlane: CONTROL_PLANE },
      {
        sourceBranch: "new-headline",
        projectSlug: "support-desk",
        projectId: "660e8400-e29b-41d4-a716-446655440000",
        controlPlane: CONTROL_PLANE,
      },
      {
        sourceBranch: "new-headline",
        projectSlug: "support-desk",
        controlPlane: "https://api.veryfront.com",
      },
    ];
    for (const input of cases) {
      const projectDir = await makeTempDir();
      try {
        const pushed = await writeBranchReceipt(projectDir, "new-headline");
        const urls: string[] = [];

        const recorded = await recordMergeInPushReceipt({
          client: filesClient(PUSHED_FILES, urls),
          projectDir,
          targetBranch: "main",
          ...input,
        });

        assertEquals(recorded, false);
        assertEquals(urls, []);
        assertEquals(await readPushReceipt(projectDir), pushed);
      } finally {
        await Deno.remove(projectDir, { recursive: true });
      }
    }
  });

  it("does nothing in a directory with no push receipt", async () => {
    const projectDir = await makeTempDir();
    try {
      const urls: string[] = [];
      const recorded = await recordMergeInPushReceipt({
        client: filesClient(PUSHED_FILES, urls),
        controlPlane: CONTROL_PLANE,
        projectSlug: "support-desk",
        projectDir,
        sourceBranch: "new-headline",
        targetBranch: "main",
      });

      assertEquals(recorded, false);
      assertEquals(urls, []);
      assertEquals(await readPushReceipt(projectDir), null);
    } finally {
      await Deno.remove(projectDir, { recursive: true });
    }
  });

  it("rejects a corrupt receipt without reading files or rewriting it", async () => {
    const projectDir = await makeTempDir();
    try {
      const receiptFile = `${projectDir}/${PUSH_RECEIPT_RELATIVE_PATH}`;
      await Deno.mkdir(`${projectDir}/.veryfront`);
      await Deno.writeTextFile(receiptFile, "{ not json");
      const urls: string[] = [];

      await assertRejects(
        () =>
          recordMergeInPushReceipt({
            client: filesClient(PUSHED_FILES, urls),
            controlPlane: CONTROL_PLANE,
            projectSlug: "support-desk",
            projectDir,
            sourceBranch: "new-headline",
            targetBranch: "main",
          }),
        Error,
        `Veryfront could not read ${PUSH_RECEIPT_RELATIVE_PATH}`,
      );

      assertEquals(urls, []);
      assertEquals(await Deno.readTextFile(receiptFile), "{ not json");
    } finally {
      await Deno.remove(projectDir, { recursive: true });
    }
  });
});

describe("deploy after veryfront merge", () => {
  const CONTROL_PLANE = "https://api.veryfront.org";
  const PROJECT = {
    controlPlane: CONTROL_PLANE,
    projectId: "550e8400-e29b-41d4-a716-446655440000",
    projectSlug: "support-desk",
  };
  const PUSHED_FILES = [{ path: "app/page.tsx", content: "export default () => 'Merged';\n" }];

  it("refuses main while the receipt names the merged branch, then promotes main once the merge records it", async () => {
    const projectDir = await makeTempDir();
    try {
      const sourceDigest = await computeSourceDigest(PUSHED_FILES);
      await writePushReceipt(projectDir, {
        ...PROJECT,
        branch: "new-headline",
        commitSha: null,
        sourceDigest,
        localSourceDigest: sourceDigest,
        localPaths: PUSHED_FILES.map((file) => file.path),
        clean: false,
        pushedAt: "2026-11-12T09:00:00.000Z",
      });
      // This directory still holds what it pushed, outside any Git checkout.
      const local = { gitSource: { commitSha: null, clean: false }, sourceDigest };
      const deployMain = () =>
        resolvePushedSource({ ...PROJECT, projectDir, branch: "main", local });

      const refusal = await assertRejects(deployMain);
      assertInstanceOf(refusal, VeryfrontError);
      assertEquals(refusal.slug, "push-branch-mismatch");

      const recorded = await recordMergeInPushReceipt({
        client: createMockClient(() => Promise.resolve({ data: PUSHED_FILES })),
        controlPlane: CONTROL_PLANE,
        projectSlug: PROJECT.projectSlug,
        projectDir,
        sourceBranch: "new-headline",
        targetBranch: "main",
      });

      assertEquals(recorded, true);
      assertEquals(await deployMain(), { commitSha: null, sourceDigest });
    } finally {
      await Deno.remove(projectDir, { recursive: true });
    }
  });
});
