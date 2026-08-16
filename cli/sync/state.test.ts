import "#veryfront/schemas/_test-setup.ts";

import { assertEquals, assertRejects } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { join } from "veryfront/platform/path";
import {
  readSyncTarget,
  SYNC_STATE_RELATIVE_PATH,
  type SyncTarget,
  writeSyncTarget,
} from "./state.ts";

const DIGEST_A = `sha256:${"a".repeat(64)}`;
const DIGEST_B = `sha256:${"b".repeat(64)}`;

function target(branch: string, digest = DIGEST_A): SyncTarget {
  return {
    controlPlane: "https://api.veryfront.com/control-plane/",
    projectId: "project-1",
    projectSlug: "my-project",
    branch,
    files: {
      "app.ts": { digest, versionId: "version-1" },
    },
  };
}

async function withTempProject(test: (projectDir: string) => Promise<void>): Promise<void> {
  const projectDir = await Deno.makeTempDir();
  try {
    await test(projectDir);
  } finally {
    await Deno.remove(projectDir, { recursive: true });
  }
}

describe("sync state", () => {
  it("writes and reads a target using normalized scope", async () => {
    await withTempProject(async (projectDir) => {
      await writeSyncTarget(projectDir, target("main"));

      assertEquals(
        await readSyncTarget(projectDir, {
          controlPlane: "https://api.veryfront.com/control-plane",
          projectId: "project-1",
          branch: "main",
        }),
        {
          ...target("main"),
          controlPlane: "https://api.veryfront.com/control-plane",
        },
      );
    });
  });

  it("keeps independent baselines for multiple branches", async () => {
    await withTempProject(async (projectDir) => {
      await writeSyncTarget(projectDir, target("main"));
      await writeSyncTarget(projectDir, target("feature", DIGEST_B));

      assertEquals(
        (await readSyncTarget(projectDir, {
          controlPlane: "https://api.veryfront.com/control-plane/",
          projectId: "project-1",
          branch: "main",
        }))?.files["app.ts"]?.digest,
        DIGEST_A,
      );
      assertEquals(
        (await readSyncTarget(projectDir, {
          controlPlane: "https://api.veryfront.com/control-plane/",
          projectId: "project-1",
          branch: "feature",
        }))?.files["app.ts"]?.digest,
        DIGEST_B,
      );
    });
  });

  it("returns null when the target scope has not been observed", async () => {
    await withTempProject(async (projectDir) => {
      await writeSyncTarget(projectDir, target("main"));

      assertEquals(
        await readSyncTarget(projectDir, {
          controlPlane: "https://api.veryfront.com/control-plane",
          projectId: "other-project",
          branch: "main",
        }),
        null,
      );
    });
  });

  it("fails closed on corrupt state", async () => {
    await withTempProject(async (projectDir) => {
      await Deno.mkdir(join(projectDir, ".veryfront"));
      await Deno.writeTextFile(join(projectDir, SYNC_STATE_RELATIVE_PATH), "{not json");

      const error = await assertRejects(
        () =>
          readSyncTarget(projectDir, {
            controlPlane: "https://api.veryfront.com",
            projectId: "project-1",
            branch: "main",
          }),
        Error,
        `Veryfront could not read ${SYNC_STATE_RELATIVE_PATH}`,
      );
      assertEquals((error as Error & { slug?: string }).slug, "sync-state-invalid");
      assertEquals((error as Error & { exitCode?: number }).exitCode, 1);
    });
  });

  it("rejects a symbolic-link metadata directory", async () => {
    await withTempProject(async (projectDir) => {
      const externalDir = await Deno.makeTempDir();
      try {
        await Deno.symlink(externalDir, join(projectDir, ".veryfront"));

        await assertRejects(
          () => writeSyncTarget(projectDir, target("main")),
          Error,
          SYNC_STATE_RELATIVE_PATH,
        );
      } finally {
        await Deno.remove(externalDir, { recursive: true });
      }
    });
  });
});
