import "#veryfront/schemas/_test-setup.ts";
import { join } from "#veryfront/compat/path/index.ts";
import { createFileSystem } from "#veryfront/platform/compat/fs.ts";
import { assertEquals, assertRejects } from "#veryfront/testing/assert.ts";
import { afterEach, describe, it } from "#veryfront/testing/bdd.ts";
import {
  buildTransformedModuleSlotPath,
  buildTransformedModuleSpecifier,
  TransformedModuleCoordinator,
  type TransformedModuleFileStore,
} from "./transformed-module-coordinator.ts";

const HASH_A = "a".repeat(64);
const HASH_B = "b".repeat(64);
const OWNER_A = "a".repeat(32);
const OWNER_B = "b".repeat(32);
const OWNER_ID_PATTERN_FOR_TEST = /^[a-f0-9]{32}$/;

function deferred(): {
  promise: Promise<void>;
  resolve: () => void;
} {
  let resolve!: () => void;
  const promise = new Promise<void>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

class MemoryModuleStore implements TransformedModuleFileStore {
  readonly files = new Map<string, Uint8Array>();
  readonly directories = new Set<string>(["/"]);
  readonly mtimes = new Map<string, Date>([["/", new Date(0)]]);
  now = Date.now();
  createCalls = 0;
  readCalls = 0;
  artifactReadCalls = 0;

  #touch(path: string): void {
    this.mtimes.set(path, new Date(this.now));
  }

  async mkdir(path: string, options?: { recursive?: boolean }): Promise<void> {
    if (this.directories.has(path) || this.files.has(path)) {
      if (options?.recursive === true && this.directories.has(path)) return;
      throw new Deno.errors.AlreadyExists("already exists");
    }
    if (options?.recursive === true) {
      const segments = path.split("/").filter(Boolean);
      let current = "";
      for (const segment of segments) {
        current += `/${segment}`;
        this.directories.add(current);
        this.#touch(current);
      }
      return;
    }
    const parent = path.slice(0, path.lastIndexOf("/")) || "/";
    if (!this.directories.has(parent)) throw new Deno.errors.NotFound("missing parent");
    this.directories.add(path);
    this.#touch(path);
  }

  async *readDir(path: string) {
    if (!this.directories.has(path)) throw new Deno.errors.NotFound("missing directory");
    const prefix = path === "/" ? "/" : `${path}/`;
    const entries = new Map<string, { isFile: boolean; isDirectory: boolean }>();
    for (const directory of this.directories) {
      if (!directory.startsWith(prefix)) continue;
      const name = directory.slice(prefix.length).split("/")[0];
      if (name) entries.set(name, { isFile: false, isDirectory: true });
    }
    for (const file of this.files.keys()) {
      if (!file.startsWith(prefix)) continue;
      const name = file.slice(prefix.length).split("/")[0];
      if (name && !entries.has(name)) {
        entries.set(name, { isFile: true, isDirectory: false });
      }
    }
    for (const [name, type] of entries) yield { name, ...type, isSymlink: false };
  }

  async createFileBytesExclusive(path: string, content: Uint8Array): Promise<void> {
    this.createCalls++;
    if (this.files.has(path)) throw new Deno.errors.AlreadyExists("already materialized");
    const parent = path.slice(0, path.lastIndexOf("/")) || "/";
    if (!this.directories.has(parent)) throw new Deno.errors.NotFound("missing parent");
    this.files.set(path, content.slice());
    this.#touch(path);
  }

  async writeFile(path: string, content: Uint8Array): Promise<void> {
    const parent = path.slice(0, path.lastIndexOf("/")) || "/";
    if (!this.directories.has(parent)) throw new Deno.errors.NotFound("missing parent");
    this.files.set(path, content.slice());
    this.#touch(path);
  }

  readFileBytesWithinLimit(path: string, byteLimit: number): Promise<Uint8Array> {
    this.readCalls++;
    if (path.includes(".vf-slot-")) this.artifactReadCalls++;
    const content = this.files.get(path);
    if (!content) return Promise.reject(new Deno.errors.NotFound("missing"));
    if (content.byteLength > byteLimit) {
      return Promise.reject(new RangeError("existing module exceeds limit"));
    }
    return Promise.resolve(content.slice());
  }

  async rename(from: string, to: string): Promise<void> {
    const content = this.files.get(from);
    if (!content) throw new Deno.errors.NotFound("missing source");
    if (this.files.has(to) || this.directories.has(to)) {
      throw new Deno.errors.AlreadyExists("target exists");
    }
    this.files.delete(from);
    this.files.set(to, content);
    this.mtimes.delete(from);
    this.#touch(to);
  }

  stat(path: string): Promise<{
    size: number;
    isFile: boolean;
    isDirectory: boolean;
    mtime: Date;
  }> {
    const file = this.files.get(path);
    if (file) {
      return Promise.resolve({
        size: file.byteLength,
        isFile: true,
        isDirectory: false,
        mtime: this.mtimes.get(path) ?? new Date(this.now),
      });
    }
    if (this.directories.has(path)) {
      return Promise.resolve({
        size: 0,
        isFile: false,
        isDirectory: true,
        mtime: this.mtimes.get(path) ?? new Date(this.now),
      });
    }
    return Promise.reject(new Deno.errors.NotFound("missing"));
  }

  async remove(path: string, options?: { recursive?: boolean }): Promise<void> {
    if (this.files.delete(path)) {
      this.mtimes.delete(path);
      return;
    }
    if (!this.directories.has(path)) throw new Deno.errors.NotFound("missing");
    const prefix = `${path}/`;
    const hasChildren = [...this.directories].some((entry) => entry.startsWith(prefix)) ||
      [...this.files.keys()].some((entry) => entry.startsWith(prefix));
    if (hasChildren && options?.recursive !== true) {
      throw new Error("directory not empty");
    }
    for (const file of this.files.keys()) {
      if (file.startsWith(prefix)) {
        this.files.delete(file);
        this.mtimes.delete(file);
      }
    }
    for (const directory of this.directories) {
      if (directory === path || directory.startsWith(prefix)) {
        this.directories.delete(directory);
        this.mtimes.delete(directory);
      }
    }
  }
}

function artifactPaths(store: MemoryModuleStore): string[] {
  return [...store.files.keys()].filter((path) => path.includes(".vf-slot-"));
}

function claimPaths(store: MemoryModuleStore): string[] {
  return [...store.files.keys()].filter((path) => path.includes("/claims/"));
}

const activeCoordinators = new Set<TransformedModuleCoordinator>();

function trackCoordinator(
  ...args: ConstructorParameters<typeof TransformedModuleCoordinator>
): TransformedModuleCoordinator {
  const coordinator = new TransformedModuleCoordinator(...args);
  activeCoordinators.add(coordinator);
  return coordinator;
}

describe("modules/react-loader/transformed-module-coordinator", () => {
  afterEach(async () => {
    await Promise.all([...activeCoordinators].map((coordinator) => coordinator.dispose()));
    activeCoordinators.clear();
  });
  it("uses an immutable content-addressed sibling slot path", () => {
    const path = buildTransformedModuleSlotPath(
      "/cache/project/components/Widget.js",
      3,
      HASH_A,
    );
    assertEquals(
      path,
      `/cache/project/components/Widget.vf-slot-3.${HASH_A}.js`,
    );
    assertEquals(
      buildTransformedModuleSlotPath(
        "/cache/project/components/Widget.js",
        3,
        HASH_B,
      ) === path,
      false,
    );
  });

  it("encodes special path characters in the import URL", () => {
    const versionedPath = buildTransformedModuleSlotPath(
      "/cache/my project/note#1?/Widget.js",
      0,
      HASH_A,
    );
    const url = new URL(buildTransformedModuleSpecifier(versionedPath, 0));

    assertEquals(decodeURIComponent(url.pathname), versionedPath);
    assertEquals(url.hash, "");
    assertEquals(url.search, "");
  });

  it("does not let a non-settling old version block a new content version", async () => {
    const firstImportEntered = deferred();
    const releaseFirstImport = deferred();
    const store = new MemoryModuleStore();
    const coordinator = trackCoordinator(
      store,
      async (specifier) => {
        if (specifier.includes(HASH_A)) {
          firstImportEntered.resolve();
          await releaseFirstImport.promise;
        }
        return { specifier };
      },
      { maxArtifacts: 2 },
    );

    const first = coordinator.importTransformedModule(
      "/cache/project/Component.js",
      "code-a",
      HASH_A,
      "/cache/project",
    );
    await firstImportEntered.promise;

    try {
      const second = await coordinator.importTransformedModule(
        "/cache/project/Component.js",
        "code-b",
        HASH_B,
        "/cache/project",
      );
      assertEquals(String(second.specifier).includes(HASH_B), true);
    } finally {
      releaseFirstImport.resolve();
      await first;
    }
  });

  it("recycles the oldest pending evaluation when every bounded slot is pending", async () => {
    const enteredA = deferred();
    const enteredB = deferred();
    const releaseA = deferred();
    const releaseB = deferred();
    const store = new MemoryModuleStore();
    const coordinator = trackCoordinator(
      store,
      async (specifier) => {
        if (specifier.includes(HASH_A)) {
          enteredA.resolve();
          await releaseA.promise;
        } else if (specifier.includes(HASH_B)) {
          enteredB.resolve();
          await releaseB.promise;
        }
        return { specifier };
      },
      { maxArtifacts: 2 },
    );

    const first = coordinator.importTransformedModule(
      "/cache/project/Component.js",
      "code-a",
      HASH_A,
      "/cache/project",
    );
    await enteredA.promise;
    const second = coordinator.importTransformedModule(
      "/cache/project/Component.js",
      "code-b",
      HASH_B,
      "/cache/project",
    );
    await enteredB.promise;

    const third = await coordinator.importTransformedModule(
      "/cache/project/Component.js",
      "code-c",
      "c".repeat(64),
      "/cache/project",
    );
    assertEquals(String(third.specifier).includes("c".repeat(64)), true);
    assertEquals(artifactPaths(store).length, 2);

    releaseA.resolve();
    releaseB.resolve();
    await assertRejects(() => first, Error, "superseded");
    await second;
  });

  it("uses a fresh specifier when unchanged content is retried after rejection", async () => {
    const store = new MemoryModuleStore();
    const specifiers: string[] = [];
    const coordinator = trackCoordinator(
      store,
      (specifier) => {
        specifiers.push(specifier);
        return specifiers.length === 1
          ? Promise.reject(new Error("synthetic import failure"))
          : Promise.resolve({ ok: true });
      },
      { maxArtifacts: 2 },
    );

    await assertRejects(
      () =>
        coordinator.importTransformedModule(
          "/cache/project/Component.js",
          "unchanged",
          HASH_A,
          "/cache/project",
        ),
      Error,
      "synthetic import failure",
    );
    assertEquals(
      await coordinator.importTransformedModule(
        "/cache/project/Component.js",
        "unchanged",
        HASH_A,
        "/cache/project",
      ),
      { ok: true },
    );

    assertEquals(specifiers.length, 2);
    assertEquals(new URL(specifiers[0]!).pathname, new URL(specifiers[1]!).pathname);
    assertEquals(new URL(specifiers[0]!).search, "");
    assertEquals(new URL(specifiers[1]!).searchParams.get("retry"), "1");
  });

  it("does not let settled import rejections permanently consume the cap", async () => {
    const store = new MemoryModuleStore();
    const coordinator = trackCoordinator(
      store,
      (specifier) => {
        if (specifier.includes(HASH_A) || specifier.includes(HASH_B)) {
          return Promise.reject(new Error("synthetic module rejection"));
        }
        return Promise.resolve({ specifier });
      },
      { maxArtifacts: 2 },
    );

    for (const [code, hash] of [["code-a", HASH_A], ["code-b", HASH_B]] as const) {
      await assertRejects(
        () =>
          coordinator.importTransformedModule(
            "/cache/project/Component.js",
            code,
            hash,
            "/cache/project",
          ),
        Error,
        "synthetic module rejection",
      );
    }

    const corrected = await coordinator.importTransformedModule(
      "/cache/project/Component.js",
      "code-c",
      "c".repeat(64),
      "/cache/project",
    );
    assertEquals(String(corrected.specifier).includes("c".repeat(64)), true);
    assertEquals(artifactPaths(store).length, 2);
  });

  it("shares only the materialization and removes its pending-map entry afterward", async () => {
    const createEntered = deferred();
    const releaseCreate = deferred();
    const store = new MemoryModuleStore();
    const originalCreate = store.createFileBytesExclusive.bind(store);
    let temporaryCreateCalls = 0;
    store.createFileBytesExclusive = async (path, content) => {
      if (path.endsWith("/module.tmp")) {
        createEntered.resolve();
        await releaseCreate.promise;
        temporaryCreateCalls++;
      }
      await originalCreate(path, content);
    };
    const coordinator = trackCoordinator(
      store,
      (specifier) => Promise.resolve({ specifier }),
      { maxArtifacts: 2 },
    );

    const first = coordinator.importTransformedModule(
      "/cache/project/Component.js",
      "unchanged",
      HASH_A,
      "/cache/project",
    );
    await createEntered.promise;
    const second = coordinator.importTransformedModule(
      "/cache/project/Component.js",
      "unchanged",
      HASH_A,
      "/cache/project",
    );
    await Promise.resolve();
    assertEquals(temporaryCreateCalls, 0);

    releaseCreate.resolve();
    await Promise.all([first, second]);
    assertEquals(temporaryCreateCalls, 1);

    await coordinator.importTransformedModule(
      "/cache/project/Component.js",
      "unchanged",
      HASH_A,
      "/cache/project",
    );
    assertEquals(temporaryCreateCalls, 1);
    assertEquals(store.artifactReadCalls, 1);
  });

  it("fails closed without exclusive materialization authority", async () => {
    const coordinator = trackCoordinator(
      {
        remove: () => Promise.resolve(),
      },
      () => Promise.resolve({}),
      { maxArtifacts: 2 },
    );

    await assertRejects(
      () =>
        coordinator.importTransformedModule(
          "/cache/project/Component.js",
          "source",
          HASH_A,
          "/cache/project",
        ),
      TypeError,
      "require exclusive file creation",
    );
  });

  it("refuses existing content that does not match the addressed source", async () => {
    const store = new MemoryModuleStore();
    const firstCoordinator = trackCoordinator(
      store,
      () => Promise.resolve({}),
      { maxArtifacts: 2 },
    );
    await firstCoordinator.importTransformedModule(
      "/cache/project/Component.js",
      "xxxxxx",
      HASH_A,
      "/cache/project",
    );
    const coordinator = trackCoordinator(
      store,
      () => Promise.resolve({}),
      { maxArtifacts: 2 },
    );

    await assertRejects(
      () =>
        coordinator.importTransformedModule(
          "/cache/project/Component.js",
          "source",
          HASH_A,
          "/cache/project",
        ),
      Error,
      "does not match its digest",
    );
  });

  it("removes a partial exclusive-create failure before retrying", async () => {
    const store = new MemoryModuleStore();
    const originalCreate = store.createFileBytesExclusive.bind(store);
    let failFirstCreate = true;
    store.createFileBytesExclusive = async (path, content) => {
      if (failFirstCreate && path.endsWith("/module.tmp")) {
        failFirstCreate = false;
        store.files.set(path, content.subarray(0, 1).slice());
        throw new Error("synthetic partial write");
      }
      await originalCreate(path, content);
    };
    const coordinator = trackCoordinator(
      store,
      () => Promise.resolve({ ok: true }),
      { maxArtifacts: 2 },
    );

    await assertRejects(
      () =>
        coordinator.importTransformedModule(
          "/cache/project/Component.js",
          "source",
          HASH_A,
          "/cache/project",
        ),
      Error,
      "synthetic partial write",
    );
    assertEquals(artifactPaths(store).length, 0);
    assertEquals(
      await coordinator.importTransformedModule(
        "/cache/project/Component.js",
        "source",
        HASH_A,
        "/cache/project",
      ),
      { ok: true },
    );
  });

  it("removes its unique lock ticket after an acquisition read fails", async () => {
    const store = new MemoryModuleStore();
    const originalReadDir = store.readDir.bind(store);
    let failIntentRead = true;
    store.readDir = async function* (path: string) {
      if (failIntentRead && path.endsWith("/locks/intents")) {
        failIntentRead = false;
        throw new Error("synthetic lock read failure");
      }
      yield* originalReadDir(path);
    };
    const coordinator = trackCoordinator(
      store,
      () => Promise.resolve({ ok: true }),
      { maxArtifacts: 2, lockPollIntervalMs: 1, lockPollAttempts: 2 },
    );

    await assertRejects(
      () =>
        coordinator.importTransformedModule(
          "/cache/project/Component.js",
          "source",
          HASH_A,
          "/cache/project",
        ),
      Error,
      "synthetic lock read failure",
    );
    assertEquals(
      [...store.files.keys()].filter((path) => path.includes("/locks/tickets/")).length,
      0,
    );
    assertEquals(
      await coordinator.importTransformedModule(
        "/cache/project/Component.js",
        "source",
        HASH_A,
        "/cache/project",
      ),
      { ok: true },
    );
  });

  it("removes a partial generation pin before retrying", async () => {
    const store = new MemoryModuleStore();
    const originalCreate = store.createFileBytesExclusive.bind(store);
    let failFirstPin = true;
    store.createFileBytesExclusive = async (path, content) => {
      if (failFirstPin && path.includes("/pins/")) {
        failFirstPin = false;
        store.files.set(path, content.subarray(0, 1).slice());
        throw new Error("synthetic partial pin write");
      }
      await originalCreate(path, content);
    };
    const coordinator = trackCoordinator(
      store,
      () => Promise.resolve({ ok: true }),
      { maxArtifacts: 2 },
    );

    await assertRejects(
      () =>
        coordinator.importTransformedModule(
          "/cache/project/Component.js",
          "source",
          HASH_A,
          "/cache/project",
        ),
      Error,
      "synthetic partial pin write",
    );
    assertEquals(
      await coordinator.importTransformedModule(
        "/cache/project/Component.js",
        "source",
        HASH_A,
        "/cache/project",
      ),
      { ok: true },
    );
    assertEquals(claimPaths(store).length, 1);
    assertEquals(artifactPaths(store).length, 1);
  });

  it("removes its pin before rolling back a post-publication cleanup failure", async () => {
    const store = new MemoryModuleStore();
    const originalRemove = store.remove.bind(store);
    let failReservationCleanup = true;
    store.remove = (path, options) => {
      if (
        failReservationCleanup &&
        path.includes("/reservations/") &&
        options?.recursive === true &&
        OWNER_ID_PATTERN_FOR_TEST.test(path.split("/").at(-1) ?? "")
      ) {
        failReservationCleanup = false;
        return Promise.reject(new Error("synthetic reservation cleanup failure"));
      }
      return originalRemove(path, options);
    };
    const coordinator = trackCoordinator(
      store,
      () => Promise.resolve({ ok: true }),
      { maxArtifacts: 2 },
    );

    await assertRejects(
      () =>
        coordinator.importTransformedModule(
          "/cache/project/Component.js",
          "source",
          HASH_A,
          "/cache/project",
        ),
      Error,
      "synthetic reservation cleanup failure",
    );
    assertEquals(
      await coordinator.importTransformedModule(
        "/cache/project/Component.js",
        "source",
        HASH_A,
        "/cache/project",
      ),
      { ok: true },
    );
    assertEquals(claimPaths(store).length, 1);
    assertEquals(artifactPaths(store).length, 1);
  });

  it("removes an unpublished reservation after an atomic-rename failure", async () => {
    const store = new MemoryModuleStore();
    const originalRename = store.rename.bind(store);
    let failFirstRename = true;
    store.rename = (from, to) => {
      if (failFirstRename) {
        failFirstRename = false;
        return Promise.reject(new Error("synthetic rename failure"));
      }
      return originalRename(from, to);
    };
    const coordinator = trackCoordinator(
      store,
      () => Promise.resolve({ ok: true }),
      { maxArtifacts: 2 },
    );

    await assertRejects(
      () =>
        coordinator.importTransformedModule(
          "/cache/project/Component.js",
          "source",
          HASH_A,
          "/cache/project",
        ),
      Error,
      "synthetic rename failure",
    );
    assertEquals(artifactPaths(store).length, 0);
    assertEquals(
      await coordinator.importTransformedModule(
        "/cache/project/Component.js",
        "source",
        HASH_A,
        "/cache/project",
      ),
      { ok: true },
    );
  });

  it("reuses one persistent artifact across coordinator lifecycles", async () => {
    const store = new MemoryModuleStore();
    const importer = (specifier: string) => Promise.resolve({ specifier });
    const firstLifecycle = trackCoordinator(store, importer, {
      maxArtifacts: 2,
    });
    const restartedLifecycle = trackCoordinator(store, importer, {
      maxArtifacts: 2,
    });

    await firstLifecycle.importTransformedModule(
      "/cache/project/Component.js",
      "unchanged",
      HASH_A,
      "/cache/project",
    );
    await restartedLifecycle.importTransformedModule(
      "/cache/project/Component.js",
      "unchanged",
      HASH_A,
      "/cache/project",
    );

    assertEquals(artifactPaths(store).length, 1);
  });

  it("waits for an in-flight heartbeat before removing its owner lease", async () => {
    const heartbeatEntered = deferred();
    const releaseHeartbeat = deferred();
    const store = new MemoryModuleStore();
    const originalWrite = store.writeFile.bind(store);
    const order: string[] = [];
    let heartbeatWrites = 0;
    store.writeFile = async (path, content) => {
      if (path.endsWith("/heartbeat") && ++heartbeatWrites === 2) {
        heartbeatEntered.resolve();
        await releaseHeartbeat.promise;
        await originalWrite(path, content);
        order.push("heartbeat");
        return;
      }
      await originalWrite(path, content);
    };
    const coordinator = trackCoordinator(
      store,
      (specifier) => Promise.resolve({ specifier }),
      {
        maxArtifacts: 2,
        ownerId: OWNER_A,
        leaseDurationMs: 100,
        heartbeatIntervalMs: 1,
      },
    );

    await coordinator.importTransformedModule(
      "/cache/project/Component.js",
      "unchanged",
      HASH_A,
      "/cache/project",
    );
    await new Promise((resolve) => setTimeout(resolve, 5));
    await heartbeatEntered.promise;

    const disposal = coordinator.dispose().then(() => {
      order.push("dispose");
    });

    releaseHeartbeat.resolve();
    await disposal;
    assertEquals(
      order,
      ["heartbeat", "dispose"],
      "dispose must await the in-flight heartbeat before tearing down the lease",
    );
    assertEquals(
      store.directories.has(
        `/cache/project/.transformed-module-slots-v2/owners/${OWNER_A}`,
      ),
      false,
    );
  });

  it("waits for a live cross-coordinator publication and reuses its artifact", async () => {
    const slotReserved = deferred();
    const releaseReservation = deferred();
    const concurrentWaitEntered = deferred();
    const store = new MemoryModuleStore();
    const originalCreate = store.createFileBytesExclusive.bind(store);
    store.createFileBytesExclusive = async (path, content) => {
      if (path.endsWith("/module.tmp")) {
        slotReserved.resolve();
        await releaseReservation.promise;
      }
      await originalCreate(path, content);
    };
    const firstCoordinator = trackCoordinator(
      store,
      (specifier) => Promise.resolve({ specifier }),
      { maxArtifacts: 2, ownerId: OWNER_A },
    );
    const concurrentCoordinator = trackCoordinator(
      store,
      (specifier) => Promise.resolve({ specifier }),
      {
        maxArtifacts: 2,
        ownerId: OWNER_B,
        wait: async () => {
          concurrentWaitEntered.resolve();
          await releaseReservation.promise;
        },
      },
    );

    const first = firstCoordinator.importTransformedModule(
      "/cache/project/Component.js",
      "unchanged",
      HASH_A,
      "/cache/project",
    );
    await slotReserved.promise;
    const concurrent = concurrentCoordinator.importTransformedModule(
      "/cache/project/Component.js",
      "unchanged",
      HASH_A,
      "/cache/project",
    );
    await concurrentWaitEntered.promise;

    releaseReservation.resolve();
    const [firstResult, concurrentResult] = await Promise.all([first, concurrent]);
    assertEquals(firstResult, concurrentResult);
    assertEquals(artifactPaths(store).length, 1);
    assertEquals(
      claimPaths(store).filter((path) => path.split("/").at(-1)?.startsWith("1.")).length,
      0,
    );
  });

  it("bounds persistent versions without deleting an older lazy-import base", async () => {
    const store = new MemoryModuleStore();
    const coordinator = trackCoordinator(
      store,
      (specifier) => Promise.resolve({ specifier }),
      { maxArtifacts: 1 },
    );

    const first = await coordinator.importTransformedModule(
      "/cache/project/Component.js",
      "version-a",
      HASH_A,
      "/cache/project",
    );
    await assertRejects(
      () =>
        coordinator.importTransformedModule(
          "/cache/project/Component.js",
          "version-b",
          HASH_B,
          "/cache/project",
        ),
      RangeError,
      "artifact limit",
    );

    assertEquals(artifactPaths(store).length, 1);
    assertEquals(
      await coordinator.importTransformedModule(
        "/cache/project/Component.js",
        "version-a",
        HASH_A,
        "/cache/project",
      ),
      first,
    );
  });

  it("recycles a historical cap after the previous owner lease expires", async () => {
    let now = 0;
    const store = new MemoryModuleStore();
    store.now = now;
    const leaseOptions = {
      maxArtifacts: 1,
      leaseDurationMs: 1_000,
      heartbeatIntervalMs: 900,
      now: () => now,
    };
    const previousRuntime = trackCoordinator(
      store,
      (specifier) => Promise.resolve({ specifier }),
      { ...leaseOptions, ownerId: OWNER_A },
    );
    await previousRuntime.importTransformedModule(
      "/cache/project/Component.js",
      "version-a",
      HASH_A,
      "/cache/project",
    );

    now = 2_000;
    store.now = now;
    const restartedRuntime = trackCoordinator(
      store,
      (specifier) => Promise.resolve({ specifier }),
      { ...leaseOptions, ownerId: OWNER_B },
    );
    const restarted = await restartedRuntime.importTransformedModule(
      "/cache/project/Component.js",
      "version-b",
      HASH_B,
      "/cache/project",
    );

    assertEquals(String(restarted.specifier).includes(HASH_B), true);
    assertEquals(artifactPaths(store).length, 1);
    assertEquals(artifactPaths(store)[0]!.includes(HASH_B), true);
    await restartedRuntime.dispose();

    const renewed = await previousRuntime.importTransformedModule(
      "/cache/project/Component.js",
      "version-a",
      HASH_A,
      "/cache/project",
    );
    assertEquals(String(renewed.specifier).includes(HASH_A), true);
    assertEquals(artifactPaths(store).length, 1);
    assertEquals(artifactPaths(store)[0]!.includes(HASH_A), true);
    assertEquals(
      store.directories.has(
        `/cache/project/.transformed-module-slots-v2/owners/${OWNER_A}`,
      ),
      false,
    );
    await previousRuntime.dispose();
  });

  it("keeps persistent artifact count and bytes bounded across released owners", async () => {
    const store = new MemoryModuleStore();

    for (let version = 0; version < 6; version++) {
      const coordinator = trackCoordinator(
        store,
        (specifier) => Promise.resolve({ specifier }),
        {
          maxArtifacts: 2,
          maxArtifactBytes: 4,
          ownerId: version.toString(16).padStart(32, "0"),
        },
      );
      await coordinator.importTransformedModule(
        "/cache/project/Component.js",
        `v${version}`,
        version.toString(16).repeat(64),
        "/cache/project",
      );
      await coordinator.dispose();

      const artifacts = artifactPaths(store).map((path) => store.files.get(path)!);
      assertEquals(artifacts.length <= 2, true);
      assertEquals(
        artifacts.reduce((total, bytes) => total + bytes.byteLength, 0) <= 8,
        true,
      );
    }
  });

  for (const reuseExisting of [true, false]) {
    it(
      `shrinks a larger historical cap before ${reuseExisting ? "reuse" : "new publication"}`,
      async () => {
        const store = new MemoryModuleStore();
        const previous = trackCoordinator(
          store,
          (specifier) => Promise.resolve({ specifier }),
          { maxArtifacts: 3, ownerId: OWNER_A },
        );
        for (
          const [code, hash] of [
            ["va", HASH_A],
            ["vb", HASH_B],
            ["vc", "c".repeat(64)],
          ] as const
        ) {
          await previous.importTransformedModule(
            "/cache/project/Component.js",
            code,
            hash,
            "/cache/project",
          );
        }
        await previous.dispose();

        const restarted = trackCoordinator(
          store,
          (specifier) => Promise.resolve({ specifier }),
          { maxArtifacts: 1, ownerId: OWNER_B },
        );
        await restarted.importTransformedModule(
          "/cache/project/Component.js",
          reuseExisting ? "vb" : "vd",
          reuseExisting ? HASH_B : "d".repeat(64),
          "/cache/project",
        );

        assertEquals(artifactPaths(store).length, 1);
        assertEquals(claimPaths(store).length, 1);
      },
    );
  }

  it("recycles an unpinned artifact above a smaller restart byte limit", async () => {
    const store = new MemoryModuleStore();
    const previous = trackCoordinator(
      store,
      (specifier) => Promise.resolve({ specifier }),
      { maxArtifacts: 1, maxArtifactBytes: 8, ownerId: OWNER_A },
    );
    await previous.importTransformedModule(
      "/cache/project/Component.js",
      "123456",
      HASH_A,
      "/cache/project",
    );
    await previous.dispose();

    const restarted = trackCoordinator(
      store,
      (specifier) => Promise.resolve({ specifier }),
      { maxArtifacts: 1, maxArtifactBytes: 4, ownerId: OWNER_B },
    );
    await restarted.importTransformedModule(
      "/cache/project/Component.js",
      "new",
      HASH_B,
      "/cache/project",
    );

    assertEquals(artifactPaths(store).length, 1);
    assertEquals(artifactPaths(store)[0]!.includes(HASH_B), true);
    assertEquals(claimPaths(store).length, 1);
  });

  it("retains the claim anchor when artifact cleanup fails and recovers on retry", async () => {
    const store = new MemoryModuleStore();
    const previous = trackCoordinator(
      store,
      (specifier) => Promise.resolve({ specifier }),
      { maxArtifacts: 1, ownerId: OWNER_A },
    );
    await previous.importTransformedModule(
      "/cache/project/Component.js",
      "version-a",
      HASH_A,
      "/cache/project",
    );
    await previous.dispose();

    const originalRemove = store.remove.bind(store);
    let failArtifactRemoval = true;
    store.remove = (path, options) => {
      if (failArtifactRemoval && path.includes(".vf-slot-")) {
        failArtifactRemoval = false;
        return Promise.reject(new Error("synthetic artifact remove failure"));
      }
      return originalRemove(path, options);
    };
    const restarted = trackCoordinator(
      store,
      (specifier) => Promise.resolve({ specifier }),
      { maxArtifacts: 1, ownerId: OWNER_B },
    );
    await assertRejects(
      () =>
        restarted.importTransformedModule(
          "/cache/project/Component.js",
          "version-b",
          HASH_B,
          "/cache/project",
        ),
      AggregateError,
      "claim was retained",
    );
    assertEquals(claimPaths(store).length, 1);
    assertEquals(artifactPaths(store).length, 1);

    await restarted.importTransformedModule(
      "/cache/project/Component.js",
      "version-b",
      HASH_B,
      "/cache/project",
    );
    assertEquals(claimPaths(store).length, 1);
    assertEquals(artifactPaths(store).length, 1);
    assertEquals(artifactPaths(store)[0]!.includes(HASH_B), true);
  });

  it("recovers from a crashed partial claim without exposing it in the claim ledger", async () => {
    let now = 0;
    const claimWriteEntered = deferred();
    const releaseClaimWrite = deferred();
    const store = new MemoryModuleStore();
    store.now = now;
    const originalCreate = store.createFileBytesExclusive.bind(store);
    let blockFirstClaim = true;
    store.createFileBytesExclusive = async (path, content) => {
      if (blockFirstClaim && path.endsWith("/claim.tmp")) {
        blockFirstClaim = false;
        store.files.set(path, content.subarray(0, 1).slice());
        claimWriteEntered.resolve();
        await releaseClaimWrite.promise;
        throw new Error("synthetic crashed claim write");
      }
      await originalCreate(path, content);
    };
    const leaseOptions = {
      maxArtifacts: 1,
      leaseDurationMs: 1_000,
      heartbeatIntervalMs: 900,
      lockPollIntervalMs: 1,
      lockPollAttempts: 4,
      now: () => now,
      wait: () => Promise.resolve(),
    };
    const crashed = trackCoordinator(
      store,
      (specifier) => Promise.resolve({ specifier }),
      { ...leaseOptions, ownerId: OWNER_A },
    );
    const interrupted = crashed.importTransformedModule(
      "/cache/project/Component.js",
      "version-a",
      HASH_A,
      "/cache/project",
    );
    await claimWriteEntered.promise;

    now = 2_000;
    store.now = now;
    const recovered = trackCoordinator(
      store,
      (specifier) => Promise.resolve({ specifier }),
      { ...leaseOptions, ownerId: OWNER_B },
    );
    const result = await recovered.importTransformedModule(
      "/cache/project/Component.js",
      "version-b",
      HASH_B,
      "/cache/project",
    );
    releaseClaimWrite.resolve();
    await assertRejects(() => interrupted, Error);

    assertEquals(String(result.specifier).includes(HASH_B), true);
    assertEquals(claimPaths(store).length, 1);
    assertEquals([...store.files.keys()].some((path) => path.endsWith("/claim.tmp")), false);
    assertEquals(artifactPaths(store).length, 1);
  });

  it("expires a non-settling lock ticket even while its owner heartbeat is live", async () => {
    let now = 0;
    const writeEntered = deferred();
    const releaseWrite = deferred();
    const store = new MemoryModuleStore();
    store.now = now;
    const originalCreate = store.createFileBytesExclusive.bind(store);
    let blockFirstWrite = true;
    store.createFileBytesExclusive = async (path, content) => {
      if (blockFirstWrite && path.endsWith("/module.tmp")) {
        blockFirstWrite = false;
        writeEntered.resolve();
        await releaseWrite.promise;
      }
      await originalCreate(path, content);
    };
    const leaseOptions = {
      maxArtifacts: 1,
      leaseDurationMs: 1_000,
      heartbeatIntervalMs: 900,
      lockPollIntervalMs: 1,
      lockPollAttempts: 4,
      now: () => now,
      wait: () => Promise.resolve(),
    };
    const stalled = trackCoordinator(
      store,
      (specifier) => Promise.resolve({ specifier }),
      { ...leaseOptions, ownerId: OWNER_A },
    );
    const interrupted = stalled.importTransformedModule(
      "/cache/project/Component.js",
      "version-a",
      HASH_A,
      "/cache/project",
    );
    await writeEntered.promise;

    now = 2_000;
    store.now = now;
    store.mtimes.set(
      `/cache/project/.transformed-module-slots-v2/owners/${OWNER_A}/heartbeat`,
      new Date(now),
    );
    const recovery = trackCoordinator(
      store,
      (specifier) => Promise.resolve({ specifier }),
      { ...leaseOptions, ownerId: OWNER_B },
    );
    const recovered = await recovery.importTransformedModule(
      "/cache/project/Component.js",
      "version-b",
      HASH_B,
      "/cache/project",
    );
    releaseWrite.resolve();
    await assertRejects(() => interrupted, Error);

    assertEquals(String(recovered.specifier).includes(HASH_B), true);
    assertEquals(artifactPaths(store).length, 1);
    assertEquals(artifactPaths(store)[0]!.includes(HASH_B), true);
  });

  it("opens a fresh owner epoch after expiry while fencing stale work", async () => {
    let now = 0;
    const writeEntered = deferred();
    const releaseWrite = deferred();
    const store = new MemoryModuleStore();
    store.now = now;
    const originalCreate = store.createFileBytesExclusive.bind(store);
    let blockFirstWrite = true;
    store.createFileBytesExclusive = async (path, content) => {
      if (blockFirstWrite && path.endsWith("/module.tmp")) {
        blockFirstWrite = false;
        writeEntered.resolve();
        await releaseWrite.promise;
      }
      await originalCreate(path, content);
    };
    const coordinator = trackCoordinator(
      store,
      (specifier) => Promise.resolve({ specifier }),
      {
        maxArtifacts: 1,
        ownerId: OWNER_A,
        leaseDurationMs: 1_000,
        heartbeatIntervalMs: 900,
        lockPollIntervalMs: 1,
        lockPollAttempts: 4,
        now: () => now,
        wait: () => Promise.resolve(),
      },
    );
    const stale = coordinator.importTransformedModule(
      "/cache/project/Component.js",
      "version-a",
      HASH_A,
      "/cache/project",
    );
    await writeEntered.promise;

    now = 2_000;
    store.now = now;
    const renewed = await coordinator.importTransformedModule(
      "/cache/project/Component.js",
      "version-b",
      HASH_B,
      "/cache/project",
    );
    releaseWrite.resolve();
    await assertRejects(() => stale, Error);

    assertEquals(String(renewed.specifier).includes(HASH_B), true);
    assertEquals(artifactPaths(store).length, 1);
    assertEquals(artifactPaths(store)[0]!.includes(HASH_B), true);
    assertEquals(
      store.directories.has(
        `/cache/project/.transformed-module-slots-v2/owners/${OWNER_A}`,
      ),
      false,
    );
  });

  it("fences a crashed incomplete publisher and preserves its replacement", async () => {
    let now = 0;
    let blockFirstTemporaryWrite = true;
    const firstWriteEntered = deferred();
    const releaseFirstWrite = deferred();
    const store = new MemoryModuleStore();
    store.now = now;
    const originalCreate = store.createFileBytesExclusive.bind(store);
    store.createFileBytesExclusive = async (path, content) => {
      if (blockFirstTemporaryWrite && path.endsWith("/module.tmp")) {
        blockFirstTemporaryWrite = false;
        firstWriteEntered.resolve();
        await releaseFirstWrite.promise;
      }
      await originalCreate(path, content);
    };
    const leaseOptions = {
      maxArtifacts: 1,
      leaseDurationMs: 1_000,
      heartbeatIntervalMs: 900,
      lockPollIntervalMs: 1,
      lockPollAttempts: 4,
      now: () => now,
      wait: () => Promise.resolve(),
    };
    const crashedPublisher = trackCoordinator(
      store,
      (specifier) => Promise.resolve({ specifier }),
      { ...leaseOptions, ownerId: OWNER_A },
    );
    const interrupted = crashedPublisher.importTransformedModule(
      "/cache/project/Component.js",
      "version-a",
      HASH_A,
      "/cache/project",
    );
    await firstWriteEntered.promise;

    now = 2_000;
    store.now = now;
    const recovery = trackCoordinator(
      store,
      (specifier) => Promise.resolve({ specifier }),
      { ...leaseOptions, ownerId: OWNER_B },
    );
    const recovered = await recovery.importTransformedModule(
      "/cache/project/Component.js",
      "version-b",
      HASH_B,
      "/cache/project",
    );
    releaseFirstWrite.resolve();
    await assertRejects(() => interrupted, Error);

    assertEquals(String(recovered.specifier).includes(HASH_B), true);
    assertEquals(
      String(
        (await recovery.importTransformedModule(
          "/cache/project/Component.js",
          "version-b",
          HASH_B,
          "/cache/project",
        )).specifier,
      ).includes(HASH_B),
      true,
    );
    assertEquals(artifactPaths(store).length, 1);
    assertEquals(artifactPaths(store)[0]!.includes(HASH_B), true);
    await Promise.all([crashedPublisher.dispose(), recovery.dispose()]);
  });

  it("keeps a live artifact usable for a delayed relative import at the cap", async () => {
    const lifecycleRoot = await Deno.makeTempDir({ prefix: "vf-lazy-module-" });
    const componentDirectory = join(lifecycleRoot, "components");
    const componentFile = join(componentDirectory, "Component.js");
    const store = createFileSystem();
    await store.mkdir(componentDirectory, { recursive: true });
    await store.writeTextFile(
      join(componentDirectory, "Lazy.js"),
      "export const value = 42;",
    );
    const coordinator = trackCoordinator(store, undefined, {
      maxArtifacts: 1,
    });

    try {
      const liveModule = await coordinator.importTransformedModule(
        componentFile,
        'export const load = () => import("./Lazy.js");',
        HASH_A,
        lifecycleRoot,
      );
      await assertRejects(
        () =>
          coordinator.importTransformedModule(
            componentFile,
            "export default 2;",
            HASH_B,
            lifecycleRoot,
          ),
        RangeError,
        "held by active leases",
      );

      const lazyModule = await (liveModule.load as () => Promise<{ value: number }>)();
      assertEquals(lazyModule.value, 42);
    } finally {
      await coordinator.dispose();
      await Deno.remove(lifecycleRoot, { recursive: true });
    }
  });

  it("rejects a TLA evaluation whose pending source was safely recycled", async () => {
    const lifecycleRoot = await Deno.makeTempDir({ prefix: "vf-tla-module-" });
    const componentDirectory = join(lifecycleRoot, "components");
    const componentFile = join(componentDirectory, "Component.js");
    const store = createFileSystem();
    const evaluationEntered = deferred();
    const releaseEvaluation = deferred();
    const globals = globalThis as unknown as Record<string, unknown>;
    globals.__vfCoordinatorTlaEntered = evaluationEntered.resolve;
    globals.__vfCoordinatorTlaGate = releaseEvaluation.promise;
    await store.mkdir(componentDirectory, { recursive: true });
    await store.writeTextFile(
      join(componentDirectory, "Lazy.js"),
      "export const value = 42;",
    );
    const coordinator = trackCoordinator(store, undefined, { maxArtifacts: 1 });

    try {
      const pending = coordinator.importTransformedModule(
        componentFile,
        `
          globalThis.__vfCoordinatorTlaEntered();
          await globalThis.__vfCoordinatorTlaGate;
          export const load = () => import("./Lazy.js");
        `,
        HASH_A,
        lifecycleRoot,
      );
      await evaluationEntered.promise;

      await coordinator.importTransformedModule(
        componentFile,
        "export default 2;",
        HASH_B,
        lifecycleRoot,
      );
      const artifacts: string[] = [];
      for await (const entry of store.readDir(componentDirectory)) {
        if (entry.isFile && entry.name.includes(".vf-slot-")) artifacts.push(entry.name);
      }
      assertEquals(artifacts.length, 1);
      assertEquals(artifacts[0]!.includes(HASH_B), true);

      releaseEvaluation.resolve();
      await assertRejects(() => pending, Error, "superseded");
    } finally {
      Reflect.deleteProperty(globals, "__vfCoordinatorTlaEntered");
      Reflect.deleteProperty(globals, "__vfCoordinatorTlaGate");
      await coordinator.dispose();
      await Deno.remove(lifecycleRoot, { recursive: true });
    }
  });

  it("refuses transformed artifacts beyond the configured byte boundary", async () => {
    const store = new MemoryModuleStore();
    const coordinator = trackCoordinator(
      store,
      () => Promise.resolve({}),
      { maxArtifacts: 2, maxArtifactBytes: 4 },
    );

    await assertRejects(
      () =>
        coordinator.importTransformedModule(
          "/cache/project/Component.js",
          "12345",
          HASH_A,
          "/cache/project",
        ),
      RangeError,
      "exceeds 4 bytes",
    );
    assertEquals(artifactPaths(store).length, 0);
  });

  it("publishes atomically and reuses artifacts with the native filesystem", async () => {
    const lifecycleRoot = await Deno.makeTempDir({ prefix: "vf-transformed-module-" });
    const componentDirectory = join(lifecycleRoot, "components");
    const componentFile = join(componentDirectory, "Component.js");
    const store = createFileSystem();
    await store.mkdir(componentDirectory, { recursive: true });

    try {
      const firstCoordinator = trackCoordinator(
        store,
        (specifier) => Promise.resolve({ specifier }),
        { maxArtifacts: 2 },
      );
      const restartedCoordinator = trackCoordinator(
        store,
        (specifier) => Promise.resolve({ specifier }),
        { maxArtifacts: 2 },
      );

      const first = await firstCoordinator.importTransformedModule(
        componentFile,
        "export default 1;",
        HASH_A,
        lifecycleRoot,
      );
      const restarted = await restartedCoordinator.importTransformedModule(
        componentFile,
        "export default 1;",
        HASH_A,
        lifecycleRoot,
      );

      assertEquals(restarted, first);
      const artifacts = [];
      for await (const entry of store.readDir(componentDirectory)) {
        if (entry.isFile) artifacts.push(entry.name);
      }
      assertEquals(artifacts.length, 1);
      assertEquals(artifacts[0]!.startsWith(".vf-slot-0-"), true);
      assertEquals(artifacts[0]!.endsWith(`.${HASH_A}.js`), true);
    } finally {
      await Deno.remove(lifecycleRoot, { recursive: true });
    }
  });

  it("keeps generated sibling filenames bounded for long component names", async () => {
    const lifecycleRoot = await Deno.makeTempDir({ prefix: "vf-long-module-" });
    const componentDirectory = join(lifecycleRoot, "components");
    const store = createFileSystem();
    await store.mkdir(componentDirectory, { recursive: true });
    const coordinator = trackCoordinator(
      store,
      (specifier) => Promise.resolve({ specifier }),
      { maxArtifacts: 2 },
    );

    try {
      for (
        const [name, hash] of [
          [`${"x".repeat(150)}.js`, HASH_A],
          [`${"界".repeat(100)}.js`, HASH_B],
        ] as const
      ) {
        await coordinator.importTransformedModule(
          join(componentDirectory, name),
          "export default 1;",
          hash,
          lifecycleRoot,
        );
      }

      const artifacts: string[] = [];
      for await (const entry of store.readDir(componentDirectory)) {
        if (entry.isFile && entry.name.includes(".vf-slot-")) artifacts.push(entry.name);
      }
      assertEquals(artifacts.length, 2);
      assertEquals(artifacts.every((name) => new TextEncoder().encode(name).length <= 255), true);
    } finally {
      await coordinator.dispose();
      await Deno.remove(lifecycleRoot, { recursive: true });
    }
  });

  it("rejects component paths outside their lifecycle root", async () => {
    const coordinator = trackCoordinator(
      new MemoryModuleStore(),
      () => Promise.resolve({}),
    );
    await assertRejects(
      () =>
        coordinator.importTransformedModule(
          "/cache/another-project/Component.js",
          "source",
          HASH_A,
          "/cache/project",
        ),
      TypeError,
      "inside its lifecycle root",
    );
  });

  it("rejects component paths that overlap the persistent slot ledger", async () => {
    const coordinator = trackCoordinator(
      new MemoryModuleStore(),
      () => Promise.resolve({}),
    );
    await assertRejects(
      () =>
        coordinator.importTransformedModule(
          "/cache/project/.transformed-module-slots-v2/Component.js",
          "source",
          HASH_A,
          "/cache/project",
        ),
      TypeError,
      "overlaps the lifecycle slot ledger",
    );
  });
});
