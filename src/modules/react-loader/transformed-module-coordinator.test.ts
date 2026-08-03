import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertRejects } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  buildContentAddressedModulePath,
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
  createCalls = 0;
  readCalls = 0;

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

  async remove(path: string): Promise<void> {
    if (!this.files.delete(path)) throw new Deno.errors.NotFound("missing");
  }
}

describe("modules/react-loader/transformed-module-coordinator", () => {
  it("uses an immutable content-addressed sibling path", () => {
    const path = buildContentAddressedModulePath(
      "/cache/project/components/Widget.js",
      HASH_A,
      "process1",
    );
    assertEquals(
      path,
      `/cache/project/components/Widget.process1.${HASH_A}.js`,
    );
    assertEquals(
      buildContentAddressedModulePath(
        "/cache/project/components/Widget.js",
        HASH_B,
        "process1",
      ) === path,
      false,
    );
  });

  it("encodes special path characters in the import URL", () => {
    const versionedPath = buildContentAddressedModulePath(
      "/cache/my project/note#1?/Widget.js",
      HASH_A,
      "process1",
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
      { namespace: "process1" },
    );

    const first = coordinator.importTransformedModule(
      "/cache/project/Component.js",
      "code-a",
      HASH_A,
    );
    await firstImportEntered.promise;

    try {
      const second = await coordinator.importTransformedModule(
        "/cache/project/Component.js",
        "code-b",
        HASH_B,
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
      { namespace: "process1" },
    );

    await assertRejects(
      () =>
        coordinator.importTransformedModule(
          "/cache/project/Component.js",
          "unchanged",
          HASH_A,
        ),
      Error,
      "synthetic import failure",
    );
    assertEquals(
      await coordinator.importTransformedModule(
        "/cache/project/Component.js",
        "unchanged",
        HASH_A,
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
      { namespace: "process1" },
    );

    const first = coordinator.importTransformedModule(
      "/cache/project/Component.js",
      "unchanged",
      HASH_A,
    );
    await createEntered.promise;
    const second = coordinator.importTransformedModule(
      "/cache/project/Component.js",
      "unchanged",
      HASH_A,
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
    );
    assertEquals(store.createCalls, 2);
    assertEquals(store.readCalls, 1);
  });

  it("fails closed without exclusive materialization authority", async () => {
    const coordinator = new TransformedModuleCoordinator(
      {
        remove: () => Promise.resolve(),
      },
      () => Promise.resolve({}),
      { namespace: "process1" },
    );

    await assertRejects(
      () =>
        coordinator.importTransformedModule(
          "/cache/project/Component.js",
          "source",
          HASH_A,
        ),
      TypeError,
      "require exclusive file creation",
    );
  });

  it("refuses existing content that does not match the addressed source", async () => {
    const store = new MemoryModuleStore();
    const path = buildContentAddressedModulePath(
      "/cache/project/Component.js",
      HASH_A,
      "process1",
    );
    store.files.set(path, new TextEncoder().encode("xxxxxx"));
    const coordinator = new TransformedModuleCoordinator(
      store,
      () => Promise.resolve({}),
      { namespace: "process1" },
    );

    await assertRejects(
      () =>
        coordinator.importTransformedModule(
          "/cache/project/Component.js",
          "source",
          HASH_A,
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
      { namespace: "process1" },
    );

    await assertRejects(
      () =>
        coordinator.importTransformedModule(
          "/cache/project/Component.js",
          "source",
          HASH_A,
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
      ),
      { ok: true },
    );
  });
});
