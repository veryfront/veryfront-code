import "#veryfront/schemas/_test-setup.ts";
import { assert, assertEquals, assertRejects } from "#veryfront/testing/assert.ts";
import { afterEach, describe, it } from "#veryfront/testing/bdd.ts";
import { exists, readTextFile, withTempDir } from "#veryfront/testing/deno-compat.ts";
import { withMockFetch } from "#veryfront/testing/mock-fetch.ts";
import { deleteEnv, setEnv } from "#veryfront/compat/process.ts";
import { join } from "#veryfront/compat/path";
import { VeryfrontError } from "#veryfront/errors";
import { runWithRequestContext } from "#veryfront/platform/adapters/fs/veryfront/multi-project-adapter.ts";
import { withLocalJsonStoreLock } from "./local-json-store-lock.ts";
import { ragStore } from "./rag-store.ts";
import { clearEmbeddingProviders, registerEmbeddingProvider } from "./resolve.ts";

const CLOUD_ENV_KEYS = [
  "VERYFRONT_API_TOKEN",
  "VERYFRONT_PROJECT_SLUG",
  "VERYFRONT_RAG_BACKEND",
  "VERYFRONT_SERVICE_LAYER",
] as const;

function clearCloudEnv(): void {
  for (const key of CLOUD_ENV_KEYS) {
    try {
      deleteEnv(key);
    } catch {
      // expected: env may already be unset
    }
  }
}

function registerTestEmbeddingProvider(): void {
  registerEmbeddingProvider("test", () =>
    ({
      specificationVersion: "v2",
      provider: "test",
      modelId: "test/demo",
      maxEmbeddingsPerCall: undefined,
      supportsParallelCalls: true,
      async doEmbed({ values }: { values: string[] }) {
        return {
          embeddings: values.map((value, index) => {
            const vector = new Array<number>(1536).fill(index);
            vector[0] = value.length;
            return vector;
          }),
          usage: { tokens: 0 },
          rawResponse: undefined,
          warnings: [],
        };
      },
    }) as never);
}

describe("ragStore", () => {
  afterEach(() => {
    clearCloudEnv();
    clearEmbeddingProviders();
  });

  it("returns empty uploads when storage file does not exist", async () => {
    await withTempDir(async (tempDir) => {
      const storagePath = join(tempDir, "data", "index.json");
      const store = ragStore({
        model: "local/test-model",
        storagePath,
      });

      const documents = await store.listDocuments();
      assertEquals(documents, []);
    });
  });

  it("creates the storage directory during first ingest", async () => {
    await withTempDir(async (tempDir) => {
      const storagePath = join(tempDir, "data", "index.json");
      const store = ragStore({
        model: "local/test-model",
        storagePath,
      });

      const id = await store.ingest("Doc", "Hello world");

      assert(id.length > 0);
      assertEquals(await exists(storagePath), true);
      assertEquals((await store.listDocuments()).map((document) => document.id), [id]);
    });
  });

  it("treats a missing temp cleanup directory as empty", async () => {
    await withTempDir(async (tempDir) => {
      const storageDirectory = join(tempDir, "data");
      const storagePath = join(storageDirectory, "index.json");
      const store = ragStore({
        model: "local/test-model",
        storagePath,
      });
      const readDirDescriptor = Object.getOwnPropertyDescriptor(Deno, "readDir");
      assert(readDirDescriptor !== undefined);
      const originalReadDir = Deno.readDir.bind(Deno);
      Object.defineProperty(Deno, "readDir", {
        ...readDirDescriptor,
        value: (path: string | URL) =>
          String(path) === storageDirectory
            ? ({
              [Symbol.asyncIterator]() {
                return {
                  next() {
                    return Promise.reject(
                      new Deno.errors.NotFound("missing storage directory"),
                    );
                  },
                };
              },
            } satisfies AsyncIterable<Deno.DirEntry>)
            : originalReadDir(path),
      });

      try {
        const id = await store.ingest("Doc", "Hello world");

        assert(id.length > 0);
        assertEquals(await exists(storagePath), true);
      } finally {
        Object.defineProperty(Deno, "readDir", readDirDescriptor);
      }
    });
  });

  for (const phase of ["open", "iteration"] as const) {
    it(`retries when a lock directory disappears during readDir ${phase}`, async () => {
      await withTempDir(async (tempDir) => {
        const storagePath = join(tempDir, "data", "index.json");
        const lockDirectory = `${storagePath}.veryfront-rag.lock`;
        await Deno.mkdir(lockDirectory, { recursive: true });
        await Deno.writeTextFile(
          join(lockDirectory, `.owner.recovering.${crypto.randomUUID()}`),
          `${JSON.stringify({ token: crypto.randomUUID(), createdAtMs: 0 })}\n`,
        );

        const readDirDescriptor = Object.getOwnPropertyDescriptor(Deno, "readDir");
        assert(readDirDescriptor !== undefined);
        const originalReadDir = Deno.readDir.bind(Deno);
        let changed = false;
        Object.defineProperty(Deno, "readDir", {
          ...readDirDescriptor,
          value: (path: string | URL) => {
            if (!changed && String(path) === lockDirectory) {
              changed = true;
              if (phase === "open") {
                return {
                  [Symbol.asyncIterator]() {
                    return {
                      async next() {
                        await Deno.remove(lockDirectory, { recursive: true });
                        throw new Deno.errors.NotFound("lock directory disappeared");
                      },
                    };
                  },
                } satisfies AsyncIterable<Deno.DirEntry>;
              }
              const entries = originalReadDir(path);
              return (async function* () {
                for await (const entry of entries) {
                  yield entry;
                  await Deno.remove(lockDirectory, { recursive: true });
                  throw new Deno.errors.NotFound("lock directory disappeared");
                }
              })();
            }
            return originalReadDir(path);
          },
        });

        try {
          await withLocalJsonStoreLock(storagePath, async () => undefined);
          assertEquals(changed, true);
          assertEquals(await exists(lockDirectory), false);
        } finally {
          Object.defineProperty(Deno, "readDir", readDirDescriptor);
        }
      });
    });
  }

  it("removes an owner-only lock when the lease write fails", async () => {
    await withTempDir(async (tempDir) => {
      const storagePath = join(tempDir, "data", "index.json");
      const lockDirectory = `${storagePath}.veryfront-rag.lock`;
      const writeTextFileDescriptor = Object.getOwnPropertyDescriptor(Deno, "writeTextFile");
      assert(writeTextFileDescriptor !== undefined);
      const originalWriteTextFile = Deno.writeTextFile.bind(Deno);
      Object.defineProperty(Deno, "writeTextFile", {
        ...writeTextFileDescriptor,
        value: (
          path: string | URL,
          data: string,
          options?: Deno.WriteFileOptions,
        ) => {
          if (String(path).endsWith(".lease")) {
            return Promise.reject(new Error("lease write failed"));
          }
          return originalWriteTextFile(path, data, options);
        },
      });

      try {
        await assertRejects(
          () => withLocalJsonStoreLock(storagePath, async () => undefined),
          Error,
          "lease write failed",
        );
        assertEquals(await exists(lockDirectory), false);
      } finally {
        Object.defineProperty(Deno, "writeTextFile", writeTextFileDescriptor);
      }
    });
  });

  it("persists ingest with atomic temp+rename workflow", async () => {
    await withTempDir(async (tempDir) => {
      const storagePath = join(tempDir, "data", "index.json");
      const store = ragStore({
        model: "local/test-model",
        storagePath,
      });

      const id = await store.ingest("Doc", "Hello world", {
        source: "upload:test.txt",
        type: "txt",
      });
      assert(id.length > 0);

      const documents = await store.listDocuments();
      assertEquals(documents.length, 1);
      assertEquals(documents[0]?.id, id);

      const persisted = await readTextFile(storagePath);
      const parsed = JSON.parse(persisted) as {
        documents: unknown[];
        chunks: unknown[];
      };
      assertEquals(Array.isArray(parsed.documents), true);
      assertEquals(Array.isArray(parsed.chunks), true);
      assertEquals(persisted, JSON.stringify(parsed));
      assertEquals(await exists(storagePath + ".tmp"), false);
    });
  });

  it("preserves the live store when its atomic replacement fails", async () => {
    await withTempDir(async (tempDir) => {
      const storagePath = join(tempDir, "data", "index.json");
      await Deno.mkdir(join(tempDir, "data"), { recursive: true });
      const original = JSON.stringify({ documents: [], chunks: [] });
      await Deno.writeTextFile(storagePath, original);

      const store = ragStore({
        model: "local/test-model",
        storagePath,
      });
      const renameDescriptor = Object.getOwnPropertyDescriptor(Deno, "rename");
      assert(renameDescriptor !== undefined);
      const originalRename = Deno.rename.bind(Deno);
      Object.defineProperty(Deno, "rename", {
        ...renameDescriptor,
        value: (from: string | URL, to: string | URL) =>
          String(to) === storagePath
            ? Promise.reject(new Error("simulated rename failure"))
            : originalRename(from, to),
      });

      try {
        const error = await assertRejects(
          () => store.ingest("Must not persist", "replacement content"),
          VeryfrontError,
          "could not be completed safely",
        );
        assert(error instanceof VeryfrontError);
        assertEquals(error.slug, "rag-store-unavailable");
        assertEquals(error.message.includes(storagePath), false);
      } finally {
        Object.defineProperty(Deno, "rename", renameDescriptor);
      }

      assertEquals(await readTextFile(storagePath), original);
      const entries: string[] = [];
      for await (const entry of Deno.readDir(join(tempDir, "data"))) {
        entries.push(entry.name);
      }
      assertEquals(entries, ["index.json"]);
    });
  });

  it("cleans a partially written unique temp file without touching the live store", async () => {
    await withTempDir(async (tempDir) => {
      const storagePath = join(tempDir, "data", "index.json");
      await Deno.mkdir(join(tempDir, "data"), { recursive: true });
      const original = JSON.stringify({ documents: [], chunks: [] });
      await Deno.writeTextFile(storagePath, original);
      const store = ragStore({ model: "local/test-model", storagePath });
      const writeDescriptor = Object.getOwnPropertyDescriptor(Deno, "writeTextFile");
      assert(writeDescriptor !== undefined);
      const originalWrite = Deno.writeTextFile.bind(Deno);
      Object.defineProperty(Deno, "writeTextFile", {
        ...writeDescriptor,
        value: async (path: string | URL, data: string, options?: Deno.WriteFileOptions) => {
          if (String(path).includes(".tmp.")) {
            await originalWrite(path, "partial", options);
            throw new Error("simulated partial temp write");
          }
          await originalWrite(path, data, options);
        },
      });

      try {
        const error = await assertRejects(
          () => store.ingest("Must not persist", "replacement content"),
          VeryfrontError,
          "could not be completed safely",
        );
        assert(error instanceof VeryfrontError);
        assertEquals(error.slug, "rag-store-unavailable");
        assertEquals(error.message.includes(storagePath), false);
      } finally {
        Object.defineProperty(Deno, "writeTextFile", writeDescriptor);
      }

      assertEquals(await readTextFile(storagePath), original);
      const entries = await Array.fromAsync(Deno.readDir(join(tempDir, "data")));
      assertEquals(entries.map((entry) => entry.name), ["index.json"]);
    });
  });

  it("cleans an orphaned temp file left by an interrupted process", async () => {
    await withTempDir(async (tempDir) => {
      const storagePath = join(tempDir, "data", "index.json");
      await Deno.mkdir(join(tempDir, "data"), { recursive: true });
      const original = JSON.stringify({ documents: [], chunks: [] });
      const orphanPath = `${storagePath}.tmp.${crypto.randomUUID()}`;
      await Deno.writeTextFile(storagePath, original);
      await Deno.writeTextFile(orphanPath, "partial");

      const store = ragStore({ model: "local/test-model", storagePath });
      assertEquals(await store.listDocuments(), []);
      assertEquals(await readTextFile(storagePath), original);
      assertEquals(await exists(orphanPath), false);
    });
  });

  it("serializes concurrent store instances targeting the same local index", async () => {
    await withTempDir(async (tempDir) => {
      const storagePath = join(tempDir, "data", "index.json");
      const first = ragStore({ model: "local/test-model", storagePath });
      const second = ragStore({ model: "local/test-model", storagePath });

      await Promise.all([
        first.ingest("First", "first content"),
        second.ingest("Second", "second content"),
      ]);

      const persisted = JSON.parse(await readTextFile(storagePath)) as {
        documents: Array<{ title: string }>;
      };
      assertEquals(persisted.documents.map((document) => document.title).sort(), [
        "First",
        "Second",
      ]);
    });
  });

  it("serializes concurrent local-index writers in separate processes", async () => {
    await withTempDir(async (tempDir) => {
      const storagePath = join(tempDir, "data", "index.json");
      const moduleUrl = new URL("./rag-store.ts", import.meta.url).href;
      const startAtMs = Date.now() + 250;
      const commandFor = (title: string) =>
        new Deno.Command(Deno.execPath(), {
          args: [
            "eval",
            `import { ragStore } from ${JSON.stringify(moduleUrl)};` +
            `while (Date.now() < ${startAtMs}) await new Promise((resolve) => setTimeout(resolve, 5));` +
            `await ragStore({backend:"local-json",model:"local/test-model",storagePath:${
              JSON.stringify(storagePath)
            }}).ingest(${JSON.stringify(title)},${JSON.stringify(`${title} content`)});`,
          ],
          cwd: Deno.cwd(),
          stdout: "piped",
          stderr: "piped",
        });

      const [first, second] = await Promise.all([
        commandFor("First process").output(),
        commandFor("Second process").output(),
      ]);
      assertEquals(new TextDecoder().decode(first.stderr), "");
      assertEquals(new TextDecoder().decode(second.stderr), "");
      assertEquals(first.success, true);
      assertEquals(second.success, true);

      const persisted = JSON.parse(await readTextFile(storagePath)) as {
        documents: Array<{ title: string }>;
      };
      assertEquals(persisted.documents.map((document) => document.title).sort(), [
        "First process",
        "Second process",
      ]);
    });
  });

  it("recovers an expired adjacent store lock before reading", async () => {
    await withTempDir(async (tempDir) => {
      const storagePath = join(tempDir, "data", "index.json");
      const lockDirectory = `${storagePath}.veryfront-rag.lock`;
      const token = crypto.randomUUID();
      await Deno.mkdir(lockDirectory, { recursive: true });
      await Deno.writeTextFile(
        join(lockDirectory, "owner.json"),
        `${JSON.stringify({ token, createdAtMs: 1 })}\n`,
      );
      const leasePath = join(lockDirectory, `${token}.lease`);
      await Deno.writeTextFile(leasePath, "1\n");
      await Deno.utime(leasePath, new Date(0), new Date(0));
      await Deno.writeTextFile(storagePath, JSON.stringify({ documents: [], chunks: [] }));

      const store = ragStore({ model: "local/test-model", storagePath });
      assertEquals(await store.listDocuments(), []);
      assertEquals(await exists(lockDirectory), false);
      assertEquals(await exists(`${lockDirectory}.recovering`), false);
    });
  });

  it("recovers a missing lease from immutable owner age without refreshing directory time", async () => {
    await withTempDir(async (tempDir) => {
      const storagePath = join(tempDir, "data", "index.json");
      const lockDirectory = `${storagePath}.veryfront-rag.lock`;
      const token = crypto.randomUUID();
      await Deno.mkdir(lockDirectory, { recursive: true });
      await Deno.writeTextFile(
        join(lockDirectory, "owner.json"),
        `${JSON.stringify({ token, createdAtMs: 1 })}\n`,
      );
      const now = new Date();
      await Deno.utime(lockDirectory, now, now);
      await Deno.writeTextFile(storagePath, JSON.stringify({ documents: [], chunks: [] }));

      const store = ragStore({ model: "local/test-model", storagePath });
      assertEquals(await store.listDocuments(), []);
      assertEquals(await exists(lockDirectory), false);
      assertEquals(await exists(`${lockDirectory}.recovering`), false);
    });
  });

  it("does not fence a fresh lease when owner metadata cannot be trusted", async () => {
    const ownerCases = [
      { name: "malformed JSON", bytes: new TextEncoder().encode("{") },
      { name: "invalid UTF-8", bytes: new Uint8Array([0xff]) },
      { name: "oversized metadata", bytes: new Uint8Array(4_097).fill(0x61) },
    ];
    for (const ownerCase of ownerCases) {
      await withTempDir(async (tempDir) => {
        const storagePath = join(tempDir, ownerCase.name.replaceAll(" ", "-"), "index.json");
        const lockDirectory = `${storagePath}.veryfront-rag.lock`;
        const leasePath = join(lockDirectory, `${crypto.randomUUID()}.lease`);
        await Deno.mkdir(lockDirectory, { recursive: true });
        await Deno.writeFile(join(lockDirectory, "owner.json"), ownerCase.bytes);
        await Deno.writeTextFile(leasePath, "live\n");
        await Deno.writeTextFile(storagePath, JSON.stringify({ documents: [], chunks: [] }));
        await Deno.utime(lockDirectory, new Date(0), new Date(0));
        const freshTime = new Date();
        await Deno.utime(leasePath, freshTime, freshTime);

        let settled = false;
        const pendingDocuments = ragStore({
          model: "local/test-model",
          storagePath,
        }).listDocuments().finally(() => {
          settled = true;
        });

        await new Promise((resolvePromise) => setTimeout(resolvePromise, 150));
        const liveLeaseWasPreserved = await exists(lockDirectory) &&
          await exists(leasePath) &&
          !await exists(`${lockDirectory}.recovering`) &&
          !settled;

        // Let the pending contender recover naturally after proving that the
        // fresh lease, rather than the old directory mtime, governed staleness.
        await Deno.utime(leasePath, new Date(0), new Date(0));
        assertEquals(await pendingDocuments, []);
        assertEquals(liveLeaseWasPreserved, true, ownerCase.name);
        assertEquals(await exists(lockDirectory), false);
        assertEquals(await exists(`${lockDirectory}.recovering`), false);
      });
    }
  });

  it("rejects a stale update when the live index changes before publication", async () => {
    await withTempDir(async (tempDir) => {
      const storagePath = join(tempDir, "data", "index.json");
      await Deno.mkdir(join(tempDir, "data"), { recursive: true });
      const original = JSON.stringify({ documents: [], chunks: [] });
      const external = JSON.stringify({
        documents: [{
          id: "external",
          title: "External",
          source: "external",
          type: "txt",
          createdAt: 1,
        }],
        chunks: [],
      });
      await Deno.writeTextFile(storagePath, original);
      const store = ragStore({ model: "local/test-model", storagePath });
      const writeDescriptor = Object.getOwnPropertyDescriptor(Deno, "writeTextFile");
      assert(writeDescriptor !== undefined);
      const originalWrite = Deno.writeTextFile.bind(Deno);
      Object.defineProperty(Deno, "writeTextFile", {
        ...writeDescriptor,
        value: async (path: string | URL, data: string, options?: Deno.WriteFileOptions) => {
          await originalWrite(path, data, options);
          if (String(path).includes(".tmp.")) await originalWrite(storagePath, external);
        },
      });

      try {
        const error = await assertRejects(
          () => store.ingest("Stale", "must not overwrite"),
          VeryfrontError,
          "changed while an update was in progress",
        );
        assert(error instanceof VeryfrontError);
        assertEquals(error.slug, "rag-store-unavailable");
      } finally {
        Object.defineProperty(Deno, "writeTextFile", writeDescriptor);
      }

      assertEquals(await readTextFile(storagePath), external);
      const entries = await Array.fromAsync(Deno.readDir(join(tempDir, "data")));
      assertEquals(entries.map((entry) => entry.name), ["index.json"]);
    });
  });

  it("compares exact snapshot bytes before publication", async () => {
    await withTempDir(async (tempDir) => {
      const storagePath = join(tempDir, "data", "index.json");
      await Deno.mkdir(join(tempDir, "data"), { recursive: true });
      const original = JSON.stringify({ documents: [], chunks: [] });
      const originalBytes = new TextEncoder().encode(original);
      const externalBytes = new Uint8Array(originalBytes.byteLength + 3);
      externalBytes.set([0xef, 0xbb, 0xbf]);
      externalBytes.set(originalBytes, 3);
      await Deno.writeFile(storagePath, originalBytes);
      const store = ragStore({ model: "local/test-model", storagePath });
      const writeDescriptor = Object.getOwnPropertyDescriptor(Deno, "writeTextFile");
      assert(writeDescriptor !== undefined);
      const originalWrite = Deno.writeTextFile.bind(Deno);
      Object.defineProperty(Deno, "writeTextFile", {
        ...writeDescriptor,
        value: async (path: string | URL, data: string, options?: Deno.WriteFileOptions) => {
          await originalWrite(path, data, options);
          if (String(path).includes(".tmp.")) await Deno.writeFile(storagePath, externalBytes);
        },
      });

      try {
        const error = await assertRejects(
          () => store.ingest("Stale bytes", "must not overwrite"),
          VeryfrontError,
          "changed while an update was in progress",
        );
        assert(error instanceof VeryfrontError);
        assertEquals(error.slug, "rag-store-unavailable");
      } finally {
        Object.defineProperty(Deno, "writeTextFile", writeDescriptor);
      }

      assertEquals(await Deno.readFile(storagePath), externalBytes);
    });
  });

  it("fences a writer that loses its adjacent lock before publication", async () => {
    await withTempDir(async (tempDir) => {
      const storagePath = join(tempDir, "data", "index.json");
      const lockDirectory = `${storagePath}.veryfront-rag.lock`;
      await Deno.mkdir(join(tempDir, "data"), { recursive: true });
      const original = JSON.stringify({ documents: [], chunks: [] });
      await Deno.writeTextFile(storagePath, original);
      const store = ragStore({ model: "local/test-model", storagePath });
      const writeDescriptor = Object.getOwnPropertyDescriptor(Deno, "writeTextFile");
      assert(writeDescriptor !== undefined);
      const originalWrite = Deno.writeTextFile.bind(Deno);
      Object.defineProperty(Deno, "writeTextFile", {
        ...writeDescriptor,
        value: async (path: string | URL, data: string, options?: Deno.WriteFileOptions) => {
          await originalWrite(path, data, options);
          if (!String(path).includes(".tmp.")) return;
          await Deno.remove(lockDirectory, { recursive: true });
          await Deno.mkdir(lockDirectory);
          const replacementToken = crypto.randomUUID();
          await originalWrite(
            join(lockDirectory, "owner.json"),
            `${JSON.stringify({ token: replacementToken, createdAtMs: Date.now() })}\n`,
          );
          await originalWrite(join(lockDirectory, `${replacementToken}.lease`), "replacement\n");
        },
      });

      try {
        const error = await assertRejects(
          () => store.ingest("Fenced", "must not overwrite"),
          VeryfrontError,
          "could not be completed safely",
        );
        assert(error instanceof VeryfrontError);
        assertEquals(error.slug, "rag-store-unavailable");
      } finally {
        Object.defineProperty(Deno, "writeTextFile", writeDescriptor);
      }

      assertEquals(await readTextFile(storagePath), original);
      const entries = await Array.fromAsync(Deno.readDir(join(tempDir, "data")));
      assertEquals(
        entries.map((entry) => entry.name).filter((name) => name.includes(".tmp.")),
        [],
      );
    });
  });

  it("cannot publish after losing the lease in the final check-to-rename gap", async () => {
    await withTempDir(async (tempDir) => {
      const storagePath = join(tempDir, "data", "index.json");
      const lockDirectory = `${storagePath}.veryfront-rag.lock`;
      await Deno.mkdir(join(tempDir, "data"), { recursive: true });
      const original = JSON.stringify({ documents: [], chunks: [] });
      await Deno.writeTextFile(storagePath, original);
      const store = ragStore({ model: "local/test-model", storagePath });
      const renameDescriptor = Object.getOwnPropertyDescriptor(Deno, "rename");
      assert(renameDescriptor !== undefined);
      const originalRename = Deno.rename.bind(Deno);
      Object.defineProperty(Deno, "rename", {
        ...renameDescriptor,
        value: async (from: string | URL, to: string | URL) => {
          if (String(from).includes(".tmp.") && String(to) === storagePath) {
            await Deno.remove(lockDirectory, { recursive: true });
            await Deno.mkdir(lockDirectory);
            const replacementToken = crypto.randomUUID();
            await Deno.writeTextFile(
              join(lockDirectory, "owner.json"),
              `${JSON.stringify({ token: replacementToken, createdAtMs: Date.now() })}\n`,
            );
            await Deno.writeTextFile(
              join(lockDirectory, `${replacementToken}.lease`),
              "replacement\n",
            );
          }
          await originalRename(from, to);
        },
      });

      try {
        const error = await assertRejects(
          () => store.ingest("Fenced at rename", "must not overwrite"),
          VeryfrontError,
          "could not be completed safely",
        );
        assert(error instanceof VeryfrontError);
        assertEquals(error.slug, "rag-store-unavailable");
        assertEquals(error.message.includes(storagePath), false);
      } finally {
        Object.defineProperty(Deno, "rename", renameDescriptor);
      }

      assertEquals(await readTextFile(storagePath), original);
    });
  });

  it("does not delete replacement ownership created in the release gap", async () => {
    await withTempDir(async (tempDir) => {
      const storagePath = join(tempDir, "data", "index.json");
      const lockDirectory = `${storagePath}.veryfront-rag.lock`;
      await Deno.mkdir(join(tempDir, "data"), { recursive: true });
      await Deno.writeTextFile(storagePath, JSON.stringify({ documents: [], chunks: [] }));
      const store = ragStore({ model: "local/test-model", storagePath });
      const removeDescriptor = Object.getOwnPropertyDescriptor(Deno, "remove");
      assert(removeDescriptor !== undefined);
      const originalRemove = Deno.remove.bind(Deno);
      const replacementToken = crypto.randomUUID();
      const replacementOwner = `${
        JSON.stringify({
          token: replacementToken,
          createdAtMs: Date.now(),
        })
      }\n`;
      let replacementInjected = false;
      let recursiveLockCleanupAttempted = false;
      Object.defineProperty(Deno, "remove", {
        ...removeDescriptor,
        value: async (path: string | URL, options?: Deno.RemoveOptions) => {
          const candidate = String(path);
          if (candidate.startsWith(lockDirectory) && options?.recursive === true) {
            recursiveLockCleanupAttempted = true;
          }
          const generationMarkerWindow = candidate.startsWith(
            join(lockDirectory, ".owner.releasing."),
          );
          if (!replacementInjected && generationMarkerWindow) {
            await originalRemove(lockDirectory, { recursive: true });
            await Deno.mkdir(lockDirectory);
            await Deno.writeTextFile(
              join(lockDirectory, "owner.json"),
              replacementOwner,
            );
            await Deno.writeTextFile(
              join(lockDirectory, `${replacementToken}.lease`),
              "replacement\n",
            );
            replacementInjected = true;
          }
          await originalRemove(path, options);
        },
      });

      try {
        assertEquals(await store.listDocuments(), []);
      } finally {
        Object.defineProperty(Deno, "remove", removeDescriptor);
      }

      assertEquals(replacementInjected, true);
      assertEquals(recursiveLockCleanupAttempted, false);
      assertEquals(await readTextFile(join(lockDirectory, "owner.json")), replacementOwner);
    });
  });

  it("refreshes an existing local document while preserving its id", async () => {
    registerTestEmbeddingProvider();

    await withTempDir(async (tempDir) => {
      const storagePath = join(tempDir, "data", "index.json");
      const store = ragStore({
        model: "test/demo",
        storagePath,
      });
      const id = await store.ingest("Deck", "Old slide text", {
        source: "upload:deck.pptx",
        type: "pptx",
      });

      await store.search("old");
      const embedded = JSON.parse(await readTextFile(storagePath)) as {
        chunks: Array<{ embedding: number[] }>;
      };
      assertEquals(embedded.chunks[0]?.embedding.length, 1536);

      const refresh = store.refreshDocument;
      assert(refresh);
      await refresh(id, "# New Slide Title\n\nNew body text", {
        title: "Deck Updated",
        source: "upload:deck-updated.pptx",
        type: "pptx",
      });

      const refreshed = JSON.parse(await readTextFile(storagePath)) as {
        documents: Array<
          { id: string; title: string; source: string; type: string; createdAt: number }
        >;
        chunks: Array<{ documentId: string; text: string; embedding: number[]; index: number }>;
      };
      assertEquals(refreshed.documents.length, 1);
      assertEquals(refreshed.documents[0]?.id, id);
      assertEquals(refreshed.documents[0]?.title, "Deck Updated");
      assertEquals(refreshed.documents[0]?.source, "upload:deck-updated.pptx");
      assertEquals(refreshed.documents[0]?.type, "pptx");
      assertEquals(typeof refreshed.documents[0]?.createdAt, "number");
      assertEquals(refreshed.chunks.length, 1);
      assertEquals(refreshed.chunks[0]?.documentId, id);
      assertEquals(refreshed.chunks[0]?.text, "# New Slide Title\n\nNew body text");
      assertEquals(refreshed.chunks[0]?.embedding, []);
      assertEquals(refreshed.chunks[0]?.index, 0);
    });
  });

  it("ranks local chunks by cosine similarity and honors topK and threshold", async () => {
    // Vectors are keyed off marker substrings so the query ("lookup") stays
    // distinct from the documents while leaning toward the alpha document.
    registerEmbeddingProvider("ranking", () =>
      ({
        specificationVersion: "v2",
        provider: "ranking",
        modelId: "test",
        maxEmbeddingsPerCall: undefined,
        supportsParallelCalls: true,
        async doEmbed({ values }: { values: string[] }) {
          return {
            embeddings: values.map((value) => {
              const vector = new Array<number>(1536).fill(0);
              const normalized = value.toLowerCase();
              const [first, second] = normalized.includes("lookup")
                ? [1, 0]
                : normalized.includes("alpha")
                ? [1, 0.2]
                : [0.2, 1];
              vector[1] = first;
              vector[2] = second;
              return vector;
            }),
            usage: { tokens: 0 },
            rawResponse: undefined,
            warnings: [],
          };
        },
      }) as never);

    await withTempDir(async (tempDir) => {
      const storagePath = join(tempDir, "data", "index.json");
      const store = ragStore({ model: "ranking/test", storagePath });

      const alphaId = await store.ingest("Alpha Doc", "Alpha body text", {
        source: "upload:alpha.txt",
        type: "txt",
      });
      const betaId = await store.ingest("Beta Doc", "Beta body text", {
        source: "upload:beta.txt",
        type: "txt",
      });

      const ranked = await store.search("alpha lookup", { topK: 2 });
      assertEquals(
        ranked.map((result) => result.documentId),
        [alphaId, betaId],
        "the higher-scoring chunk must sort first",
      );
      assertEquals(
        ranked.map((result) => result.title),
        ["Alpha Doc", "Beta Doc"],
        "the document title must be joined onto each result",
      );

      const topOne = await store.search("alpha lookup", { topK: 1 });
      assertEquals(topOne.length, 1, "topK must slice the ranked list");
      assertEquals(
        topOne[0]?.documentId,
        alphaId,
        "the single retained result must be the highest-scoring chunk",
      );

      assertEquals(
        await store.search("alpha lookup", { threshold: 0.99 }),
        [],
        "a threshold above the best score must filter every chunk out",
      );
    });
  });

  it("returns empty results for whitespace-only local queries", async () => {
    await withTempDir(async (tempDir) => {
      const storagePath = join(tempDir, "data", "index.json");
      const store = ragStore({
        model: "local/test-model",
        storagePath,
      });

      await store.ingest("Doc", "Hello world", {
        source: "upload:test.txt",
        type: "txt",
      });

      const results = await store.search("   ");
      assertEquals(results, []);
    });
  });

  it("does not hold the local store lock while embedding the search query", async () => {
    let releaseQueryEmbedding!: () => void;
    let signalQueryEmbedding!: () => void;
    const queryEmbeddingStarted = new Promise<void>((resolve) => {
      signalQueryEmbedding = resolve;
    });
    const queryEmbeddingReleased = new Promise<void>((resolve) => {
      releaseQueryEmbedding = resolve;
    });
    registerEmbeddingProvider("slow-query", () =>
      ({
        specificationVersion: "v2",
        provider: "slow-query",
        modelId: "test",
        maxEmbeddingsPerCall: undefined,
        supportsParallelCalls: true,
        async doEmbed({ values }: { values: string[] }) {
          if (values.length === 1 && values[0] === "needle") {
            signalQueryEmbedding();
            await queryEmbeddingReleased;
          }
          return {
            embeddings: values.map((value) => {
              const vector = new Array<number>(1536).fill(0);
              vector[0] = value.length;
              return vector;
            }),
            usage: { tokens: 0 },
            rawResponse: undefined,
            warnings: [],
          };
        },
      }) as never);

    await withTempDir(async (tempDir) => {
      const storagePath = join(tempDir, "data", "index.json");
      const store = ragStore({ model: "slow-query/test", storagePath });
      await store.ingest("Doc", "Hello world");
      await store.search("warm");

      const searchPromise = store.search("needle");
      await queryEmbeddingStarted;
      const listDocumentsPromise = store.listDocuments();
      let blockedTimer: ReturnType<typeof setTimeout> | undefined;
      let observedDocuments: Awaited<ReturnType<typeof store.listDocuments>> | "blocked";
      try {
        observedDocuments = await Promise.race([
          listDocumentsPromise,
          new Promise<"blocked">((resolve) => {
            blockedTimer = setTimeout(() => resolve("blocked"), 5_000);
          }),
        ]);
      } finally {
        if (blockedTimer !== undefined) clearTimeout(blockedTimer);
        releaseQueryEmbedding();
      }
      let settleTimer: ReturnType<typeof setTimeout> | undefined;
      const documents = await Promise.race([
        listDocumentsPromise,
        new Promise<never>((_, reject) => {
          settleTimer = setTimeout(
            () => reject(new Error("listDocuments did not settle after query embedding release")),
            5_000,
          );
        }),
      ]).finally(() => {
        if (settleTimer !== undefined) clearTimeout(settleTimer);
      });
      await searchPromise;

      assert(Array.isArray(observedDocuments));
      assertEquals(observedDocuments, documents);
      assertEquals(documents.length, 1);
      assertEquals(documents[0]?.title, "Doc");
    });
  });

  it("fails safely when embedding persistence repeatedly loses the store race", async () => {
    await withTempDir(async (tempDir) => {
      const storagePath = join(tempDir, "data", "index.json");
      let embeddingAttempts = 0;
      registerEmbeddingProvider("contended-persist", () =>
        ({
          specificationVersion: "v2",
          provider: "contended-persist",
          modelId: "test",
          maxEmbeddingsPerCall: undefined,
          supportsParallelCalls: true,
          async doEmbed({ values }: { values: string[] }) {
            if (values.length > 1 || values[0] !== "query") {
              embeddingAttempts++;
              if (embeddingAttempts > 2) {
                throw new Error("embedding persistence was retried after exhaustion");
              }
              await Deno.writeTextFile(
                storagePath,
                JSON.stringify({
                  documents: [{
                    id: "doc",
                    title: `External ${embeddingAttempts}`,
                    source: "external",
                    type: "txt",
                    createdAt: embeddingAttempts,
                  }],
                  chunks: [{
                    id: "chunk",
                    documentId: "doc",
                    text: "searchable content",
                    embedding: [],
                    index: 0,
                  }],
                }),
              );
            }
            return {
              embeddings: values.map((value) => {
                const vector = new Array<number>(1536).fill(0);
                vector[0] = value.length;
                return vector;
              }),
              usage: { tokens: 0 },
              rawResponse: undefined,
              warnings: [],
            };
          },
        }) as never);
      const store = ragStore({ model: "contended-persist/test", storagePath });
      await store.ingest("Doc", "searchable content");

      const error = await assertRejects(
        () => store.search("query"),
        VeryfrontError,
        "changed repeatedly while embeddings were persisted",
      );
      assert(error instanceof VeryfrontError);
      assertEquals(error.slug, "rag-store-unavailable");
      assertEquals(embeddingAttempts, 2);
    });
  });

  it("does not report stored-chunk embedding provider failures as storage failures", async () => {
    await withTempDir(async (tempDir) => {
      registerEmbeddingProvider("failing-doc-embed", () =>
        ({
          specificationVersion: "v2",
          provider: "failing-doc-embed",
          modelId: "test",
          maxEmbeddingsPerCall: undefined,
          supportsParallelCalls: true,
          async doEmbed() {
            throw new Error("embedding provider timed out");
          },
        }) as never);

      const store = ragStore({
        model: "failing-doc-embed/test",
        storagePath: join(tempDir, "data", "index.json"),
      });
      await store.ingest("Doc", "searchable content");

      const error = await assertRejects(
        () => store.search("query"),
        Error,
        "embedding provider timed out",
      );
      assert(error instanceof Error);
      assertEquals(
        error instanceof VeryfrontError && error.slug === "rag-store-unavailable",
        false,
      );
      assertEquals(error.message.includes("Check storage and retry"), false);
    });
  });

  it("does not report query embedding provider failures as storage failures", async () => {
    await withTempDir(async (tempDir) => {
      registerEmbeddingProvider("failing-query-embed", () =>
        ({
          specificationVersion: "v2",
          provider: "failing-query-embed",
          modelId: "test",
          maxEmbeddingsPerCall: undefined,
          supportsParallelCalls: true,
          async doEmbed({ values }: { values: string[] }) {
            if (values.length === 1 && values[0] === "query") {
              throw new Error("embedding provider rate limited");
            }
            return {
              embeddings: values.map((value) => {
                const vector = new Array<number>(1536).fill(0);
                vector[0] = value.length;
                return vector;
              }),
              usage: { tokens: 0 },
              rawResponse: undefined,
              warnings: [],
            };
          },
        }) as never);

      const store = ragStore({
        model: "failing-query-embed/test",
        storagePath: join(tempDir, "data", "index.json"),
      });
      await store.ingest("Doc", "searchable content");

      const error = await assertRejects(
        () => store.search("query"),
        Error,
        "embedding provider rate limited",
      );
      assert(error instanceof Error);
      assertEquals(
        error instanceof VeryfrontError && error.slug === "rag-store-unavailable",
        false,
      );
      assertEquals(error.message.includes("Check storage and retry"), false);
    });
  });

  it("reuses parsed local store data across searches until storage changes", async () => {
    registerTestEmbeddingProvider();

    await withTempDir(async (tempDir) => {
      const storagePath = join(tempDir, "data", "index.json");
      const store = ragStore({
        model: "test/demo",
        storagePath,
      });

      await store.ingest("Doc", "Hello world", {
        source: "upload:test.txt",
        type: "txt",
      });

      let parseCalls = 0;
      const originalParse = JSON.parse;
      JSON.parse = ((text, reviver) => {
        if (text.includes('"documents"') && text.includes('"chunks"')) parseCalls++;
        return originalParse(text, reviver);
      }) as typeof JSON.parse;

      try {
        await store.search("hello");
        await store.search("hello");

        assertEquals(
          parseCalls <= 1,
          true,
          `Expected repeated searches to parse the store at most once, got ${parseCalls}`,
        );

        parseCalls = 0;
        const previousInfo = await Deno.stat(storagePath);
        const previousPayload = await readTextFile(storagePath);
        const externalPayload = previousPayload.replace('"title":"Doc"', '"title":"Alt"');
        assertEquals(externalPayload.length, previousPayload.length);
        await new Promise((resolve) => setTimeout(resolve, 5));
        await Deno.writeTextFile(storagePath, externalPayload);
        if (previousInfo.mtime !== null) {
          await Deno.utime(
            storagePath,
            previousInfo.atime ?? previousInfo.mtime,
            previousInfo.mtime,
          );
        }

        const documents = await store.listDocuments();
        assertEquals(documents.map((document) => document.title), ["Alt"]);
        assertEquals(parseCalls, 1);
      } finally {
        JSON.parse = originalParse;
      }
    });
  });

  it("migrates legacy upload-store data from data/index.json", async () => {
    await withTempDir(async (tempDir) => {
      const storagePath = join(tempDir, "data", "index.json");
      await Deno.mkdir(join(tempDir, "data"), { recursive: true });
      await Deno.writeTextFile(
        storagePath,
        JSON.stringify({
          uploads: [{
            id: "upload-1",
            title: "Legacy Doc",
            source: "upload:legacy.txt",
            type: "txt",
            createdAt: 1,
          }],
          chunks: [{
            id: "chunk-1",
            uploadId: "upload-1",
            text: "legacy content",
            embedding: [],
            index: 0,
          }],
        }),
      );

      const store = ragStore({
        model: "local/test-model",
        storagePath,
      });

      const documents = await store.listDocuments();
      assertEquals(documents, [{
        id: "upload-1",
        title: "Legacy Doc",
        source: "upload:legacy.txt",
        type: "txt",
        createdAt: 1,
      }]);
    });
  });

  it("fails closed without overwriting invalid document entries", async () => {
    await withTempDir(async (tempDir) => {
      const storagePath = join(tempDir, "data", "index.json");
      await Deno.mkdir(join(tempDir, "data"), { recursive: true });
      const original = JSON.stringify({
        documents: [{
          id: 123,
          title: "Invalid Doc",
          source: "upload:invalid.txt",
          type: "txt",
          createdAt: 1,
        }],
        chunks: [],
      });
      await Deno.writeTextFile(storagePath, original);

      const store = ragStore({
        model: "local/test-model",
        storagePath,
      });

      await assertRejects(
        () => store.listDocuments(),
        Error,
        "failed validation",
      );
      await assertRejects(
        () => store.ingest("Replacement", "must not overwrite"),
        Error,
        "failed validation",
      );
      assertEquals(await readTextFile(storagePath), original);
    });
  });

  it("fails closed without overwriting invalid chunk entries", async () => {
    await withTempDir(async (tempDir) => {
      const storagePath = join(tempDir, "data", "index.json");
      await Deno.mkdir(join(tempDir, "data"), { recursive: true });
      const original = JSON.stringify({
        documents: [{
          id: "doc-1",
          title: "Valid Doc",
          source: "upload:valid.txt",
          type: "txt",
          createdAt: 1,
        }],
        chunks: [{
          id: "chunk-1",
          documentId: "doc-1",
          text: "content",
          embedding: ["not-a-number"],
          index: 0,
        }],
      });
      await Deno.writeTextFile(storagePath, original);

      const store = ragStore({
        model: "local/test-model",
        storagePath,
      });

      await assertRejects(
        () => store.listDocuments(),
        Error,
        "failed validation",
      );
      assertEquals(await readTextFile(storagePath), original);
    });
  });

  it("fails closed on duplicate document identities before a mutation can discard chunks", async () => {
    await withTempDir(async (tempDir) => {
      const storagePath = join(tempDir, "data", "index.json");
      await Deno.mkdir(join(tempDir, "data"), { recursive: true });
      const original = JSON.stringify({
        documents: [
          { id: "duplicate", title: "First", source: "first", type: "txt", createdAt: 1 },
          { id: "duplicate", title: "Second", source: "second", type: "txt", createdAt: 2 },
        ],
        chunks: [
          {
            id: "chunk-first",
            documentId: "duplicate",
            text: "first",
            embedding: [],
            index: 0,
          },
          {
            id: "chunk-second",
            documentId: "duplicate",
            text: "second",
            embedding: [],
            index: 1,
          },
        ],
      });
      await Deno.writeTextFile(storagePath, original);
      const store = ragStore({ model: "local/test-model", storagePath });

      await assertRejects(
        () => store.refreshDocument!("duplicate", "replacement"),
        VeryfrontError,
        "failed validation",
      );
      assertEquals(await readTextFile(storagePath), original);
    });
  });

  it("fails closed on chunks that do not belong to a persisted document", async () => {
    await withTempDir(async (tempDir) => {
      const storagePath = join(tempDir, "data", "index.json");
      await Deno.mkdir(join(tempDir, "data"), { recursive: true });
      const original = JSON.stringify({
        documents: [],
        chunks: [{
          id: "orphan",
          documentId: "missing",
          text: "orphaned content",
          embedding: [],
          index: 0,
        }],
      });
      await Deno.writeTextFile(storagePath, original);
      const store = ragStore({ model: "local/test-model", storagePath });

      await assertRejects(
        () => store.removeDocument("missing"),
        VeryfrontError,
        "failed validation",
      );
      assertEquals(await readTextFile(storagePath), original);
    });
  });

  it("fails closed without overwriting malformed JSON", async () => {
    await withTempDir(async (tempDir) => {
      const storagePath = join(tempDir, "data", "index.json");
      await Deno.mkdir(join(tempDir, "data"), { recursive: true });
      const original = '{"documents":[';
      await Deno.writeTextFile(storagePath, original);

      const store = ragStore({
        model: "local/test-model",
        storagePath,
      });

      const error = await assertRejects(
        () => store.listDocuments(),
        VeryfrontError,
        "malformed JSON",
      );
      assert(error instanceof VeryfrontError);
      assertEquals(error.slug, "rag-store-corrupt");
      assertEquals(error.message.includes(storagePath), false);
      assertEquals(error.context, { storagePath });
      await assertRejects(
        () => store.removeDocument("anything"),
        Error,
        "malformed JSON",
      );
      assertEquals(await readTextFile(storagePath), original);
    });
  });

  it("fails closed on invalid UTF-8 without replacing persisted bytes", async () => {
    await withTempDir(async (tempDir) => {
      const storagePath = join(tempDir, "data", "index.json");
      await Deno.mkdir(join(tempDir, "data"), { recursive: true });
      const original = new Uint8Array([0xff, 0xfe, 0xfd]);
      await Deno.writeFile(storagePath, original);
      const store = ragStore({ model: "local/test-model", storagePath });

      const error = await assertRejects(
        () => store.listDocuments(),
        VeryfrontError,
        "not valid UTF-8",
      );
      assert(error instanceof VeryfrontError);
      assertEquals(error.slug, "rag-store-corrupt");
      assertEquals(error.message.includes(storagePath), false);
      assertEquals(await Deno.readFile(storagePath), original);
    });
  });

  it("rejects an oversized index before allocating or parsing its contents", async () => {
    await withTempDir(async (tempDir) => {
      const storagePath = join(tempDir, "data", "index.json");
      await Deno.mkdir(join(tempDir, "data"), { recursive: true });
      const oversizedBytes = 64 * 1024 * 1024 + 1;
      await Deno.writeFile(storagePath, new Uint8Array([0x7b]));
      await Deno.truncate(storagePath, oversizedBytes);
      const store = ragStore({ model: "local/test-model", storagePath });

      const error = await assertRejects(
        () => store.listDocuments(),
        VeryfrontError,
        "file exceeds size limit",
      );
      assert(error instanceof VeryfrontError);
      assertEquals(error.slug, "rag-store-corrupt");
      assertEquals(error.message.includes(storagePath), false);
      assertEquals((await Deno.stat(storagePath)).size, oversizedBytes);
    });
  });

  it("rejects a directory store path without deleting matching sibling temps", async () => {
    await withTempDir(async (tempDir) => {
      const storagePath = join(tempDir, "index.json");
      const siblingTemp = `${storagePath}.tmp.${crypto.randomUUID()}`;
      await Deno.mkdir(storagePath);
      await Deno.writeTextFile(siblingTemp, "unrelated sibling bytes");
      const store = ragStore({
        model: "local/test-model",
        storagePath,
      });

      const error = await assertRejects(
        () => store.listDocuments(),
        VeryfrontError,
        "must be a regular file or be absent",
      );

      assert(error instanceof VeryfrontError);
      assertEquals(error.slug, "rag-store-unavailable");
      assertEquals(error.message.includes(storagePath), false);
      assertEquals(error.context, { storagePath });
      assertEquals(await readTextFile(siblingTemp), "unrelated sibling bytes");
    });
  });

  it("auto-upgrades to the veryfront-cloud backend when cloud bootstrap is present", async () => {
    setEnv("VERYFRONT_API_TOKEN", "vf_test_cloud");
    setEnv("VERYFRONT_PROJECT_SLUG", "cloud-project");
    registerTestEmbeddingProvider();

    const fileChunks = new Map<
      string,
      Array<{
        id: string;
        index: number;
        content: string;
        metadata?: Record<string, unknown>;
      }>
    >();
    const ragDocuments = new Map<string, {
      id: string;
      title: string;
      source: string;
      type: string;
      created_at: string;
      metadata?: Record<string, unknown>;
    }>();
    const embeddingVectors = new Map<string, number[]>();
    const authHeaders: Array<string | null> = [];
    const postContentTypes: Array<string | null> = [];

    await withMockFetch(
      async (input: string | URL | Request, init?: RequestInit) => {
        const request = input instanceof Request ? input : new Request(input, init);
        const url = new URL(request.url);
        const path = url.pathname;
        authHeaders.push(request.headers.get("authorization"));
        if (request.method === "POST") {
          postContentTypes.push(request.headers.get("content-type"));
        }

        const fileMatch = path.match(/^\/projects\/[^/]+\/branches\/[^/]+\/files\/(.+)\/chunks$/);
        const filePath = fileMatch ? decodeURIComponent(fileMatch[1]!) : null;

        // RAG document management routes
        const ragDocMatch = path.match(/^\/projects\/[^/]+\/rag\/documents(?:\/(.+))?$/);
        if (ragDocMatch !== null) {
          const docId = ragDocMatch[1] ? decodeURIComponent(ragDocMatch[1]) : null;

          if (request.method === "GET" && !docId) {
            return Response.json({
              documents: [...ragDocuments.values()],
            });
          }

          if (request.method === "POST" && !docId) {
            const body = await request.json() as {
              id: string;
              title: string;
              source: string;
              type: string;
              metadata?: Record<string, unknown>;
            };
            ragDocuments.set(body.id, {
              ...body,
              created_at: new Date().toISOString(),
            });
            return Response.json({ id: body.id });
          }

          if (request.method === "DELETE" && docId) {
            ragDocuments.delete(docId);
            return Response.json({ deleted: 1 });
          }
        }

        if (request.method === "GET" && filePath) {
          const chunks = fileChunks.get(filePath);
          if (!chunks) {
            return new Response("Not found", { status: 404 });
          }
          return Response.json({
            data: chunks,
            page_info: { next: null },
          });
        }

        if (request.method === "DELETE" && filePath) {
          fileChunks.delete(filePath);
          return Response.json({ deleted: 1 });
        }

        if (request.method === "POST" && filePath) {
          const body = await request.json() as {
            chunks: Array<{
              chunk_index: number;
              content: string;
              metadata?: Record<string, unknown>;
            }>;
          };
          const stored = body.chunks.map((chunk) => ({
            id: `${filePath}:${chunk.chunk_index}`,
            index: chunk.chunk_index,
            content: chunk.content,
            metadata: chunk.metadata,
          }));
          fileChunks.set(filePath, stored);

          return Response.json({
            chunks: stored.map(({ id, index }) => ({ id, index })),
            created: stored.length,
            updated: 0,
          });
        }

        if (request.method === "POST" && path.endsWith("/embeddings")) {
          const body = await request.json() as {
            chunk_ids: string[];
            vectors: number[][];
          };
          body.chunk_ids.forEach((chunkId, index) => {
            embeddingVectors.set(chunkId, body.vectors[index]!);
          });

          return Response.json({
            embeddings: body.chunk_ids.map((chunkId) => ({
              id: `embedding:${chunkId}`,
              model: "test/demo",
              status: "ready",
              created_at: new Date().toISOString(),
            })),
            created: body.chunk_ids.length,
            updated: 0,
          });
        }

        if (request.method === "POST" && path.endsWith("/search")) {
          const manifestChunks = fileChunks.get(".veryfront/rag/manifest.json") ?? [];
          const documentFilePath = [...fileChunks.keys()].find((key) =>
            key.startsWith(".veryfront/rag/documents/")
          );
          const documentChunks = documentFilePath ? (fileChunks.get(documentFilePath) ?? []) : [];

          return Response.json({
            data: [
              ...manifestChunks.map((chunk) => ({
                chunk: {
                  file_path: ".veryfront/rag/manifest.json",
                  content: chunk.content,
                  metadata: chunk.metadata,
                },
                score: 0.99,
              })),
              ...documentChunks.map((chunk) => ({
                chunk: {
                  file_path: documentFilePath,
                  content: chunk.content,
                  metadata: chunk.metadata,
                },
                score: 0.91,
              })),
            ],
          });
        }

        return new Response(`Unhandled ${request.method} ${path}`, { status: 404 });
      },
      async () => {
        const store = ragStore({
          model: "test/demo",
        });

        const id = await store.ingest("Cloud Doc", "Hello cloud world", {
          source: "upload:cloud.txt",
          type: "txt",
        });

        const documents = await store.listDocuments();
        assertEquals(documents.length, 1);
        assertEquals(documents[0]?.id, id);

        const results = await store.search("cloud", { topK: 1 });
        assertEquals(results.length, 1);
        assertEquals(results[0]?.documentId, id);
        assertEquals(results[0]?.title, "Cloud Doc");

        assertEquals(embeddingVectors.size > 0, true);
        assertEquals(authHeaders.some((header) => header === "Bearer vf_test_cloud"), true);
        assertEquals(
          postContentTypes.every((contentType) => contentType === "application/json"),
          true,
        );

        await store.removeDocument(id);
        assertEquals(await store.listDocuments(), []);
      },
    );
  });

  it("refreshes cloud document chunks and embeddings under the existing id", async () => {
    setEnv("VERYFRONT_API_TOKEN", "vf_test_cloud");
    setEnv("VERYFRONT_PROJECT_SLUG", "cloud-project");
    registerTestEmbeddingProvider();

    const fileChunks = new Map<
      string,
      Array<{
        id: string;
        index: number;
        content: string;
        metadata?: Record<string, unknown>;
      }>
    >([
      [
        ".veryfront/rag/documents/doc-pptx.pptx",
        [{
          id: "old-chunk",
          index: 0,
          content: "Old flat PPTX content",
          metadata: {
            kind: "rag-document",
            document_id: "doc-pptx",
            title: "Old Deck",
            source: "upload:old.pptx",
            type: "pptx",
          },
        }],
      ],
    ]);
    const ragDocuments = new Map<string, {
      id: string;
      title: string;
      source: string;
      type: string;
      created_at: string;
      updated_at: string;
      metadata?: Record<string, unknown>;
    }>([
      [
        "doc-pptx",
        {
          id: "doc-pptx",
          title: "Old Deck",
          source: "upload:old.pptx",
          type: "pptx",
          created_at: "2026-06-25T00:00:00.000Z",
          updated_at: "2026-06-25T00:00:00.000Z",
          metadata: { filePath: ".veryfront/rag/documents/doc-pptx.pptx" },
        },
      ],
    ]);
    const embeddingVectors = new Map<string, number[]>();
    const deletedFilePaths: string[] = [];

    await withMockFetch(
      async (input: string | URL | Request, init?: RequestInit) => {
        const request = input instanceof Request ? input : new Request(input, init);
        const url = new URL(request.url);
        const path = url.pathname;

        const ragDocMatch = path.match(/^\/projects\/[^/]+\/rag\/documents(?:\/(.+))?$/);
        if (ragDocMatch !== null) {
          const docId = ragDocMatch[1] ? decodeURIComponent(ragDocMatch[1]) : null;

          if (request.method === "GET" && !docId) {
            return Response.json({
              documents: [...ragDocuments.values()],
            });
          }

          if (request.method === "POST" && !docId) {
            const body = await request.json() as {
              id: string;
              title: string;
              source: string;
              type: string;
              metadata?: Record<string, unknown>;
            };
            ragDocuments.set(body.id, {
              ...body,
              created_at: ragDocuments.get(body.id)?.created_at ??
                "2026-06-25T00:00:00.000Z",
              updated_at: "2026-06-25T01:00:00.000Z",
            });
            return Response.json({ document: ragDocuments.get(body.id) });
          }
        }

        const fileMatch = path.match(/^\/projects\/[^/]+\/branches\/[^/]+\/files\/(.+)\/chunks$/);
        const filePath = fileMatch ? decodeURIComponent(fileMatch[1]!) : null;

        if (request.method === "DELETE" && filePath) {
          deletedFilePaths.push(filePath);
          fileChunks.delete(filePath);
          return Response.json({ deleted: 1 });
        }

        if (request.method === "POST" && filePath) {
          const body = await request.json() as {
            chunks: Array<{
              chunk_index: number;
              content: string;
              metadata?: Record<string, unknown>;
            }>;
          };
          const stored = body.chunks.map((chunk) => ({
            id: `${filePath}:${chunk.chunk_index}`,
            index: chunk.chunk_index,
            content: chunk.content,
            metadata: chunk.metadata,
          }));
          fileChunks.set(filePath, stored);

          return Response.json({
            chunks: stored.map(({ id, index }) => ({ id, index })),
            created: stored.length,
            updated: 0,
          });
        }

        if (request.method === "POST" && path.endsWith("/embeddings")) {
          const body = await request.json() as {
            chunk_ids: string[];
            vectors: number[][];
          };
          body.chunk_ids.forEach((chunkId, index) => {
            embeddingVectors.set(chunkId, body.vectors[index]!);
          });

          return Response.json({
            embeddings: body.chunk_ids.map((chunkId) => ({
              id: `embedding:${chunkId}`,
              model: "test/demo",
              status: "ready",
              created_at: new Date().toISOString(),
            })),
            created: body.chunk_ids.length,
            updated: 0,
          });
        }

        return new Response(`Unhandled ${request.method} ${path}`, { status: 404 });
      },
      async () => {
        const store = ragStore({
          model: "test/demo",
        });

        const refresh = store.refreshDocument;
        assert(refresh);
        await refresh("doc-pptx", "# Better Deck\n\nBody text", {
          title: "Better Deck",
          source: "upload:better.pptx",
          type: "pptx",
        });

        assertEquals(deletedFilePaths, [".veryfront/rag/documents/doc-pptx.pptx"]);
        const refreshedDocument = [...ragDocuments.values()][0];
        const refreshedFilePath = refreshedDocument?.metadata?.filePath;
        assertEquals(typeof refreshedFilePath, "string");
        assertEquals(
          (refreshedFilePath as string).startsWith(
            ".veryfront/rag/documents/doc-pptx.refresh-",
          ),
          true,
        );
        assertEquals((refreshedFilePath as string).endsWith(".pptx"), true);
        assertEquals(refreshedDocument, {
          id: "doc-pptx",
          title: "Better Deck",
          source: "upload:better.pptx",
          type: "pptx",
          created_at: "2026-06-25T00:00:00.000Z",
          updated_at: "2026-06-25T01:00:00.000Z",
          metadata: { filePath: refreshedFilePath },
        });
        const chunks = fileChunks.get(refreshedFilePath as string) ?? [];
        assertEquals(chunks.length, 1);
        assertEquals(chunks[0]?.content, "# Better Deck\n\nBody text");
        assertEquals(chunks[0]?.metadata, {
          kind: "rag-document",
          document_id: "doc-pptx",
          title: "Better Deck",
          source: "upload:better.pptx",
          type: "pptx",
        });
        assertEquals(embeddingVectors.size, 1);

        const listedDocuments = await store.listDocuments() as unknown as Array<
          Record<string, unknown>
        >;
        assertEquals("filePath" in listedDocuments[0]!, false);
      },
    );
  });

  it("keeps old cloud chunks when refresh replacement embedding persistence fails", async () => {
    setEnv("VERYFRONT_API_TOKEN", "vf_test_cloud");
    setEnv("VERYFRONT_PROJECT_SLUG", "cloud-project");
    registerTestEmbeddingProvider();

    const fileChunks = new Map<
      string,
      Array<{ id: string; index: number; content: string; metadata?: Record<string, unknown> }>
    >([
      [
        ".veryfront/rag/documents/doc-pptx.pptx",
        [{
          id: "old-chunk",
          index: 0,
          content: "Old flat PPTX content",
          metadata: {
            kind: "rag-document",
            document_id: "doc-pptx",
            title: "Old Deck",
            source: "upload:old.pptx",
            type: "pptx",
          },
        }],
      ],
    ]);
    const ragDocuments = new Map<string, {
      id: string;
      title: string;
      source: string;
      type: string;
      created_at: string;
      updated_at: string;
      metadata?: Record<string, unknown>;
    }>([
      [
        "doc-pptx",
        {
          id: "doc-pptx",
          title: "Old Deck",
          source: "upload:old.pptx",
          type: "pptx",
          created_at: "2026-06-25T00:00:00.000Z",
          updated_at: "2026-06-25T00:00:00.000Z",
          metadata: { filePath: ".veryfront/rag/documents/doc-pptx.pptx" },
        },
      ],
    ]);
    const deletedFilePaths: string[] = [];

    await withMockFetch(
      async (input: string | URL | Request, init?: RequestInit) => {
        const request = input instanceof Request ? input : new Request(input, init);
        const url = new URL(request.url);
        const path = url.pathname;

        const ragDocMatch = path.match(/^\/projects\/[^/]+\/rag\/documents(?:\/(.+))?$/);
        if (ragDocMatch !== null && request.method === "GET" && !ragDocMatch[1]) {
          return Response.json({ documents: [...ragDocuments.values()] });
        }

        const fileMatch = path.match(/^\/projects\/[^/]+\/branches\/[^/]+\/files\/(.+)\/chunks$/);
        const filePath = fileMatch ? decodeURIComponent(fileMatch[1]!) : null;

        if (request.method === "DELETE" && filePath) {
          deletedFilePaths.push(filePath);
          fileChunks.delete(filePath);
          return Response.json({ deleted: 1 });
        }

        if (request.method === "POST" && filePath) {
          const body = await request.json() as {
            chunks: Array<{
              chunk_index: number;
              content: string;
              metadata?: Record<string, unknown>;
            }>;
          };
          const stored = body.chunks.map((chunk) => ({
            id: `${filePath}:${chunk.chunk_index}`,
            index: chunk.chunk_index,
            content: chunk.content,
            metadata: chunk.metadata,
          }));
          fileChunks.set(filePath, stored);
          return Response.json({
            chunks: stored.map(({ id, index }) => ({ id, index })),
            created: stored.length,
            updated: 0,
          });
        }

        if (request.method === "POST" && path.endsWith("/embeddings")) {
          return new Response("embedding write failed", { status: 500 });
        }

        return new Response(`Unhandled ${request.method} ${path}`, { status: 404 });
      },
      async () => {
        const store = ragStore({ model: "test/demo" });
        const refresh = store.refreshDocument;
        assert(refresh);

        await assertRejects(
          () => refresh("doc-pptx", "# Better Deck\n\nBody text"),
          Error,
          "embedding write failed",
        );

        assertEquals(deletedFilePaths.includes(".veryfront/rag/documents/doc-pptx.pptx"), false);
        assertEquals(
          fileChunks.get(".veryfront/rag/documents/doc-pptx.pptx")?.[0]?.content,
          "Old flat PPTX content",
        );
        assertEquals(ragDocuments.get("doc-pptx")?.title, "Old Deck");
      },
    );
  });

  it("returns empty results for whitespace-only cloud queries without making requests", async () => {
    setEnv("VERYFRONT_API_TOKEN", "vf_test_cloud");
    setEnv("VERYFRONT_PROJECT_SLUG", "cloud-project");

    let fetchCalls = 0;

    await withMockFetch(
      async () => {
        fetchCalls++;
        throw new Error("fetch should not run for whitespace-only queries");
      },
      async () => {
        const store = ragStore({
          model: "test/demo",
        });

        const results = await store.search("   ");
        assertEquals(results, []);
        assertEquals(fetchCalls, 0);
      },
    );
  });

  it("resolves cloud backend from request-scoped credentials at call time", async () => {
    registerTestEmbeddingProvider();

    const urls: string[] = [];
    const fileChunks = new Map<string, Array<{ id: string; index: number; content: string }>>();

    await withMockFetch(
      async (input: string | URL | Request, init?: RequestInit) => {
        const request = input instanceof Request ? input : new Request(input, init);
        const url = new URL(request.url);
        urls.push(url.toString());

        const fileMatch = url.pathname.match(
          /^\/projects\/([^/]+)\/branches\/([^/]+)\/files\/(.+)\/chunks$/,
        );
        const filePath = fileMatch ? decodeURIComponent(fileMatch[3] ?? "") : null;

        if (request.method === "GET" && filePath) {
          const chunks = fileChunks.get(filePath);
          if (!chunks) return new Response("Not found", { status: 404 });
          return Response.json({ data: chunks, page_info: { next: null } });
        }

        if (request.method === "POST" && filePath) {
          const body = await request.json() as {
            chunks: Array<{ chunk_index: number; content: string }>;
          };
          const stored = body.chunks.map((chunk) => ({
            id: `${filePath}:${chunk.chunk_index}`,
            index: chunk.chunk_index,
            content: chunk.content,
          }));
          fileChunks.set(filePath, stored);
          return Response.json({
            chunks: stored.map(({ id, index }) => ({ id, index })),
            created: stored.length,
            updated: 0,
          });
        }

        if (request.method === "POST" && url.pathname.endsWith("/embeddings")) {
          return Response.json({
            embeddings: [{ id: "embedding-1", model: "test/demo", status: "ready" }],
            created: 1,
            updated: 0,
          });
        }

        // RAG document management
        if (url.pathname.match(/\/rag\/documents(\/|$)/)) {
          if (request.method === "POST") {
            const body = await request.json() as { id: string };
            return Response.json({ id: body.id });
          }
          return Response.json({ documents: [] });
        }

        throw new Error(`Unhandled ${request.method} ${url.pathname}`);
      },
      async () => {
        const store = ragStore({
          model: "test/demo",
        });

        await runWithRequestContext(
          {
            projectSlug: "request-project",
            token: "vf_request_token",
          },
          async () => {
            await store.ingest("Scoped Doc", "request scoped content", {
              source: "upload:scoped.txt",
              type: "txt",
            });
          },
        );

        // All requests should target the request-scoped project, not any env-based slug
        assertEquals(
          urls.every((u) => u.includes("/projects/request-project/")),
          true,
          `Expected all URLs to target request-project, got: ${urls[0]}`,
        );
      },
    );
  });

  it("indexes contentDir from published release files in request context", async () => {
    registerTestEmbeddingProvider();

    const ragDocuments = new Map<string, {
      id: string;
      title: string;
      source: string;
      type: string;
      created_at: string;
      updated_at: string;
      metadata?: Record<string, unknown>;
    }>();
    const fileChunks = new Map<
      string,
      Array<{
        id: string;
        index: number;
        content: string;
        metadata?: Record<string, unknown>;
      }>
    >();
    const requestedPaths: string[] = [];

    await withMockFetch(
      async (input: string | URL | Request, init?: RequestInit) => {
        const request = input instanceof Request ? input : new Request(input, init);
        const url = new URL(request.url);
        requestedPaths.push(url.pathname);

        if (
          request.method === "GET" &&
          url.pathname === "/projects/cloud-project/releases/rel-abc/files"
        ) {
          return Response.json({
            data: [
              {
                id: "file-login",
                version_id: "version-login",
                path: "knowledge/login-troubleshooting.md",
                content: "# Login troubleshooting\n\nEscalate blocked SSO login issues.",
                size: 62,
                type: "file",
                updated_at: "2026-06-25T00:00:00.000Z",
                release_id: "rel-abc",
                release_version: "0.0.1",
              },
            ],
            page_info: { next: null },
            release_id: "rel-abc",
            release_version: "0.0.1",
          });
        }

        const ragDocMatch = url.pathname.match(/^\/projects\/[^/]+\/rag\/documents(?:\/(.+))?$/);
        if (ragDocMatch !== null) {
          const docId = ragDocMatch[1] ? decodeURIComponent(ragDocMatch[1]) : null;

          if (request.method === "GET" && !docId) {
            return Response.json({ documents: [...ragDocuments.values()] });
          }

          if (request.method === "POST" && !docId) {
            const body = await request.json() as {
              id: string;
              title: string;
              source: string;
              type: string;
              metadata?: Record<string, unknown>;
            };
            ragDocuments.set(body.id, {
              ...body,
              created_at: "2026-06-25T00:00:00.000Z",
              updated_at: "2026-06-25T00:00:00.000Z",
            });
            return Response.json({ document: ragDocuments.get(body.id) });
          }
        }

        const fileMatch = url.pathname.match(
          /^\/projects\/[^/]+\/branches\/[^/]+\/files\/(.+)\/chunks$/,
        );
        const filePath = fileMatch ? decodeURIComponent(fileMatch[1] ?? "") : null;

        if (request.method === "POST" && filePath) {
          const body = await request.json() as {
            chunks: Array<{
              chunk_index: number;
              content: string;
              metadata?: Record<string, unknown>;
            }>;
          };
          const stored = body.chunks.map((chunk) => ({
            id: `${filePath}:${chunk.chunk_index}`,
            index: chunk.chunk_index,
            content: chunk.content,
            metadata: chunk.metadata,
          }));
          fileChunks.set(filePath, stored);
          return Response.json({
            chunks: stored.map(({ id, index }) => ({ id, index })),
          });
        }

        if (request.method === "POST" && url.pathname.endsWith("/embeddings")) {
          return Response.json({
            embeddings: [{ id: "embedding-1", model: "test/demo", status: "ready" }],
          });
        }

        throw new Error(`Unhandled ${request.method} ${url.pathname}`);
      },
      async () => {
        const store = ragStore({
          contentDir: "knowledge",
          model: "test/demo",
        });

        await runWithRequestContext(
          {
            projectSlug: "cloud-project",
            token: "vf_request_token",
            productionMode: true,
            releaseId: "rel-abc",
          },
          () => store.indexContentDir(),
        );

        const documents = [...ragDocuments.values()];
        assertEquals(documents.length, 1);
        assertEquals(documents[0]?.title, "login-troubleshooting");
        assertEquals(documents[0]?.source, "knowledge/login-troubleshooting.md");
        assertEquals(fileChunks.size, 1);
        assertEquals(
          requestedPaths.includes("/projects/cloud-project/releases/rel-abc/files"),
          true,
        );
      },
    );
  });

  it("respects VERYFRONT_RAG_BACKEND=local-json as an override", async () => {
    setEnv("VERYFRONT_API_TOKEN", "vf_test_cloud");
    setEnv("VERYFRONT_PROJECT_SLUG", "cloud-project");
    setEnv("VERYFRONT_RAG_BACKEND", "local-json");

    await withTempDir(async (tempDir) => {
      const storagePath = join(tempDir, "data", "index.json");
      const store = ragStore({
        model: "local/test-model",
        storagePath,
      });

      const id = await store.ingest("Local Doc", "Hello local override", {
        source: "upload:local.txt",
        type: "txt",
      });

      const documents = await store.listDocuments();
      assertEquals(documents.length, 1);
      assertEquals(documents[0]?.id, id);
      assertEquals(await exists(storagePath), true);
    });
  });
});
