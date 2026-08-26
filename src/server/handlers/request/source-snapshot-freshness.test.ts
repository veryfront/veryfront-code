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
  seedPreviewDocumentSourceSnapshot,
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

it("does not trust an inherited freshness options marker on a direct adapter", async () => {
  let ensureCalls = 0;
  let refreshes = 0;
  const adapter = createMockAdapter();
  const fs = Object.assign(
    Object.create({ sourceSnapshotFreshnessOptionsVersion: 1 }),
    adapter.fs,
    {
      ensureSourceSnapshotFresh: (_reason?: string) => {
        ensureCalls++;
        return Promise.resolve();
      },
      refreshSourceSnapshot: () => {
        refreshes++;
        return Promise.resolve();
      },
    },
  ) as typeof adapter.fs;
  adapter.fs = fs;

  await preparePreviewDocumentSourceSnapshot(makePreviewCtx(adapter));

  assertEquals(ensureCalls, 0, "an inherited marker must not authorize the options contract");
  assertEquals(refreshes, 1, "strict freshness must use the unconditional fallback");
});

it("does not invoke an accessor freshness options marker on a direct adapter", async () => {
  let getterCalls = 0;
  let ensureCalls = 0;
  const adapter = createMockAdapter();
  const fs = {
    ...adapter.fs,
    ensureSourceSnapshotFresh: (_reason?: string) => {
      ensureCalls++;
      return Promise.resolve();
    },
  };
  Object.defineProperty(fs, "sourceSnapshotFreshnessOptionsVersion", {
    get() {
      getterCalls++;
      return 1;
    },
  });
  adapter.fs = fs;

  const rejection = await assertRejects(() =>
    preparePreviewDocumentSourceSnapshot(makePreviewCtx(adapter))
  );

  assertInstanceOf(rejection, VeryfrontError);
  assertEquals(rejection.slug, "source-snapshot-freshness-unavailable");
  assertEquals(getterCalls, 0, "capability discovery must not execute adapter accessors");
  assertEquals(ensureCalls, 0, "an accessor marker must not authorize the options contract");
});

it("prefers a versioned zero-age ensure contract over unconditional refresh", async () => {
  const ensureCalls: Array<{ reason?: string; maxAgeMs?: number }> = [];
  let refreshes = 0;
  const adapter = createMockAdapter();
  adapter.fs = {
    ...adapter.fs,
    sourceSnapshotFreshnessOptionsVersion: 1,
    ensureSourceSnapshotFresh: (reason, options) => {
      ensureCalls.push({ reason, maxAgeMs: options?.maxAgeMs });
      return Promise.resolve();
    },
    refreshSourceSnapshot: () => {
      refreshes++;
      return Promise.resolve();
    },
  };

  await preparePreviewDocumentSourceSnapshot(makePreviewCtx(adapter));

  assertEquals(ensureCalls, [{ reason: "preview-document-routing", maxAgeMs: 0 }]);
  assertEquals(refreshes, 0, "the versioned ensure method owns immutable-source short-circuiting");
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

it("reuses a prepared document snapshot while its identity and generation are unchanged", async () => {
  let refreshes = 0;
  const adapter = createMockAdapter();
  adapter.fs.refreshSourceSnapshot = () => {
    refreshes++;
    return Promise.resolve();
  };
  adapter.fs.getSourceSnapshotIdentity = () => "branch:preview-project:main";
  adapter.fs.getSourceSnapshotVersion = () => 1;
  const ctx = makePreviewCtx(adapter);

  await preparePreviewDocumentSourceSnapshot(ctx);
  await ensurePreviewDocumentSourceSnapshot(ctx);

  assertEquals(refreshes, 1, "an unchanged generation reuses the classifier's strict refresh");
});

it("fails closed when config and routing would observe different generations", async () => {
  let version = 1;
  const adapter = createMockAdapter();
  adapter.fs.getSourceSnapshotIdentity = () => "branch:preview-project:main";
  adapter.fs.getSourceSnapshotVersion = () => version;
  const ctx = makePreviewCtx(adapter);
  seedPreviewDocumentSourceSnapshot(ctx, {
    identity: "branch:preview-project:main",
    version,
  });
  version++;

  const rejection = await assertRejects(() => preparePreviewDocumentSourceSnapshot(ctx));

  assertInstanceOf(rejection, VeryfrontError);
  assertEquals(rejection.slug, "source-snapshot-freshness-unavailable");
});

it("reclassifies when the source generation changes without changing identity", async () => {
  let refreshes = 0;
  let version = 1;
  const adapter = createMockAdapter();
  adapter.fs.refreshSourceSnapshot = () => {
    refreshes++;
    return Promise.resolve();
  };
  adapter.fs.getSourceSnapshotIdentity = () => "branch:preview-project:main";
  adapter.fs.getSourceSnapshotVersion = () => version;
  const ctx = makePreviewCtx(adapter);
  const reclassify = () => Promise.resolve({ continue: true });

  await preparePreviewDocumentSourceSnapshot(ctx, reclassify);
  version++;

  assertEquals(
    await ensurePreviewDocumentSourceSnapshot(ctx),
    reclassify,
    "same-branch edits must invalidate the ownership decision made from the old generation",
  );
  assertEquals(
    refreshes,
    1,
    "SSR must not refresh into a new generation while retaining old route ownership",
  );
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
