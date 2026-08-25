import "#veryfront/schemas/_test-setup.ts";
import {
  assertEquals,
  assertExists,
  assertRejects,
  assertStringIncludes,
} from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { VeryfrontError } from "#veryfront/errors/types.ts";
import {
  computeIntegrity,
  createEmptyLockfile,
  createLockfileManager,
  extractImports,
  fetchWithLock,
  type FSAdapter,
  getLockfileEntryForBuild,
  type LockfileData,
  type LockfileEntry,
  resolveImportUrl,
  setLockfileEntryForBuild,
  verifyIntegrity,
} from "./import-lockfile.ts";

function createMockFS(
  files: Record<string, string> = {},
  coordinationKey?: string,
): FSAdapter {
  const store = new Map<string, string>(Object.entries(files));

  return {
    ...(coordinationKey === undefined ? {} : { coordinationKey }),
    readFile: (path: string) => {
      const content = store.get(path);
      if (content == null) return Promise.reject(new Error("ENOENT"));
      return Promise.resolve(content);
    },
    writeFile: (path: string, content: string) => {
      store.set(path, content);
      return Promise.resolve();
    },
    exists: (path: string) => Promise.resolve(store.has(path)),
    remove: (path: string) => {
      store.delete(path);
      return Promise.resolve();
    },
  };
}

function createDeferredCanonicalAliasFS(initialContent?: string): {
  fs: FSAdapter;
  store: Map<string, string>;
  backingLockfilePath: string;
  enableCanonicalization(): void;
} {
  const backingProjectDir = "/backing/project";
  const backingLockfilePath = `${backingProjectDir}/veryfront.lock`;
  const store = new Map<string, string>();
  if (initialContent !== undefined) store.set(backingLockfilePath, initialContent);
  let canonicalizationEnabled = false;
  const backingPath = (path: string): string =>
    path === "/project/veryfront.lock" || path === "/alias/veryfront.lock"
      ? backingLockfilePath
      : path;

  return {
    backingLockfilePath,
    store,
    enableCanonicalization(): void {
      canonicalizationEnabled = true;
    },
    fs: {
      exists: (path) => Promise.resolve(store.has(backingPath(path))),
      readFile: (path) => {
        const content = store.get(backingPath(path));
        return content === undefined
          ? Promise.reject(new Error("ENOENT"))
          : Promise.resolve(content);
      },
      writeFile: (path, content) => {
        store.set(backingPath(path), content);
        return Promise.resolve();
      },
      remove: (path) => {
        store.delete(backingPath(path));
        return Promise.resolve();
      },
      realPath: (path) =>
        canonicalizationEnabled && (path === "/project" || path === "/alias")
          ? Promise.resolve(backingProjectDir)
          : Promise.reject(new Error("canonical path unavailable")),
    },
  };
}

function blockNextWrite(fs: FSAdapter): {
  started: Promise<void>;
  release: () => void;
} {
  const started = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  const writeFile = fs.writeFile;
  let blocked = false;

  fs.writeFile = async (path: string, content: string): Promise<void> => {
    if (!blocked) {
      blocked = true;
      started.resolve();
      await release.promise;
    }
    await writeFile(path, content);
  };

  return { started: started.promise, release: release.resolve };
}

function exposePartialNextWrite(fs: FSAdapter): {
  started: Promise<void>;
  release: () => void;
} {
  const started = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  const writeFile = fs.writeFile;
  let blocked = false;

  fs.writeFile = async (path: string, content: string): Promise<void> => {
    if (!blocked) {
      blocked = true;
      await writeFile(path, "{");
      started.resolve();
      await release.promise;
    }
    await writeFile(path, content);
  };

  return { started: started.promise, release: release.resolve };
}

function resolvesWithin(promise: Promise<unknown>, milliseconds = 50): Promise<boolean> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<boolean>((resolve) => {
    timeout = setTimeout(() => resolve(false), milliseconds);
  });
  return Promise.race([promise.then(() => true), timeoutPromise]).finally(() => {
    if (timeout !== undefined) clearTimeout(timeout);
  });
}

describe("import-lockfile", () => {
  describe("createEmptyLockfile", () => {
    it("should create lockfile with version 1 and empty imports", () => {
      const lockfile = createEmptyLockfile();
      assertEquals(lockfile.version, 1);
      assertEquals(lockfile.imports, {});
      assertEquals(Object.getPrototypeOf(lockfile.imports), Object.prototype);
      // deno-lint-ignore no-prototype-builtins -- verifies public consumers can call this directly.
      assertEquals(lockfile.imports.hasOwnProperty("package"), false);
    });
  });

  describe("computeIntegrity", () => {
    it("should return sha256- prefixed hash", async () => {
      const integrity = await computeIntegrity("hello world");
      assertEquals(integrity.startsWith("sha256-"), true);
      assertEquals(integrity.length, 7 + 64);
    });

    it("should produce consistent output", async () => {
      const [i1, i2] = await Promise.all([computeIntegrity("test"), computeIntegrity("test")]);
      assertEquals(i1, i2);
    });
  });

  describe("verifyIntegrity", () => {
    it("should return true for matching content", async () => {
      const integrity = await computeIntegrity("test content");
      assertEquals(await verifyIntegrity("test content", integrity), true);
    });

    it("should return false for mismatched content", async () => {
      const integrity = await computeIntegrity("original");
      assertEquals(await verifyIntegrity("modified", integrity), false);
    });
  });

  describe("extractImports", () => {
    it("should extract static imports", () => {
      const code = `import { foo } from "react";\nimport bar from "./bar.ts";`;
      const imports = extractImports(code);

      assertEquals(imports.length, 2);

      const [first, second] = imports;
      assertExists(first);
      assertExists(second);

      assertEquals(first.specifier, "react");
      assertEquals(first.type, "static");
      assertEquals(second.specifier, "./bar.ts");
    });

    it("should extract dynamic imports", () => {
      const code = `const mod = await import("./dynamic.ts");`;
      const imports = extractImports(code);

      assertEquals(imports.length, 1);

      const [first] = imports;
      assertExists(first);
      assertEquals(first.specifier, "./dynamic.ts");
      assertEquals(first.type, "dynamic");
    });

    it("should extract export-from statements", () => {
      const code = `export { foo } from "./foo.ts";`;
      const imports = extractImports(code);

      assertEquals(imports.length, 1);

      const [first] = imports;
      assertExists(first);
      assertEquals(first.specifier, "./foo.ts");
      assertEquals(first.type, "static");
    });

    it("should deduplicate specifiers", () => {
      const code = `import { a } from "react";\nimport { b } from "react";`;
      assertEquals(extractImports(code).length, 1);
    });

    it("should return empty array for no imports", () => {
      assertEquals(extractImports("const x = 1;"), []);
    });
  });

  describe("resolveImportUrl", () => {
    it("should return http URLs as-is", () => {
      assertEquals(
        resolveImportUrl("http://example.com/mod.ts", "https://base.com/"),
        "http://example.com/mod.ts",
      );
    });

    it("should return https URLs as-is", () => {
      assertEquals(
        resolveImportUrl("https://cdn.com/mod.ts", "https://base.com/"),
        "https://cdn.com/mod.ts",
      );
    });

    it("should resolve relative paths against base URL", () => {
      assertEquals(
        resolveImportUrl("./utils.ts", "https://cdn.com/dir/main.ts"),
        "https://cdn.com/dir/utils.ts",
      );
    });

    it("should resolve parent paths against base URL", () => {
      assertEquals(
        resolveImportUrl("../lib.ts", "https://cdn.com/dir/sub/main.ts"),
        "https://cdn.com/dir/lib.ts",
      );
    });

    it("should return null for bare specifiers", () => {
      assertEquals(resolveImportUrl("react", "https://base.com/"), null);
    });

    it("should return null for node: specifiers", () => {
      assertEquals(resolveImportUrl("node:fs", "https://base.com/"), null);
    });
  });

  describe("createLockfileManager", () => {
    it("should return null for read when no lockfile exists", async () => {
      const mgr = createLockfileManager("/project", createMockFS());
      assertEquals(await mgr.read(), null);
    });

    it("should read existing lockfile", async () => {
      const data = {
        version: 1,
        imports: {
          "https://cdn.com/mod.ts": {
            resolved: "https://cdn.com/mod.ts",
            integrity: "sha256-abc",
          },
        },
      };
      const fs = createMockFS({ "/project/veryfront.lock": JSON.stringify(data) });
      const mgr = createLockfileManager("/project", fs);

      const result = await mgr.read();
      assertEquals(result?.version, 1);
      assertEquals(Object.keys(result!.imports).length, 1);
    });

    it("should set and get entries", async () => {
      const mgr = createLockfileManager("/project", createMockFS());
      await mgr.set("https://cdn.com/mod.ts", {
        resolved: "https://cdn.com/mod.ts",
        integrity: "sha256-abc",
      });

      const entry = await mgr.get("https://cdn.com/mod.ts");
      assertEquals(entry?.resolved, "https://cdn.com/mod.ts");
      assertEquals(entry?.integrity, "sha256-abc");
    });

    it("should report has correctly", async () => {
      const mgr = createLockfileManager("/project", createMockFS());
      const specifier = "https://cdn.com/mod.ts";

      assertEquals(await mgr.has(specifier), false);
      for (const inheritedName of ["constructor", "toString", "__proto__"]) {
        assertEquals(await mgr.has(inheritedName), false);
      }

      await mgr.set(specifier, { resolved: specifier, integrity: "sha256-abc" });
      assertEquals(await mgr.has(specifier), true);

      for (const specialName of ["constructor", "toString", "__proto__"]) {
        await mgr.set(specialName, { resolved: specialName, integrity: "sha256-special" });
        assertEquals(await mgr.has(specialName), true);
      }
    });

    it("should report inherited names as absent when no lockfile exists", async () => {
      const mgr = createLockfileManager("/project", createMockFS());

      assertEquals(await mgr.has("constructor"), false);
      assertEquals(await mgr.has("toString"), false);
    });

    it("should ignore names inherited from a polluted Object prototype", async () => {
      const inheritedName = "veryfrontLockfileInheritedEntry";
      const previous = Object.getOwnPropertyDescriptor(Object.prototype, inheritedName);
      Object.defineProperty(Object.prototype, inheritedName, {
        configurable: true,
        value: { resolved: "inherited", integrity: "inherited" },
      });

      try {
        const mgr = createLockfileManager("/project", createMockFS());
        assertEquals(await mgr.has(inheritedName), false);
      } finally {
        if (previous === undefined) {
          Reflect.deleteProperty(Object.prototype, inheritedName);
        } else {
          Object.defineProperty(Object.prototype, inheritedName, previous);
        }
      }
    });

    it("should remain writable when descriptor fields are inherited", async () => {
      const descriptorFields = [
        "value",
        "writable",
        "get",
        "set",
        "enumerable",
        "configurable",
      ] as const;
      const previous = new Map(
        descriptorFields.map((field) => [
          field,
          Object.getOwnPropertyDescriptor(Object.prototype, field),
        ]),
      );
      const definePoison = (field: string, value: unknown): void => {
        const descriptor = Object.create(null) as PropertyDescriptor;
        descriptor.value = value;
        descriptor.configurable = true;
        descriptor.writable = true;
        Object.defineProperty(Object.prototype, field, descriptor);
      };

      try {
        definePoison("value", "inherited-value");
        definePoison("writable", true);
        definePoison("get", () => "inherited-getter");
        definePoison("set", () => undefined);
        definePoison("enumerable", true);
        definePoison("configurable", true);

        const fs = createMockFS();
        const manager = createLockfileManager("/project", fs);
        const specifier = "https://cdn.com/descriptor-safe.ts";
        await manager.set(specifier, {
          resolved: specifier,
          integrity: "sha256-descriptor-safe",
        });
        await manager.flush();
        assertEquals(await manager.has(specifier), true);
      } finally {
        for (const field of descriptorFields) {
          const descriptor = previous.get(field);
          if (descriptor === undefined) Reflect.deleteProperty(Object.prototype, field);
          else Object.defineProperty(Object.prototype, field, descriptor);
        }
      }
    });

    it("should clear lockfile data", async () => {
      const mgr = createLockfileManager("/project", createMockFS());
      const specifier = "https://cdn.com/mod.ts";

      await mgr.set(specifier, { resolved: specifier, integrity: "sha256-abc" });
      await mgr.clear();

      assertEquals(await mgr.has(specifier), false);
    });

    it("should cache absence after removing the lockfile", async () => {
      const path = "/project/veryfront.lock";
      const fs = createMockFS({
        [path]: JSON.stringify(createEmptyLockfile()),
      });
      const mgr = createLockfileManager("/project", fs);

      assertEquals(await mgr.read(), createEmptyLockfile());
      await mgr.clear();

      assertEquals(await fs.exists(path), false);
      assertEquals(await mgr.read(), null);
      assertEquals(await createLockfileManager("/project", fs).read(), null);
    });

    it("should invalidate a peer manager's warmed cache after clear", async () => {
      const path = "/project/veryfront.lock";
      const url = "https://cdn.com/mod.ts";
      const fs = createMockFS({
        [path]: JSON.stringify({
          version: 1,
          imports: { [url]: { resolved: url, integrity: "sha256-abc" } },
        }),
      });
      const clearingManager = createLockfileManager("/project", fs);
      const warmedManager = createLockfileManager("/project", fs);

      assertEquals(await warmedManager.has(url), true);
      await clearingManager.clear();

      assertEquals(await warmedManager.has(url), false);
      assertEquals(await warmedManager.get(url), null);
    });

    it("should discard peer pending entries created before clear", async () => {
      const path = "/project/veryfront.lock";
      const url = "https://cdn.com/pending.ts";
      const fs = createMockFS();
      const clearingManager = createLockfileManager("/project", fs);
      const pendingManager = createLockfileManager("/project", fs);

      await pendingManager.set(url, { resolved: url, integrity: "sha256-pending" });
      await clearingManager.clear();
      await pendingManager.flush();

      assertEquals(await fs.exists(path), false);
      assertEquals(await pendingManager.has(url), false);
    });

    it("should keep shared-store clear invalidation scoped to one lockfile", async () => {
      const coordinationKey = "multi-project-test-store";
      const fs = createMockFS({}, coordinationKey);
      const url = "https://cdn.com/pending.ts";
      const projectAManager = createLockfileManager("/project-a", fs);
      const projectBManager = createLockfileManager("/project-b", fs);

      await projectBManager.set(url, { resolved: url, integrity: "sha256-pending" });
      await projectAManager.clear();
      await projectBManager.flush();

      assertEquals(await projectBManager.has(url), true);
      assertEquals(await fs.exists("/project-b/veryfront.lock"), true);
    });

    it("should keep adapter-wide queue invalidation scoped to one lockfile", async () => {
      const fs = createMockFS();
      const url = "https://cdn.com/pending.ts";
      const projectAManager = createLockfileManager("/project-a", fs);
      const projectBManager = createLockfileManager("/project-b", fs);

      await projectBManager.set(url, { resolved: url, integrity: "sha256-pending" });
      await projectAManager.clear();
      await projectBManager.flush();

      assertEquals(await projectBManager.has(url), true);
      assertEquals(await fs.exists("/project-b/veryfront.lock"), true);
    });

    it("should share clear invalidation across canonical project aliases", async () => {
      const backingProjectDir = "/backing/project";
      const backingLockfilePath = `${backingProjectDir}/veryfront.lock`;
      const originalUrl = "https://cdn.com/original.ts";
      const pendingUrl = "https://cdn.com/pending.ts";
      const store = new Map<string, string>([[
        backingLockfilePath,
        JSON.stringify({
          version: 1,
          imports: {
            [originalUrl]: { resolved: originalUrl, integrity: "sha256-original" },
          },
        }),
      ]]);
      const backingPath = (path: string): string =>
        path === "/project/veryfront.lock" || path === "/alias/veryfront.lock"
          ? backingLockfilePath
          : path;
      const fs: FSAdapter = {
        coordinationKey: "aliased-clear-test-store",
        exists: (path) => Promise.resolve(store.has(backingPath(path))),
        readFile: (path) => {
          const content = store.get(backingPath(path));
          return content === undefined
            ? Promise.reject(new Error("ENOENT"))
            : Promise.resolve(content);
        },
        writeFile: (path, content) => {
          store.set(backingPath(path), content);
          return Promise.resolve();
        },
        remove: (path) => {
          store.delete(backingPath(path));
          return Promise.resolve();
        },
        realPath: (path) => {
          if (path === "/project" || path === "/alias") {
            return Promise.resolve(backingProjectDir);
          }
          return Promise.reject(new Error("ENOENT"));
        },
      };
      const projectManager = createLockfileManager("/project", fs);
      const aliasManager = createLockfileManager("/alias", fs);

      assertEquals(await projectManager.has(originalUrl), true);
      await aliasManager.clear();
      assertEquals(await projectManager.has(originalUrl), false);

      await projectManager.set(pendingUrl, {
        resolved: pendingUrl,
        integrity: "sha256-pending",
      });
      await aliasManager.clear();
      await projectManager.flush();

      assertEquals(store.has(backingLockfilePath), false);
      assertEquals(await projectManager.has(pendingUrl), false);
    });

    it("should retry canonical identity after a transient resolution failure", async () => {
      const originalUrl = "https://cdn.com/original.ts";
      const pendingUrl = "https://cdn.com/pending.ts";
      const { fs, store, backingLockfilePath, enableCanonicalization } =
        createDeferredCanonicalAliasFS(JSON.stringify({
          version: 1,
          imports: {
            [originalUrl]: { resolved: originalUrl, integrity: "sha256-original" },
          },
        }));
      const earlyManager = createLockfileManager("/project", fs);

      assertEquals(await earlyManager.has(originalUrl), true);
      await earlyManager.set(pendingUrl, {
        resolved: pendingUrl,
        integrity: "sha256-pending",
      });

      enableCanonicalization();
      await createLockfileManager("/alias", fs).clear();

      assertEquals(await earlyManager.has(originalUrl), false);
      assertEquals(await earlyManager.has(pendingUrl), false);
      await earlyManager.flush();
      assertEquals(store.has(backingLockfilePath), false);
    });

    it("should reuse a timed-out canonicalization while it remains pending", async () => {
      const resolution = Promise.withResolvers<string>();
      let canonicalizationCalls = 0;
      const fs: FSAdapter = {
        ...createMockFS(),
        coordinationKey: "current-canonicalization-single-flight-test-store",
        realPath: () => {
          canonicalizationCalls++;
          return resolution.promise;
        },
      };
      const manager = createLockfileManager("/project", fs);

      assertEquals(await manager.read(), null);
      assertEquals(canonicalizationCalls, 1);
      const retry = manager.read();
      await new Promise((resolve) => setTimeout(resolve, 10));
      assertEquals(canonicalizationCalls, 1);
      resolution.resolve("/project");
      assertEquals(await retry, null);
      assertEquals(canonicalizationCalls, 1);
    });

    it("should not retain or retry a read-only adapter after canonicalization fails", async () => {
      const coordinationKey = "read-only-canonical-failure-test-store";
      const backingFS = createMockFS();
      let failedAdapterRealPathCalls = 0;
      const failedAdapter: FSAdapter = {
        ...backingFS,
        coordinationKey,
        realPath: () => {
          failedAdapterRealPathCalls++;
          return failedAdapterRealPathCalls === 1
            ? Promise.reject(new Error("canonical path unavailable"))
            : new Promise<string>(() => {});
        },
      };
      const healthyAdapter: FSAdapter = {
        ...backingFS,
        coordinationKey,
        realPath: (path) => Promise.resolve(path),
      };

      assertEquals(await createLockfileManager("/failed", failedAdapter).read(), null);
      assertEquals(
        await resolvesWithin(createLockfileManager("/healthy", healthyAdapter).read()),
        true,
      );
      assertEquals(failedAdapterRealPathCalls, 1);
    });

    it("should invalidate a warmed unresolved reader through a healthy alias", async () => {
      const originalUrl = "https://cdn.com/original.ts";
      const coordinationKey = "warmed-unresolved-reader-test-store";
      const { fs, store, backingLockfilePath } = createDeferredCanonicalAliasFS(
        JSON.stringify({
          version: 1,
          imports: {
            [originalUrl]: {
              resolved: originalUrl,
              integrity: "sha256-original",
            },
          },
        }),
      );
      const failedAdapter: FSAdapter = {
        ...fs,
        coordinationKey,
        realPath: () => Promise.reject(new Error("canonical path unavailable")),
      };
      const healthyAdapter: FSAdapter = {
        ...fs,
        coordinationKey,
        realPath: () => Promise.resolve("/backing/project"),
      };
      const warmedManager = createLockfileManager("/project", failedAdapter);

      assertEquals(await warmedManager.has(originalUrl), true);
      await createLockfileManager("/alias", healthyAdapter).clear();

      assertEquals(store.has(backingLockfilePath), false);
      assertEquals(await warmedManager.read(), null);
      assertEquals(await warmedManager.get(originalUrl), null);
      assertEquals(await warmedManager.has(originalUrl), false);
    });

    it("should invalidate a warmed reader without realPath through a healthy alias", async () => {
      const originalUrl = "https://cdn.com/original.ts";
      const coordinationKey = "warmed-no-realpath-reader-test-store";
      const { fs, store, backingLockfilePath } = createDeferredCanonicalAliasFS(
        JSON.stringify({
          version: 1,
          imports: {
            [originalUrl]: {
              resolved: originalUrl,
              integrity: "sha256-original",
            },
          },
        }),
      );
      const readerAdapter: FSAdapter = { ...fs, coordinationKey, realPath: undefined };
      const healthyAdapter: FSAdapter = {
        ...fs,
        coordinationKey,
        realPath: () => Promise.resolve("/backing/project"),
      };
      const warmedManager = createLockfileManager("/project", readerAdapter);

      assertEquals(await warmedManager.has(originalUrl), true);
      await createLockfileManager("/alias", healthyAdapter).clear();

      assertEquals(store.has(backingLockfilePath), false);
      assertEquals(await warmedManager.read(), null);
      assertEquals(await warmedManager.get(originalUrl), null);
      assertEquals(await warmedManager.has(originalUrl), false);
    });

    it("should not let an unresolved project block healthy projects", async () => {
      const coordinationKey = "isolated-historical-canonicalization-test-store";
      const backingFS = createMockFS();
      const unresolvedAdapter: FSAdapter = {
        ...backingFS,
        coordinationKey,
        realPath: () => Promise.reject(new Error("canonical path unavailable")),
      };
      const unresolvedManager = createLockfileManager("/project-a", unresolvedAdapter);
      await unresolvedManager.clear();

      let historicalCalls = 0;
      const healthyAdapter: FSAdapter = {
        ...backingFS,
        coordinationKey,
        realPath: (path) => {
          if (path !== "/project-a") return Promise.resolve(path);
          historicalCalls++;
          return new Promise<string>(() => {});
        },
      };
      const firstRead = createLockfileManager("/project-b", healthyAdapter).read();
      const secondRead = createLockfileManager("/project-c", healthyAdapter).read();

      assertEquals(await resolvesWithin(firstRead, 100), true);
      assertEquals(await resolvesWithin(secondRead, 100), true);
      assertEquals(await firstRead, null);
      assertEquals(await secondRead, null);
      assertEquals(historicalCalls, 1);
    });

    it("should cap unresolved history without blocking a healthy project", async () => {
      const coordinationKey = "bounded-unresolved-history-test-store";
      const backingFS = createMockFS();
      const unresolvedAdapter: FSAdapter = {
        ...backingFS,
        coordinationKey,
        realPath: () => Promise.reject(new Error("canonical path unavailable")),
      };
      const managers = [];
      let limitError: VeryfrontError | undefined;
      for (let index = 0; index < 2_048; index++) {
        const manager = createLockfileManager(`/unresolved-${index}`, unresolvedAdapter);
        managers.push(manager);
        try {
          await manager.read();
        } catch (error) {
          if (!(error instanceof VeryfrontError)) throw error;
          limitError = error;
          break;
        }
      }

      assertExists(limitError);
      assertEquals(
        (limitError.context as { reason?: string }).reason,
        "access-failed",
      );
      const healthyAdapter: FSAdapter = {
        ...backingFS,
        coordinationKey,
        realPath: (path) =>
          path === "/healthy"
            ? Promise.resolve(path)
            : Promise.reject(new Error("historical path unavailable")),
      };
      assertEquals(
        await createLockfileManager("/healthy", healthyAdapter).read(),
        null,
      );
      assertEquals(managers.length < 2_048, true);
    });

    it("should retain durable mutation history after manager owner scope is released", async () => {
      const moduleUrl = new URL("./import-lockfile.ts", import.meta.url).href;
      const source = `
        class InstrumentedWeakRef {
          static instances = [];
          constructor(value) {
            this.value = value;
            InstrumentedWeakRef.instances.push(this);
          }
          deref() {
            return this.value;
          }
        }

        class InstrumentedFinalizationRegistry {
          static instances = [];
          constructor(cleanup) {
            this.cleanup = cleanup;
            this.registrations = 0;
            this.unregistrations = 0;
            this.active = new Map();
            InstrumentedFinalizationRegistry.instances.push(this);
          }
          register(target, heldValue, unregisterToken) {
            if (!unregisterToken || typeof unregisterToken !== "object") {
              throw new Error("missing deterministic unregister token");
            }
            this.registrations++;
            this.active.set(unregisterToken, { target, heldValue });
          }
          unregister(unregisterToken) {
            if (!this.active.delete(unregisterToken)) return false;
            this.unregistrations++;
            return true;
          }
        }

        Object.defineProperty(globalThis, "WeakRef", { value: InstrumentedWeakRef });
        Object.defineProperty(globalThis, "FinalizationRegistry", {
          value: InstrumentedFinalizationRegistry,
        });
        const { createLockfileManager } = await import(
          ${JSON.stringify(moduleUrl)} + "?lifecycle=" + crypto.randomUUID()
        );

        function createBackingStore(coordinationKey, initialLockfile) {
          const canonicalDir = "/backing/project";
          const canonicalFile = canonicalDir + "/veryfront.lock";
          const store = new Map();
          if (initialLockfile !== undefined) store.set(canonicalFile, initialLockfile);
          const backingPath = (path) => path.endsWith("/veryfront.lock") ? canonicalFile : path;
          return {
            canonicalDir,
            canonicalFile,
            store,
            adapter: {
              coordinationKey,
              exists: (path) => Promise.resolve(store.has(backingPath(path))),
              readFile: (path) => {
                const value = store.get(backingPath(path));
                return value === undefined
                  ? Promise.reject(new Error("ENOENT"))
                  : Promise.resolve(value);
              },
              writeFile: (path, value) => {
                store.set(backingPath(path), value);
                return Promise.resolve();
              },
              remove: (path) => {
                store.delete(backingPath(path));
                return Promise.resolve();
              },
            },
          };
        }

        function snapshotFinalizers() {
          return InstrumentedFinalizationRegistry.instances.map((registry) => ({
            registrations: registry.registrations,
            unregistrations: registry.unregistrations,
            active: registry.active.size,
          }));
        }

        async function runLifecycleScenario() {
          const stable = createBackingStore("stable-" + crypto.randomUUID());
          const stableManager = createLockfileManager("/project", {
            ...stable.adapter,
            realPath: () => Promise.resolve(stable.canonicalDir),
          });
          await stableManager.read();
          const afterFirstRead = snapshotFinalizers();
          const weakReferencesAfterFirstRead = InstrumentedWeakRef.instances.length;
          for (let index = 0; index < 1_000; index++) await stableManager.read();
          const afterRepeatedReads = snapshotFinalizers();
          const weakReferencesAfterRepeatedReads = InstrumentedWeakRef.instances.length;

          const aliases = createBackingStore("aliases-" + crypto.randomUUID());
          const unresolved = () => ({
            ...aliases.adapter,
            realPath: () => Promise.reject(new Error("unresolved")),
          });
          await createLockfileManager("/alias-a", unresolved()).read();
          await createLockfileManager("/alias-b", unresolved()).read();
          const beforeRootMerge = snapshotFinalizers();
          await createLockfileManager("/bridge", {
            ...aliases.adapter,
            realPath: () => Promise.resolve(aliases.canonicalDir),
          }).read();
          const afterRootMerge = snapshotFinalizers();

          return {
            stableRegistrations: JSON.stringify(afterFirstRead) ===
              JSON.stringify(afterRepeatedReads),
            stableWeakReferences: weakReferencesAfterFirstRead ===
              weakReferencesAfterRepeatedReads,
            rootReplacementUnregistered: afterRootMerge.some((entry, index) =>
              entry.unregistrations > beforeRootMerge[index].unregistrations
            ),
            tokenLifecycleBalanced: afterRootMerge.every((entry) =>
              entry.active === entry.registrations - entry.unregistrations
            ),
          };
        }

        async function runClearScenario() {
          const pendingUrl = "https://cdn.test/pending.ts";
          const backing = createBackingStore("gc-clear-" + crypto.randomUUID());
          const pending = createLockfileManager("/alias", {
            ...backing.adapter,
            realPath: () => Promise.reject(new Error("unresolved")),
          });
          await pending.set(pendingUrl, {
            resolved: pendingUrl,
            integrity: "sha256-pending",
          });

          async function clearThenLoseOwner() {
            const fs = {
              ...backing.adapter,
              realPath: () => Promise.reject(new Error("unresolved")),
            };
            const manager = createLockfileManager("/project", fs);
            await manager.clear();
          }

          await clearThenLoseOwner();
          const healthy = createLockfileManager("/bridge", {
            ...backing.adapter,
            realPath: () => Promise.resolve(backing.canonicalDir),
          });
          await healthy.read();
          await pending.flush();

          return {
            ownerScopeReleased: true,
            diskExists: backing.store.has(backing.canonicalFile),
            pendingHas: await pending.has(pendingUrl),
          };
        }

        async function runWriteScenario() {
          const oldUrl = "https://cdn.test/old.ts";
          const freshUrl = "https://cdn.test/fresh.ts";
          const backing = createBackingStore(
            "gc-write-" + crypto.randomUUID(),
            JSON.stringify({
              version: 1,
              imports: {
                [oldUrl]: { resolved: oldUrl, integrity: "sha256-old" },
              },
            }),
          );
          const stale = createLockfileManager("/alias", {
            ...backing.adapter,
            realPath: () => Promise.reject(new Error("unresolved")),
          });
          await stale.read();

          async function writeThenLoseOwner() {
            const fs = {
              ...backing.adapter,
              realPath: () => Promise.reject(new Error("unresolved")),
            };
            const manager = createLockfileManager("/project", fs);
            await manager.write({
              version: 1,
              imports: {
                [freshUrl]: { resolved: freshUrl, integrity: "sha256-fresh" },
              },
            });
          }

          await writeThenLoseOwner();
          const healthy = createLockfileManager("/bridge", {
            ...backing.adapter,
            realPath: () => Promise.resolve(backing.canonicalDir),
          });
          await healthy.read();
          const disk = JSON.parse(backing.store.get(backing.canonicalFile));

          return {
            ownerScopeReleased: true,
            diskHasOld: Object.hasOwn(disk.imports, oldUrl),
            diskHasFresh: Object.hasOwn(disk.imports, freshUrl),
            staleHasOld: await stale.has(oldUrl),
            staleHasFresh: await stale.has(freshUrl),
          };
        }

        console.log(JSON.stringify({
          lifecycle: await runLifecycleScenario(),
          clear: await runClearScenario(),
          write: await runWriteScenario(),
        }));
      `;
      const output = await new Deno.Command(Deno.execPath(), {
        args: [
          "eval",
          "--no-check",
          "--frozen",
          "--config=deno.json",
          source,
        ],
        stdout: "piped",
        stderr: "piped",
      }).output();
      const stderr = new TextDecoder().decode(output.stderr);
      assertEquals(output.success, true, stderr);
      assertEquals(
        JSON.parse(new TextDecoder().decode(output.stdout)),
        {
          lifecycle: {
            stableRegistrations: true,
            stableWeakReferences: true,
            rootReplacementUnregistered: true,
            tokenLifecycleBalanced: true,
          },
          clear: {
            ownerScopeReleased: true,
            diskExists: false,
            pendingHas: false,
          },
          write: {
            ownerScopeReleased: true,
            diskHasOld: false,
            diskHasFresh: true,
            staleHasOld: false,
            staleHasFresh: true,
          },
        },
      );
    });

    it("should preserve shared coordination after post-import intrinsic poisoning", async () => {
      const moduleUrl = new URL("./import-lockfile.ts", import.meta.url).href;
      const source = `
        const apply = Reflect.apply;
        const defineProperty = Object.defineProperty;
        const getOwnPropertyDescriptor = Object.getOwnPropertyDescriptor;
        const getPrototypeOf = Object.getPrototypeOf;
        const hasOwn = Object.hasOwn;
        const NativeJSON = JSON;
        const NativeFinalizationRegistry = FinalizationRegistry;
        const NativeMap = Map;
        const NativeNumber = Number;
        const NativePromise = Promise;
        const NativeURL = URL;
        const NativeWeakMap = WeakMap;
        const NativeWeakRef = WeakRef;
        const jsonStringify = JSON.stringify;
        const nativeSetTimeout = setTimeout;
        const promiseReject = Promise.reject;
        const promiseResolve = Promise.resolve;
        const mapIteratorPrototype = getPrototypeOf(new NativeMap().entries());
        const arrayIteratorDescriptor = getOwnPropertyDescriptor(
          Array.prototype,
          Symbol.iterator,
        );
        const clearTimeoutDescriptor = getOwnPropertyDescriptor(globalThis, "clearTimeout");
        const jsonParseDescriptor = getOwnPropertyDescriptor(NativeJSON, "parse");
        const jsonStringifyDescriptor = getOwnPropertyDescriptor(NativeJSON, "stringify");
        const numberIsSafeIntegerDescriptor = getOwnPropertyDescriptor(
          NativeNumber,
          "isSafeInteger",
        );
        const setTimeoutDescriptor = getOwnPropertyDescriptor(globalThis, "setTimeout");
        const urlDescriptor = getOwnPropertyDescriptor(globalThis, "URL");
        const urlToStringDescriptor = getOwnPropertyDescriptor(NativeURL.prototype, "toString");

        const resolved = (value) => apply(promiseResolve, NativePromise, [value]);
        const rejected = (reason) => apply(promiseReject, NativePromise, [reason]);
        const stringify = (value) => apply(jsonStringify, NativeJSON, [value]);
        const waitForTurn = () => new NativePromise((resolve) => nativeSetTimeout(resolve, 0));

        const { createLockfileManager, resolveImportUrl } = await import(
          ${JSON.stringify(moduleUrl)} + "?primordials=" + crypto.randomUUID()
        );

        function throwing(label) {
          return function () {
            throw new Error("poisoned intrinsic invoked: " + label);
          };
        }
        function poisonMethod(owner, key, label) {
          defineProperty(owner, key, {
            configurable: true,
            writable: true,
            value: throwing(label),
          });
        }

        poisonMethod(NativeMap.prototype, "get", "Map.get");
        poisonMethod(NativeMap.prototype, "set", "Map.set");
        poisonMethod(NativeMap.prototype, "delete", "Map.delete");
        poisonMethod(NativeMap.prototype, "clear", "Map.clear");
        poisonMethod(NativeMap.prototype, "entries", "Map.entries");
        poisonMethod(NativeMap.prototype, Symbol.iterator, "Map.iterator");
        defineProperty(NativeMap.prototype, "size", {
          configurable: true,
          get: throwing("Map.size"),
        });
        poisonMethod(mapIteratorPrototype, "next", "MapIterator.next");
        poisonMethod(NativeWeakMap.prototype, "get", "WeakMap.get");
        poisonMethod(NativeWeakMap.prototype, "set", "WeakMap.set");
        poisonMethod(NativeWeakRef.prototype, "deref", "WeakRef.deref");
        poisonMethod(
          NativeFinalizationRegistry.prototype,
          "register",
          "FinalizationRegistry.register",
        );
        poisonMethod(
          NativeFinalizationRegistry.prototype,
          "unregister",
          "FinalizationRegistry.unregister",
        );
        poisonMethod(NativePromise, "all", "Promise.all");
        poisonMethod(NativePromise, "race", "Promise.race");
        poisonMethod(NativePromise, "reject", "Promise.reject");
        poisonMethod(NativePromise, "resolve", "Promise.resolve");
        poisonMethod(NativePromise.prototype, "then", "Promise.then");
        poisonMethod(NativePromise.prototype, "finally", "Promise.finally");
        poisonMethod(NativeJSON, "parse", "JSON.parse");
        poisonMethod(NativeJSON, "stringify", "JSON.stringify");
        poisonMethod(NativeNumber, "isSafeInteger", "Number.isSafeInteger");
        poisonMethod(NativeURL.prototype, "toString", "URL.toString");
        poisonMethod(Array.prototype, "map", "Array.map");
        poisonMethod(Array.prototype, Symbol.iterator, "Array.iterator");

        const PoisonedConstructor = class {
          constructor() {
            throw new Error("poisoned intrinsic constructor invoked");
          }
        };
        defineProperty(globalThis, "Map", { configurable: true, value: PoisonedConstructor });
        defineProperty(globalThis, "WeakMap", { configurable: true, value: PoisonedConstructor });
        defineProperty(globalThis, "WeakRef", { configurable: true, value: PoisonedConstructor });
        defineProperty(globalThis, "FinalizationRegistry", {
          configurable: true,
          value: PoisonedConstructor,
        });
        defineProperty(globalThis, "Promise", { configurable: true, value: PoisonedConstructor });
        defineProperty(globalThis, "URL", { configurable: true, value: PoisonedConstructor });
        defineProperty(globalThis, "setTimeout", {
          configurable: true,
          value: throwing("setTimeout"),
        });
        defineProperty(globalThis, "clearTimeout", {
          configurable: true,
          value: throwing("clearTimeout"),
        });

        function createBackingStore(coordinationKey, initialLockfile) {
          const canonicalDir = "/backing/" + coordinationKey;
          const canonicalFile = canonicalDir + "/veryfront.lock";
          const files = Object.create(null);
          if (initialLockfile !== undefined) files[canonicalFile] = initialLockfile;
          const backingPath = (path) => path.endsWith("/veryfront.lock")
            ? canonicalFile
            : path;
          const adapter = {
            coordinationKey,
            exists: (path) => resolved(hasOwn(files, backingPath(path))),
            readFile: (path) => {
              const key = backingPath(path);
              return hasOwn(files, key)
                ? resolved(files[key])
                : rejected(new Error("ENOENT"));
            },
            writeFile: (path, value) => {
              files[backingPath(path)] = value;
              return resolved(undefined);
            },
            remove: (path) => {
              delete files[backingPath(path)];
              return resolved(undefined);
            },
          };
          return { adapter, canonicalDir, canonicalFile, files };
        }

        async function runSteadyReads() {
          const backing = createBackingStore("steady-" + crypto.randomUUID());
          const manager = createLockfileManager("/project", {
            ...backing.adapter,
            realPath: () => resolved(backing.canonicalDir),
          });
          await manager.read();
          for (let index = 0; index < 100; index++) await manager.read();
          return true;
        }

        async function runTimeoutRetry() {
          const backing = createBackingStore("timeout-" + crypto.randomUUID());
          let canonicalizationCalls = 0;
          let completeCanonicalization;
          const manager = createLockfileManager("/project", {
            ...backing.adapter,
            realPath: () => {
              canonicalizationCalls++;
              return new NativePromise((resolve) => {
                completeCanonicalization = resolve;
              });
            },
          });
          await manager.read();
          completeCanonicalization(backing.canonicalDir);
          await waitForTurn();
          await manager.read();
          return canonicalizationCalls === 1;
        }

        async function runHistoricalIsolation() {
          const backing = createBackingStore("history-" + crypto.randomUUID());
          const unresolved = createLockfileManager("/missing", {
            ...backing.adapter,
            realPath: () => rejected(new Error("missing project")),
          });
          await unresolved.clear();

          let historicalCalls = 0;
          const healthy = createLockfileManager("/healthy", {
            ...backing.adapter,
            realPath: (path) => {
              if (path === "/healthy") return resolved(backing.canonicalDir);
              historicalCalls++;
              return new NativePromise(() => {});
            },
          });
          const startedAt = Date.now();
          const value = await healthy.read();
          return value === null && historicalCalls === 1 && Date.now() - startedAt < 750;
        }

        async function runRootReplacement() {
          const oldUrl = "https://cdn.test/old.ts";
          const backing = createBackingStore(
            "roots-" + crypto.randomUUID(),
            stringify({
              version: 1,
              imports: {
                [oldUrl]: { resolved: oldUrl, integrity: "sha256-old" },
              },
            }),
          );
          const unresolvedAdapter = () => ({
            ...backing.adapter,
            realPath: () => rejected(new Error("unresolved alias")),
          });
          const first = createLockfileManager("/alias-a", unresolvedAdapter());
          const second = createLockfileManager("/alias-b", unresolvedAdapter());
          await first.read();
          await second.read();

          const bridge = createLockfileManager("/bridge", {
            ...backing.adapter,
            realPath: () => resolved(backing.canonicalDir),
          });
          await bridge.read();
          await bridge.clear();
          return !(await first.has(oldUrl)) && !(await second.has(oldUrl));
        }

        async function runFailClosedInputs() {
          const backing = createBackingStore("input-" + crypto.randomUUID());
          const manager = createLockfileManager("/project", backing.adapter);
          let rejectedInvalidEntry = false;
          try {
            await manager.set("https://cdn.test/invalid.ts", {
              resolved: "https://cdn.test/invalid.ts",
              integrity: "sha256-invalid",
              dependencies: [42],
            });
          } catch {
            rejectedInvalidEntry = true;
          }
          return rejectedInvalidEntry;
        }

        function runCapturedUrlIntrinsic() {
          return resolveImportUrl(
            "./dependency.ts",
            "https://example.test/project/main.ts",
          ) === "https://example.test/project/dependency.ts";
        }

        const result = {
          steadyReads: await runSteadyReads(),
          timeoutRetry: await runTimeoutRetry(),
          historicalIsolation: await runHistoricalIsolation(),
          rootReplacement: await runRootReplacement(),
          failClosedInputs: await runFailClosedInputs(),
          capturedUrlIntrinsic: runCapturedUrlIntrinsic(),
        };
        // Node's process-exit shim iterates an internal listener array after
        // this regression completes. Restore only that runtime prerequisite;
        // every asserted lockfile operation above ran with the iterator
        // poisoned.
        defineProperty(Array.prototype, Symbol.iterator, arrayIteratorDescriptor);
        defineProperty(NativeJSON, "parse", jsonParseDescriptor);
        defineProperty(NativeJSON, "stringify", jsonStringifyDescriptor);
        defineProperty(NativeNumber, "isSafeInteger", numberIsSafeIntegerDescriptor);
        defineProperty(NativeURL.prototype, "toString", urlToStringDescriptor);
        if (urlDescriptor) defineProperty(globalThis, "URL", urlDescriptor);
        if (setTimeoutDescriptor) defineProperty(globalThis, "setTimeout", setTimeoutDescriptor);
        if (clearTimeoutDescriptor) defineProperty(globalThis, "clearTimeout", clearTimeoutDescriptor);
        console.log(stringify(result));
      `;
      const output = await new Deno.Command(Deno.execPath(), {
        args: [
          "eval",
          "--no-check",
          "--frozen",
          "--config=deno.json",
          source,
        ],
        stdout: "piped",
        stderr: "piped",
      }).output();
      const stderr = new TextDecoder().decode(output.stderr);
      assertEquals(output.success, true, stderr);
      assertEquals(
        JSON.parse(new TextDecoder().decode(output.stdout)),
        {
          steadyReads: true,
          timeoutRetry: true,
          historicalIsolation: true,
          rootReplacement: true,
          failClosedInputs: true,
          capturedUrlIntrinsic: true,
        },
      );
    });

    it("should reconcile mutation state through the current healthy adapter", async () => {
      const pendingUrl = "https://cdn.com/pending.ts";
      const coordinationKey = "healthy-canonical-reconciliation-test-store";
      const { fs, store, backingLockfilePath } = createDeferredCanonicalAliasFS();
      let failedAdapterRealPathCalls = 0;
      const failedAdapter: FSAdapter = {
        ...fs,
        coordinationKey,
        realPath: () => {
          failedAdapterRealPathCalls++;
          return failedAdapterRealPathCalls === 1
            ? Promise.reject(new Error("canonical path unavailable"))
            : new Promise<string>(() => {});
        },
      };
      const healthyAdapter: FSAdapter = {
        ...fs,
        coordinationKey,
        realPath: () => Promise.resolve("/backing/project"),
      };
      const pendingManager = createLockfileManager("/project", failedAdapter);

      await pendingManager.set(pendingUrl, {
        resolved: pendingUrl,
        integrity: "sha256-pending",
      });
      assertEquals(
        await resolvesWithin(createLockfileManager("/alias", healthyAdapter).clear()),
        true,
      );
      assertEquals(failedAdapterRealPathCalls, 1);
      assertEquals(store.has(backingLockfilePath), false);
    });

    it("should order clears across shared states that are canonicalized later", async () => {
      const pendingUrl = "https://cdn.com/pending.ts";
      const { fs, store, backingLockfilePath, enableCanonicalization } =
        createDeferredCanonicalAliasFS();
      const projectManager = createLockfileManager("/project", fs);
      const aliasManager = createLockfileManager("/alias", fs);

      await projectManager.clear();
      await projectManager.set(pendingUrl, {
        resolved: pendingUrl,
        integrity: "sha256-pending",
      });
      await aliasManager.clear();

      enableCanonicalization();
      await projectManager.flush();

      assertEquals(store.has(backingLockfilePath), false);
      assertEquals(await projectManager.has(pendingUrl), false);
    });

    it("should not reparent state during an in-flight clear", async () => {
      const pendingUrl = "https://cdn.com/pending.ts";
      const { fs, store, backingLockfilePath, enableCanonicalization } =
        createDeferredCanonicalAliasFS(JSON.stringify({ version: 1, imports: {} }));
      const projectManager = createLockfileManager("/project", fs);
      const aliasManager = createLockfileManager("/alias", fs);
      const removeStarted = Promise.withResolvers<void>();
      const releaseRemove = Promise.withResolvers<void>();
      const remove = fs.remove;
      assertExists(remove);
      fs.remove = async (path): Promise<void> => {
        removeStarted.resolve();
        await releaseRemove.promise;
        await remove(path);
      };

      await projectManager.set(pendingUrl, {
        resolved: pendingUrl,
        integrity: "sha256-pending",
      });
      const clear = aliasManager.clear();
      await removeStarted.promise;

      enableCanonicalization();
      const bridgeRead = createLockfileManager("/project", fs).has(pendingUrl);
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
      releaseRemove.resolve();

      await clear;
      assertEquals(await bridgeRead, false);
      await projectManager.flush();
      assertEquals(store.has(backingLockfilePath), false);
      assertEquals(await projectManager.has(pendingUrl), false);
    });

    it("should retain entries set after a disconnected clear when states merge", async () => {
      const pendingUrl = "https://cdn.com/pending.ts";
      const { fs, store, backingLockfilePath, enableCanonicalization } =
        createDeferredCanonicalAliasFS();
      const projectManager = createLockfileManager("/project", fs);
      const aliasManager = createLockfileManager("/alias", fs);

      await projectManager.clear();
      await aliasManager.set(pendingUrl, {
        resolved: pendingUrl,
        integrity: "sha256-pending",
      });

      enableCanonicalization();
      assertEquals(await projectManager.has(pendingUrl), false);
      await aliasManager.flush();

      assertEquals(store.has(backingLockfilePath), true);
      assertEquals(await aliasManager.has(pendingUrl), true);
    });

    it("should share clear invalidation with mixed realPath support", async () => {
      const path = "/project/veryfront.lock";
      const originalUrl = "https://cdn.com/original.ts";
      const pendingUrl = "https://cdn.com/pending.ts";
      const backingFS = createMockFS({
        [path]: JSON.stringify({
          version: 1,
          imports: {
            [originalUrl]: { resolved: originalUrl, integrity: "sha256-original" },
          },
        }),
      });
      const coordinationKey = "mixed-realpath-clear-test-store";
      const fsWithoutRealPath: FSAdapter = { ...backingFS, coordinationKey };
      const fsWithRealPath: FSAdapter = {
        ...backingFS,
        coordinationKey,
        realPath: (projectDir) => Promise.resolve(`/backing${projectDir}`),
      };
      const logicalManager = createLockfileManager("/project", fsWithoutRealPath);
      const canonicalManager = createLockfileManager("/project", fsWithRealPath);

      assertEquals(await logicalManager.has(originalUrl), true);
      await canonicalManager.clear();
      assertEquals(await logicalManager.has(originalUrl), false);

      await logicalManager.set(pendingUrl, {
        resolved: pendingUrl,
        integrity: "sha256-pending",
      });
      await canonicalManager.clear();
      await logicalManager.flush();

      assertEquals(await backingFS.exists(path), false);
      assertEquals(await logicalManager.has(pendingUrl), false);
    });

    it("should refresh a peer manager's warmed cache after a write", async () => {
      const path = "/project/veryfront.lock";
      const originalUrl = "https://cdn.com/original.ts";
      const replacementUrl = "https://cdn.com/replacement.ts";
      const fs = createMockFS({
        [path]: JSON.stringify({
          version: 1,
          imports: {
            [originalUrl]: { resolved: originalUrl, integrity: "sha256-original" },
          },
        }),
      });
      const writingManager = createLockfileManager("/project", fs);
      const warmedManager = createLockfileManager("/project", fs);
      assertEquals(await warmedManager.has(originalUrl), true);

      await writingManager.write({
        version: 1,
        imports: {
          [replacementUrl]: { resolved: replacementUrl, integrity: "sha256-replacement" },
        },
      });

      assertEquals(await warmedManager.has(originalUrl), false);
      assertEquals(await warmedManager.has(replacementUrl), true);
    });

    it("should flush dirty data to disk", async () => {
      const fs = createMockFS();
      const mgr = createLockfileManager("/project", fs);

      await mgr.set("https://cdn.com/mod.ts", {
        resolved: "https://cdn.com/mod.ts",
        integrity: "sha256-abc",
      });
      await mgr.flush();

      assertEquals(await fs.exists("/project/veryfront.lock"), true);
    });

    it("should persist a __proto__ module specifier without mutating the imports prototype", async () => {
      const fs = createMockFS();
      const mgr = createLockfileManager("/project", fs);
      const entry = {
        resolved: "https://cdn.com/proto.ts",
        integrity: "sha256-proto",
      };

      await mgr.set("__proto__", entry);
      await mgr.flush();

      const inMemory = await mgr.read();
      assertExists(inMemory);
      assertEquals(Object.getPrototypeOf(inMemory.imports), Object.prototype);
      // deno-lint-ignore no-prototype-builtins -- verifies public consumers can call this directly.
      assertEquals(inMemory.imports.hasOwnProperty("__proto__"), true);
      assertEquals(inMemory.imports["__proto__"], entry);
      const onDisk = JSON.parse(await fs.readFile("/project/veryfront.lock")) as LockfileData;
      assertEquals(Object.keys(onDisk.imports), ["__proto__"]);
      assertEquals(onDisk.imports["__proto__"], entry);
    });

    it("should not flush when not dirty", async () => {
      const fs = createMockFS();
      const mgr = createLockfileManager("/project", fs);

      await mgr.flush();
      assertEquals(await fs.exists("/project/veryfront.lock"), false);
    });

    it("should fail explicitly on a format mismatch instead of substituting an empty lockfile", async () => {
      const data = { version: 99, imports: { x: { resolved: "x", integrity: "y" } } };
      const fs = createMockFS({ "/project/veryfront.lock": JSON.stringify(data) });
      const mgr = createLockfileManager("/project", fs);

      const error = await assertRejects(() => mgr.read(), VeryfrontError);
      assertExists(error);
      if (!(error instanceof VeryfrontError)) throw new Error("expected VeryfrontError");
      assertEquals(error.slug, "lockfile-format-mismatch");
      assertEquals(error.title, "Lockfile format is not supported");
      assertExists(error.detail);
      assertStringIncludes(error.detail, "format version 99");
      assertStringIncludes(error.detail, "supports version 1");
      assertEquals(error.detail.includes("/project/veryfront.lock"), false);
      assertEquals(
        error.suggestion,
        "Upgrade Veryfront or migrate the lockfile before modifying it",
      );
      const context = error.context as { actualVersion?: number; lockfilePath?: string };
      assertEquals(context.actualVersion, 99);
      assertEquals(context.lockfilePath, "/project/veryfront.lock");
    });

    it("should treat a non-numeric lockfile version as invalid structure", async () => {
      const data = { version: "1", imports: {} };
      const fs = createMockFS({ "/project/veryfront.lock": JSON.stringify(data) });
      const mgr = createLockfileManager("/project", fs);

      const error = await assertRejects(() => mgr.read(), VeryfrontError);

      assertExists(error);
      if (!(error instanceof VeryfrontError)) throw new Error("expected VeryfrontError");
      assertEquals(error.slug, "lockfile-read-error");
      assertExists(error.detail);
      assertStringIncludes(error.detail, "invalid structure");
      assertEquals(error.detail.includes("/project/veryfront.lock"), false);
      const context = error.context as { lockfilePath?: string; reason?: string };
      assertEquals(context.lockfilePath, "/project/veryfront.lock");
      assertEquals(context.reason, "invalid-structure");
    });

    it("should reject a missing version inherited from Object.prototype", async () => {
      const previousVersion = Object.getOwnPropertyDescriptor(Object.prototype, "version");
      Object.defineProperty(Object.prototype, "version", {
        configurable: true,
        value: 1,
      });

      try {
        const fs = createMockFS({ "/project/veryfront.lock": JSON.stringify({ imports: {} }) });
        const mgr = createLockfileManager("/project", fs);

        const error = await assertRejects(() => mgr.read(), VeryfrontError);

        assertExists(error);
        if (!(error instanceof VeryfrontError)) throw new Error("expected VeryfrontError");
        assertEquals(error.slug, "lockfile-read-error");
        assertEquals((error.context as { reason?: string }).reason, "invalid-structure");
      } finally {
        if (previousVersion === undefined) Reflect.deleteProperty(Object.prototype, "version");
        else Object.defineProperty(Object.prototype, "version", previousVersion);
      }
    });

    it("should reject missing imports inherited from Object.prototype", async () => {
      const previousImports = Object.getOwnPropertyDescriptor(Object.prototype, "imports");
      Object.defineProperty(Object.prototype, "imports", {
        configurable: true,
        value: {},
      });

      try {
        const fs = createMockFS({ "/project/veryfront.lock": JSON.stringify({ version: 1 }) });
        const mgr = createLockfileManager("/project", fs);

        const error = await assertRejects(() => mgr.read(), VeryfrontError);

        assertExists(error);
        if (!(error instanceof VeryfrontError)) throw new Error("expected VeryfrontError");
        assertEquals(error.slug, "lockfile-read-error");
        assertEquals((error.context as { reason?: string }).reason, "invalid-structure");
      } finally {
        if (previousImports === undefined) Reflect.deleteProperty(Object.prototype, "imports");
        else Object.defineProperty(Object.prototype, "imports", previousImports);
      }
    });

    it("rejects inherited required entry fields and ignores inherited optional fields", async () => {
      const fieldNames = ["resolved", "integrity", "dependencies", "fetchedAt"] as const;
      const descriptors = new Map(
        fieldNames.map((
          field,
        ) => [field, Object.getOwnPropertyDescriptor(Object.prototype, field)]),
      );

      try {
        Object.defineProperties(Object.prototype, {
          resolved: { configurable: true, value: "https://poisoned.example/mod.ts" },
          integrity: { configurable: true, value: "sha256-poisoned" },
          dependencies: { configurable: true, value: ["https://poisoned.example/dep.ts"] },
          fetchedAt: { configurable: true, value: "poisoned-date" },
        });

        const invalidFs = createMockFS({
          "/invalid/veryfront.lock": '{"version":1,"imports":{"package":{}}}',
        });
        const invalidManager = createLockfileManager("/invalid", invalidFs);
        const error = await assertRejects(() => invalidManager.read(), VeryfrontError);
        assertExists(error);
        if (!(error instanceof VeryfrontError)) throw new Error("expected VeryfrontError");
        assertEquals(error.slug, "lockfile-read-error");
        assertEquals((error.context as { reason?: string }).reason, "invalid-structure");

        const validFs = createMockFS({
          "/valid/veryfront.lock": JSON.stringify({
            version: 1,
            imports: {
              package: { resolved: "https://example.com/mod.ts", integrity: "sha256-valid" },
            },
          }),
        });
        const validManager = createLockfileManager("/valid", validFs);
        const validRead = await validManager.read();
        assertEquals(validRead, {
          version: 1,
          imports: {
            package: { resolved: "https://example.com/mod.ts", integrity: "sha256-valid" },
          },
        });
        assertExists(validRead);
        assertEquals(Object.getPrototypeOf(validRead.imports), Object.prototype);
        // deno-lint-ignore no-prototype-builtins -- verifies public consumers can call this directly.
        assertEquals(validRead.imports.hasOwnProperty("package"), true);
      } finally {
        for (const field of fieldNames) {
          const descriptor = descriptors.get(field);
          if (descriptor) Object.defineProperty(Object.prototype, field, descriptor);
          else Reflect.deleteProperty(Object.prototype, field);
        }
      }
    });

    it("should preserve a newer-format lockfile on disk after a format mismatch", async () => {
      const fs = createMockFS();
      const mgr = createLockfileManager("/project", fs);
      await mgr.set("https://cdn.com/mod.ts", {
        resolved: "https://cdn.com/mod.ts",
        integrity: "sha256-abc",
      });

      const newerContent = JSON.stringify({
        version: 99,
        imports: { "https://cdn.com/newer.ts": { resolved: "x", integrity: "y" } },
      });
      await fs.writeFile("/project/veryfront.lock", newerContent);

      // A flush with pending work must fail rather than overwrite the newer-format file.
      await assertRejects(() => mgr.flush(), VeryfrontError);

      assertEquals(await fs.readFile("/project/veryfront.lock"), newerContent);
    });

    it("should write import keys in deterministic code-unit order", async () => {
      const fs = createMockFS();
      const mgr = createLockfileManager("/project", fs);

      await mgr.write({
        version: 1,
        imports: {
          a: { resolved: "a", integrity: "sha256-a" },
          B: { resolved: "B", integrity: "sha256-b" },
        },
      });

      const onDisk = JSON.parse(await fs.readFile("/project/veryfront.lock")) as LockfileData;
      assertEquals(Object.keys(onDisk.imports), ["B", "a"]);
    });

    it("should clear a newer-format lockfile as an explicit recovery operation", async () => {
      const fs = createMockFS();
      const mgr = createLockfileManager("/project", fs);
      const pendingUrl = "https://cdn.com/pending.ts";
      const pendingEntry = {
        resolved: pendingUrl,
        integrity: "sha256-pending",
      };
      await mgr.set(pendingUrl, pendingEntry);

      const newerContent = JSON.stringify({
        version: 99,
        imports: { "https://cdn.com/newer.ts": { resolved: "x", integrity: "y" } },
      });
      await fs.writeFile("/project/veryfront.lock", newerContent);

      await mgr.clear();

      assertEquals(await fs.exists("/project/veryfront.lock"), false);
      assertEquals(await mgr.get(pendingUrl), null);
    });

    it("should preserve disk and cached state when lockfile removal fails", async () => {
      const fs = createMockFS();
      const mgr = createLockfileManager("/project", fs);
      const url = "https://cdn.com/mod.ts";
      const entry = { resolved: url, integrity: "sha256-abc" };
      await mgr.set(url, entry);
      await mgr.flush();
      const before = await fs.readFile("/project/veryfront.lock");
      fs.remove = () => Promise.reject(new Error("remove failed"));

      await assertRejects(() => mgr.clear(), Error, "remove failed");

      assertEquals(await fs.readFile("/project/veryfront.lock"), before);
      assertEquals(await mgr.get(url), entry);
    });

    it("should preserve pending state when clear cannot inspect the lockfile path", async () => {
      const fs = createMockFS();
      const mgr = createLockfileManager("/project", fs);
      const url = "https://cdn.com/pending.ts";
      const entry = { resolved: url, integrity: "sha256-pending" };
      await mgr.set(url, entry);
      fs.exists = () => Promise.reject(new Error("permission denied"));

      const error = await assertRejects(() => mgr.clear(), VeryfrontError);

      assertExists(error);
      if (!(error instanceof VeryfrontError)) throw new Error("expected VeryfrontError");
      assertEquals(error.slug, "lockfile-read-error");
      assertExists(error.detail);
      assertEquals(error.detail.includes("/project/veryfront.lock"), false);
      const context = error.context as { lockfilePath?: string; reason?: string };
      assertEquals(context.lockfilePath, "/project/veryfront.lock");
      assertEquals(context.reason, "access-failed");
      assertEquals(await mgr.get(url), entry);
    });

    it("should persist an empty lockfile when the adapter cannot remove files", async () => {
      const path = "/project/veryfront.lock";
      const url = "https://cdn.com/mod.ts";
      const backingFS = createMockFS({
        [path]: JSON.stringify({
          version: 1,
          imports: { [url]: { resolved: url, integrity: "sha256-abc" } },
        }),
      });
      const fs: FSAdapter = {
        coordinationKey: "non-removing-test-store",
        exists: backingFS.exists,
        readFile: backingFS.readFile,
        writeFile: backingFS.writeFile,
      };
      const mgr = createLockfileManager("/project", fs);

      await mgr.clear();

      assertEquals(JSON.parse(await fs.readFile(path)), createEmptyLockfile());
      const freshManager = createLockfileManager("/project", fs);
      assertEquals(await freshManager.has(url), false);
    });

    it("should keep a cold reader behind an in-flight lockfile replacement", async () => {
      const path = "/project/veryfront.lock";
      const baseUrl = "https://cdn.com/base.ts";
      const addedUrl = "https://cdn.com/added.ts";
      const fs = createMockFS({
        [path]: JSON.stringify({
          version: 1,
          imports: {
            [baseUrl]: { resolved: baseUrl, integrity: "sha256-base" },
          },
        }),
      });
      const writer = createLockfileManager("/project", fs);
      await writer.set(addedUrl, { resolved: addedUrl, integrity: "sha256-added" });

      const partialRead = Promise.withResolvers<void>();
      const readFile = fs.readFile;
      fs.readFile = async (filePath: string): Promise<string> => {
        const content = await readFile(filePath);
        if (content === "{") partialRead.resolve();
        return content;
      };
      const gate = exposePartialNextWrite(fs);
      const flush = writer.flush();
      await gate.started;

      const coldReader = createLockfileManager("/project", fs);
      const coldRead = coldReader.read().then(
        (value) => ({ ok: true as const, value }),
        (error: unknown) => ({ ok: false as const, error }),
      );
      const observedPartialContent = await resolvesWithin(partialRead.promise);
      gate.release();
      await flush;

      assertEquals(observedPartialContent, false);
      const result = await coldRead;
      if (!result.ok) throw result.error;
      assertEquals(Object.keys(result.value?.imports ?? {}).sort(), [addedUrl, baseUrl]);
    });

    it("should keep a cold reader behind an in-flight clear fallback write", async () => {
      const path = "/project/veryfront.lock";
      const url = "https://cdn.com/mod.ts";
      const backingFS = createMockFS({
        [path]: JSON.stringify({
          version: 1,
          imports: { [url]: { resolved: url, integrity: "sha256-abc" } },
        }),
      });
      const fs: FSAdapter = {
        coordinationKey: "non-removing-clear-window-test-store",
        exists: backingFS.exists,
        readFile: backingFS.readFile,
        writeFile: backingFS.writeFile,
      };
      const partialRead = Promise.withResolvers<void>();
      const readFile = fs.readFile;
      fs.readFile = async (filePath: string): Promise<string> => {
        const content = await readFile(filePath);
        if (content === "{") partialRead.resolve();
        return content;
      };
      const gate = exposePartialNextWrite(fs);
      const clearingManager = createLockfileManager("/project", fs);
      const clear = clearingManager.clear();
      await gate.started;

      const coldReader = createLockfileManager("/project", fs);
      const coldRead = coldReader.read().then(
        (value) => ({ ok: true as const, value }),
        (error: unknown) => ({ ok: false as const, error }),
      );
      const observedPartialContent = await resolvesWithin(partialRead.promise);
      gate.release();
      await clear;

      assertEquals(observedPartialContent, false);
      const result = await coldRead;
      if (!result.ok) throw result.error;
      assertEquals(result.value, createEmptyLockfile());
    });

    it("should fail closed on write but allow clear to remove malformed JSON", async () => {
      const malformed = "{not-json";
      const fs = createMockFS({ "/project/veryfront.lock": malformed });
      const mgr = createLockfileManager("/project", fs);

      const error = await assertRejects(
        () => mgr.write(createEmptyLockfile()),
        VeryfrontError,
      );
      assertExists(error);
      if (!(error instanceof VeryfrontError)) throw new Error("expected VeryfrontError");
      assertEquals(error.slug, "lockfile-read-error");
      assertEquals(error.title, "Lockfile could not be read safely");
      assertEquals(await fs.readFile("/project/veryfront.lock"), malformed);

      await mgr.clear();

      assertEquals(await fs.exists("/project/veryfront.lock"), false);
    });

    it("should validate public write data before touching disk", async () => {
      const validUrl = "https://cdn.com/valid.ts";
      const existingLockfile = JSON.stringify({
        version: 1,
        imports: {
          [validUrl]: { resolved: validUrl, integrity: "sha256-valid" },
        },
      });
      const fs = createMockFS({ "/project/veryfront.lock": existingLockfile });
      const mgr = createLockfileManager("/project", fs);

      const versionError = await assertRejects(
        () =>
          mgr.write({
            version: 99,
            imports: {
              [validUrl]: { resolved: validUrl, integrity: "sha256-new" },
            },
          } as unknown as LockfileData),
        VeryfrontError,
      );
      if (!(versionError instanceof VeryfrontError)) throw new Error("expected VeryfrontError");
      assertEquals(versionError.slug, "lockfile-format-mismatch");
      assertEquals(await fs.readFile("/project/veryfront.lock"), existingLockfile);

      const structureError = await assertRejects(
        () =>
          mgr.write({
            version: 1,
            imports: {
              "https://cdn.com/bad.ts": {},
            },
          } as unknown as LockfileData),
        VeryfrontError,
      );
      if (!(structureError instanceof VeryfrontError)) throw new Error("expected VeryfrontError");
      assertEquals(structureError.slug, "invalid-argument");
      assertEquals(
        (structureError.context as { reason?: string }).reason,
        "invalid-structure",
      );
      assertEquals(await fs.readFile("/project/veryfront.lock"), existingLockfile);

      let importGetterCalls = 0;
      const accessorImports: Record<string, LockfileEntry> = {};
      Object.defineProperty(accessorImports, "https://cdn.com/accessor.ts", {
        enumerable: true,
        get() {
          importGetterCalls++;
          throw new Error("import getter must not run");
        },
      });
      const accessorError = await assertRejects(
        () =>
          mgr.write({
            version: 1,
            imports: accessorImports,
          }),
        VeryfrontError,
      );
      if (!(accessorError instanceof VeryfrontError)) throw new Error("expected VeryfrontError");
      assertEquals(accessorError.slug, "invalid-argument");
      assertEquals(importGetterCalls, 0);
      assertEquals(await fs.readFile("/project/veryfront.lock"), existingLockfile);
    });

    it("should reject invalid public set entry fields before touching disk", async () => {
      let existsCalls = 0;
      let writeCalls = 0;
      const fs: FSAdapter = {
        exists: () => {
          existsCalls++;
          return Promise.resolve(false);
        },
        readFile: () => Promise.reject(new Error("unexpected read")),
        writeFile: () => {
          writeCalls++;
          return Promise.resolve();
        },
      };
      const mgr = createLockfileManager("/project", fs);
      let dependencyGetterCalls = 0;
      const accessorDependencies = ["placeholder"];
      Object.defineProperty(accessorDependencies, 0, {
        enumerable: true,
        get() {
          dependencyGetterCalls++;
          throw new Error("dependency getter must not run");
        },
      });

      const invalidEntries = [
        Object.create({
          resolved: "https://cdn.com/inherited.ts",
          integrity: "sha256-inherited",
        }) as LockfileEntry,
        {
          resolved: "https://cdn.com/bad-dependencies.ts",
          integrity: "sha256-bad-dependencies",
          dependencies: "not-an-array",
        } as unknown as LockfileEntry,
        {
          resolved: "https://cdn.com/bad-fetched-at.ts",
          integrity: "sha256-bad-fetched-at",
          fetchedAt: 1_234,
        } as unknown as LockfileEntry,
        {
          resolved: "https://cdn.com/accessor-dependencies.ts",
          integrity: "sha256-accessor-dependencies",
          dependencies: accessorDependencies,
        },
      ];

      for (const entry of invalidEntries) {
        const error = await assertRejects(
          () => mgr.set(entry.resolved ?? "https://cdn.com/inherited.ts", entry),
          VeryfrontError,
        );
        if (!(error instanceof VeryfrontError)) throw new Error("expected VeryfrontError");
        assertEquals(error.slug, "invalid-argument");
        assertEquals((error.context as { reason?: string }).reason, "invalid-structure");
      }
      assertEquals(dependencyGetterCalls, 0);
      assertEquals(existsCalls, 0);
      assertEquals(writeCalls, 0);
    });

    it("should fail closed on write but allow clear to remove an unreadable lockfile", async () => {
      let writes = 0;
      let removals = 0;
      const fs: FSAdapter = {
        coordinationKey: "unreadable-test-store",
        exists: () => Promise.resolve(true),
        readFile: () => Promise.reject(new Error("permission denied")),
        writeFile: () => {
          writes++;
          return Promise.resolve();
        },
        remove: () => {
          removals++;
          return Promise.resolve();
        },
      };
      const mgr = createLockfileManager("/project", fs);

      await assertRejects(() => mgr.write(createEmptyLockfile()), VeryfrontError);
      assertEquals(writes, 0);
      assertEquals(removals, 0);

      await mgr.clear();

      assertEquals(writes, 0);
      assertEquals(removals, 1);
    });

    it("should serialize path aliases across adapters with a shared coordination identity", async () => {
      const backingFS = createMockFS({
        "/project/veryfront.lock": JSON.stringify({
          version: 1,
          imports: {
            "https://cdn.com/base.ts": {
              resolved: "https://cdn.com/base.ts",
              integrity: "sha256-base",
            },
          },
        }),
      });
      const coordinationKey = "shared-test-store";
      const fsA: FSAdapter = { ...backingFS, coordinationKey };
      const fsB: FSAdapter = { ...backingFS, coordinationKey };
      const mgrA = createLockfileManager("/project", fsA);
      const mgrB = createLockfileManager("/project/.", fsB);

      // Both managers warm their caches from the same on-disk state.
      assertEquals(await mgrA.has("https://cdn.com/base.ts"), true);
      assertEquals(await mgrB.has("https://cdn.com/base.ts"), true);

      await mgrA.set("https://cdn.com/a.ts", {
        resolved: "https://cdn.com/a.ts",
        integrity: "sha256-a",
      });
      await mgrB.set("https://cdn.com/b.ts", {
        resolved: "https://cdn.com/b.ts",
        integrity: "sha256-b",
      });

      await Promise.all([mgrA.flush(), mgrB.flush()]);

      const onDisk = JSON.parse(await backingFS.readFile("/project/veryfront.lock")) as {
        imports: Record<string, unknown>;
      };
      assertEquals(Object.keys(onDisk.imports).sort(), [
        "https://cdn.com/a.ts",
        "https://cdn.com/b.ts",
        "https://cdn.com/base.ts",
      ]);
    });

    it("should serialize aliased paths when no shared adapter has realPath", async () => {
      const canonicalPath = "/backing/project/veryfront.lock";
      const baseUrl = "https://cdn.com/base.ts";
      const aUrl = "https://cdn.com/a.ts";
      const bUrl = "https://cdn.com/b.ts";
      const store = new Map<string, string>([[
        canonicalPath,
        JSON.stringify({
          version: 1,
          imports: {
            [baseUrl]: { resolved: baseUrl, integrity: "sha256-base" },
          },
        }),
      ]]);
      const backingPath = (path: string): string =>
        path === "/project/veryfront.lock" || path === "/alias/veryfront.lock"
          ? canonicalPath
          : path;
      const firstWriteStarted = Promise.withResolvers<void>();
      const secondWriteStarted = Promise.withResolvers<void>();
      const releaseFirstWrite = Promise.withResolvers<void>();
      let writes = 0;
      const writeFile = async (path: string, content: string): Promise<void> => {
        writes++;
        if (writes === 1) {
          firstWriteStarted.resolve();
          await releaseFirstWrite.promise;
        } else if (writes === 2) {
          secondWriteStarted.resolve();
        }
        store.set(backingPath(path), content);
      };
      const shared = {
        coordinationKey: "no-realpath-alias-test-store",
        exists: (path: string) => Promise.resolve(store.has(backingPath(path))),
        readFile: (path: string) => {
          const content = store.get(backingPath(path));
          return content === undefined
            ? Promise.reject(new Error("ENOENT"))
            : Promise.resolve(content);
        },
        writeFile,
        remove: (path: string) => {
          store.delete(backingPath(path));
          return Promise.resolve();
        },
      } satisfies FSAdapter;
      const managerA = createLockfileManager("/project", shared);
      const managerB = createLockfileManager("/alias", { ...shared });
      await managerA.set(aUrl, { resolved: aUrl, integrity: "sha256-a" });
      await managerB.set(bUrl, { resolved: bUrl, integrity: "sha256-b" });

      const flushA = managerA.flush();
      await firstWriteStarted.promise;
      const flushB = managerB.flush();
      const secondWriteBeforeRelease = await resolvesWithin(secondWriteStarted.promise);
      releaseFirstWrite.resolve();
      await Promise.all([flushA, flushB]);

      assertEquals(secondWriteBeforeRelease, false);
      const onDisk = JSON.parse(store.get(canonicalPath)!) as {
        imports: Record<string, unknown>;
      };
      assertEquals(Object.keys(onDisk.imports).sort(), [aUrl, bUrl, baseUrl]);
    });

    it("should allow distinct canonical shared-store lockfiles to flush independently", async () => {
      const firstPath = "/project-a/veryfront.lock";
      const secondPath = "/project-b/veryfront.lock";
      const aUrl = "https://cdn.com/a.ts";
      const bUrl = "https://cdn.com/b.ts";
      const backingFS: FSAdapter = {
        ...createMockFS({}, "independent-lockfile-test-store"),
        realPath: (path) => Promise.resolve(path),
      };
      const firstWriteStarted = Promise.withResolvers<void>();
      const secondWriteStarted = Promise.withResolvers<void>();
      const releaseFirstWrite = Promise.withResolvers<void>();
      const writeFile = backingFS.writeFile;
      backingFS.writeFile = async (filePath: string, content: string): Promise<void> => {
        if (filePath === firstPath) {
          firstWriteStarted.resolve();
          await releaseFirstWrite.promise;
        } else if (filePath === secondPath) {
          secondWriteStarted.resolve();
        }
        await writeFile(filePath, content);
      };
      const managerA = createLockfileManager("/project-a", backingFS);
      const managerB = createLockfileManager("/project-b", backingFS);
      await managerA.set(aUrl, { resolved: aUrl, integrity: "sha256-a" });
      await managerB.set(bUrl, { resolved: bUrl, integrity: "sha256-b" });

      const flushA = managerA.flush();
      await firstWriteStarted.promise;
      const flushB = managerB.flush();
      const secondWriteBeforeRelease = await resolvesWithin(secondWriteStarted.promise);
      releaseFirstWrite.resolve();
      await Promise.all([flushA, flushB]);

      assertEquals(secondWriteBeforeRelease, true);
      const firstOnDisk = JSON.parse(await backingFS.readFile(firstPath)) as {
        imports: Record<string, unknown>;
      };
      const secondOnDisk = JSON.parse(await backingFS.readFile(secondPath)) as {
        imports: Record<string, unknown>;
      };
      assertEquals(Object.keys(firstOnDisk.imports), [aUrl]);
      assertEquals(Object.keys(secondOnDisk.imports), [bUrl]);
    });

    it("should use coordinationKey across adapters with mixed realPath support", async () => {
      const path = "/project/veryfront.lock";
      const baseUrl = "https://cdn.com/base.ts";
      const aUrl = "https://cdn.com/a.ts";
      const bUrl = "https://cdn.com/b.ts";
      const backingFS = createMockFS({
        [path]: JSON.stringify({
          version: 1,
          imports: {
            [baseUrl]: { resolved: baseUrl, integrity: "sha256-base" },
          },
        }),
      });
      const firstWriteStarted = Promise.withResolvers<void>();
      const secondWriteStarted = Promise.withResolvers<void>();
      const releaseFirstWrite = Promise.withResolvers<void>();
      const writeFile = backingFS.writeFile;
      let writes = 0;
      const coordinatedWrite = async (filePath: string, content: string): Promise<void> => {
        writes++;
        if (writes === 1) {
          firstWriteStarted.resolve();
          await releaseFirstWrite.promise;
        } else if (writes === 2) {
          secondWriteStarted.resolve();
        }
        await writeFile(filePath, content);
      };
      const coordinationKey = "mixed-realpath-test-store";
      const fsWithoutRealPath: FSAdapter = {
        ...backingFS,
        coordinationKey,
        writeFile: coordinatedWrite,
      };
      const fsWithRealPath: FSAdapter = {
        ...backingFS,
        coordinationKey,
        writeFile: coordinatedWrite,
        realPath: (filePath: string) => Promise.resolve(filePath),
      };
      const managerA = createLockfileManager("/project", fsWithoutRealPath);
      const managerB = createLockfileManager("/project", fsWithRealPath);
      await managerA.set(aUrl, { resolved: aUrl, integrity: "sha256-a" });
      await managerB.set(bUrl, { resolved: bUrl, integrity: "sha256-b" });

      const flushA = managerA.flush();
      await firstWriteStarted.promise;
      const flushB = managerB.flush();
      const secondWriteBeforeRelease = await resolvesWithin(secondWriteStarted.promise);
      releaseFirstWrite.resolve();
      await Promise.all([flushA, flushB]);

      assertEquals(secondWriteBeforeRelease, false);
      const onDisk = JSON.parse(await backingFS.readFile(path)) as {
        imports: Record<string, unknown>;
      };
      assertEquals(Object.keys(onDisk.imports).sort(), [aUrl, bUrl, baseUrl]);
    });

    it("should serialize aliased paths when only one shared adapter has realPath", async () => {
      const canonicalPath = "/backing/project/veryfront.lock";
      const baseUrl = "https://cdn.com/base.ts";
      const aUrl = "https://cdn.com/a.ts";
      const bUrl = "https://cdn.com/b.ts";
      const store = new Map<string, string>([[
        canonicalPath,
        JSON.stringify({
          version: 1,
          imports: {
            [baseUrl]: { resolved: baseUrl, integrity: "sha256-base" },
          },
        }),
      ]]);
      const backingPath = (path: string): string =>
        path === "/project/veryfront.lock" || path === "/alias/veryfront.lock"
          ? canonicalPath
          : path;
      const firstWriteStarted = Promise.withResolvers<void>();
      const secondWriteStarted = Promise.withResolvers<void>();
      const releaseFirstWrite = Promise.withResolvers<void>();
      let writes = 0;
      const writeFile = async (path: string, content: string): Promise<void> => {
        writes++;
        if (writes === 1) {
          firstWriteStarted.resolve();
          await releaseFirstWrite.promise;
        } else if (writes === 2) {
          secondWriteStarted.resolve();
        }
        store.set(backingPath(path), content);
      };
      const shared = {
        coordinationKey: "mixed-realpath-alias-test-store",
        exists: (path: string) => Promise.resolve(store.has(backingPath(path))),
        readFile: (path: string) => {
          const content = store.get(backingPath(path));
          return content === undefined
            ? Promise.reject(new Error("ENOENT"))
            : Promise.resolve(content);
        },
        writeFile,
        remove: (path: string) => {
          store.delete(backingPath(path));
          return Promise.resolve();
        },
      } satisfies FSAdapter;
      const managerA = createLockfileManager("/project", shared);
      const managerB = createLockfileManager("/alias", {
        ...shared,
        realPath: () => Promise.resolve("/backing/project"),
      });
      await managerA.set(aUrl, { resolved: aUrl, integrity: "sha256-a" });
      await managerB.set(bUrl, { resolved: bUrl, integrity: "sha256-b" });

      const flushA = managerA.flush();
      await firstWriteStarted.promise;
      const flushB = managerB.flush();
      const secondWriteBeforeRelease = await resolvesWithin(secondWriteStarted.promise);
      releaseFirstWrite.resolve();
      await Promise.all([flushA, flushB]);

      assertEquals(secondWriteBeforeRelease, false);
      const onDisk = JSON.parse(store.get(canonicalPath)!) as {
        imports: Record<string, unknown>;
      };
      assertEquals(Object.keys(onDisk.imports).sort(), [aUrl, bUrl, baseUrl]);
    });

    it("should serialize real symlink aliases by canonical backing path", async () => {
      const root = await Deno.makeTempDir({ prefix: "veryfront-lockfile-alias-" });
      const projectDir = `${root}/project`;
      const aliasDir = `${root}/project-alias`;
      const lockfilePath = `${projectDir}/veryfront.lock`;
      const aliasLockfilePath = `${aliasDir}/veryfront.lock`;
      const baseUrl = "https://cdn.com/base.ts";
      const aUrl = "https://cdn.com/a.ts";
      const bUrl = "https://cdn.com/b.ts";

      try {
        await Deno.mkdir(projectDir);
        await Deno.writeTextFile(
          lockfilePath,
          JSON.stringify({
            version: 1,
            imports: {
              [baseUrl]: { resolved: baseUrl, integrity: "sha256-base" },
            },
          }),
        );
        try {
          await Deno.symlink(projectDir, aliasDir);
        } catch (error) {
          if (
            error instanceof Deno.errors.NotSupported ||
            error instanceof Deno.errors.PermissionDenied
          ) return;
          throw error;
        }

        const firstWriteStarted = Promise.withResolvers<void>();
        const releaseFirstWrite = Promise.withResolvers<void>();
        const aliasRead = Promise.withResolvers<void>();
        let blockFirstWrite = false;
        let blocked = false;
        let observeAliasRead = false;
        const fs: FSAdapter = {
          async exists(path: string): Promise<boolean> {
            try {
              await Deno.stat(path);
              return true;
            } catch (error) {
              if (error instanceof Deno.errors.NotFound) return false;
              throw error;
            }
          },
          async readFile(path: string): Promise<string> {
            if (observeAliasRead && path === aliasLockfilePath) aliasRead.resolve();
            return await Deno.readTextFile(path);
          },
          async writeFile(path: string, content: string): Promise<void> {
            if (blockFirstWrite && !blocked && path === lockfilePath) {
              blocked = true;
              firstWriteStarted.resolve();
              await releaseFirstWrite.promise;
            }
            await Deno.writeTextFile(path, content);
          },
          remove: (path: string) => Deno.remove(path),
          realPath: (path: string) => Deno.realPath(path),
        };
        const managerA = createLockfileManager(projectDir, fs);
        const managerB = createLockfileManager(aliasDir, fs);

        assertEquals(await managerA.has(baseUrl), true);
        assertEquals(await managerB.has(baseUrl), true);
        await managerA.set(aUrl, { resolved: aUrl, integrity: "sha256-a" });
        await managerB.set(bUrl, { resolved: bUrl, integrity: "sha256-b" });

        blockFirstWrite = true;
        const flushA = managerA.flush();
        await firstWriteStarted.promise;
        observeAliasRead = true;
        const flushB = managerB.flush();
        const aliasReadBeforeRelease = await resolvesWithin(aliasRead.promise);
        releaseFirstWrite.resolve();
        await Promise.all([flushA, flushB]);

        assertEquals(aliasReadBeforeRelease, false);
        const onDisk = JSON.parse(await Deno.readTextFile(lockfilePath)) as {
          imports: Record<string, unknown>;
        };
        assertEquals(Object.keys(onDisk.imports).sort(), [aUrl, bUrl, baseUrl]);
      } finally {
        await Deno.remove(root, { recursive: true });
      }
    });

    it("should coordinate aliases when the lockfile is created after manager construction", async () => {
      const canonicalProjectDir = "/backing/project";
      const canonicalLockfilePath = `${canonicalProjectDir}/veryfront.lock`;
      const projectDir = "/project";
      const aliasDir = "/project-alias";
      const projectLockfilePath = `${projectDir}/veryfront.lock`;
      const aliasLockfilePath = `${aliasDir}/veryfront.lock`;
      const aUrl = "https://cdn.com/a.ts";
      const bUrl = "https://cdn.com/b.ts";
      const store = new Map<string, string>();
      const firstWriteStarted = Promise.withResolvers<void>();
      const releaseFirstWrite = Promise.withResolvers<void>();
      const aliasAccess = Promise.withResolvers<void>();
      let blockFirstWrite = false;
      let blocked = false;
      let observeAliasAccess = false;

      function backingPath(path: string): string {
        return path === projectLockfilePath || path === aliasLockfilePath
          ? canonicalLockfilePath
          : path;
      }

      const fs: FSAdapter = {
        exists(path: string): Promise<boolean> {
          if (observeAliasAccess && path === aliasLockfilePath) aliasAccess.resolve();
          return Promise.resolve(store.has(backingPath(path)));
        },
        readFile(path: string): Promise<string> {
          if (observeAliasAccess && path === aliasLockfilePath) aliasAccess.resolve();
          const content = store.get(backingPath(path));
          return content === undefined
            ? Promise.reject(new Error("ENOENT"))
            : Promise.resolve(content);
        },
        async writeFile(path: string, content: string): Promise<void> {
          if (blockFirstWrite && !blocked && path === projectLockfilePath) {
            blocked = true;
            firstWriteStarted.resolve();
            await releaseFirstWrite.promise;
          }
          store.set(backingPath(path), content);
        },
        remove(path: string): Promise<void> {
          store.delete(backingPath(path));
          return Promise.resolve();
        },
        realPath(path: string): Promise<string> {
          if (path === projectDir || path === aliasDir) {
            return Promise.resolve(canonicalProjectDir);
          }
          if (
            (path === projectLockfilePath || path === aliasLockfilePath) &&
            store.has(canonicalLockfilePath)
          ) {
            return Promise.resolve(canonicalLockfilePath);
          }
          return Promise.reject(new Error("ENOENT"));
        },
      };
      const managerA = createLockfileManager(projectDir, fs);
      const managerB = createLockfileManager(aliasDir, fs);

      // Both managers resolve their stable access identity while the lockfile
      // is absent, using the canonical project directory as the fallback.
      await managerA.set(aUrl, { resolved: aUrl, integrity: "sha256-a" });
      await managerB.set(bUrl, { resolved: bUrl, integrity: "sha256-b" });

      blockFirstWrite = true;
      const flushA = managerA.flush();
      await firstWriteStarted.promise;
      observeAliasAccess = true;
      const flushB = managerB.flush();
      const aliasAccessBeforeRelease = await resolvesWithin(aliasAccess.promise);
      releaseFirstWrite.resolve();
      await Promise.all([flushA, flushB]);

      assertEquals(aliasAccessBeforeRelease, false);
      const onDisk = JSON.parse(store.get(canonicalLockfilePath)!) as {
        imports: Record<string, unknown>;
      };
      assertEquals(Object.keys(onDisk.imports).sort(), [aUrl, bUrl]);
    });

    it("should keep a stable access key when the lockfile becomes a symlink target", async () => {
      const projectDir = "/project";
      const lockfilePath = `${projectDir}/veryfront.lock`;
      const canonicalProjectDir = "/backing/project";
      const targetPath = "/backing/renamed.lock";
      const aUrl = "https://cdn.com/a.ts";
      const bUrl = "https://cdn.com/b.ts";
      const cUrl = "https://cdn.com/c.ts";
      const store = new Map<string, string>();
      const firstWriteStarted = Promise.withResolvers<void>();
      const releaseFirstWrite = Promise.withResolvers<void>();
      const secondAccess = Promise.withResolvers<void>();
      let blockFirstWrite = false;
      let blocked = false;
      let observeSecondAccess = false;

      const fs: FSAdapter = {
        exists(path: string): Promise<boolean> {
          if (observeSecondAccess && path === lockfilePath) secondAccess.resolve();
          return Promise.resolve(store.has(path === lockfilePath ? targetPath : path));
        },
        readFile(path: string): Promise<string> {
          if (observeSecondAccess && path === lockfilePath) secondAccess.resolve();
          const content = store.get(path === lockfilePath ? targetPath : path);
          return content === undefined
            ? Promise.reject(new Error("ENOENT"))
            : Promise.resolve(content);
        },
        async writeFile(path: string, content: string): Promise<void> {
          if (blockFirstWrite && !blocked && path === lockfilePath) {
            blocked = true;
            firstWriteStarted.resolve();
            await releaseFirstWrite.promise;
          }
          store.set(path === lockfilePath ? targetPath : path, content);
        },
        remove(path: string): Promise<void> {
          store.delete(path === lockfilePath ? targetPath : path);
          return Promise.resolve();
        },
        realPath(path: string): Promise<string> {
          if (path === projectDir) return Promise.resolve(canonicalProjectDir);
          if (path === lockfilePath && store.has(targetPath)) return Promise.resolve(targetPath);
          return Promise.reject(new Error("ENOENT"));
        },
      };
      const managerA = createLockfileManager(projectDir, fs);
      await managerA.set(aUrl, { resolved: aUrl, integrity: "sha256-a" });
      await managerA.flush();

      // Manager A cached its access key before the lockfile existed. Manager B
      // resolves its key after the logical lockfile points at a differently
      // named target; both must still share the project-scoped queue.
      const managerB = createLockfileManager(projectDir, fs);
      await managerB.set(bUrl, { resolved: bUrl, integrity: "sha256-b" });
      await managerA.set(cUrl, { resolved: cUrl, integrity: "sha256-c" });

      blockFirstWrite = true;
      const flushA = managerA.flush();
      await firstWriteStarted.promise;
      observeSecondAccess = true;
      const flushB = managerB.flush();
      const secondAccessBeforeRelease = await resolvesWithin(secondAccess.promise);
      releaseFirstWrite.resolve();
      await Promise.all([flushA, flushB]);

      assertEquals(secondAccessBeforeRelease, false);
      const onDisk = JSON.parse(store.get(targetPath)!) as {
        imports: Record<string, unknown>;
      };
      assertEquals(Object.keys(onDisk.imports).sort(), [aUrl, bUrl, cUrl]);
    });

    it("should preserve a set queued during an in-flight flush and snapshot its input", async () => {
      const fs = createMockFS();
      const mgr = createLockfileManager("/project", fs);
      const firstUrl = "https://cdn.com/first.ts";
      const lateUrl = "https://cdn.com/late.ts";
      await mgr.set(firstUrl, { resolved: firstUrl, integrity: "sha256-first" });
      const gate = blockNextWrite(fs);

      const inFlightFlush = mgr.flush();
      await gate.started;
      const lateEntry = {
        resolved: lateUrl,
        integrity: "sha256-late",
        dependencies: ["dep-a"],
      };
      const lateSet = mgr.set(lateUrl, lateEntry);
      lateEntry.integrity = "sha256-mutated-by-caller";
      lateEntry.dependencies.push("dep-b");
      gate.release();
      await inFlightFlush;
      await lateSet;

      assertEquals(await mgr.get(lateUrl), {
        resolved: lateUrl,
        integrity: "sha256-late",
        dependencies: ["dep-a"],
      });
      await mgr.flush();
      const onDisk = JSON.parse(await fs.readFile("/project/veryfront.lock")) as {
        imports: Record<string, LockfileEntry>;
      };
      assertEquals(onDisk.imports[lateUrl]?.integrity, "sha256-late");
      assertEquals(Object.keys(onDisk.imports).sort(), [firstUrl, lateUrl]);
    });

    it("should preserve a set queued during an in-flight write", async () => {
      const fs = createMockFS();
      const mgr = createLockfileManager("/project", fs);
      const writtenUrl = "https://cdn.com/written.ts";
      const lateUrl = "https://cdn.com/late.ts";
      const writeData: LockfileData = {
        version: 1,
        imports: {
          [writtenUrl]: { resolved: writtenUrl, integrity: "sha256-written" },
        },
      };
      const gate = blockNextWrite(fs);

      const inFlightWrite = mgr.write(writeData);
      await gate.started;
      const lateSet = mgr.set(lateUrl, {
        resolved: lateUrl,
        integrity: "sha256-late",
      });
      writeData.imports[writtenUrl]!.integrity = "sha256-mutated-by-caller";
      gate.release();
      await Promise.all([inFlightWrite, lateSet]);

      assertEquals((await mgr.get(writtenUrl))?.integrity, "sha256-written");
      assertEquals((await mgr.get(lateUrl))?.integrity, "sha256-late");
      await mgr.flush();
      const onDisk = JSON.parse(await fs.readFile("/project/veryfront.lock")) as {
        imports: Record<string, LockfileEntry>;
      };
      assertEquals(Object.keys(onDisk.imports).sort(), [lateUrl, writtenUrl]);
      assertEquals(onDisk.imports[writtenUrl]?.integrity, "sha256-written");
    });

    it("should replace the lockfile through a staged temp file when the adapter supports rename", async () => {
      const url = "https://cdn.com/mod.ts";
      const lockfilePath = "/project/veryfront.lock";
      const store = new Map<string, string>();
      const directWrites: string[] = [];
      const fs: FSAdapter = {
        readFile: (path: string) => {
          const content = store.get(path);
          if (content == null) return Promise.reject(new Error("ENOENT"));
          return Promise.resolve(content);
        },
        writeFile: (path: string, content: string) => {
          directWrites.push(path);
          store.set(path, content);
          return Promise.resolve();
        },
        exists: (path: string) => Promise.resolve(store.has(path)),
        remove: (path: string) => {
          store.delete(path);
          return Promise.resolve();
        },
        rename: (from: string, to: string) => {
          const content = store.get(from);
          if (content == null) return Promise.reject(new Error("ENOENT"));
          store.delete(from);
          store.set(to, content);
          return Promise.resolve();
        },
      };
      const mgr = createLockfileManager("/project", fs);

      await mgr.set(url, { resolved: url, integrity: "sha256-abc" });
      await mgr.flush();

      // The lockfile path itself is never written directly: the content is
      // staged under a sibling temp name and renamed into place, so a crash
      // mid-write cannot leave truncated JSON at the lockfile path.
      assertEquals(directWrites.length, 1);
      const [tempPath] = directWrites;
      assertExists(tempPath);
      assertEquals(tempPath.startsWith(`${lockfilePath}.`), true);
      assertEquals(tempPath.endsWith(".tmp"), true);
      assertEquals([...store.keys()], [lockfilePath]);
      const onDiskContent = store.get(lockfilePath);
      assertExists(onDiskContent);
      const onDisk = JSON.parse(onDiskContent) as { imports: Record<string, unknown> };
      assertEquals(Object.keys(onDisk.imports), [url]);
    });

    it("should clean up the staged temp file and preserve the lockfile when rename fails", async () => {
      const url = "https://cdn.com/mod.ts";
      const lockfilePath = "/project/veryfront.lock";
      const originalContent = JSON.stringify({
        version: 1,
        imports: {
          "https://cdn.com/base.ts": {
            resolved: "https://cdn.com/base.ts",
            integrity: "sha256-base",
          },
        },
      });
      const store = new Map<string, string>([[lockfilePath, originalContent]]);
      const fs: FSAdapter = {
        readFile: (path: string) => {
          const content = store.get(path);
          if (content == null) return Promise.reject(new Error("ENOENT"));
          return Promise.resolve(content);
        },
        writeFile: (path: string, content: string) => {
          store.set(path, content);
          return Promise.resolve();
        },
        exists: (path: string) => Promise.resolve(store.has(path)),
        remove: (path: string) => {
          store.delete(path);
          return Promise.resolve();
        },
        rename: () => Promise.reject(new Error("EACCES")),
      };
      const mgr = createLockfileManager("/project", fs);

      await mgr.set(url, { resolved: url, integrity: "sha256-abc" });
      await assertRejects(() => mgr.flush(), Error, "EACCES");

      // The failed replacement leaves no temp file behind and keeps the
      // previous lockfile content intact.
      assertEquals([...store.keys()], [lockfilePath]);
      assertEquals(store.get(lockfilePath), originalContent);
    });
  });

  describe("getLockfileEntryForBuild", () => {
    it("should return entries from a healthy lockfile", async () => {
      const url = "https://cdn.com/mod.ts";
      const fs = createMockFS({
        "/project/veryfront.lock": JSON.stringify({
          version: 1,
          imports: { [url]: { resolved: url, integrity: "sha256-abc" } },
        }),
      });
      const mgr = createLockfileManager("/project", fs);

      assertEquals(await getLockfileEntryForBuild(mgr, url), {
        resolved: url,
        integrity: "sha256-abc",
      });
      assertEquals(await getLockfileEntryForBuild(mgr, "https://cdn.com/missing.ts"), null);
    });

    it("should degrade to a cache miss when the lockfile is unreadable", async () => {
      const originalWarn = console.warn;
      const warnings: string[] = [];
      const truncated = '{"version":1,"imports":{';
      const fs = createMockFS({ "/project/veryfront.lock": truncated });
      const mgr = createLockfileManager("/project", fs);

      try {
        console.warn = ((...args: unknown[]) => {
          warnings.push(args.map(String).join(" "));
        }) as typeof console.warn;

        // Truncated or malformed JSON must not fail the build hot path; the
        // file itself stays untouched for inspection or `veryfront lock --clear`.
        assertEquals(await getLockfileEntryForBuild(mgr, "https://cdn.com/mod.ts"), null);
        assertEquals(await getLockfileEntryForBuild(mgr, "https://cdn.com/other.ts"), null);
        assertEquals(await fs.readFile("/project/veryfront.lock"), truncated);
      } finally {
        console.warn = originalWarn;
      }

      assertEquals(warnings.length, 1);
      const warning = warnings[0];
      assertExists(warning);
      assertStringIncludes(warning, "Lockfile veryfront.lock could not be read");
      assertStringIncludes(warning, "veryfront lock --clear");
      assertEquals(warning.includes("/project/veryfront.lock"), false);
    });

    it("should warn once after WeakSet prototype poisoning", async () => {
      const originalWarn = console.warn;
      const weakSetHas = Object.getOwnPropertyDescriptor(WeakSet.prototype, "has");
      const weakSetAdd = Object.getOwnPropertyDescriptor(WeakSet.prototype, "add");
      const warnings: string[] = [];
      const truncated = '{"version":1,"imports":{';
      const fs = createMockFS({ "/project/veryfront.lock": truncated });
      const mgr = createLockfileManager("/project", fs);

      try {
        console.warn = ((...args: unknown[]) => {
          warnings.push(args.map(String).join(" "));
        }) as typeof console.warn;
        Object.defineProperty(WeakSet.prototype, "has", {
          configurable: true,
          value: () => {
            throw new Error("poisoned WeakSet.has");
          },
        });
        Object.defineProperty(WeakSet.prototype, "add", {
          configurable: true,
          value: () => {
            throw new Error("poisoned WeakSet.add");
          },
        });

        assertEquals(await getLockfileEntryForBuild(mgr, "https://cdn.com/mod.ts"), null);
        assertEquals(await getLockfileEntryForBuild(mgr, "https://cdn.com/other.ts"), null);
      } finally {
        console.warn = originalWarn;
        if (weakSetHas === undefined) Reflect.deleteProperty(WeakSet.prototype, "has");
        else Object.defineProperty(WeakSet.prototype, "has", weakSetHas);
        if (weakSetAdd === undefined) Reflect.deleteProperty(WeakSet.prototype, "add");
        else Object.defineProperty(WeakSet.prototype, "add", weakSetAdd);
      }

      assertEquals(warnings.length, 1);
      const warning = warnings[0];
      assertExists(warning);
      assertStringIncludes(warning, "Lockfile veryfront.lock could not be read");
    });

    it("should keep failing loudly for a newer-format lockfile", async () => {
      const newerContent = JSON.stringify({
        version: 99,
        imports: { "https://cdn.com/newer.ts": { resolved: "x", integrity: "y" } },
      });
      const fs = createMockFS({ "/project/veryfront.lock": newerContent });
      const mgr = createLockfileManager("/project", fs);

      // A valid lockfile written by a newer Veryfront is not corruption; the
      // build must stop instead of proceeding around data it cannot read.
      const error = await assertRejects(
        () => getLockfileEntryForBuild(mgr, "https://cdn.com/mod.ts"),
        VeryfrontError,
      );
      assertExists(error);
      if (!(error instanceof VeryfrontError)) throw new Error("expected VeryfrontError");
      assertEquals(error.slug, "lockfile-format-mismatch");
      assertEquals(await fs.readFile("/project/veryfront.lock"), newerContent);
    });
  });

  describe("setLockfileEntryForBuild", () => {
    it("should stage entries against a healthy lockfile", async () => {
      const url = "https://cdn.com/mod.ts";
      const fs = createMockFS();
      const mgr = createLockfileManager("/project", fs);

      assertEquals(
        await setLockfileEntryForBuild(mgr, url, { resolved: url, integrity: "sha256-abc" }),
        true,
      );
      await mgr.flush();
      const onDisk = JSON.parse(await fs.readFile("/project/veryfront.lock")) as {
        imports: Record<string, unknown>;
      };
      assertEquals(Object.keys(onDisk.imports), [url]);
    });

    it("should skip persistence when the lockfile is unreadable", async () => {
      const url = "https://cdn.com/mod.ts";
      const truncated = '{"version":1,"imports":{';
      const fs = createMockFS({ "/project/veryfront.lock": truncated });
      const mgr = createLockfileManager("/project", fs);

      // A refetched module must still be served: the entry is simply not
      // recorded and the corrupted file is preserved for `lock --clear`.
      assertEquals(
        await setLockfileEntryForBuild(mgr, url, { resolved: url, integrity: "sha256-abc" }),
        false,
      );
      assertEquals(await fs.readFile("/project/veryfront.lock"), truncated);
    });

    it("should keep failing loudly when persisting against a newer-format lockfile", async () => {
      const url = "https://cdn.com/mod.ts";
      const newerContent = JSON.stringify({
        version: 99,
        imports: { "https://cdn.com/newer.ts": { resolved: "x", integrity: "y" } },
      });
      const fs = createMockFS({ "/project/veryfront.lock": newerContent });
      const mgr = createLockfileManager("/project", fs);

      const error = await assertRejects(
        () => setLockfileEntryForBuild(mgr, url, { resolved: url, integrity: "sha256-abc" }),
        VeryfrontError,
      );
      assertExists(error);
      if (!(error instanceof VeryfrontError)) throw new Error("expected VeryfrontError");
      assertEquals(error.slug, "lockfile-format-mismatch");
      assertEquals(await fs.readFile("/project/veryfront.lock"), newerContent);
    });
  });

  describe("fetchWithLock", () => {
    it("should return cached content when integrity matches", async () => {
      const url = "https://cdn.com/mod.ts";
      const resolved = "https://esm.sh/mod.ts";
      const content = "export const value = 1;";
      const integrity = await computeIntegrity(content);
      const mgr = createLockfileManager("/project", createMockFS());

      await mgr.set(url, { resolved, integrity });

      const result = await fetchWithLock({
        lockfile: mgr,
        url,
        fetchFn: (input: string | URL | Request) => {
          assertEquals(String(input), resolved);
          return Promise.resolve(new Response(content, { status: 200 }));
        },
      });

      assertEquals(result.fromCache, true);
      assertEquals(result.resolvedUrl, resolved);
      assertEquals(result.content, content);
      assertEquals(result.integrity, integrity);
    });

    it("should fetch fresh content and persist the resolved entry on cache miss", async () => {
      const url = "https://cdn.com/mod.ts";
      const finalUrl = "https://esm.sh/final/mod.ts";
      const content = "export const value = 2;";
      const mgr = createLockfileManager("/project", createMockFS());

      const result = await fetchWithLock({
        lockfile: mgr,
        url,
        fetchFn: (input: string | URL | Request) => {
          assertEquals(String(input), url);
          const res = new Response(content, { status: 200 });
          Object.defineProperty(res, "url", { value: finalUrl });
          return Promise.resolve(res);
        },
      });

      const saved = await mgr.get(url);
      assertExists(saved);
      assertEquals(result.fromCache, false);
      assertEquals(
        result.resolvedUrl,
        finalUrl,
        "the lockfile must pin the final redirected url, not the requested one",
      );
      assertEquals(result.content, content);
      assertEquals(
        saved.resolved,
        finalUrl,
        "the persisted entry must record the redirected url",
      );
      assertEquals(saved.integrity, result.integrity);
    });

    it("refetches and re-pins when a cached body no longer matches its integrity", async () => {
      const url = "https://cdn.com/mod.ts";
      const mgr = createLockfileManager("/project", createMockFS());

      await mgr.set(url, { resolved: url, integrity: await computeIntegrity("old") });

      let calls = 0;
      const result = await fetchWithLock({
        lockfile: mgr,
        url,
        fetchFn: () => {
          calls++;
          return Promise.resolve(new Response("new", { status: 200 }));
        },
      });

      assertEquals(
        result.fromCache,
        false,
        "a mismatching cached body must not be served as a cache hit",
      );
      assertEquals(result.content, "new", "the refetched body is returned");
      assertEquals(
        result.integrity,
        await computeIntegrity("new"),
        "the returned integrity must be recomputed from the refetched body",
      );
      assertEquals(calls, 2, "the original url must be refetched after a mismatch");
      assertEquals(
        (await mgr.get(url))?.integrity,
        await computeIntegrity("new"),
        "the lockfile must be re-pinned",
      );
    });

    it("fails loudly in strict mode when the pinned resolved url is dead", async () => {
      const url = "https://cdn.com/mod.ts";
      const resolved = "https://esm.sh/mod.ts";
      const mgr = createLockfileManager("/project", createMockFS());

      await mgr.set(url, { resolved, integrity: await computeIntegrity("x") });

      await assertRejects(
        () =>
          fetchWithLock({
            lockfile: mgr,
            url,
            strict: true,
            fetchFn: () => Promise.resolve(new Response("", { status: 404 })),
          }),
        Error,
        "Lockfile entry stale",
      );
    });

    it("falls back to a fresh fetch when a stale pin is not strict", async () => {
      const url = "https://cdn.com/mod.ts";
      const resolved = "https://esm.sh/mod.ts";
      const content = "export const value = 3;";
      const mgr = createLockfileManager("/project", createMockFS());

      await mgr.set(url, { resolved, integrity: await computeIntegrity("x") });

      const requested: string[] = [];
      const result = await fetchWithLock({
        lockfile: mgr,
        url,
        fetchFn: (input: string | URL | Request) => {
          requested.push(String(input));
          return Promise.resolve(
            String(input) === resolved
              ? new Response("", { status: 404 })
              : new Response(content, { status: 200 }),
          );
        },
      });

      assertEquals(result.fromCache, false, "a stale pin must fall back to a fresh fetch");
      assertEquals(requested, [resolved, url], "the fallback fetch must target the original url");
      assertEquals(result.content, content, "the freshly fetched body is returned");
    });

    it("should throw in strict mode when cached integrity mismatches", async () => {
      const url = "https://cdn.com/mod.ts";
      const mgr = createLockfileManager("/project", createMockFS());

      await mgr.set(url, {
        resolved: url,
        integrity: await computeIntegrity("old"),
      });

      await assertRejects(
        () =>
          fetchWithLock({
            lockfile: mgr,
            url,
            strict: true,
            fetchFn: () => Promise.resolve(new Response("new", { status: 200 })),
          }),
        Error,
        "Integrity mismatch",
      );
    });
  });
});
