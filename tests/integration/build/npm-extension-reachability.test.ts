import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { join } from "#std/path";
import { makeTempDir } from "#veryfront/testing/deno-compat.ts";
import { pruneUnreachableExtensionDirectories } from "../../../scripts/build/npm-extension-reachability.ts";

async function withPackage(
  files: Record<string, string>,
  test: (outDir: string) => Promise<void>,
): Promise<void> {
  const outDir = await makeTempDir();
  try {
    for (const [name, source] of Object.entries(files)) {
      const path = join(outDir, "esm", name);
      await Deno.mkdir(join(path, ".."), { recursive: true });
      await Deno.writeTextFile(path, source);
    }
    await test(outDir);
  } finally {
    await Deno.remove(outDir, { recursive: true });
  }
}

async function exists(outDir: string, path: string): Promise<boolean> {
  try {
    await Deno.stat(join(outDir, "esm", path));
    return true;
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) return false;
    throw error;
  }
}

async function prune(
  input: Parameters<typeof pruneUnreachableExtensionDirectories>[0],
): Promise<boolean> {
  return (await pruneUnreachableExtensionDirectories(input)).kind ===
    "complete";
}

const root = "./esm/extensions/owner/src/index.js";

describe("generated extension directory reachability", () => {
  it("follows emitted module-relative workers selected by an immutable const", async () => {
    await withPackage({
      "extensions/owner/src/index.js":
        `const worker = import.meta.url.endsWith(".ts") ? "./worker.ts" : "./worker.js";
        export const url = new URL(worker, import.meta.url);`,
      "extensions/owner/src/worker.js": 'import "../../peer/src/index.js";',
      "extensions/peer/src/index.js": "export {};",
      "extensions/unused/src/index.js": "export {};",
    }, async (outDir) => {
      assertEquals(await prune({ outDir, entryPointPaths: [root] }), true);
      assertEquals(await exists(outDir, "extensions/peer"), true);
      assertEquals(await exists(outDir, "extensions/unused"), false);
    });
  });

  it("recognizes package-resolved dynamic imports without fetching the package", async () => {
    await withPackage({
      "extensions/owner/src/index.js":
        `const packageUrl = import.meta.resolve("declared-optional-package");
        const workerUrl = new URL("./worker.js", packageUrl).href;
        export const load = () => import(workerUrl);`,
      "extensions/unused/src/index.js": "export {};",
    }, async (outDir) => {
      assertEquals(await prune({ outDir, entryPointPaths: [root] }), true);
      assertEquals(await exists(outDir, "extensions/unused"), false);
    });
  });

  it("follows finite selectors through the exact DNT import-meta wrapper", async () => {
    await withPackage({
      "extensions/owner/src/index.js":
        `const worker = globalThis[Symbol.for("import-meta-ponyfill-esmodule")](import.meta).url.endsWith(".ts") ? "./worker.ts" : "worker.js";
        export const url = new URL(worker, globalThis[Symbol.for("import-meta-ponyfill-esmodule")](import.meta).url);`,
      "extensions/owner/src/worker.js": 'import "../../peer/src/index.js";',
      "extensions/peer/src/index.js": "export {};",
      "extensions/unused/src/index.js": "export {};",
    }, async (outDir) => {
      assertEquals(await prune({ outDir, entryPointPaths: [root] }), true);
      assertEquals(await exists(outDir, "extensions/peer"), true);
      assertEquals(await exists(outDir, "extensions/unused"), false);
    });
  });

  it("keeps both finite branches when a selector condition is unknown", async () => {
    await withPackage({
      "extensions/owner/src/index.js":
        `const module = condition ? "../../first/src/index.js" : "../../second/src/index.js";
        export const load = () => import(module);`,
      "extensions/first/src/index.js": "export {};",
      "extensions/second/src/index.js": "export {};",
      "extensions/unused/src/index.js": "export {};",
    }, async (outDir) => {
      assertEquals(await prune({ outDir, entryPointPaths: [root] }), true);
      assertEquals(await exists(outDir, "extensions/first"), true);
      assertEquals(await exists(outDir, "extensions/second"), true);
      assertEquals(await exists(outDir, "extensions/unused"), false);
    });
  });

  for (
    const source of [
      `let worker = "./worker.js"; export const load = () => import(worker);`,
      `const worker = "./worker.js"; export const load = (worker) => import(worker);`,
      `const worker = "./worker.js"; function other() { const worker = unknown; return import(worker); }`,
      `const worker = "./worker.js"; export const loader = { load(worker) { return import(worker); } };`,
      `const worker = "./worker.js"; export class Loader { load(worker) { return import(worker); } }`,
      `const URL = replacement; export const load = () => import(new URL("./worker.js", import.meta.url));`,
      `const base = unknown; export const url = new URL("./worker.js", base);`,
      `const base = import.meta.resolve("file:///unknown/package.js"); export const load = () => import(base);`,
      `export const load = () => import(new URL("file:///unknown/package.js"));`,
      `import { createRequire } from "node:module";
      const require = createRequire(import.meta.url);
      export const workerPath = require.resolve("../../../src/worker.js");`,
      `require.resolve?.("../../../src/worker.js");`,
      `require.resolve.call(require, "../../../src/worker.js");`,
      `const resolveWorker = require.resolve.bind(require, "../../../src/worker.js"); resolveWorker();`,
    ]
  ) {
    it(`preserves all output for ambiguous or mutable selector ${source}`, async () => {
      await withPackage({
        "extensions/owner/src/index.js": source,
        "extensions/owner/src/worker.js": "export {};",
        "src/worker.js": "export {};",
        "extensions/possibly-used/src/index.js": "export {};",
      }, async (outDir) => {
        assertEquals(await prune({ outDir, entryPointPaths: [root] }), false);
        assertEquals(await exists(outDir, "extensions/possibly-used"), true);
        assertEquals(await exists(outDir, "src/worker.js"), true);
      });
    });
  }

  it("reports module-relative package-root assets for later cleanup to retain", async () => {
    await withPackage({
      "extensions/owner/src/index.js":
        'export const worker = new URL("../../../src/worker.js", import.meta.url);',
      "src/worker.js":
        'import "../deps/helper.js"; export const image = new URL("../react/image.svg", import.meta.url);',
      "deps/helper.js": "export {};",
      "react/image.svg": "<svg/>",
      "extensions/unused/src/index.js": "export {};",
    }, async (outDir) => {
      const graph = await pruneUnreachableExtensionDirectories({
        outDir,
        entryPointPaths: [root],
      });
      assertEquals(graph.kind, "complete");
      if (graph.kind !== "complete") {
        throw new Error("Expected complete asset graph");
      }
      for (const directory of ["src", "deps", "react"]) {
        assertEquals(graph.referencedTopLevelEntries.has(directory), true);
      }
      assertEquals(await exists(outDir, "src/worker.js"), true);
      assertEquals(await exists(outDir, "react/image.svg"), true);
      assertEquals(await exists(outDir, "extensions/unused"), false);
    });
  });
  it("prunes unused peer baggage whose root references would retain the framework", async () => {
    await withPackage({
      "extensions/owner/src/index.js": 'import "veryfront/extensions";',
      "extensions/unused/src/index.js": 'import "../../../src/private.js";',
      "src/private.js": 'import "unrelated-framework-dependency";',
    }, async (outDir) => {
      assertEquals(
        await prune({ outDir, entryPointPaths: [root] }),
        true,
      );
      assertEquals(await exists(outDir, "extensions/owner/src/index.js"), true);
      assertEquals(await exists(outDir, "extensions/unused"), false);
      assertEquals(await exists(outDir, "src/private.js"), true);
    });
  });

  it("keeps cross-extension static and lazy literal imports", async () => {
    await withPackage({
      "extensions/owner/src/index.js":
        'export * from "../../peer/src/index.js"; export const load = () => import("../../lazy/src/index.js");',
      "extensions/peer/src/index.js": "export const peer = true;",
      "extensions/lazy/src/index.js": "export const lazy = true;",
      "extensions/unused/src/index.js": "export {};",
    }, async (outDir) => {
      assertEquals(
        await prune({ outDir, entryPointPaths: [root] }),
        true,
      );
      assertEquals(await exists(outDir, "extensions/peer/src/index.js"), true);
      assertEquals(await exists(outDir, "extensions/lazy/src/index.js"), true);
      assertEquals(await exists(outDir, "extensions/unused"), false);
    });
  });

  it("keeps declaration-only edges that address JavaScript module names", async () => {
    await withPackage({
      "extensions/owner/src/index.js": "export {};",
      "extensions/owner/src/index.d.ts":
        'export type Value = import("../../types-only/src/index.js").Value;',
      "extensions/types-only/src/index.d.ts": "export type Value = string;",
      "extensions/unused/src/index.js": "export {};",
    }, async (outDir) => {
      assertEquals(
        await prune({
          outDir,
          entryPointPaths: [root, root.replace(/\.js$/, ".d.ts")],
        }),
        true,
      );
      assertEquals(
        await exists(outDir, "extensions/types-only/src/index.d.ts"),
        true,
      );
      assertEquals(await exists(outDir, "extensions/unused"), false);
    });
  });

  it("keeps TypeScript triple-slash declaration references", async () => {
    await withPackage({
      "extensions/owner/src/index.js": "export {};",
      "extensions/owner/src/index.d.ts":
        '/// <reference path="../../types-only/src/index.d.ts" />\nexport {};',
      "extensions/types-only/src/index.d.ts": "export type Value = string;",
      "extensions/unused/src/index.js": "export {};",
    }, async (outDir) => {
      assertEquals(
        await prune({
          outDir,
          entryPointPaths: [root, root.replace(/\.js$/, ".d.ts")],
        }),
        true,
      );
      assertEquals(await exists(outDir, "extensions/types-only"), true);
      assertEquals(await exists(outDir, "extensions/unused"), false);
    });
  });

  it("handles cycles without dropping either reachable peer", async () => {
    await withPackage({
      "extensions/owner/src/index.js": 'import "../../first/src/index.js";',
      "extensions/first/src/index.js": 'import "../../second/src/index.js";',
      "extensions/second/src/index.js": 'import "../../first/src/index.js";',
      "extensions/unused/src/index.js": "export {};",
    }, async (outDir) => {
      assertEquals(
        await prune({ outDir, entryPointPaths: [root] }),
        true,
      );
      assertEquals(await exists(outDir, "extensions/first/src/index.js"), true);
      assertEquals(
        await exists(outDir, "extensions/second/src/index.js"),
        true,
      );
      assertEquals(await exists(outDir, "extensions/unused"), false);
    });
  });

  for (
    const source of [
      "export const load = (name) => import(name);",
      "export const load = (name) => require(name);",
    ]
  ) {
    it(`retains all output for an unresolved dynamic selector: ${source.includes("require") ? "require" : "import"}`, async () => {
      await withPackage({
        "extensions/owner/src/index.js": source,
        "extensions/possibly-used/src/index.js": "export {};",
        "src/private.js": "export {};",
      }, async (outDir) => {
        assertEquals(
          await prune({ outDir, entryPointPaths: [root] }),
          false,
        );
        assertEquals(
          await exists(outDir, "extensions/possibly-used/src/index.js"),
          true,
        );
        assertEquals(await exists(outDir, "src/private.js"), true);
      });
    });
  }

  it("retains all output after a parse failure or missing relative target", async () => {
    for (const source of ["export const = ;", 'import "./missing.js";']) {
      await withPackage({
        "extensions/owner/src/index.js": source,
        "extensions/possibly-used/src/index.js": "export {};",
      }, async (outDir) => {
        assertEquals(
          await prune({ outDir, entryPointPaths: [root] }),
          false,
        );
        assertEquals(
          await exists(outDir, "extensions/possibly-used/src/index.js"),
          true,
        );
      });
    }
  });

  it("includes every exported subpath root", async () => {
    await withPackage({
      "extensions/owner/src/index.js": "export {};",
      "extensions/subpath/src/index.js": "export {};",
      "extensions/unused/src/index.js": "export {};",
    }, async (outDir) => {
      assertEquals(
        await prune({
          outDir,
          entryPointPaths: [root, "./esm/extensions/subpath/src/index.js"],
        }),
        true,
      );
      assertEquals(
        await exists(outDir, "extensions/subpath/src/index.js"),
        true,
      );
      assertEquals(await exists(outDir, "extensions/unused"), false);
    });
  });

  it("keeps same-directory assets and follows a module-relative worker dependency", async () => {
    await withPackage({
      "extensions/owner/src/index.js":
        'export const worker = new URL("./worker.js", import.meta.url);',
      "extensions/owner/src/worker.js": 'import "../../worker-peer/src/index.js";',
      "extensions/owner/src/data.json": '{"asset":true}',
      "extensions/worker-peer/src/index.js": "export {};",
      "extensions/unused/src/index.js": "export {};",
    }, async (outDir) => {
      assertEquals(
        await prune({ outDir, entryPointPaths: [root] }),
        true,
      );
      assertEquals(
        await exists(outDir, "extensions/owner/src/data.json"),
        true,
      );
      assertEquals(
        await exists(outDir, "extensions/owner/src/worker.js"),
        true,
      );
      assertEquals(
        await exists(outDir, "extensions/worker-peer/src/index.js"),
        true,
      );
      assertEquals(await exists(outDir, "extensions/unused"), false);
    });
  });

  it("ignores import-looking text in comments and generated source strings", async () => {
    await withPackage({
      "extensions/owner/src/index.js":
        'export const source = `import("${resolved}")`; // import("../../unused/src/index.js")',
      "extensions/unused/src/index.js": "export {};",
    }, async (outDir) => {
      assertEquals(
        await prune({ outDir, entryPointPaths: [root] }),
        true,
      );
      assertEquals(await exists(outDir, "extensions/unused"), false);
    });
  });
});
