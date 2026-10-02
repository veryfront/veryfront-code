import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { afterEach, beforeEach, describe, it } from "#veryfront/testing/bdd.ts";
import type { VeryfrontFSAdapter } from "./adapter.ts";
import { fetchSourceListingForContext } from "./adapter-content-context.ts";
import { createAdapter } from "./adapter.test-helpers.ts";
import { runWithRequestContext } from "./request-context.ts";
import {
  admitVerifiedSourceContents,
  assembleSourceListing,
  hasVerifiedSourceContents,
  resetSourceContentStore,
} from "./source-content-store.ts";

interface SourceFile {
  path: string;
  content: string;
  checksum: string;
}

interface ListingCounts {
  fullListings: number;
  metadataListings: number;
  fileReads: number;
  listingCacheWrites: number;
  listingCacheReads: number;
}

async function sha256Hex(content: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(content));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join(
    "",
  );
}

async function sourceFiles(entries: Record<string, string>): Promise<SourceFile[]> {
  const files: SourceFile[] = [];
  for (const [path, content] of Object.entries(entries)) {
    files.push({ path, content, checksum: await sha256Hex(content) });
  }
  return files;
}

/**
 * One hosted credential: a fresh adapter whose API client answers with the
 * files that credential may see. A listing that selects fields returns
 * metadata only, as the API does for `fields=(...)` without `content`.
 */
function createCredentialAdapter(visibleFiles: () => SourceFile[]): {
  adapter: VeryfrontFSAdapter;
  counts: ListingCounts;
} {
  const adapter = createAdapter({
    veryfront: {
      apiBaseUrl: "https://api.example.com",
      apiToken: "test-token",
      projectSlug: "test-project",
      cache: { enabled: true },
    },
  });
  const counts: ListingCounts = {
    fullListings: 0,
    metadataListings: 0,
    fileReads: 0,
    listingCacheWrites: 0,
    listingCacheReads: 0,
  };
  const internals = adapter as unknown as {
    client: {
      initialize: () => Promise<void>;
      getProjectSlug: () => string;
      getProjectId: () => string;
      getCachedProject: () => { provider: string; layout: string };
      listAllFiles: (options?: { fields?: readonly string[] }) => Promise<unknown[]>;
      getFileContent: (path: string) => Promise<string>;
      getFileContentBytesWithinLimit: (path: string) => Promise<Uint8Array>;
    };
    wsManager: { connect: (_projectId: string) => void };
    cache: {
      setAsync: (key: string, value: unknown) => Promise<void>;
      getAsync: (key: string) => Promise<unknown>;
    };
  };
  internals.client.initialize = () => Promise.resolve();
  internals.client.getProjectSlug = () => "test-project";
  internals.client.getProjectId = () => "project-123";
  internals.client.getCachedProject = () => ({ provider: "veryfront", layout: "default" });
  internals.client.listAllFiles = (options) => {
    if (options?.fields) {
      counts.metadataListings++;
      return Promise.resolve(
        visibleFiles().map((file) => ({
          path: file.path,
          checksum: file.checksum,
          size: file.content.length,
          type: "file",
          updated_at: "2026-10-02T12:00:00.000Z",
        })),
      );
    }
    counts.fullListings++;
    return Promise.resolve(
      visibleFiles().map((file) => ({
        path: file.path,
        content: file.content,
        checksum: file.checksum,
        size: file.content.length,
        type: "file",
        updated_at: "2026-10-02T12:00:00.000Z",
      })),
    );
  };
  const readVisible = (path: string) => {
    counts.fileReads++;
    const file = visibleFiles().find((candidate) => candidate.path === path);
    if (!file) return Promise.reject(new Error(`404 Not Found: ${path}`));
    return Promise.resolve(file.content);
  };
  internals.client.getFileContent = readVisible;
  internals.client.getFileContentBytesWithinLimit = async (path) =>
    new TextEncoder().encode(await readVisible(path));
  internals.wsManager.connect = () => {};

  const setAsync = internals.cache.setAsync.bind(internals.cache);
  internals.cache.setAsync = (key, value) => {
    if (key.startsWith("files:")) counts.listingCacheWrites++;
    return setAsync(key, value);
  };
  const getAsync = internals.cache.getAsync.bind(internals.cache);
  internals.cache.getAsync = (key) => {
    if (key.startsWith("files:")) counts.listingCacheReads++;
    return getAsync(key);
  };

  adapter.setContentContext({ sourceType: "branch", projectSlug: "test-project", branch: "main" });
  return { adapter, counts };
}

function asCredential<T>(token: string, operation: () => Promise<T>): Promise<T> {
  return runWithRequestContext(
    { projectSlug: "test-project", projectId: "project-123", token, branch: "main" },
    operation,
  );
}

describe("source content reuse across fresh credentials (issue inbox#2277)", () => {
  beforeEach(() => resetSourceContentStore());
  afterEach(() => resetSourceContentStore());

  it("fills a fresh credential's listing from verified contents without a second full listing", async () => {
    const files = await sourceFiles({
      "veryfront.config.ts": "export default {};",
      "agents/assistant.ts": "export default { id: 'assistant' };",
      "tools/search.ts": "export default {};",
    });

    const first = createCredentialAdapter(() => files);
    const firstFingerprint = await asCredential("credential-a", async () => {
      await first.adapter.initialize();
      return await first.adapter.getSourceSnapshotFingerprint();
    });
    assertEquals(first.counts.fullListings, 1, "a cold process lists sources with content once");
    first.adapter.dispose();

    const second = createCredentialAdapter(() => files);
    await asCredential("credential-b", async () => {
      await second.adapter.initialize();
      await second.adapter.ensureSourceSnapshotFresh("config-load", undefined, true);
      assertEquals(
        await second.adapter.readTextFile("agents/assistant.ts"),
        "export default { id: 'assistant' };",
      );
      assertEquals(await second.adapter.exists("tools/search.ts"), true);
      assertEquals(
        await second.adapter.getSourceSnapshotFingerprint(),
        firstFingerprint,
        "reused contents must describe the same source snapshot",
      );
    });

    assertEquals(second.counts.fullListings, 0, "a fresh credential must not relist contents");
    assertEquals(
      second.counts.metadataListings,
      1,
      "a fresh credential lists its own file metadata once",
    );
    assertEquals(second.counts.fileReads, 0, "the assembled listing must answer every read");
    assertEquals(
      second.counts.listingCacheWrites,
      0,
      "an assembled listing must not be copied into the credential-scoped listing cache",
    );
    assertEquals(
      second.counts.listingCacheReads,
      0,
      "reads must use the retained listing instead of the listing cache",
    );
    second.adapter.dispose();
  });

  it("keeps each credential's own file set when contents are reused", async () => {
    const files = await sourceFiles({
      "agents/assistant.ts": "export default {};",
      "api/secret.ts": "export const secret = 'editor-only';",
    });

    const editor = createCredentialAdapter(() => files);
    await asCredential("editor-credential", () => editor.adapter.initialize());
    editor.adapter.dispose();

    // The API hides server-function sources from a non-editor credential.
    const viewerFiles = files.filter((file) => !file.path.startsWith("api/"));
    const viewer = createCredentialAdapter(() => viewerFiles);
    await asCredential("viewer-credential", async () => {
      await viewer.adapter.initialize();
      assertEquals(await viewer.adapter.exists("agents/assistant.ts"), true);
      assertEquals(
        await viewer.adapter.exists("api/secret.ts"),
        false,
        "content reuse must never widen what a credential can see",
      );
    });
    assertEquals(viewer.counts.fullListings, 0);
    viewer.adapter.dispose();
  });

  it("lists contents again when a file changed since they were verified", async () => {
    let files = await sourceFiles({ "agents/assistant.ts": "export default 'before';" });

    const first = createCredentialAdapter(() => files);
    await asCredential("credential-a", () => first.adapter.initialize());
    first.adapter.dispose();

    files = await sourceFiles({ "agents/assistant.ts": "export default 'after';" });
    const second = createCredentialAdapter(() => files);
    await asCredential("credential-b", async () => {
      await second.adapter.initialize();
      assertEquals(
        await second.adapter.readTextFile("agents/assistant.ts"),
        "export default 'after';",
      );
    });
    assertEquals(second.counts.metadataListings, 1);
    assertEquals(second.counts.fullListings, 1, "an unknown checksum falls back to full contents");
    second.adapter.dispose();
  });

  it("lists published sources with contents and never reuses them", async () => {
    const files = await sourceFiles({ "agents/assistant.ts": "export default {};" });
    const calls: string[] = [];
    const client = {
      listAllFiles: () => {
        calls.push("branch");
        return Promise.resolve([]);
      },
      listAllEnvironmentFiles: () => {
        calls.push("environment");
        return Promise.resolve([]);
      },
      listPublishedFiles: (_projectId?: string, releaseId?: string) => {
        calls.push(`release:${releaseId}`);
        return Promise.resolve(
          files.map((file) => ({ ...file, size: 0, type: "file" as const, updated_at: "" })),
        );
      },
    } as unknown as Parameters<typeof fetchSourceListingForContext>[0];

    const listing = await fetchSourceListingForContext(
      client,
      { sourceType: "release", projectSlug: "test-project", releaseId: "release-1" },
      "source-a",
    );

    assertEquals(listing.contentReused, false);
    assertEquals(listing.files.length, 1);
    assertEquals(calls, ["release:release-1"]);
    assertEquals(hasVerifiedSourceContents("source-a"), false);
  });

  it("never admits content that does not match its reported checksum", async () => {
    const files = [{
      path: "agents/assistant.ts",
      content: "export default 'tampered';",
      checksum: await sha256Hex("export default 'original';"),
    }];

    await admitVerifiedSourceContents("source-a", files);

    assertEquals(hasVerifiedSourceContents("source-a"), false);
    assertEquals(
      assembleSourceListing("source-a", [{ path: files[0]!.path, checksum: files[0]!.checksum }]),
      undefined,
    );
  });

  it("assembles nothing when a listed file has no checksum", async () => {
    const files = await sourceFiles({ "agents/assistant.ts": "export default {};" });
    await admitVerifiedSourceContents("source-a", files);

    assertEquals(hasVerifiedSourceContents("source-a"), true);
    assertEquals(assembleSourceListing("source-a", [{ path: "agents/assistant.ts" }]), undefined);
  });

  it("assembles empty files and copies listing metadata", async () => {
    const files = await sourceFiles({ "empty.ts": "", "agents/assistant.ts": "export {};" });
    await admitVerifiedSourceContents("source-a", files);

    const assembled = assembleSourceListing("source-a", [
      { path: "renamed.ts", checksum: files[0]!.checksum, size: 0 },
    ]);
    assertEquals(assembled, [
      { path: "renamed.ts", checksum: files[0]!.checksum, size: 0, content: "" },
    ]);
  });
});
