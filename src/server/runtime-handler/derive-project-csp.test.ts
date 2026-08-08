import "#veryfront/schemas/_test-setup.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { assert, assertEquals } from "#veryfront/testing/assert.ts";
import { deriveProjectCspOrigins } from "./project-runtime-context.ts";
import { __clearDerivedCspCacheForTests } from "#veryfront/security/http/derived-csp-cache.ts";
import type { RuntimeAdapter } from "#veryfront/platform/adapters/base.ts";

const SOURCE = [{
  path: "pages/index.tsx",
  content: '<img src="https://images.unsplash.com/photo.jpg" />',
}];

/**
 * Adapter shaped like the hosted one.
 *
 * The behaviour under test is the initialization requirement: the real adapter
 * answers `getAllSourceFiles` with an empty list until it has a content
 * context, and the only thing that establishes one is `ensureSourceSnapshotFresh`
 * (which awaits `ensureInitialized`). Its file-list warmup is itself gated on
 * being initialized, so an uninitialized read never fills in afterwards.
 */
function createHostedAdapter(options: { requireInitialization: boolean }) {
  let initialized = false;
  const calls = { ensureFresh: 0, listSource: 0, ranInContext: 0 };

  const underlying = {
    ensureSourceSnapshotFresh: (_reason?: string) => {
      calls.ensureFresh += 1;
      initialized = true;
      return Promise.resolve();
    },
    getAllSourceFiles: () => {
      calls.listSource += 1;
      if (options.requireInitialization && !initialized) return Promise.resolve([]);
      return Promise.resolve(SOURCE);
    },
    getContentContext: () => null,
    // Async, like MultiProjectFSAdapter's.
    getSourceSnapshotVersion: () => Promise.resolve(7),
  };

  const fs = {
    isVeryfrontAdapter: true,
    isMultiProjectMode: true,
    getUnderlyingAdapter: () => underlying,
    ensureSourceSnapshotFresh: underlying.ensureSourceSnapshotFresh,
    runWithContext: (
      _slug: string,
      _token: string,
      run: () => Promise<unknown>,
    ) => {
      calls.ranInContext += 1;
      return run();
    },
  };

  return { adapter: { fs } as unknown as RuntimeAdapter, calls };
}

const PRODUCTION = {
  projectSlug: "acme",
  projectId: "proj_acme",
  token: "tok",
  releaseId: "rel_1",
  branch: null,
  environmentName: "production",
};

describe("server/runtime-handler/deriveProjectCspOrigins", () => {
  it("derives origins for a hosted production release", async () => {
    // The case that was broken in production: a release-backed adapter that has
    // not been initialized for this request yet.
    __clearDerivedCspCacheForTests();
    const { adapter, calls } = createHostedAdapter({ requireInitialization: true });

    const derived = await deriveProjectCspOrigins({ adapter, ...PRODUCTION });

    assertEquals(derived?.["img-src"], ["https://images.unsplash.com"]);
    assert(calls.ensureFresh > 0, "the adapter must be initialized before its source is read");
    assertEquals(calls.ranInContext, 1, "the read stays inside the tenant context");
  });

  it("still derives when the adapter needs no initializing", async () => {
    __clearDerivedCspCacheForTests();
    const { adapter } = createHostedAdapter({ requireInitialization: false });

    const derived = await deriveProjectCspOrigins({
      adapter,
      ...PRODUCTION,
      releaseId: undefined,
      environmentName: "preview",
    });

    assertEquals(derived?.["img-src"], ["https://images.unsplash.com"]);
  });

  it("re-derives when the snapshot moves under a fixed release", async () => {
    // The wrapper's `getSourceSnapshotVersion` is async, and template-stringifying
    // it wrote the literal "[object Promise]" into every key. Two releases would
    // still differ by their id prefix, so only a moving snapshot under one fixed
    // identity can see this: with the promise stringified, both calls share a key
    // and the second is served from cache instead of re-reading the source.
    __clearDerivedCspCacheForTests();

    let snapshot = 1;
    let reads = 0;
    let source = SOURCE;
    const underlying = {
      ensureSourceSnapshotFresh: () => Promise.resolve(),
      getAllSourceFiles: () => {
        reads += 1;
        return Promise.resolve(source);
      },
      getContentContext: () => null,
      getSourceSnapshotVersion: () => Promise.resolve(snapshot),
    };
    const adapter = {
      fs: {
        isVeryfrontAdapter: true,
        isMultiProjectMode: true,
        getUnderlyingAdapter: () => underlying,
        ensureSourceSnapshotFresh: () => Promise.resolve(),
        runWithContext: (_s: string, _t: string, run: () => Promise<unknown>) => run(),
      },
    } as unknown as RuntimeAdapter;

    const first = await deriveProjectCspOrigins({ ...PRODUCTION, adapter });
    assertEquals(first?.["img-src"], ["https://images.unsplash.com"]);
    assertEquals(reads, 1);

    // Same release, new content pushed under it.
    snapshot = 2;
    source = [{ path: "pages/index.tsx", content: '<img src="https://cdn.example.com/a.png" />' }];

    const second = await deriveProjectCspOrigins({ ...PRODUCTION, adapter });
    assertEquals(reads, 2, "a moved snapshot must not be served from the previous key");
    assertEquals(second?.["img-src"], ["https://cdn.example.com"]);
  });

  it("returns nothing rather than throwing when the adapter cannot host a tenant", async () => {
    __clearDerivedCspCacheForTests();
    const derived = await deriveProjectCspOrigins({
      adapter: { fs: {} } as unknown as RuntimeAdapter,
      ...PRODUCTION,
    });

    assertEquals(derived, undefined);
  });

  it("never fails a response when the read throws", async () => {
    __clearDerivedCspCacheForTests();
    const { adapter } = createHostedAdapter({ requireInitialization: false });
    const fs = (adapter as unknown as { fs: Record<string, unknown> }).fs;
    fs.runWithContext = () => Promise.reject(new Error("tenant unavailable"));

    const derived = await deriveProjectCspOrigins({ adapter, ...PRODUCTION });

    assertEquals(derived, undefined);
  });
});
