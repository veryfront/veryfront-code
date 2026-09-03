import "#veryfront/schemas/_test-setup.ts";

import { assertEquals, assertRejects } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { computeContentDigest } from "../../sync/state.ts";
import { planPushChanges } from "./plan.ts";

const VERSION_1 = "00000000-0000-4000-8000-000000000001";
const VERSION_2 = "00000000-0000-4000-8000-000000000002";

describe("planPushChanges", () => {
  it("skips identical files and refreshes their observed version", async () => {
    const digest = await computeContentDigest("same\n");
    const plan = await planPushChanges({
      localFiles: [{ path: "app.ts", content: "same\n" }],
      remoteFiles: [{ path: "app.ts", content: "same\n", version_id: VERSION_2 }],
      baselineFiles: { "app.ts": { digest, versionId: VERSION_1 } },
      deletePaths: [],
      force: false,
    });

    assertEquals(plan.uploads, []);
    assertEquals(plan.deletes, []);
    assertEquals(plan.conflicts, []);
    assertEquals(plan.nextFiles, {
      "app.ts": { digest, versionId: VERSION_2 },
    });
  });

  it("updates a file when the remote content still matches the baseline", async () => {
    const baselineDigest = await computeContentDigest("before\n");
    const localDigest = await computeContentDigest("after\n");
    const plan = await planPushChanges({
      localFiles: [{ path: "app.ts", content: "after\n" }],
      remoteFiles: [{ path: "app.ts", content: "before\n", version_id: VERSION_2 }],
      baselineFiles: { "app.ts": { digest: baselineDigest, versionId: VERSION_1 } },
      deletePaths: [],
      force: false,
    });

    assertEquals(plan.uploads, [{
      path: "app.ts",
      content: "after\n",
      expectedVersionId: VERSION_2,
    }]);
    assertEquals(plan.conflicts, []);
    assertEquals(plan.nextFiles, { "app.ts": { digest: localDigest } });
  });

  it("rejects an overwrite when the remote content changed after the baseline", async () => {
    const plan = await planPushChanges({
      localFiles: [{ path: "app.ts", content: "local\n" }],
      remoteFiles: [{ path: "app.ts", content: "studio\n", version_id: VERSION_2 }],
      baselineFiles: {
        "app.ts": { digest: await computeContentDigest("before\n"), versionId: VERSION_1 },
      },
      deletePaths: [],
      force: false,
    });

    assertEquals(plan.uploads, []);
    assertEquals(plan.conflicts, ["app.ts"]);
  });

  it("rejects a differing remote file when no baseline exists", async () => {
    const plan = await planPushChanges({
      localFiles: [{ path: "app.ts", content: "local\n" }],
      remoteFiles: [{ path: "app.ts", content: "remote\n", version_id: VERSION_2 }],
      baselineFiles: {},
      deletePaths: [],
      force: false,
    });

    assertEquals(plan.uploads, []);
    assertEquals(plan.conflicts, ["app.ts"]);
  });

  it("treats a newly created branch snapshot as its initial baseline", async () => {
    const plan = await planPushChanges({
      localFiles: [{ path: "app.ts", content: "local\n" }],
      remoteFiles: [{ path: "app.ts", content: "main\n", version_id: VERSION_2 }],
      baselineFiles: {
        "app.ts": { digest: await computeContentDigest("deleted branch\n"), versionId: VERSION_1 },
      },
      deletePaths: [],
      force: false,
      remoteFilesAreBaseline: true,
    });

    assertEquals(plan.uploads, [{
      path: "app.ts",
      content: "local\n",
      expectedVersionId: VERSION_2,
    }]);
    assertEquals(plan.conflicts, []);
  });

  it("uses create-only protection for a new local file", async () => {
    const plan = await planPushChanges({
      localFiles: [{ path: "new.ts", content: "new\n" }],
      remoteFiles: [],
      baselineFiles: {},
      deletePaths: [],
      force: false,
    });

    assertEquals(plan.uploads, [{
      path: "new.ts",
      content: "new\n",
      expectedAbsent: true,
    }]);
    assertEquals(plan.conflicts, []);
  });

  it("rejects recreation when a baseline file was deleted remotely", async () => {
    const plan = await planPushChanges({
      localFiles: [{ path: "deleted.ts", content: "local\n" }],
      remoteFiles: [],
      baselineFiles: {
        "deleted.ts": { digest: await computeContentDigest("before\n"), versionId: VERSION_1 },
      },
      deletePaths: [],
      force: false,
    });

    assertEquals(plan.uploads, []);
    assertEquals(plan.conflicts, ["deleted.ts"]);
  });

  it("ignores a stale absent-file baseline when a recreated branch snapshot is trusted", async () => {
    const localDigest = await computeContentDigest("local\n");
    const plan = await planPushChanges({
      localFiles: [{ path: "deleted.ts", content: "local\n" }],
      remoteFiles: [],
      baselineFiles: {
        "deleted.ts": { digest: await computeContentDigest("old branch\n"), versionId: VERSION_1 },
      },
      deletePaths: [],
      force: false,
      remoteFilesAreBaseline: true,
    });

    assertEquals(plan.uploads, [{
      path: "deleted.ts",
      content: "local\n",
      expectedAbsent: true,
    }]);
    assertEquals(plan.conflicts, []);
    assertEquals(plan.nextFiles, { "deleted.ts": { digest: localDigest } });
  });

  it("protects deletes with the observed remote version", async () => {
    const digest = await computeContentDigest("before\n");
    const plan = await planPushChanges({
      localFiles: [],
      remoteFiles: [{ path: "old.ts", content: "before\n", version_id: VERSION_2 }],
      baselineFiles: { "old.ts": { digest, versionId: VERSION_1 } },
      deletePaths: ["old.ts"],
      force: false,
    });

    assertEquals(plan.deletes, [{ path: "old.ts", expectedVersionId: VERSION_2 }]);
    assertEquals(plan.conflicts, []);
    assertEquals(plan.nextFiles, {});
  });

  it("rejects pruning an unobserved or changed remote file", async () => {
    const plan = await planPushChanges({
      localFiles: [],
      remoteFiles: [
        { path: "changed.ts", content: "studio\n", version_id: VERSION_2 },
        { path: "unknown.ts", content: "remote\n", version_id: VERSION_2 },
      ],
      baselineFiles: {
        "changed.ts": {
          digest: await computeContentDigest("before\n"),
          versionId: VERSION_1,
        },
      },
      deletePaths: ["changed.ts", "unknown.ts"],
      force: false,
    });

    assertEquals(plan.deletes, []);
    assertEquals(plan.conflicts, ["changed.ts", "unknown.ts"]);
  });

  it("cleans a protected remote path using its observed version", async () => {
    const plan = await planPushChanges({
      localFiles: [],
      remoteFiles: [{ path: ".env/credentials.json", version_id: VERSION_2 }],
      baselineFiles: {},
      deletePaths: [".env/credentials.json"],
      protectedDeletePaths: [".env/credentials.json"],
      force: false,
    });

    assertEquals(plan.deletes, [{
      path: ".env/credentials.json",
      expectedVersionId: VERSION_2,
    }]);
    assertEquals(plan.conflicts, []);
    assertEquals(plan.nextFiles, {});
  });

  it("ignores a protected path that is not also queued for deletion", async () => {
    const digest = await computeContentDigest("secret\n");
    const plan = await planPushChanges({
      localFiles: [],
      remoteFiles: [{ path: ".env/credentials.json", content: "secret\n", version_id: VERSION_2 }],
      baselineFiles: {},
      deletePaths: [],
      protectedDeletePaths: [".env/credentials.json"],
      force: false,
    });

    assertEquals(plan.deletes, []);
    assertEquals(plan.conflicts, []);
    assertEquals(plan.nextFiles, {
      ".env/credentials.json": { digest, versionId: VERSION_2 },
    });
  });

  it("lets force intentionally bypass overwrite preconditions", async () => {
    const localDigest = await computeContentDigest("local\n");
    const plan = await planPushChanges({
      localFiles: [{ path: "app.ts", content: "local\n" }],
      remoteFiles: [
        { path: "app.ts", content: "studio\n", version_id: VERSION_2 },
        { path: "old.ts", content: "remote\n", version_id: VERSION_2 },
      ],
      baselineFiles: {},
      deletePaths: ["old.ts"],
      force: true,
    });

    assertEquals(plan.uploads, [{ path: "app.ts", content: "local\n" }]);
    assertEquals(plan.deletes, [{ path: "old.ts" }]);
    assertEquals(plan.conflicts, []);
    assertEquals(plan.nextFiles, { "app.ts": { digest: localDigest } });
  });

  it("uploads identical managed files when force is set", async () => {
    const localDigest = await computeContentDigest("same\n");
    const plan = await planPushChanges({
      localFiles: [{ path: "app.ts", content: "same\n" }],
      remoteFiles: [{ path: "app.ts", content: "same\n", version_id: VERSION_2 }],
      baselineFiles: {
        "app.ts": { digest: await computeContentDigest("before\n"), versionId: VERSION_1 },
      },
      deletePaths: [],
      force: true,
    });

    assertEquals(plan.uploads, [{ path: "app.ts", content: "same\n" }]);
    assertEquals(plan.deletes, []);
    assertEquals(plan.conflicts, []);
    assertEquals(plan.nextFiles, { "app.ts": { digest: localDigest } });
  });

  it("fails closed when a changed remote file has no version ID", async () => {
    const digest = await computeContentDigest("before\n");
    await assertRejects(
      () =>
        planPushChanges({
          localFiles: [{ path: "app.ts", content: "after\n" }],
          remoteFiles: [{ path: "app.ts", content: "before\n" }],
          baselineFiles: { "app.ts": { digest } },
          deletePaths: [],
          force: false,
        }),
      Error,
      'Veryfront did not return a version ID for "app.ts"',
    );
  });
});
