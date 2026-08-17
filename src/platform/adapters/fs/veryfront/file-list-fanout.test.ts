import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import type { VeryfrontFSAdapter } from "./adapter.ts";
import { buildFileListCacheKey } from "./cache-keys.ts";
import { createAdapter, waitFor } from "./adapter.test-helpers.ts";

interface StubFile {
  path: string;
  content: string;
}

interface ClientCallCounts {
  listAllFiles: number;
  getFileContent: number;
  listFiles: number;
}

/**
 * Wires the adapter's API client so every network operation is counted.
 * `files` is mutable: tests can edit entries to simulate draft updates.
 */
function stubClient(
  adapter: VeryfrontFSAdapter,
  files: StubFile[],
): ClientCallCounts {
  const counts: ClientCallCounts = {
    listAllFiles: 0,
    getFileContent: 0,
    listFiles: 0,
  };

  const client = adapter.getClient() as unknown as {
    listAllFiles: () => Promise<Array<{ path: string; content?: string }>>;
    getFileContent: (path: string) => Promise<string>;
    getFileContentBytesWithinLimit: (path: string) => Promise<Uint8Array>;
    listFiles: (options?: { pattern?: string }) => Promise<{ files: Array<{ path: string }> }>;
  };

  client.listAllFiles = () => {
    counts.listAllFiles++;
    return Promise.resolve(files.map((file) => ({ ...file })));
  };
  client.getFileContent = (path: string) => {
    counts.getFileContent++;
    const file = files.find((candidate) => candidate.path === path);
    if (!file) return Promise.reject(new Error(`404 Not Found: ${path}`));
    return Promise.resolve(file.content);
  };
  client.getFileContentBytesWithinLimit = (path: string) => {
    counts.getFileContent++;
    const file = files.find((candidate) => candidate.path === path);
    if (!file) return Promise.reject(new Error(`404 Not Found: ${path}`));
    return Promise.resolve(new TextEncoder().encode(file.content));
  };
  client.listFiles = () => {
    counts.listFiles++;
    return Promise.resolve({ files: [] });
  };

  return counts;
}

function createDraftAdapter(files: StubFile[], cacheEnabled = true): {
  adapter: VeryfrontFSAdapter;
  counts: ClientCallCounts;
} {
  const adapter = createAdapter({
    veryfront: {
      apiBaseUrl: "https://api.example.com",
      apiToken: "test-token",
      projectSlug: "test-project",
      cache: { enabled: cacheEnabled },
    },
  });
  const counts = stubClient(adapter, files);

  adapter.setContentContext({
    sourceType: "branch",
    projectSlug: "test-project",
    branch: "main",
  });
  // Simulate a warmed-up server whose file-list cache entry expired (the
  // preview steady state after the 60s TTL): initialized, but no cached list.
  (adapter as unknown as { initialized: boolean }).initialized = true;

  return { adapter, counts };
}

describe("file list fan-out (issue inbox#32)", () => {
  it("serves N draft module reads from one listing fetch instead of per-file probes", async () => {
    const moduleCount = 8;
    const files: StubFile[] = Array.from({ length: moduleCount }, (_, index) => ({
      path: `components/mod${index}.tsx`,
      content: `export const mod${index} = ${index};`,
    }));
    const { adapter, counts } = createDraftAdapter(files);

    const contents = await Promise.all(
      files.map((file) => adapter.readTextFile(file.path)),
    );

    assertEquals(
      contents,
      files.map((file) => file.content),
      "every module must be served with its draft content",
    );
    assertEquals(
      counts.listAllFiles,
      1,
      "an SSR render with a cold file-list cache must fetch the listing exactly once",
    );
    assertEquals(
      counts.getFileContent,
      0,
      "module reads must come from the single listing fetch, not per-file API probes",
    );
    assertEquals(
      counts.listFiles,
      0,
      "module resolution must not issue per-extension pattern searches",
    );
  });

  it("resolves extensionless module paths via the listing without pattern searches", async () => {
    const files: StubFile[] = [
      { path: "app/layout.tsx", content: "export default function Layout() {}" },
      { path: "components/app.tsx", content: "export const app = 1;" },
    ];
    const { adapter, counts } = createDraftAdapter(files);

    const resolvedLayout = await adapter.resolveFile("app/layout");
    const resolvedComponent = await adapter.resolveFile("components/app");

    assertEquals(resolvedLayout, "app/layout.tsx", "layout must resolve from the listing");
    assertEquals(
      resolvedComponent,
      "components/app.tsx",
      "component must resolve from the listing",
    );
    assertEquals(
      counts.listFiles,
      0,
      "extension resolution must not fan out into per-pattern API searches",
    );
    assertEquals(
      counts.listAllFiles,
      1,
      "extension resolution must reuse the single listing fetch",
    );
  });

  it("reuses an authoritative empty listing across sequential resolutions", async () => {
    const { adapter, counts } = createDraftAdapter([], false);

    assertEquals(await adapter.resolveFile("components/missing-one"), null);
    assertEquals(await adapter.resolveFile("components/missing-two"), null);

    assertEquals(
      counts.listAllFiles,
      1,
      "an empty branch listing must be fetched only once",
    );
  });

  it("still serves fresh draft content after a file update poke", async () => {
    const files: StubFile[] = [
      { path: "pages/index.tsx", content: "export default 'v1';" },
    ];
    const { adapter, counts } = createDraftAdapter(files);

    const first = await adapter.readTextFile("pages/index.tsx");
    assertEquals(first, "export default 'v1';", "first read must see the initial draft");

    // Simulate an edit: the API now returns new content, and the WebSocket
    // poke replaces the source snapshot exactly as websocket-manager does.
    files[0] = { path: "pages/index.tsx", content: "export default 'v2';" };
    const context = adapter.getContentContext();
    if (!context) throw new Error("content context required");
    const internals = adapter as unknown as {
      replaceSourceSnapshot: (
        cacheKey: string,
        snapshotFiles: Array<{ path: string; content?: string }>,
      ) => Promise<void>;
    };
    await internals.replaceSourceSnapshot(
      buildFileListCacheKey(context),
      files.map((file) => ({ ...file })),
    );

    const second = await adapter.readTextFile("pages/index.tsx");
    assertEquals(
      second,
      "export default 'v2';",
      "an edited draft file must invalidate any file-list caching",
    );
    assertEquals(
      counts.getFileContent,
      0,
      "updated content must be served from the poked snapshot without per-file probes",
    );
  });

  it("fetches a fresh listing when the cached one is cleared by an invalidation", async () => {
    const files: StubFile[] = [
      { path: "pages/index.tsx", content: "export default 'v1';" },
    ];
    const { adapter, counts } = createDraftAdapter(files);

    const first = await adapter.readTextFile("pages/index.tsx");
    assertEquals(first, "export default 'v1';", "first read must see the initial draft");
    assertEquals(counts.listAllFiles, 1, "first read warms the listing once");

    // Drive the real invalidation path that clears caches without replacing the
    // snapshot (a poke that could not fetch files inline).
    files[0] = { path: "pages/index.tsx", content: "export default 'v2';" };
    const context = adapter.getContentContext();
    if (!context) throw new Error("content context required");
    const internals = adapter as unknown as {
      cache: { delete: (key: string) => void };
      clearMemoryCaches: () => void;
    };
    internals.cache.delete(buildFileListCacheKey(context));
    internals.clearMemoryCaches();

    const second = await adapter.readTextFile("pages/index.tsx");
    assertEquals(
      second,
      "export default 'v2';",
      "a cleared file-list cache must trigger a fresh listing, never stale content",
    );
    assertEquals(
      counts.listAllFiles,
      2,
      "the invalidated listing must be refetched exactly once",
    );
  });

  it("serves later module reads from the warmed listing when cache storage retains nothing", async () => {
    // Caching disabled is the sharpest form of "the cache write did not
    // retain": setAsync is a no-op, exactly like an oversized listing dropped
    // by the memory cache or a failed backend write. Without in-adapter
    // retention every module lookup would start and await its own full
    // listing fetch -- more API traffic than the per-file probing this
    // change replaced.
    const files: StubFile[] = Array.from({ length: 8 }, (_, index) => ({
      path: `components/mod${index}.tsx`,
      content: `export const mod${index} = ${index};`,
    }));
    const { adapter, counts } = createDraftAdapter(files, false);

    const contents: string[] = [];
    for (const file of files) {
      contents.push(await adapter.readTextFile(file.path));
    }

    assertEquals(
      contents,
      files.map((file) => file.content),
      "every module must be served with its draft content",
    );
    assertEquals(
      counts.listAllFiles,
      1,
      "a non-retaining cache must not turn each module lookup into its own listing fetch",
    );
    assertEquals(
      counts.getFileContent,
      0,
      "module reads must come from the warmed listing, not per-file API probes",
    );
  });

  it("drops the retained listing on a poke so a non-retaining cache never serves stale drafts", async () => {
    const files: StubFile[] = [
      { path: "pages/index.tsx", content: "export default 'v1';" },
    ];
    const { adapter, counts } = createDraftAdapter(files, false);

    assertEquals(
      await adapter.readTextFile("pages/index.tsx"),
      "export default 'v1';",
      "first read must see the initial draft",
    );

    files[0] = { path: "pages/index.tsx", content: "export default 'v2';" };
    const context = adapter.getContentContext();
    if (!context) throw new Error("content context required");
    const internals = adapter as unknown as {
      replaceSourceSnapshot: (
        cacheKey: string,
        snapshotFiles: Array<{ path: string; content?: string }>,
      ) => Promise<void>;
      clearMemoryCaches: () => void;
    };

    await internals.replaceSourceSnapshot(
      buildFileListCacheKey(context),
      files.map((file) => ({ ...file })),
    );

    assertEquals(
      await adapter.readTextFile("pages/index.tsx"),
      "export default 'v2';",
      "a poked snapshot must win over the retained listing",
    );

    // A poke that could not carry files inline only clears memory caches. The
    // retained listing must go with them, or the next read serves the old draft.
    files[0] = { path: "pages/index.tsx", content: "export default 'v3';" };
    internals.clearMemoryCaches();

    assertEquals(
      await adapter.readTextFile("pages/index.tsx"),
      "export default 'v3';",
      "clearing memory caches must invalidate the retained listing",
    );
    assertEquals(
      counts.listAllFiles,
      2,
      "only the memory-cache invalidation may cost a refetch; the poked snapshot must not",
    );
  });

  it("discards a warmup that resolves after a newer snapshot replaced it", async () => {
    const files: StubFile[] = [
      { path: "pages/index.tsx", content: "export default 'v1';" },
    ];
    const { adapter, counts } = createDraftAdapter(files);

    // Hold the listing fetch open so a WebSocket snapshot can land while it is
    // in flight. The fetch resolves with the listing as it was *before* the
    // snapshot -- writing that through would roll the cache back to v1.
    let releaseFetch: (() => void) | undefined;
    const fetchReleased = new Promise<void>((resolve) => {
      releaseFetch = resolve;
    });
    const client = adapter.getClient() as unknown as {
      listAllFiles: () => Promise<Array<{ path: string; content?: string }>>;
    };
    const staleListing = files.map((file) => ({ ...file }));
    client.listAllFiles = async () => {
      counts.listAllFiles++;
      await fetchReleased;
      return staleListing;
    };

    const readPromise = adapter.readTextFile("pages/index.tsx");
    await waitFor(() => Promise.resolve(counts.listAllFiles === 1));

    const context = adapter.getContentContext();
    if (!context) throw new Error("content context required");
    const cacheKey = buildFileListCacheKey(context);
    const internals = adapter as unknown as {
      replaceSourceSnapshot: (
        key: string,
        snapshotFiles: Array<{ path: string; content?: string }>,
      ) => Promise<void>;
      cache: { getAsync: <T>(key: string) => Promise<T | undefined> };
    };
    await internals.replaceSourceSnapshot(cacheKey, [
      { path: "pages/index.tsx", content: "export default 'v2';" },
    ]);

    releaseFetch?.();

    assertEquals(
      await readPromise,
      "export default 'v2';",
      "a warmup that started before the poke must not answer with its pre-poke listing",
    );

    const cached = await internals.cache.getAsync<Array<{ path: string; content?: string }>>(
      cacheKey,
    );
    assertEquals(
      cached?.[0]?.content,
      "export default 'v2';",
      "the obsolete warmup must not overwrite the newer snapshot in the cache",
    );
  });

  it("discards a warmup that resolves after a poke clears memory caches", async () => {
    const files: StubFile[] = [
      { path: "pages/index.tsx", content: "export default 'v1';" },
    ];
    const { adapter, counts } = createDraftAdapter(files);

    let releaseFetch: (() => void) | undefined;
    const fetchReleased = new Promise<void>((resolve) => {
      releaseFetch = resolve;
    });
    const client = adapter.getClient() as unknown as {
      listAllFiles: () => Promise<Array<{ path: string; content?: string }>>;
    };
    const staleListing = files.map((file) => ({ ...file }));
    client.listAllFiles = async () => {
      counts.listAllFiles++;
      await fetchReleased;
      return staleListing;
    };

    const readPromise = adapter.readTextFile("pages/index.tsx");
    await waitFor(() => Promise.resolve(counts.listAllFiles === 1));

    files[0] = { path: "pages/index.tsx", content: "export default 'v2';" };
    const internals = adapter as unknown as {
      clearMemoryCaches: () => void;
    };
    internals.clearMemoryCaches();
    releaseFetch?.();

    assertEquals(
      await readPromise,
      "export default 'v2';",
      "a pre-poke warmup must not answer after the poke invalidates memory caches",
    );
    assertEquals(
      counts.getFileContent,
      1,
      "the invalidated warmup must fall back to a fresh exact-file read",
    );
  });

  it("discards a warmup when a poke lands during its cache write", async () => {
    const files: StubFile[] = [
      { path: "pages/index.tsx", content: "export default 'v1';" },
    ];
    const { adapter, counts } = createDraftAdapter(files);

    let markSetStarted: (() => void) | undefined;
    const setStarted = new Promise<void>((resolve) => {
      markSetStarted = resolve;
    });
    let releaseSet: (() => void) | undefined;
    const setReleased = new Promise<void>((resolve) => {
      releaseSet = resolve;
    });
    const internals = adapter as unknown as {
      cache: {
        setAsync: (key: string, value: unknown) => Promise<void>;
      };
      clearMemoryCaches: () => void;
    };
    const setAsync = internals.cache.setAsync.bind(internals.cache);
    internals.cache.setAsync = async (key, value) => {
      markSetStarted?.();
      await setReleased;
      await setAsync(key, value);
    };

    const readPromise = adapter.readTextFile("pages/index.tsx");
    await setStarted;

    files[0] = { path: "pages/index.tsx", content: "export default 'v2';" };
    internals.clearMemoryCaches();
    releaseSet?.();

    assertEquals(
      await readPromise,
      "export default 'v2';",
      "a cache write that finishes after the poke must not publish its old listing",
    );
    assertEquals(
      counts.getFileContent,
      1,
      "the superseded cache write must fall back to a fresh exact-file read",
    );
  });

  it("discards a replacement snapshot invalidated during its cache write", async () => {
    const files: StubFile[] = [
      { path: "pages/index.tsx", content: "export default 'v2';" },
    ];
    const { adapter } = createDraftAdapter(files);
    const context = adapter.getContentContext();
    if (!context) throw new Error("content context required");

    let markSetStarted: (() => void) | undefined;
    const setStarted = new Promise<void>((resolve) => {
      markSetStarted = resolve;
    });
    let releaseSet: (() => void) | undefined;
    const setReleased = new Promise<void>((resolve) => {
      releaseSet = resolve;
    });
    const internals = adapter as unknown as {
      cache: {
        setAsync: (key: string, value: unknown) => Promise<void>;
      };
      clearMemoryCaches: () => void;
      replaceSourceSnapshot: (
        key: string,
        snapshotFiles: Array<{ path: string; content?: string }>,
      ) => Promise<void>;
    };
    const setAsync = internals.cache.setAsync.bind(internals.cache);
    internals.cache.setAsync = async (key, value) => {
      markSetStarted?.();
      await setReleased;
      await setAsync(key, value);
    };

    const replacement = internals.replaceSourceSnapshot(
      buildFileListCacheKey(context),
      [{ path: "pages/index.tsx", content: "export default 'v1';" }],
    );
    await setStarted;

    // A second poke clears memory immediately, then its selective refresh can
    // fail. The first poke's delayed write must not become the retained answer.
    internals.clearMemoryCaches();
    releaseSet?.();
    await replacement;

    assertEquals(
      await adapter.readTextFile("pages/index.tsx"),
      "export default 'v2';",
      "a replacement invalidated during its write must not retain the older draft",
    );
  });

  it("discards a source refresh invalidated during its cache write", async () => {
    const files: StubFile[] = [
      { path: "pages/index.tsx", content: "export default 'v1';" },
    ];
    const { adapter } = createDraftAdapter(files);
    (adapter.getClient() as unknown as { getProjectId: () => string | undefined }).getProjectId =
      () => undefined;
    let markSetStarted: (() => void) | undefined;
    const setStarted = new Promise<void>((resolve) => {
      markSetStarted = resolve;
    });
    let releaseSet: (() => void) | undefined;
    const setReleased = new Promise<void>((resolve) => {
      releaseSet = resolve;
    });
    const internals = adapter as unknown as {
      cache: {
        setAsync: (key: string, value: unknown) => Promise<void>;
      };
      clearMemoryCaches: () => void;
    };
    const setAsync = internals.cache.setAsync.bind(internals.cache);
    internals.cache.setAsync = async (key, value) => {
      markSetStarted?.();
      await setReleased;
      await setAsync(key, value);
    };

    const refresh = adapter.refreshSourceSnapshot("poll");
    await setStarted;

    files[0] = { path: "pages/index.tsx", content: "export default 'v2';" };
    internals.clearMemoryCaches();
    releaseSet?.();
    await refresh;

    assertEquals(
      await adapter.readTextFile("pages/index.tsx"),
      "export default 'v2';",
      "a refresh invalidated during its write must not retain the older draft",
    );
  });

  it("discards a replacement invalidated while waiting for the mutation queue", async () => {
    const files: StubFile[] = [
      { path: "pages/index.tsx", content: "export default 'v2';" },
    ];
    const { adapter } = createDraftAdapter(files);
    const context = adapter.getContentContext();
    if (!context) throw new Error("content context required");
    const cacheKey = buildFileListCacheKey(context);
    let markSetStarted: (() => void) | undefined;
    const setStarted = new Promise<void>((resolve) => {
      markSetStarted = resolve;
    });
    let releaseSet: (() => void) | undefined;
    const setReleased = new Promise<void>((resolve) => {
      releaseSet = resolve;
    });
    const internals = adapter as unknown as {
      cache: {
        setAsync: (key: string, value: unknown) => Promise<void>;
      };
      clearMemoryCaches: () => void;
      replaceSourceSnapshot: (
        key: string,
        snapshotFiles: Array<{ path: string; content?: string }>,
      ) => Promise<void>;
    };
    const setAsync = internals.cache.setAsync.bind(internals.cache);
    let setCalls = 0;
    internals.cache.setAsync = async (key, value) => {
      setCalls++;
      if (setCalls === 1) {
        markSetStarted?.();
        await setReleased;
      }
      await setAsync(key, value);
    };

    const blockingReplacement = internals.replaceSourceSnapshot(cacheKey, [
      { path: "pages/index.tsx", content: "export default 'v0';" },
    ]);
    await setStarted;
    const queuedReplacement = internals.replaceSourceSnapshot(cacheKey, [
      { path: "pages/index.tsx", content: "export default 'v1';" },
    ]);

    internals.clearMemoryCaches();
    releaseSet?.();
    await Promise.all([blockingReplacement, queuedReplacement]);

    assertEquals(
      await adapter.readTextFile("pages/index.tsx"),
      "export default 'v2';",
      "a queued replacement must keep the generation from when it was requested",
    );
  });
});
