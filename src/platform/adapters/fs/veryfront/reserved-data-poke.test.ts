import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertExists, assertNotEquals } from "#veryfront/testing/assert.ts";
import { afterEach, describe, it } from "#veryfront/testing/bdd.ts";
import type { VeryfrontFSAdapter } from "./adapter.ts";
import { buildFileListCacheKey } from "./cache-keys.ts";
import { createAdapter, waitFor } from "./adapter.test-helpers.ts";
import { clearAllPendingInvalidations } from "./invalidation-state.ts";
import { runWithRequestContext } from "./request-context.ts";

type ListedFile = { path: string; version_id?: string; content?: string };
type FetchedFile = { path: string; content: string; id?: string; type?: string; size?: number };

interface AdapterHarness {
  adapter: VeryfrontFSAdapter;
  listCalls: () => number;
  getFileCalls: () => string[];
  /** Resolve the listing the next `listAllFiles` call is blocked on. */
  blockNextListing: () => {
    started: Promise<void>;
    release: (files: ListedFile[]) => void;
  };
  setListing: (files: ListedFile[]) => void;
  setRemoteFile: (path: string, file: FetchedFile | null | Error) => void;
  poke: (changedPaths: string[]) => void;
  internals: {
    sourceSnapshotFiles: ListedFile[] | undefined;
    sourceSnapshotIdentity: string | undefined;
    clearMemoryCalls: number;
  };
  dispose: () => void;
}

const AGENT_SOURCE = { path: "agents/support.ts", version_id: "a1", content: "export default 1;" };
const NOTE_PATH = "knowledge/churn/note.md";

function note(content: string): ListedFile {
  return { path: NOTE_PATH, version_id: `note-${content}`, content };
}

async function createHarness(
  options: { initialFiles?: ListedFile[]; isAdapterInUse?: () => boolean } = {},
): Promise<AdapterHarness> {
  const adapter = createAdapter({
    veryfront: {
      apiBaseUrl: "https://api.example.com",
      apiToken: "test-token",
      projectSlug: "test-project",
      contentSource: { type: "branch", branch: "main" },
      cache: { enabled: true },
    },
    invalidationCallbacks: options.isAdapterInUse
      ? { isAdapterInUse: options.isAdapterInUse }
      : undefined,
  });
  let listing: ListedFile[] = options.initialFiles ?? [AGENT_SOURCE, note("0")];
  let listCalls = 0;
  const getFileCalls: string[] = [];
  const remoteFiles = new Map<string, FetchedFile | null | Error>();
  let blocked: { started: () => void; promise: Promise<ListedFile[]> } | undefined;

  const client = (adapter as unknown as {
    client: {
      initialize: () => Promise<void>;
      getProjectSlug: () => string;
      getProjectId: () => string;
      getCachedProject: () => { provider: string; layout: string };
      listAllFiles: () => Promise<ListedFile[]>;
      getFile: (path: string) => Promise<FetchedFile>;
    };
  }).client;
  client.initialize = () => Promise.resolve();
  client.getProjectSlug = () => "test-project";
  client.getProjectId = () => "project-123";
  client.getCachedProject = () => ({ provider: "veryfront", layout: "default" });
  client.listAllFiles = () => {
    listCalls++;
    const current = blocked;
    if (current) {
      blocked = undefined;
      current.started();
      return current.promise;
    }
    return Promise.resolve(listing);
  };
  client.getFile = (path: string) => {
    getFileCalls.push(path);
    const remote = remoteFiles.get(path);
    if (remote instanceof Error) return Promise.reject(remote);
    if (remote === null) {
      return Promise.reject(Object.assign(new Error("Not Found"), { status: 404 }));
    }
    return Promise.resolve(remote ?? { path, content: "" });
  };

  const wsManager = (adapter as unknown as {
    wsManager: {
      connect: (_projectId: string) => void;
      handlePokeMessage: (event: MessageEvent) => void;
      deps: { clearMemoryCaches: () => void };
    };
  }).wsManager;
  wsManager.connect = () => {};
  const internals = adapter as unknown as AdapterHarness["internals"];
  internals.clearMemoryCalls = 0;
  const clearMemoryCaches = wsManager.deps.clearMemoryCaches;
  wsManager.deps.clearMemoryCaches = () => {
    internals.clearMemoryCalls++;
    clearMemoryCaches();
  };

  await adapter.initialize();

  return {
    adapter,
    listCalls: () => listCalls,
    getFileCalls: () => getFileCalls,
    blockNextListing: () => {
      const started = Promise.withResolvers<void>();
      const release = Promise.withResolvers<ListedFile[]>();
      blocked = { started: started.resolve, promise: release.promise };
      return { started: started.promise, release: release.resolve };
    },
    setListing: (files) => {
      listing = files;
    },
    setRemoteFile: (path, file) => {
      remoteFiles.set(path, file);
    },
    poke: (changedPaths) => {
      wsManager.handlePokeMessage(
        new MessageEvent("message", {
          data: JSON.stringify({ type: "poke", data: { changedPaths, branchName: "main" } }),
        }),
      );
    },
    internals,
    dispose: () => adapter.dispose(),
  };
}

function snapshotPaths(harness: AdapterHarness): string[] {
  return (harness.internals.sourceSnapshotFiles ?? []).map((file) => file.path).sort();
}

function snapshotContent(harness: AdapterHarness, path: string): string | undefined {
  return harness.internals.sourceSnapshotFiles?.find((file) => file.path === path)?.content;
}

/** Wait until every remote file request the pokes scheduled has been patched in. */
async function waitForPatch(harness: AdapterHarness, path: string, content: string) {
  await waitFor(() => Promise.resolve(snapshotContent(harness, path) === content), 2_000);
}

describe("reserved data pokes", () => {
  afterEach(() => {
    clearAllPendingInvalidations();
  });

  it("does not supersede an agent startup refresh with data-file pokes", async () => {
    const harness = await createHarness();
    try {
      const { adapter } = harness;
      const versionBefore = adapter.getSourceSnapshotVersion();
      const listing = harness.blockNextListing();
      const startup = adapter.ensureSourceSnapshotFresh("agent-source-config-start", {
        maxAgeMs: 0,
      });
      await listing.started;

      for (let write = 1; write <= 5; write++) {
        harness.setRemoteFile(NOTE_PATH, { path: NOTE_PATH, content: `${write}` });
        harness.poke([NOTE_PATH]);
        assertEquals(adapter.getSourceSnapshotVersion(), versionBefore);
        await waitForPatch(harness, NOTE_PATH, `${write}`);
      }
      assertEquals(harness.internals.clearMemoryCalls, 0);

      // The listing predates every write; the patched note must survive it.
      listing.release([AGENT_SOURCE, note("0")]);
      await startup;

      assertEquals(harness.listCalls(), 2, "the startup refresh must apply on its first listing");
      assertEquals(harness.internals.sourceSnapshotIdentity, adapter.getSourceSnapshotIdentity());
      assertEquals(snapshotContent(harness, NOTE_PATH), "5");
      assertEquals(await adapter.readFile(NOTE_PATH), "5");
      assertExists(await adapter.getSourceSnapshotFingerprint({ purpose: "agent-config" }));
    } finally {
      harness.dispose();
    }
  });

  it("still supersedes an agent startup refresh with an agent-config poke", async () => {
    const harness = await createHarness();
    try {
      const { adapter } = harness;
      const versionBefore = adapter.getSourceSnapshotVersion();
      const listing = harness.blockNextListing();
      const startup = adapter.ensureSourceSnapshotFresh("agent-source-config-start", {
        maxAgeMs: 0,
      });
      await listing.started;

      const editedAgent = { ...AGENT_SOURCE, version_id: "a2", content: "export default 2;" };
      harness.setListing([editedAgent, note("0")]);
      harness.poke([AGENT_SOURCE.path]);

      assertEquals(harness.internals.clearMemoryCalls, 1);
      assertNotEquals(adapter.getSourceSnapshotVersion(), versionBefore);

      listing.release([AGENT_SOURCE, note("0")]);
      await startup;

      assertEquals(harness.listCalls() >= 3, true, "the superseded refresh must list again");
      assertEquals(snapshotContent(harness, AGENT_SOURCE.path), "export default 2;");
      assertEquals(harness.getFileCalls(), []);
    } finally {
      harness.dispose();
    }
  });

  it("adds new data files and removes deleted ones without a listing", async () => {
    const created = "knowledge/churn/created.md";
    const harness = await createHarness();
    try {
      harness.setRemoteFile(created, { path: created, content: "new", size: 3, type: "file" });
      harness.poke([created]);
      await waitForPatch(harness, created, "new");
      assertEquals(snapshotPaths(harness), [AGENT_SOURCE.path, created, NOTE_PATH].sort());
      assertEquals(await harness.adapter.exists(created), true);
      const createdStat = await harness.adapter.stat(created);
      assertEquals(Number.isNaN(createdStat.mtime?.getTime()), false);

      harness.setRemoteFile(NOTE_PATH, null);
      harness.poke([NOTE_PATH]);
      await waitFor(() => Promise.resolve(!snapshotPaths(harness).includes(NOTE_PATH)), 2_000);
      assertEquals(snapshotPaths(harness), [AGENT_SOURCE.path, created].sort());
      assertEquals(harness.listCalls(), 1, "only the initial listing may run");
      assertEquals(harness.internals.clearMemoryCalls, 0);

      const context = harness.adapter.getContentContext();
      assertExists(context);
      const cached = await (harness.adapter as unknown as {
        cache: { getAsync: <T>(key: string) => Promise<T | undefined> };
      }).cache.getAsync<ListedFile[]>(buildFileListCacheKey(context));
      assertEquals(cached, undefined, "the cached pre-write listing must not answer later reads");
    } finally {
      harness.dispose();
    }
  });

  it("invalidates the whole snapshot when a data file cannot be fetched", async () => {
    const harness = await createHarness();
    try {
      const versionBefore = harness.adapter.getSourceSnapshotVersion();
      harness.setRemoteFile(NOTE_PATH, new Error("upstream unavailable"));
      harness.poke([NOTE_PATH]);
      await waitFor(() => Promise.resolve(harness.internals.clearMemoryCalls === 1), 2_000);
      await waitFor(() => Promise.resolve(harness.listCalls() === 2), 2_000);
      assertNotEquals(harness.adapter.getSourceSnapshotVersion(), versionBefore);
    } finally {
      harness.dispose();
    }
  });

  it("invalidates the whole snapshot for an idle adapter", async () => {
    const harness = await createHarness({ isAdapterInUse: () => false });
    try {
      harness.poke([NOTE_PATH]);
      await waitFor(() => Promise.resolve(harness.internals.clearMemoryCalls === 1), 2_000);
      assertEquals(harness.getFileCalls(), []);
    } finally {
      harness.dispose();
    }
  });

  it("invalidates the whole snapshot when a poke mixes data and source paths", async () => {
    const harness = await createHarness();
    try {
      harness.poke([NOTE_PATH, AGENT_SOURCE.path]);
      assertEquals(harness.internals.clearMemoryCalls, 1);
      await waitFor(() => Promise.resolve(harness.listCalls() === 2), 2_000);
      assertEquals(harness.getFileCalls(), []);
    } finally {
      harness.dispose();
    }
  });

  it("keeps a data patch that lands while a pushed listing is in flight", async () => {
    const harness = await createHarness();
    try {
      const { adapter } = harness;
      const context = adapter.getContentContext();
      assertExists(context);
      const internals = adapter as unknown as {
        replaceSourceSnapshot: (
          cacheKey: string,
          files: ListedFile[],
          expectedSnapshotVersion?: number,
          expectedDataGeneration?: number,
        ) => Promise<number | undefined>;
        wsManager: { deps: { getReservedDataGeneration: () => number } };
      };
      const version = adapter.getSourceSnapshotVersion();
      const generation = internals.wsManager.deps.getReservedDataGeneration();

      harness.setRemoteFile(NOTE_PATH, { path: NOTE_PATH, content: "patched" });
      harness.poke([NOTE_PATH]);
      await waitForPatch(harness, NOTE_PATH, "patched");

      const applied = await internals.replaceSourceSnapshot(
        buildFileListCacheKey(context),
        [AGENT_SOURCE, note("listed-before-write")],
        version,
        generation,
      );
      assertExists(applied);
      assertEquals(snapshotContent(harness, NOTE_PATH), "patched");
    } finally {
      harness.dispose();
    }
  });

  it("classifies writes by the agent discovery roots a run reported", async () => {
    const skillDoc = "knowledge/research/SKILL.md";
    const skillReference = "knowledge/research/references/sources.md";
    const harness = await createHarness({
      initialFiles: [AGENT_SOURCE, note("0"), {
        path: skillDoc,
        version_id: "s1",
        content: "---\nname: research\n---",
      }, { path: skillReference, version_id: "r1", content: "old" }],
    });
    try {
      const { adapter } = harness;
      // No run has reported discovery roots yet.
      assertEquals(await adapter.refreshReservedDataPaths([NOTE_PATH]), "definition");

      await adapter.getSourceSnapshotFingerprint({
        purpose: "agent-config",
        agentMarkdownPaths: ["agents"],
        skillMarkdownPaths: ["knowledge"],
      });
      assertEquals(await adapter.refreshReservedDataPaths([NOTE_PATH]), "data");
      assertEquals(await adapter.refreshReservedDataPaths([skillDoc]), "definition");
      assertEquals(await adapter.refreshReservedDataPaths([skillReference]), "definition");
      assertEquals(
        await adapter.refreshReservedDataPaths(["evals/reports/run-1.json"]),
        "data",
      );
      assertEquals(await adapter.refreshReservedDataPaths([AGENT_SOURCE.path]), undefined);

      // Another branch may configure other roots; forget the reported ones.
      adapter.setRequestBranch("draft");
      adapter.setRequestBranch(null);
      await adapter.ensureSourceSnapshotFresh("reselect", { maxAgeMs: 0 });
      assertEquals(await adapter.refreshReservedDataPaths([NOTE_PATH]), "definition");
    } finally {
      harness.dispose();
    }
  });

  it("only patches a path with the newest reply for it", async () => {
    const harness = await createHarness();
    try {
      const { adapter } = harness;
      const client = (adapter as unknown as {
        client: { getFile: (path: string) => Promise<FetchedFile> };
      }).client;
      const older = Promise.withResolvers<FetchedFile>();
      let calls = 0;
      client.getFile = (path) => {
        calls++;
        return calls === 1 ? older.promise : Promise.resolve({ path, content: "newer" });
      };

      const first = adapter.refreshReservedDataPaths([NOTE_PATH]);
      await adapter.refreshReservedDataPaths([NOTE_PATH]);
      older.resolve({ path: NOTE_PATH, content: "older" });
      await first;

      assertEquals(snapshotContent(harness, NOTE_PATH), "newer");
    } finally {
      harness.dispose();
    }
  });

  it("serves the patched data file to reads under another request credential", async () => {
    const harness = await createHarness();
    try {
      const { adapter } = harness;
      const runContext = { projectSlug: "test-project", token: "run-token", branch: "main" };
      assertEquals(await runWithRequestContext(runContext, () => adapter.readFile(NOTE_PATH)), "0");
      const listsBeforeWrite = harness.listCalls();

      harness.setListing([AGENT_SOURCE, note("1")]);
      harness.setRemoteFile(NOTE_PATH, { path: NOTE_PATH, content: "1" });
      harness.poke([NOTE_PATH]);
      await waitForPatch(harness, NOTE_PATH, "1");

      assertEquals(await runWithRequestContext(runContext, () => adapter.readFile(NOTE_PATH)), "1");
      assertEquals(await adapter.readFile(NOTE_PATH), "1");
      assertEquals(harness.internals.clearMemoryCalls, 0);
      assertEquals(harness.listCalls() - listsBeforeWrite <= 1, true);
    } finally {
      harness.dispose();
    }
  });

  it("drops a listing retained for another source instead of patching it", async () => {
    const harness = await createHarness();
    try {
      const internals = harness.adapter as unknown as {
        retainedFileList: { cacheKey: string; files: ListedFile[] } | null;
      };
      assertExists(internals.retainedFileList);
      internals.retainedFileList.cacheKey = "files:branch:test-project:other";
      harness.setRemoteFile(NOTE_PATH, { path: NOTE_PATH, content: "patched" });

      assertEquals(await harness.adapter.refreshReservedDataPaths([NOTE_PATH]), "definition");
      assertEquals(internals.retainedFileList, null);
      assertEquals(snapshotContent(harness, NOTE_PATH), "patched");
    } finally {
      harness.dispose();
    }
  });

  it("refuses to patch more data files than one poke may name", async () => {
    const harness = await createHarness();
    try {
      const paths = Array.from({ length: 17 }, (_, index) => `knowledge/bulk/${index}.md`);
      assertEquals(harness.adapter.canPatchReservedDataPaths(paths), false);
      assertEquals(harness.adapter.canPatchReservedDataPaths(paths.slice(0, 16)), true);
      assertEquals(harness.adapter.canPatchReservedDataPaths([]), false);
    } finally {
      harness.dispose();
    }
  });
});
