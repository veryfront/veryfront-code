import "#veryfront/schemas/_test-setup.ts";
import { join } from "#veryfront/compat/path/index.ts";
import { createFileSystem } from "#veryfront/platform/compat/fs.ts";
import { assertEquals, assertRejects } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  buildTransformedModuleSlotPath,
  buildTransformedModuleSpecifier,
  TransformedModuleCoordinator,
  type TransformedModuleFileStore,
} from "./transformed-module-coordinator.ts";

const HASH_A = "a".repeat(64);
const HASH_B = "b".repeat(64);

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
  createCalls = 0;
  readCalls = 0;

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
      }
      return;
    }
    const parent = path.slice(0, path.lastIndexOf("/")) || "/";
    if (!this.directories.has(parent)) throw new Deno.errors.NotFound("missing parent");
    this.directories.add(path);
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
    this.files.set(path, content.slice());
  }

  readFileBytesWithinLimit(path: string, byteLimit: number): Promise<Uint8Array> {
    this.readCalls++;
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
  }

  async remove(path: string, options?: { recursive?: boolean }): Promise<void> {
    if (this.files.delete(path)) return;
    if (!this.directories.has(path)) throw new Deno.errors.NotFound("missing");
    const prefix = `${path}/`;
    const hasChildren = [...this.directories].some((entry) => entry.startsWith(prefix)) ||
      [...this.files.keys()].some((entry) => entry.startsWith(prefix));
    if (hasChildren && options?.recursive !== true) {
      throw new Error("directory not empty");
    }
    for (const file of this.files.keys()) {
      if (file.startsWith(prefix)) this.files.delete(file);
    }
    for (const directory of this.directories) {
      if (directory === path || directory.startsWith(prefix)) this.directories.delete(directory);
    }
  }
}

describe("modules/react-loader/transformed-module-coordinator", () => {
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
    const coordinator = new TransformedModuleCoordinator(
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

  it("uses a fresh specifier when unchanged content is retried after rejection", async () => {
    const store = new MemoryModuleStore();
    const specifiers: string[] = [];
    const coordinator = new TransformedModuleCoordinator(
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

  it("shares only the materialization and removes its pending-map entry afterward", async () => {
    const createEntered = deferred();
    const releaseCreate = deferred();
    const store = new MemoryModuleStore();
    const originalCreate = store.createFileBytesExclusive.bind(store);
    store.createFileBytesExclusive = async (path, content) => {
      if (store.createCalls === 0) {
        createEntered.resolve();
        await releaseCreate.promise;
      }
      await originalCreate(path, content);
    };
    const coordinator = new TransformedModuleCoordinator(
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
    assertEquals(store.createCalls, 0);

    releaseCreate.resolve();
    await Promise.all([first, second]);
    assertEquals(store.createCalls, 1);

    await coordinator.importTransformedModule(
      "/cache/project/Component.js",
      "unchanged",
      HASH_A,
      "/cache/project",
    );
    assertEquals(store.createCalls, 1);
    assertEquals(store.readCalls, 1);
  });

  it("fails closed without exclusive materialization authority", async () => {
    const coordinator = new TransformedModuleCoordinator(
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
    const firstCoordinator = new TransformedModuleCoordinator(
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
    const coordinator = new TransformedModuleCoordinator(
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
      if (failFirstCreate) {
        failFirstCreate = false;
        store.files.set(path, content.subarray(0, 1).slice());
        throw new Error("synthetic partial write");
      }
      await originalCreate(path, content);
    };
    const coordinator = new TransformedModuleCoordinator(
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
    assertEquals(store.files.size, 0);
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
    const coordinator = new TransformedModuleCoordinator(
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
    assertEquals(store.files.size, 0);
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
    const firstLifecycle = new TransformedModuleCoordinator(store, importer, {
      maxArtifacts: 2,
    });
    const restartedLifecycle = new TransformedModuleCoordinator(store, importer, {
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

    assertEquals(store.files.size, 1);
  });

  it("does not duplicate an artifact while another lifecycle owns an empty slot", async () => {
    const slotReserved = deferred();
    const releaseReservation = deferred();
    const store = new MemoryModuleStore();
    const originalMkdir = store.mkdir.bind(store);
    store.mkdir = async (path, options) => {
      await originalMkdir(path, options);
      if (path.endsWith("/.transformed-module-slots-v1/0")) {
        slotReserved.resolve();
        await releaseReservation.promise;
      }
    };
    const firstCoordinator = new TransformedModuleCoordinator(
      store,
      (specifier) => Promise.resolve({ specifier }),
      { maxArtifacts: 2 },
    );
    const concurrentCoordinator = new TransformedModuleCoordinator(
      store,
      (specifier) => Promise.resolve({ specifier }),
      { maxArtifacts: 2 },
    );

    const first = firstCoordinator.importTransformedModule(
      "/cache/project/Component.js",
      "unchanged",
      HASH_A,
      "/cache/project",
    );
    await slotReserved.promise;
    await assertRejects(
      () =>
        concurrentCoordinator.importTransformedModule(
          "/cache/project/Component.js",
          "unchanged",
          HASH_A,
          "/cache/project",
        ),
      Error,
      "reservation is incomplete",
    );

    releaseReservation.resolve();
    await first;
    assertEquals(store.files.size, 1);
    assertEquals(
      store.directories.has("/cache/project/.transformed-module-slots-v1/1"),
      false,
    );
  });

  it("bounds persistent versions without deleting an older lazy-import base", async () => {
    const store = new MemoryModuleStore();
    const coordinator = new TransformedModuleCoordinator(
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

    assertEquals(store.files.size, 1);
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

  it("refuses transformed artifacts beyond the configured byte boundary", async () => {
    const store = new MemoryModuleStore();
    const coordinator = new TransformedModuleCoordinator(
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
    assertEquals(store.files.size, 0);
  });

  it("publishes atomically and reuses artifacts with the native filesystem", async () => {
    const lifecycleRoot = await Deno.makeTempDir({ prefix: "vf-transformed-module-" });
    const componentDirectory = join(lifecycleRoot, "components");
    const componentFile = join(componentDirectory, "Component.js");
    const store = createFileSystem();
    await store.mkdir(componentDirectory, { recursive: true });

    try {
      const firstCoordinator = new TransformedModuleCoordinator(
        store,
        (specifier) => Promise.resolve({ specifier }),
        { maxArtifacts: 2 },
      );
      const restartedCoordinator = new TransformedModuleCoordinator(
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
      assertEquals(artifacts, [`Component.vf-slot-0.${HASH_A}.js`]);
    } finally {
      await Deno.remove(lifecycleRoot, { recursive: true });
    }
  });

  it("rejects component paths outside their lifecycle root", async () => {
    const coordinator = new TransformedModuleCoordinator(
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
    const coordinator = new TransformedModuleCoordinator(
      new MemoryModuleStore(),
      () => Promise.resolve({}),
    );
    await assertRejects(
      () =>
        coordinator.importTransformedModule(
          "/cache/project/.transformed-module-slots-v1/Component.js",
          "source",
          HASH_A,
          "/cache/project",
        ),
      TypeError,
      "overlaps the lifecycle slot ledger",
    );
  });
});
