import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import type { VeryfrontFSAdapter } from "./adapter.ts";
import { buildFileCacheKeyPrefix, buildFileListCacheKey } from "./cache-keys.ts";
import { addPendingInvalidation, removePendingInvalidation } from "./invalidation-state.ts";
import { createAdapter, waitFor } from "./adapter.test-helpers.ts";

interface StubFile {
  path: string;
  content: string;
}

interface ClientCallCounts {
  listAllFiles: number;
  getFileContent: number;
  listFiles: number;
  /**
   * Every request that hits `GET /projects/{slug}/files` -- the full listing
   * (`listAllFiles`) and each pattern probe (`listFiles`) alike. This is the
   * number the production trace counts, so it is the number a render budget
   * has to be expressed in.
   */
  listingRequests: number;
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
    listingRequests: 0,
  };

  const client = adapter.getClient() as unknown as {
    listAllFiles: () => Promise<Array<{ path: string; content?: string }>>;
    getFileContent: (path: string) => Promise<string>;
    getFileContentBytesWithinLimit: (path: string) => Promise<Uint8Array>;
    listFiles: (options?: { pattern?: string }) => Promise<{ files: Array<{ path: string }> }>;
  };

  client.listAllFiles = () => {
    counts.listAllFiles++;
    counts.listingRequests++;
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
  client.listFiles = (options?: { pattern?: string }) => {
    counts.listFiles++;
    counts.listingRequests++;
    const pattern = options?.pattern;
    if (!pattern) return Promise.resolve({ files: files.map((file) => ({ ...file })) });
    const matcher = new RegExp(
      `^${
        pattern.split("*").map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join(".*")
      }$`,
    );
    return Promise.resolve({
      files: files.filter((file) => matcher.test(file.path)).map((file) => ({ ...file })),
    });
  };

  return counts;
}

/**
 * @param recoverableSnapshot Give the client a project id so the adapter's
 * branch-miss snapshot recovery can actually run. Production previews always
 * have one, so leaving it off hides every listing refetch that recovery costs.
 */
function createDraftAdapter(
  files: StubFile[],
  cacheEnabled = true,
  recoverableSnapshot = false,
): {
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

  if (recoverableSnapshot) {
    (adapter.getClient() as unknown as { getProjectId: () => string }).getProjectId = () =>
      "project-123";
  }

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
  it("reuses the listing fetched during initialization when cache storage retains nothing", async () => {
    const files: StubFile[] = [
      { path: "pages/index.tsx", content: "export default 'initialized';" },
    ];
    const adapter = createAdapter({
      veryfront: {
        apiBaseUrl: "https://api.example.com",
        apiToken: "test-token",
        projectSlug: "test-project",
        cache: { enabled: false },
      },
    });
    const counts = stubClient(adapter, files);
    const internals = adapter as unknown as {
      client: {
        initialize: () => Promise<void>;
        getProjectSlug: () => string;
        getProjectId: () => string;
        getCachedProject: () => { provider: string; layout: string };
      };
      wsManager: { connect: (_projectId: string) => void };
    };
    internals.client.initialize = () => Promise.resolve();
    internals.client.getProjectSlug = () => "test-project";
    internals.client.getProjectId = () => "project-123";
    internals.client.getCachedProject = () => ({ provider: "veryfront", layout: "default" });
    internals.wsManager.connect = () => {};
    adapter.setContentContext({
      sourceType: "branch",
      projectSlug: "test-project",
      branch: "main",
    });

    await adapter.initialize();
    assertEquals(counts.listAllFiles, 1, "initialization must fetch the listing once");

    assertEquals(await adapter.readTextFile("pages/index.tsx"), "export default 'initialized';");
    assertEquals(
      counts.listAllFiles,
      1,
      "the first read after initialization must reuse the fetched listing",
    );
    assertEquals(counts.getFileContent, 0, "the initialized listing must answer the read");
  });

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
    assertEquals(
      counts.listFiles,
      0,
      "an authoritative empty listing must not fall back to per-extension searches",
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

  it("answers a preview root render's module probes from the single listing fetch", async () => {
    // A default project's module graph, exactly as the listing returns it.
    const modulePaths = [
      "app/layout",
      "pages/index",
      "components/Welcome",
      "components/app",
      "components/Header",
      "components/Footer",
      "styles/globals",
    ];
    const files: StubFile[] = modulePaths.map((modulePath) => ({
      path: `${modulePath}.tsx`,
      content: `export const source = "${modulePath}";`,
    }));
    const { adapter, counts } = createDraftAdapter(files, true, true);

    // `mdx.load_module_esm` -> `mdx.fetch_module` asks for every import
    // specifier once per candidate extension. None of these spellings exist,
    // and the listing this render already fetched says so.
    const probedExtensions = [".js", ".jsx", ".ts", ".md", ".mdx"];
    for (const modulePath of modulePaths) {
      for (const extension of probedExtensions) {
        assertEquals(
          await adapter.exists(`${modulePath}${extension}`),
          false,
          `${modulePath}${extension} is not in the listing`,
        );
      }
    }

    // Freshness is unchanged: the listing still answers the real modules.
    for (const file of files) {
      assertEquals(await adapter.readTextFile(file.path), file.content);
    }

    assertEquals(
      counts.listingRequests,
      1,
      "a preview root render must cost exactly one file-listing request",
    );
  });

  it("stops trusting the listing for absent paths once a poke lands", async () => {
    const files: StubFile[] = [
      { path: "pages/index.tsx", content: "export default function Home() {}" },
    ];
    const { adapter, counts } = createDraftAdapter(files, true, true);

    assertEquals(
      await adapter.exists("components/Welcome.tsx"),
      false,
      "the file does not exist yet, and the listing is authoritative about that",
    );
    assertEquals(counts.listingRequests, 1, "the absent path must not cost a probe");

    // The user creates the file; the WebSocket poke replaces the snapshot.
    files.push({ path: "components/Welcome.tsx", content: "export const Welcome = 1;" });
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

    assertEquals(
      await adapter.exists("components/Welcome.tsx"),
      true,
      "a poked snapshot must retire the previous listing's authority, not serve its absence",
    );
    assertEquals(
      await adapter.readTextFile("components/Welcome.tsx"),
      "export const Welcome = 1;",
      "the new file must be readable immediately after the poke",
    );
  });

  it("still falls back to the API when no listing is available at all", async () => {
    const { adapter } = createDraftAdapter([], true, true);

    // No listing can be fetched, so nothing is authoritative: a miss must fall
    // through to the API rather than being reported absent on no evidence.
    const client = adapter.getClient() as unknown as {
      listAllFiles: () => Promise<Array<{ path: string }>>;
      searchFiles: (pattern: string) => Promise<Array<{ path: string }>>;
    };
    client.listAllFiles = () => Promise.reject(new Error("listing unavailable"));
    let searched = 0;
    client.searchFiles = (pattern: string) => {
      searched++;
      return Promise.resolve(
        pattern === "components/Late.*" ? [{ path: "components/Late.tsx" }] : [],
      );
    };

    assertEquals(
      await adapter.resolveFile("components/Late"),
      "components/Late.tsx",
      "without any listing the API search must still run",
    );
    assertEquals(searched > 0, true, "the API fallback must not be disabled unconditionally");
  });
  it("still recovers a branch miss when the index is not authoritative", async () => {
    // The fan-out gate disables snapshot recovery while the index can answer.
    // Raised in review: nothing pinned that recovery still works when it
    // cannot — i.e. that the gate narrows the path rather than closing it.
    // The oracle is the recovered file itself: a request counter cannot tell a
    // snapshot refresh apart from the ordinary listing probe.
    const files: StubFile[] = [{ path: "app/page.tsx", content: "export default () => null;" }];
    const { adapter } = createDraftAdapter(files, true, true);

    assertEquals(
      (await adapter.readdir("app")).map((entry) => entry.path),
      ["app/page.tsx"],
      "the pre-edit listing answers from the index",
    );

    files.push({ path: "lib/util.ts", content: "export const util = 1;" });

    const branchSourcePrefix = buildFileCacheKeyPrefix(adapter.getContentContext());
    let entries: Array<{ path: string }>;
    try {
      addPendingInvalidation(branchSourcePrefix);
      entries = await adapter.readdir("lib");
    } finally {
      removePendingInvalidation(branchSourcePrefix);
    }

    assertEquals(
      entries.map((entry) => entry.path),
      ["lib/util.ts"],
      "a recoverable snapshot must refresh and list the new file when the index cannot answer",
    );
  });

  it("lets index authority expire so a missed poke cannot wedge recovery shut", async () => {
    // INDEX_AUTHORITY_LIMIT_MS is the only thing bounding a MISSED poke: a poke
    // that never arrives would otherwise leave the gate closed forever against
    // a listing that predates the edit.
    const files: StubFile[] = [{ path: "app/page.tsx", content: "export default () => null;" }];
    const { adapter } = createDraftAdapter(files, true, true);
    await adapter.resolveFile("app/page");

    const statOps = (adapter as unknown as {
      statOps: { isIndexAuthoritative(): boolean; indexBuiltAt: number };
    }).statOps;
    assertEquals(statOps.isIndexAuthoritative(), true, "fresh index answers authoritatively");

    // Age the index past the window rather than sleeping through it.
    statOps.indexBuiltAt = Date.now() - (5 * 60 * 1000 + 1);
    assertEquals(
      statOps.isIndexAuthoritative(),
      false,
      "authority must lapse so recovery turns back on without a poke",
    );
  });

  it("renews index authority when an expired refresh finds the snapshot unchanged", async () => {
    // The expiry above is a safety valve, not a budget: crossing it must cost
    // ONE re-check, not one per probe. A preview open longer than the window
    // whose refresh keeps confirming "nothing changed" must not slide back
    // into the per-probe fan-out this whole change exists to remove.
    const files: StubFile[] = [{ path: "app/page.tsx", content: "export default () => null;" }];
    const { adapter, counts } = createDraftAdapter(files, true, true);

    // A preview that has been open a while: the listing is warm and a snapshot
    // has been recorded, so later refreshes have a baseline to compare against
    // and can come back unchanged.
    assertEquals(await adapter.exists("app/page.tsx"), true);
    await adapter.refreshSourceSnapshot("test-warmup");
    assertEquals(await adapter.exists("app/page.tsx"), true);

    const statOps = (adapter as unknown as {
      statOps: { isIndexAuthoritative(): boolean; indexBuiltAt: number };
    }).statOps;
    assertEquals(statOps.isIndexAuthoritative(), true, "the warm index answers authoritatively");

    // Five idle minutes pass. Age the index rather than sleeping through it.
    statOps.indexBuiltAt = Date.now() - (5 * 60 * 1000 + 1);

    // The first probe past the window re-checks the API, as designed.
    const beforeFirstMiss = counts.listingRequests;
    assertEquals(await adapter.exists("components/Missing-one.tsx"), false);
    assertEquals(
      counts.listingRequests > beforeFirstMiss,
      true,
      "the first probe past the window must re-check the listing against the API",
    );

    // That re-check confirmed the listing, so the index built from it describes
    // the current snapshot again. Every later probe must be answered from it.
    const afterFirstMiss = counts.listingRequests;
    assertEquals(await adapter.exists("components/Missing-two.tsx"), false);
    assertEquals(
      counts.listingRequests,
      afterFirstMiss,
      "an unchanged refresh must renew index authority, not leave each later probe to re-check",
    );
  });

  it("still sees an edit whose poke was missed once the renewed window lapses", async () => {
    // The other half of the renewal: it must not turn "unchanged once" into
    // "never re-check again". Each renewal buys exactly one more window, and
    // an edit that arrives without a poke must be picked up when that lapses.
    const files: StubFile[] = [{ path: "app/page.tsx", content: "export default () => null;" }];
    const { adapter } = createDraftAdapter(files, true, true);

    assertEquals(await adapter.exists("app/page.tsx"), true);
    await adapter.refreshSourceSnapshot("test-warmup");
    assertEquals(await adapter.exists("app/page.tsx"), true);

    const statOps = (adapter as unknown as {
      statOps: { isIndexAuthoritative(): boolean; indexBuiltAt: number };
    }).statOps;
    const expire = () => {
      statOps.indexBuiltAt = Date.now() - (5 * 60 * 1000 + 1);
    };

    // Window one lapses against an unchanged listing, so authority is renewed.
    // Probe a path unrelated to the edit below: a path that misses while the
    // window is open is memoised as a recent recovery failure, which would
    // suppress the recovery this test is here to observe.
    expire();
    assertEquals(await adapter.exists("components/Unrelated.tsx"), false);
    assertEquals(
      statOps.isIndexAuthoritative(),
      true,
      "the confirming refresh renews the window",
    );

    // The user now creates the file and the poke never reaches us.
    files.push({ path: "components/Welcome.tsx", content: "export const Welcome = 1;" });
    assertEquals(
      await adapter.exists("components/Welcome.tsx"),
      false,
      "inside the renewed window the index still answers from the confirmed listing",
    );

    // Window two lapses. The renewal bought a window, not immunity.
    expire();
    assertEquals(
      await adapter.exists("components/Welcome.tsx"),
      true,
      "a missed poke must still surface once the renewed window expires",
    );
    assertEquals(
      await adapter.readTextFile("components/Welcome.tsx"),
      "export const Welcome = 1;",
      "the recovered snapshot must serve the missed file's content",
    );
  });
});
