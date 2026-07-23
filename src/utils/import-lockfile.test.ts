import "#veryfront/schemas/_test-setup.ts";
import {
  assertEquals,
  assertExists,
  assertRejects,
  assertThrows,
} from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { VeryfrontError } from "#veryfront/errors";
import { __resetLoggerConfigForTests } from "./logger/index.ts";
import {
  computeIntegrity,
  createEmptyLockfile,
  createLockfileManager,
  extractImports,
  fetchWithLock,
  type FetchWithLockOptions,
  type FSAdapter,
  type LockfileManager,
  resolveImportUrl,
  verifyIntegrity,
} from "./import-lockfile.ts";

const VALID_INTEGRITY = `sha256-${"a".repeat(64)}`;

function validEntry(resolved = "https://cdn.com/mod.ts") {
  return { resolved, integrity: VALID_INTEGRITY };
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

async function assertVeryfrontRejects(fn: () => Promise<unknown>): Promise<VeryfrontError> {
  return await assertRejects(fn, VeryfrontError) as VeryfrontError;
}

function createMockFS(files: Record<string, string> = {}): FSAdapter {
  const store = new Map<string, string>(Object.entries(files));

  return {
    readFile: (path: string) => {
      const content = store.get(path);
      if (content == null) {
        return Promise.reject(Object.assign(new Error("missing"), { code: "ENOENT" }));
      }
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

describe("import-lockfile", () => {
  describe("createEmptyLockfile", () => {
    it("should create lockfile with version 1 and empty imports", () => {
      const lockfile = createEmptyLockfile();
      assertEquals(lockfile.version, 1);
      assertEquals(lockfile.imports, {});
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

    it("ignores import-like text in comments, strings, templates, and regular expressions", () => {
      const code = [
        '// import "./comment.ts";',
        '/* export { fake } from "./block-comment.ts"; */',
        "const first = 'import \"./string.ts\"';",
        'const second = `export * from "./template.ts"`;',
        "const matcher = /import\\s+[\"']\\.\\/regex\\.ts/;",
        'import "./real.ts";',
      ].join("\n");

      assertEquals(extractImports(code), [{ specifier: "./real.ts", type: "static" }]);
    });

    it("supports multiline declarations, export-star, and dynamic import options", () => {
      const code = `
        import {
          value,
        } from "./multiline.ts" with { type: "json" };
        export * as helpers from "./helpers.ts";
        const lazy = import("./lazy.json", { with: { type: "json" } });
      `;

      assertEquals(extractImports(code), [
        { specifier: "./multiline.ts", type: "static" },
        { specifier: "./helpers.ts", type: "static" },
        { specifier: "./lazy.json", type: "dynamic" },
      ]);
    });

    it("does not treat computed dynamic imports or import.meta as dependencies", () => {
      const code = `
        const computed = import("./pages/" + name + ".ts");
        const metadata = import.meta.url;
      `;

      assertEquals(extractImports(code), []);
    });

    it("decodes escaped module specifiers", () => {
      const code = 'import "./\\u0066oo.ts"; const lazy = import(`./bar.ts`);';

      assertEquals(extractImports(code), [
        { specifier: "./foo.ts", type: "static" },
        { specifier: "./bar.ts", type: "dynamic" },
      ]);
    });

    it("upgrades a repeated dynamic dependency to static without changing source order", () => {
      const code = `
        const lazy = import("./shared.ts");
        import value from "./shared.ts";
        import "./other.ts";
      `;

      assertEquals(extractImports(code), [
        { specifier: "./shared.ts", type: "static" },
        { specifier: "./other.ts", type: "static" },
      ]);
    });

    it("ignores property calls and regular expressions after control-flow conditions", () => {
      const code = [
        'const ignored = loader.import("./property.ts");',
        'if (enabled) /import "\\.\\/regex-after-if\\.ts"/.test(source);',
        'if (enabled) {} /import("regex-after-block")/.test(source);',
        'import "./real.ts";',
      ].join("\n");

      assertEquals(extractImports(code), [{ specifier: "./real.ts", type: "static" }]);
    });

    it("ignores regular expressions after statement block and declaration bodies", () => {
      const code = [
        '{} /import("regex-after-block")/.test(source);',
        'function example() {} /import("regex-after-function")/.test(source);',
        'class Example {} /import("regex-after-class")/.test(source);',
        'const expression = function () {} / import("./real-expression.ts");',
        'import "./real.ts";',
      ].join("\n");

      assertEquals(extractImports(code), [
        { specifier: "./real-expression.ts", type: "dynamic" },
        { specifier: "./real.ts", type: "static" },
      ]);
    });

    it("ignores regular expressions after ASI-separated declarations", () => {
      const code = [
        "const value = 1",
        'function example() {} /import("regex-after-function")/.test(source);',
        "const Other = value",
        'class Example {} /import("regex-after-class")/.test(source);',
        'import "./real.ts";',
      ].join("\n");

      assertEquals(extractImports(code), [{ specifier: "./real.ts", type: "static" }]);
    });

    it("finds imports inside template interpolations", () => {
      const code = 'const value = `prefix ${import("./inner.ts")}`;';

      assertEquals(extractImports(code), [{ specifier: "./inner.ts", type: "dynamic" }]);
    });

    it("rejects module sources beyond the supported scan bound", () => {
      const error = assertThrows(
        () => extractImports(" ".repeat(16 * 1024 * 1024 + 1)),
        VeryfrontError,
      );

      assertEquals(error.slug, "invalid-argument");
    });

    it("rejects excessive token and template nesting complexity", () => {
      const tokenError = assertThrows(
        () => extractImports("+ ".repeat(250_001)),
        VeryfrontError,
      );
      let nestedTemplate = "0";
      for (let depth = 0; depth < 66; depth++) {
        nestedTemplate = "`" + "${" + nestedTemplate + "}" + "`";
      }
      const nestingError = assertThrows(
        () => extractImports(nestedTemplate),
        VeryfrontError,
      );

      assertEquals(tokenError.slug, "invalid-argument");
      assertEquals(nestingError.slug, "invalid-argument");
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

    it("rejects credential-bearing and whitespace-padded URLs", () => {
      assertEquals(
        resolveImportUrl("https://user:secret@cdn.com/mod.ts", "https://base.com/"),
        null,
      );
      assertEquals(resolveImportUrl(" https://cdn.com/mod.ts", "https://base.com/"), null);
      assertEquals(resolveImportUrl("./mod.ts", "https://user:secret@base.com/main.ts"), null);
    });
  });

  describe("createLockfileManager", () => {
    it("should return null for read when no lockfile exists", async () => {
      const mgr = createLockfileManager("/project", createMockFS());
      assertEquals(await mgr.read(), null);
    });

    it("uses the adapter absence check when read errors have no platform code", async () => {
      let existsCalls = 0;
      const fs: FSAdapter = {
        readFile: () => Promise.reject(new Error("adapter-specific missing file")),
        writeFile: () => Promise.resolve(),
        exists: () => {
          existsCalls += 1;
          return Promise.resolve(false);
        },
      };
      const mgr = createLockfileManager("/project", fs);

      assertEquals(await mgr.read(), null);
      assertEquals(existsCalls, 1);
    });

    it("should read existing lockfile", async () => {
      const data = {
        version: 1,
        imports: {
          "https://cdn.com/mod.ts": {
            resolved: "https://cdn.com/mod.ts",
            integrity: VALID_INTEGRITY,
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
        integrity: VALID_INTEGRITY,
      });

      const entry = await mgr.get("https://cdn.com/mod.ts");
      assertEquals(entry?.resolved, "https://cdn.com/mod.ts");
      assertEquals(entry?.integrity, VALID_INTEGRITY);
    });

    it("should report has correctly", async () => {
      const mgr = createLockfileManager("/project", createMockFS());
      const specifier = "https://cdn.com/mod.ts";

      assertEquals(await mgr.has(specifier), false);

      await mgr.set(specifier, validEntry(specifier));
      assertEquals(await mgr.has(specifier), true);
    });

    it("should clear lockfile data", async () => {
      const mgr = createLockfileManager("/project", createMockFS());
      const specifier = "https://cdn.com/mod.ts";

      await mgr.set(specifier, validEntry(specifier));
      await mgr.clear();

      assertEquals(await mgr.has(specifier), false);
    });

    it("should flush dirty data to disk", async () => {
      const fs = createMockFS();
      const mgr = createLockfileManager("/project", fs);

      await mgr.set("https://cdn.com/mod.ts", {
        resolved: "https://cdn.com/mod.ts",
        integrity: VALID_INTEGRITY,
      });
      await mgr.flush();

      assertEquals(await fs.exists("/project/veryfront.lock"), true);
    });

    it("serializes imports in locale-independent code-unit order", async () => {
      let persisted = "";
      const fs: FSAdapter = {
        exists: () => Promise.resolve(false),
        readFile: () => Promise.reject(Object.assign(new Error("missing"), { code: "ENOENT" })),
        writeFile: (_path, content) => {
          persisted = content;
          return Promise.resolve();
        },
      };
      const mgr = createLockfileManager("/project", fs);
      const urls = [
        "https://cdn.com/z.ts",
        "https://cdn.com/ä.ts",
        "https://cdn.com/a.ts",
        "https://cdn.com/Z.ts",
      ];
      for (const url of urls) await mgr.set(url, validEntry(url));

      await mgr.flush();

      const parsed = JSON.parse(persisted) as { imports: Record<string, unknown> };
      assertEquals(Object.keys(parsed.imports), [
        "https://cdn.com/Z.ts",
        "https://cdn.com/a.ts",
        "https://cdn.com/z.ts",
        "https://cdn.com/ä.ts",
      ]);
    });

    it("should not flush when not dirty", async () => {
      const fs = createMockFS();
      const mgr = createLockfileManager("/project", fs);

      await mgr.flush();
      assertEquals(await fs.exists("/project/veryfront.lock"), false);
    });

    it("rejects an unsupported lockfile version instead of silently resetting it", async () => {
      const data = { version: 99, imports: { x: { resolved: "x", integrity: "y" } } };
      const fs = createMockFS({ "/project/veryfront.lock": JSON.stringify(data) });
      const mgr = createLockfileManager("/project", fs);

      const error = await assertVeryfrontRejects(() => mgr.read());
      assertEquals(error.slug, "config-parse-error");
      assertEquals(error.message.includes("99"), false);
    });

    it("rejects malformed and structurally invalid lockfiles", async () => {
      const malformed = createLockfileManager(
        "/project",
        createMockFS({ "/project/veryfront.lock": "{not-json" }),
      );
      const malformedError = await assertVeryfrontRejects(() => malformed.read());
      assertEquals(malformedError.slug, "config-parse-error");
      assertEquals(malformedError.message.includes("not-json"), false);

      const invalid = createLockfileManager(
        "/project",
        createMockFS({
          "/project/veryfront.lock": JSON.stringify({ version: 1, imports: [] }),
        }),
      );
      const invalidError = await assertVeryfrontRejects(() => invalid.read());
      assertEquals(invalidError.slug, "config-parse-error");
    });

    it("propagates operational read failures as sanitized cache errors and allows retry", async () => {
      let attempts = 0;
      const canary = "private-lockfile-path-canary";
      const fs: FSAdapter = {
        exists: () => Promise.resolve(true),
        readFile: () => {
          attempts += 1;
          if (attempts === 1) return Promise.reject(new Error(canary));
          return Promise.resolve(JSON.stringify({ version: 1, imports: {} }));
        },
        writeFile: () => Promise.resolve(),
        remove: () => Promise.resolve(),
      };
      const mgr = createLockfileManager("/project", fs);

      const error = await assertVeryfrontRejects(() => mgr.read());
      assertEquals(error.slug, "cache-error");
      assertEquals(error.message.includes(canary), false);
      assertEquals(error.detail?.includes(canary) ?? false, false);
      assertEquals((await mgr.read())?.version, 1);
      assertEquals(attempts, 2);
    });

    it("coalesces concurrent reads", async () => {
      const pendingRead = deferred<string>();
      let reads = 0;
      const fs: FSAdapter = {
        exists: () => Promise.resolve(true),
        readFile: () => {
          reads += 1;
          return pendingRead.promise;
        },
        writeFile: () => Promise.resolve(),
        remove: () => Promise.resolve(),
      };
      const mgr = createLockfileManager("/project", fs);
      const first = mgr.read();
      const second = mgr.read();

      pendingRead.resolve(JSON.stringify({ version: 1, imports: {} }));

      assertEquals((await first)?.version, 1);
      assertEquals((await second)?.version, 1);
      assertEquals(reads, 1);
    });

    it("snapshots file system adapter methods once at creation", async () => {
      const accesses = {
        readFile: 0,
        writeFile: 0,
        exists: 0,
        remove: 0,
        rename: 0,
      };
      const calls = {
        readFile: 0,
        writeFile: 0,
        remove: 0,
        rename: 0,
      };
      const implementations: FSAdapter = {
        readFile: () => {
          calls.readFile += 1;
          return Promise.reject(Object.assign(new Error("missing"), { code: "ENOENT" }));
        },
        writeFile: () => {
          calls.writeFile += 1;
          return Promise.resolve();
        },
        exists: () => Promise.resolve(false),
        remove: () => {
          calls.remove += 1;
          return Promise.resolve();
        },
        rename: () => {
          calls.rename += 1;
          return Promise.resolve();
        },
      };
      const adapter = {} as FSAdapter;
      for (const methodName of Object.keys(accesses) as Array<keyof FSAdapter>) {
        Object.defineProperty(adapter, methodName, {
          configurable: true,
          get() {
            accesses[methodName] += 1;
            return implementations[methodName];
          },
        });
      }

      const mgr = createLockfileManager("/project", adapter);
      for (const methodName of Object.keys(accesses) as Array<keyof FSAdapter>) {
        Object.defineProperty(adapter, methodName, {
          get() {
            throw new Error(`late-${methodName}-access`);
          },
        });
      }

      assertEquals(await mgr.read(), null);
      await mgr.set("https://cdn.com/mod.ts", validEntry());
      await mgr.flush();
      await mgr.clear();

      assertEquals(accesses, {
        readFile: 1,
        writeFile: 1,
        exists: 1,
        remove: 1,
        rename: 1,
      });
      assertEquals(calls, { readFile: 1, writeFile: 1, remove: 1, rename: 1 });
    });

    it("isolates cached data from caller mutation", async () => {
      const url = "https://cdn.com/mod.ts";
      const dependencies = ["https://cdn.com/dependency.ts"];
      const entry = { ...validEntry(url), dependencies };
      const mgr = createLockfileManager("/project", createMockFS());

      await mgr.set(url, entry);
      entry.resolved = "https://attacker.invalid/mutated.ts";
      dependencies.push("https://attacker.invalid/dependency.ts");

      const firstRead = await mgr.read();
      assertExists(firstRead);
      firstRead.imports[url]!.resolved = "https://attacker.invalid/read-mutation.ts";
      firstRead.imports[url]!.dependencies!.push("https://attacker.invalid/read-dependency.ts");

      const cached = await mgr.get(url);
      assertEquals(cached?.resolved, url);
      assertEquals(cached?.dependencies, ["https://cdn.com/dependency.ts"]);
    });

    it("rejects invalid entry keys and values without mutating the cache", async () => {
      const mgr = createLockfileManager("/project", createMockFS());

      const keyError = await assertVeryfrontRejects(() => mgr.set("__proto__", validEntry()));
      assertEquals(keyError.slug, "invalid-argument");

      const entryError = await assertVeryfrontRejects(
        () =>
          mgr.set("https://cdn.com/mod.ts", {
            resolved: "https://user:secret@cdn.com/mod.ts",
            integrity: "sha256-invalid",
          }),
      );
      assertEquals(entryError.slug, "invalid-argument");
      assertEquals(await mgr.read(), null);
    });

    it("keeps failed writes dirty so a later flush can retry", async () => {
      let writes = 0;
      let persisted = "";
      const fs: FSAdapter = {
        exists: () => Promise.resolve(false),
        readFile: () => Promise.reject(Object.assign(new Error("missing"), { code: "ENOENT" })),
        writeFile: (_path, content) => {
          writes += 1;
          if (writes === 1) return Promise.reject(new Error("disk-full-canary"));
          persisted = content;
          return Promise.resolve();
        },
        remove: () => Promise.resolve(),
      };
      const mgr = createLockfileManager("/project", fs);
      await mgr.set("https://cdn.com/mod.ts", validEntry());

      const error = await assertVeryfrontRejects(() => mgr.flush());
      assertEquals(error.slug, "cache-error");
      assertEquals(error.message.includes("disk-full-canary"), false);
      await mgr.flush();

      assertEquals(writes, 2);
      assertEquals(persisted.includes("https://cdn.com/mod.ts"), true);
    });

    it("serializes a set invoked while a flush is writing", async () => {
      const firstWrite = deferred<void>();
      const writes: string[] = [];
      const fs: FSAdapter = {
        exists: () => Promise.resolve(false),
        readFile: () => Promise.reject(Object.assign(new Error("missing"), { code: "ENOENT" })),
        writeFile: (_path, content) => {
          writes.push(content);
          return writes.length === 1 ? firstWrite.promise : Promise.resolve();
        },
        remove: () => Promise.resolve(),
      };
      const mgr = createLockfileManager("/project", fs);
      await mgr.set("https://cdn.com/first.ts", validEntry("https://cdn.com/first.ts"));

      const flushing = mgr.flush();
      const setting = mgr.set(
        "https://cdn.com/second.ts",
        validEntry("https://cdn.com/second.ts"),
      );
      firstWrite.resolve();
      await flushing;
      await setting;
      await mgr.flush();

      assertEquals(writes.length, 2);
      assertEquals(writes[0]!.includes("https://cdn.com/second.ts"), false);
      assertEquals(writes[1]!.includes("https://cdn.com/first.ts"), true);
      assertEquals(writes[1]!.includes("https://cdn.com/second.ts"), true);
    });

    it("atomically replaces the lockfile when the adapter supports rename", async () => {
      const writes: string[] = [];
      const renames: Array<[string, string]> = [];
      const fs = {
        exists: () => Promise.resolve(false),
        readFile: () => Promise.reject(Object.assign(new Error("missing"), { code: "ENOENT" })),
        writeFile: (path: string) => {
          writes.push(path);
          return Promise.resolve();
        },
        rename: (from: string, to: string) => {
          renames.push([from, to]);
          return Promise.resolve();
        },
        remove: () => Promise.resolve(),
      };
      const mgr = createLockfileManager("/project", fs);
      await mgr.set("https://cdn.com/mod.ts", validEntry());

      await mgr.flush();

      assertEquals(writes.length, 1);
      assertEquals(writes[0]!.startsWith("/project/veryfront.lock.tmp-"), true);
      assertEquals(renames, [[writes[0]!, "/project/veryfront.lock"]]);
    });

    it("uses atomic replacement when cleanup support is unavailable", async () => {
      const writes: string[] = [];
      const renames: Array<[string, string]> = [];
      const fs: FSAdapter = {
        exists: () => Promise.resolve(false),
        readFile: () => Promise.reject(Object.assign(new Error("missing"), { code: "ENOENT" })),
        writeFile: (path) => {
          writes.push(path);
          return Promise.resolve();
        },
        rename: (from, to) => {
          renames.push([from, to]);
          return Promise.resolve();
        },
      };
      const mgr = createLockfileManager("/project", fs);
      await mgr.set("https://cdn.com/mod.ts", validEntry());

      await mgr.flush();

      assertEquals(writes.length, 1);
      assertEquals(writes[0]!.startsWith("/project/veryfront.lock.tmp-"), true);
      assertEquals(renames, [[writes[0]!, "/project/veryfront.lock"]]);
    });

    it("cleans failed atomic writes and keeps them retryable", async () => {
      const temporaryWrites: string[] = [];
      const removed: string[] = [];
      let renameAttempts = 0;
      const fs = {
        exists: () => Promise.resolve(false),
        readFile: () => Promise.reject(Object.assign(new Error("missing"), { code: "ENOENT" })),
        writeFile: (path: string) => {
          temporaryWrites.push(path);
          return Promise.resolve();
        },
        rename: () => {
          renameAttempts += 1;
          if (renameAttempts === 1) return Promise.reject(new Error("rename-failed-canary"));
          return Promise.resolve();
        },
        remove: (path: string) => {
          removed.push(path);
          return Promise.resolve();
        },
      };
      const mgr = createLockfileManager("/project", fs);
      await mgr.set("https://cdn.com/mod.ts", validEntry());

      const error = await assertVeryfrontRejects(() => mgr.flush());
      assertEquals(error.slug, "cache-error");
      assertEquals(removed, [temporaryWrites[0]!]);

      await mgr.flush();
      assertEquals(renameAttempts, 2);
      assertEquals(temporaryWrites.length, 2);
    });

    it("does not clear in-memory data when persistent removal fails", async () => {
      const url = "https://cdn.com/mod.ts";
      let removes = 0;
      const fs: FSAdapter = {
        exists: () => Promise.resolve(true),
        readFile: () =>
          Promise.resolve(JSON.stringify({ version: 1, imports: { [url]: validEntry(url) } })),
        writeFile: () => Promise.resolve(),
        remove: () => {
          removes += 1;
          if (removes === 1) return Promise.reject(new Error("permission-canary"));
          return Promise.resolve();
        },
      };
      const mgr = createLockfileManager("/project", fs);

      const error = await assertVeryfrontRejects(() => mgr.clear());
      assertEquals(error.slug, "cache-error");
      assertEquals((await mgr.get(url))?.resolved, url);

      await mgr.clear();
      assertEquals(await mgr.get(url), null);
    });

    it("persists an empty lockfile when the adapter cannot remove files", async () => {
      const url = "https://cdn.com/mod.ts";
      let persisted = JSON.stringify({
        version: 1,
        imports: { [url]: validEntry(url) },
      });
      const fs: FSAdapter = {
        exists: () => Promise.resolve(true),
        readFile: () => Promise.resolve(persisted),
        writeFile: (_path, content) => {
          persisted = content;
          return Promise.resolve();
        },
      };
      const mgr = createLockfileManager("/project", fs);

      await mgr.clear();

      assertEquals(await mgr.get(url), null);
      const reloaded = await createLockfileManager("/project", fs).read();
      assertEquals(reloaded?.version, 1);
      assertEquals(Object.keys(reloaded!.imports), []);
    });

    it("does not let an in-flight read restore data after replacement-based clear", async () => {
      const url = "https://cdn.com/mod.ts";
      const pendingRead = deferred<string>();
      const readStarted = deferred<void>();
      let persisted = "";
      let writeStarted = false;
      const fs: FSAdapter = {
        exists: () => Promise.resolve(true),
        readFile: () => {
          readStarted.resolve();
          return pendingRead.promise;
        },
        writeFile: (_path, content) => {
          writeStarted = true;
          persisted = content;
          return Promise.resolve();
        },
      };
      const mgr = createLockfileManager("/project", fs);
      const reading = mgr.read();
      await readStarted.promise;

      const clearing = mgr.clear();
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
      assertEquals(writeStarted, false);
      pendingRead.resolve(JSON.stringify({
        version: 1,
        imports: { [url]: validEntry(url) },
      }));
      await reading;
      await clearing;

      assertEquals(await mgr.get(url), null);
      assertEquals(JSON.parse(persisted), { version: 1, imports: {} });
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
      const content = "export const value = 2;";
      const mgr = createLockfileManager("/project", createMockFS());

      const result = await fetchWithLock({
        lockfile: mgr,
        url,
        fetchFn: (input: string | URL | Request) => {
          assertEquals(String(input), url);
          return Promise.resolve(new Response(content, { status: 200 }));
        },
      });

      const saved = await mgr.get(url);
      assertExists(saved);
      assertEquals(result.fromCache, false);
      assertEquals(result.resolvedUrl, url);
      assertEquals(result.content, content);
      assertEquals(saved.resolved, url);
      assertEquals(saved.integrity, result.integrity);
    });

    it("cancels an unconsumed cached error body before falling back", async () => {
      const url = "https://cdn.com/mod.ts";
      const resolved = "https://esm.sh/mod.ts";
      const mgr = createLockfileManager("/project", createMockFS());
      await mgr.set(url, { resolved, integrity: await computeIntegrity("old") });
      let cancelCalls = 0;

      const result = await fetchWithLock({
        lockfile: mgr,
        url,
        fetchFn: (input: string | URL | Request) => {
          if (String(input) === resolved) {
            return Promise.resolve(
              new Response(
                new ReadableStream<Uint8Array>({
                  cancel() {
                    cancelCalls += 1;
                  },
                }),
                { status: 503 },
              ),
            );
          }
          return Promise.resolve(new Response("export const value = 2;", { status: 200 }));
        },
      });

      assertEquals(result.fromCache, false);
      assertEquals(cancelCalls, 1);
    });

    it("cancels an unconsumed fresh error body", async () => {
      const mgr = createLockfileManager("/project", createMockFS());
      let cancelCalls = 0;

      const error = await assertVeryfrontRejects(() =>
        fetchWithLock({
          lockfile: mgr,
          url: "https://cdn.com/mod.ts",
          fetchFn: () =>
            Promise.resolve(
              new Response(
                new ReadableStream<Uint8Array>({
                  cancel() {
                    cancelCalls += 1;
                  },
                }),
                { status: 500 },
              ),
            ),
        })
      );

      assertEquals(error.slug, "network-error");
      assertEquals(cancelCalls, 1);
    });

    it("throws a sanitized cache error in strict mode when integrity mismatches", async () => {
      const url = "https://cdn.com/private-module-canary.ts";
      const mgr = createLockfileManager("/project", createMockFS());

      await mgr.set(url, {
        resolved: url,
        integrity: await computeIntegrity("old"),
      });

      const error = await assertVeryfrontRejects(
        () =>
          fetchWithLock({
            lockfile: mgr,
            url,
            strict: true,
            fetchFn: () => Promise.resolve(new Response("new", { status: 200 })),
          }),
      );
      assertEquals(error.slug, "cache-error");
      assertEquals(error.message.includes(url), false);
      assertEquals(error.message.includes("sha256-"), false);
    });

    it("rejects unsafe URLs before invoking fetch", async () => {
      const mgr = createLockfileManager("/project", createMockFS());
      let fetchCalls = 0;

      const error = await assertVeryfrontRejects(() =>
        fetchWithLock({
          lockfile: mgr,
          url: "https://user:secret@cdn.com/mod.ts",
          fetchFn: () => {
            fetchCalls += 1;
            return Promise.resolve(new Response("unexpected"));
          },
        })
      );

      assertEquals(error.slug, "invalid-argument");
      assertEquals(fetchCalls, 0);
    });

    it("rejects malformed cancellation signals before invoking fetch", async () => {
      const mgr = createLockfileManager("/project", createMockFS());
      let fetchCalls = 0;

      const error = await assertVeryfrontRejects(() =>
        fetchWithLock({
          lockfile: mgr,
          url: "https://cdn.com/mod.ts",
          signal: {
            aborted: false,
            addEventListener() {},
          } as unknown as AbortSignal,
          fetchFn: () => {
            fetchCalls += 1;
            return Promise.resolve(new Response("unexpected"));
          },
        })
      );

      assertEquals(error.slug, "invalid-argument");
      assertEquals(fetchCalls, 0);
    });

    it("snapshots cancellation methods before asynchronous work", async () => {
      const mgr = createLockfileManager("/project", createMockFS());
      const signal = {
        aborted: false,
        addEventListener: () => {},
        removeEventListener: () => {},
      };

      const resultPromise = fetchWithLock({
        lockfile: mgr,
        url: "https://cdn.com/mod.ts",
        signal: signal as unknown as AbortSignal,
        fetchFn: () => Promise.resolve(new Response("export const value = 1;")),
      });
      signal.addEventListener = () => {
        throw new Error("mutated-add-listener-canary");
      };
      signal.removeEventListener = () => {
        throw new Error("mutated-remove-listener-canary");
      };

      const result = await resultPromise;
      assertEquals(result.fromCache, false);
    });

    it("snapshots lockfile operations before asynchronous work", async () => {
      const mgr = createLockfileManager("/project", createMockFS());
      const response = deferred<Response>();
      const fetchStarted = deferred<void>();
      const lockfile = {} as LockfileManager;
      const operations = {
        get: mgr.get,
        set: mgr.set,
        flush: mgr.flush,
      };
      for (const methodName of Object.keys(operations) as Array<keyof typeof operations>) {
        Object.defineProperty(lockfile, methodName, {
          configurable: true,
          get: () => operations[methodName],
        });
      }

      const resultPromise = fetchWithLock({
        lockfile,
        url: "https://cdn.com/mod.ts",
        fetchFn: () => {
          fetchStarted.resolve();
          return response.promise;
        },
      });
      await fetchStarted.promise;
      for (const methodName of ["get", "set", "flush"] as const) {
        Object.defineProperty(lockfile, methodName, {
          get() {
            throw new Error(`late-${methodName}-access`);
          },
        });
      }
      response.resolve(new Response("export const value = 1;"));

      const result = await resultPromise;
      assertEquals(result.fromCache, false);
      assertEquals((await mgr.get("https://cdn.com/mod.ts"))?.resolved, "https://cdn.com/mod.ts");
    });

    it("snapshots fetch options before validating or starting I/O", async () => {
      const mgr = createLockfileManager("/project", createMockFS());
      let strictReads = 0;
      const options = {
        lockfile: mgr,
        url: "https://cdn.com/mod.ts",
        fetchFn: () => Promise.resolve(new Response("export const value = 1;")),
      } as FetchWithLockOptions;
      Object.defineProperty(options, "strict", {
        enumerable: true,
        get() {
          strictReads += 1;
          return strictReads === 1 ? false : "invalid";
        },
      });

      const result = await fetchWithLock(options);

      assertEquals(result.fromCache, false);
      assertEquals(strictReads, 1);
    });

    it("does not invoke fetch when cancellation already occurred", async () => {
      const mgr = createLockfileManager("/project", createMockFS());
      const controller = new AbortController();
      controller.abort();
      let fetchCalls = 0;

      const error = await assertVeryfrontRejects(() =>
        fetchWithLock({
          lockfile: mgr,
          url: "https://cdn.com/mod.ts",
          signal: controller.signal,
          fetchFn: () => {
            fetchCalls += 1;
            return Promise.resolve(new Response("unexpected"));
          },
        })
      );

      assertEquals(error.slug, "network-error");
      assertEquals(error.message, "The remote import request was cancelled");
      assertEquals(fetchCalls, 0);
    });

    it("wraps network failures without exposing the URL or raw error", async () => {
      const url = "https://cdn.com/private-network-canary.ts";
      const rawCanary = "socket-private-canary";
      const mgr = createLockfileManager("/project", createMockFS());

      const error = await assertVeryfrontRejects(() =>
        fetchWithLock({
          lockfile: mgr,
          url,
          fetchFn: () => Promise.reject(new Error(rawCanary)),
        })
      );

      assertEquals(error.slug, "network-error");
      assertEquals(error.message.includes(url), false);
      assertEquals(error.message.includes(rawCanary), false);
      assertEquals(error.detail?.includes(rawCanary) ?? false, false);
      assertEquals(error.cause, undefined);
    });

    it("enforces the configured response byte limit while streaming", async () => {
      const mgr = createLockfileManager("/project", createMockFS());
      const options = {
        lockfile: mgr,
        url: "https://cdn.com/large.ts",
        maxResponseBytes: 4,
        fetchFn: () =>
          Promise.resolve(
            new Response(
              new ReadableStream<Uint8Array>({
                start(controller) {
                  controller.enqueue(new TextEncoder().encode("123"));
                  controller.enqueue(new TextEncoder().encode("456"));
                  controller.close();
                },
              }),
            ),
          ),
      };

      const error = await assertVeryfrontRejects(() => fetchWithLock(options));
      assertEquals(error.slug, "network-error");
      assertEquals(error.message, "The remote import response is too large");
    });

    it("times out even when a custom fetch implementation only observes abort", async () => {
      const mgr = createLockfileManager("/project", createMockFS());
      const options = {
        lockfile: mgr,
        url: "https://cdn.com/slow.ts",
        timeoutMs: 5,
        fetchFn: (_input: string | URL | Request, init?: RequestInit) =>
          new Promise<Response>((_resolve, reject) => {
            const guard = setTimeout(
              () => reject(new Error("fetch abort signal was not received")),
              50,
            );
            init?.signal?.addEventListener(
              "abort",
              () => {
                clearTimeout(guard);
                reject(new DOMException("Aborted", "AbortError"));
              },
              { once: true },
            );
          }),
      };

      const error = await assertVeryfrontRejects(() => fetchWithLock(options));
      assertEquals(error.slug, "timeout-error");
    });

    it("applies the request timeout while reading the response body", async () => {
      const mgr = createLockfileManager("/project", createMockFS());
      let bodyCancelled = false;
      let bodyGuard: ReturnType<typeof setTimeout> | undefined;
      const options = {
        lockfile: mgr,
        url: "https://cdn.com/hanging-body.ts",
        timeoutMs: 5,
        fetchFn: () =>
          Promise.resolve(
            new Response(
              new ReadableStream<Uint8Array>({
                start(controller) {
                  bodyGuard = setTimeout(
                    () => controller.error(new Error("body read guard elapsed")),
                    50,
                  );
                },
                cancel() {
                  clearTimeout(bodyGuard);
                  bodyCancelled = true;
                },
              }),
            ),
          ),
      };

      const error = await assertVeryfrontRejects(() => fetchWithLock(options));
      assertEquals(error.slug, "timeout-error");
      assertEquals(bodyCancelled, true);
    });

    it("does not await a hanging body cancellation after external cancellation", async () => {
      const mgr = createLockfileManager("/project", createMockFS());
      const controller = new AbortController();
      const bodyReadStarted = deferred<void>();
      let cancelCalls = 0;
      const request = fetchWithLock({
        lockfile: mgr,
        url: "https://cdn.com/hanging-cancel.ts",
        signal: controller.signal,
        fetchFn: () =>
          Promise.resolve(
            new Response(
              new ReadableStream<Uint8Array>({
                pull() {
                  bodyReadStarted.resolve();
                },
                cancel() {
                  cancelCalls += 1;
                  return new Promise<void>(() => {});
                },
              }, { highWaterMark: 0 }),
            ),
          ),
      });

      await bodyReadStarted.promise;
      controller.abort();
      const guard = Symbol("request did not settle");
      let guardTimer: ReturnType<typeof setTimeout> | undefined;
      const outcome = await Promise.race([
        request.catch((error) => error),
        new Promise<typeof guard>((resolve) => {
          guardTimer = setTimeout(() => resolve(guard), 50);
        }),
      ]);
      clearTimeout(guardTimer);

      assertEquals(outcome === guard, false);
      assertEquals(outcome instanceof VeryfrontError ? outcome.slug : undefined, "network-error");
      assertEquals(cancelCalls, 1);
    });

    it("rejects credential-bearing redirect targets", async () => {
      const mgr = createLockfileManager("/project", createMockFS());
      const response = new Response("export const value = 1;");
      Object.defineProperty(response, "url", {
        configurable: true,
        value: "https://user:secret@cdn.com/redirected.ts",
      });

      const error = await assertVeryfrontRejects(() =>
        fetchWithLock({
          lockfile: mgr,
          url: "https://cdn.com/mod.ts",
          fetchFn: () => Promise.resolve(response),
        })
      );

      assertEquals(error.slug, "network-error");
      assertEquals(await mgr.read(), null);
    });

    it("validates redirect targets for cached responses", async () => {
      const url = "https://cdn.com/cached.ts";
      const content = "export const cached = true;";
      const mgr = createLockfileManager("/project", createMockFS());
      await mgr.set(url, { resolved: url, integrity: await computeIntegrity(content) });
      const response = new Response(content);
      Object.defineProperty(response, "url", {
        configurable: true,
        value: "https://user:secret@cdn.com/cached-redirect.ts",
      });

      const error = await assertVeryfrontRejects(() =>
        fetchWithLock({
          lockfile: mgr,
          url,
          strict: true,
          fetchFn: () => Promise.resolve(response),
        })
      );

      assertEquals(error.slug, "network-error");
    });

    it("does not include import URLs in debug logs", async () => {
      const url = "https://cdn.com/private-log-canary.ts";
      const previousLogLevel = Deno.env.get("LOG_LEVEL");
      const originalDebug = console.debug;
      const output: string[] = [];
      const mgr = createLockfileManager("/project", createMockFS());

      try {
        Deno.env.set("LOG_LEVEL", "DEBUG");
        __resetLoggerConfigForTests();
        console.debug = (...args: unknown[]) => output.push(args.map(String).join(" "));

        await fetchWithLock({
          lockfile: mgr,
          url,
          fetchFn: () => Promise.resolve(new Response("export const value = 1;")),
        });

        assertEquals(output.join("\n").includes(url), false);
      } finally {
        console.debug = originalDebug;
        if (previousLogLevel === undefined) Deno.env.delete("LOG_LEVEL");
        else Deno.env.set("LOG_LEVEL", previousLogLevel);
        __resetLoggerConfigForTests();
      }
    });
  });
});
