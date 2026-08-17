import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import type { VeryfrontFSAdapter } from "./adapter.ts";
import { buildFileListCacheKey } from "./cache-keys.ts";
import { createAdapter } from "./adapter.test-helpers.ts";

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

function createDraftAdapter(files: StubFile[]): {
  adapter: VeryfrontFSAdapter;
  counts: ClientCallCounts;
} {
  const adapter = createAdapter({
    veryfront: {
      apiBaseUrl: "https://api.example.com",
      apiToken: "test-token",
      projectSlug: "test-project",
      cache: { enabled: true },
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

    // Simulate the invalidation path that clears caches without replacing the
    // snapshot (e.g. a poke that could not fetch files inline).
    files[0] = { path: "pages/index.tsx", content: "export default 'v2';" };
    const context = adapter.getContentContext();
    if (!context) throw new Error("content context required");
    const internals = adapter as unknown as {
      cache: { delete: (key: string) => void };
      readOps: { clearFileListIndex: () => void };
      statOps: { clearIndex: () => void };
    };
    internals.cache.delete(buildFileListCacheKey(context));
    internals.readOps.clearFileListIndex();
    internals.statOps.clearIndex();

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
});
