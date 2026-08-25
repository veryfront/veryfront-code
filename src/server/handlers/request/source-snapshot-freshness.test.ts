import { VeryfrontError } from "#veryfront/errors";
import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertInstanceOf, assertRejects } from "#veryfront/testing/assert.ts";
import { it } from "#veryfront/testing/bdd.ts";
import type { HandlerContext } from "../types.ts";
import { createMockAdapter, makeCtx } from "./ssr/ssr.handler.test-helpers.ts";
import {
  ensurePreviewDocumentSourceSnapshot,
  ensurePreviewSourceSnapshotFresh,
  preparePreviewDocumentSourceSnapshot,
} from "./source-snapshot-freshness.ts";

function makePreviewCtx(adapter: ReturnType<typeof createMockAdapter>): HandlerContext {
  return makeCtx({
    adapter,
    projectSlug: "preview-project",
    requestContext: {
      token: "",
      slug: "preview-project",
      branch: "main",
      mode: "preview",
    },
  });
}

it("rejects an unversioned ensure-only adapter for a negative age budget", async () => {
  let ensureCalls = 0;
  const adapter = createMockAdapter();
  adapter.fs.ensureSourceSnapshotFresh = () => {
    ensureCalls++;
    return Promise.resolve();
  };

  const rejection = await assertRejects(() =>
    ensurePreviewSourceSnapshotFresh(
      makeCtx({
        adapter,
        projectSlug: "preview-project",
        requestContext: {
          token: "",
          slug: "preview-project",
          branch: "main",
          mode: "preview",
        },
      }),
      {
        ensure: "strict-preview-request",
        refreshFallback: "strict-preview-request",
        maxAgeMs: -1,
      },
    )
  );

  assertInstanceOf(rejection, VeryfrontError);
  assertEquals(rejection.slug, "source-snapshot-freshness-unavailable");
  assertEquals(ensureCalls, 0, "a legacy lease cannot satisfy a negative age budget");
});

it("reuses a prepared document snapshot while its identity is unchanged", async () => {
  let refreshes = 0;
  const adapter = createMockAdapter();
  adapter.fs.refreshSourceSnapshot = () => {
    refreshes++;
    return Promise.resolve();
  };
  adapter.fs.getSourceSnapshotIdentity = () => "branch:preview-project:main";
  const ctx = makePreviewCtx(adapter);

  await preparePreviewDocumentSourceSnapshot(ctx);
  await ensurePreviewDocumentSourceSnapshot(ctx);

  assertEquals(refreshes, 1, "an unchanged identity reuses the classifier's strict refresh");
});

it("re-establishes freshness when the snapshot identity changed after preparation", async () => {
  // A reused contextual adapter can switch branches between the API/page
  // classifier and the SSR render context (setRequestBranch), so the prepared
  // snapshot no longer describes what the render reads.
  const refreshedIdentities: string[] = [];
  let identity = "branch:preview-project:main";
  const adapter = createMockAdapter();
  adapter.fs.refreshSourceSnapshot = () => {
    refreshedIdentities.push(identity);
    return Promise.resolve();
  };
  adapter.fs.getSourceSnapshotIdentity = () => identity;
  const ctx = makePreviewCtx(adapter);

  await preparePreviewDocumentSourceSnapshot(ctx);
  identity = "branch:preview-project:feature";
  await ensurePreviewDocumentSourceSnapshot(ctx);

  assertEquals(
    refreshedIdentities,
    ["branch:preview-project:main", "branch:preview-project:feature"],
    "a context switch after preparation must refresh the newly targeted snapshot",
  );
});

it("never reuses a prepared snapshot from an adapter that cannot name its context", async () => {
  let refreshes = 0;
  const adapter = createMockAdapter();
  adapter.fs.refreshSourceSnapshot = () => {
    refreshes++;
    return Promise.resolve();
  };
  const ctx = makePreviewCtx(adapter);

  await preparePreviewDocumentSourceSnapshot(ctx);
  await ensurePreviewDocumentSourceSnapshot(ctx);

  assertEquals(
    refreshes,
    2,
    "without a snapshot identity, freshness must not carry across a possible context change",
  );
});
