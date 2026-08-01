import { win32 } from "node:path";
import { assertEquals, assertRejects, assertThrows } from "#std/assert";
import { isPathContained as isSourcePathContained } from "../lib/path-containment.ts";
import {
  collectCoreProductionFiles,
  collectSourceDependencies,
  type SourceDependency,
  type SourceDependencyCollectionOptions,
  SourceImportCollectorError,
} from "./source-import-collector.ts";

Deno.test("source file containment is separator-agnostic for Windows paths", () => {
  const root = String.raw`C:\repo`;
  const implementation = {
    relative: win32.relative,
    isAbsolute: win32.isAbsolute,
    separator: win32.sep,
  };
  for (
    const [candidate, expected] of [
      [root, true],
      [String.raw`C:\repo\src\index.ts`, true],
      [String.raw`C:\repo-other\src\index.ts`, false],
      [String.raw`C:\outside\index.ts`, false],
      [String.raw`D:\repo\src\index.ts`, false],
    ] as const
  ) {
    assertEquals(
      isSourcePathContained(root, candidate, implementation),
      expected,
      candidate,
    );
  }
});

function dependencySummary(
  dependencies: SourceDependency[],
): Array<Pick<SourceDependency, "kind" | "specifier" | "loader" | "line">> {
  return dependencies.map(({ kind, specifier, loader, line }) => ({
    kind,
    specifier,
    loader,
    line,
  }));
}

Deno.test("source collector parses static, type, dynamic, import-equals, and triple-slash edges", () => {
  const dependencies = collectSourceDependencies({
    path: "src/example.ts",
    content: [
      '/// <reference types="npm:@types/node@24.0.0" />',
      'import value from "npm:runtime@1.0.0";',
      'import type { Model } from "jsr:@vendor/types@1.0.0";',
      'export { helper } from "https://vendor.example/helper.ts";',
      'export type { Contract } from "@vendor/exported-contract";',
      'type Remote = import("@vendor/contracts").Remote;',
      'import legacy = require("legacy-runtime");',
      'await import("dynamic-runtime");',
    ].join("\n"),
  });

  assertEquals(dependencySummary(dependencies), [
    {
      kind: "triple-slash-reference",
      specifier: "npm:@types/node@24.0.0",
      loader: undefined,
      line: 1,
    },
    {
      kind: "static-import",
      specifier: "npm:runtime@1.0.0",
      loader: undefined,
      line: 2,
    },
    {
      kind: "type-import",
      specifier: "jsr:@vendor/types@1.0.0",
      loader: undefined,
      line: 3,
    },
    {
      kind: "static-export",
      specifier: "https://vendor.example/helper.ts",
      loader: undefined,
      line: 4,
    },
    {
      kind: "type-import",
      specifier: "@vendor/exported-contract",
      loader: undefined,
      line: 5,
    },
    {
      kind: "type-import",
      specifier: "@vendor/contracts",
      loader: undefined,
      line: 6,
    },
    {
      kind: "import-equals",
      specifier: "legacy-runtime",
      loader: undefined,
      line: 7,
    },
    {
      kind: "dynamic-import",
      specifier: "dynamic-runtime",
      loader: "import",
      line: 8,
    },
  ]);
});

Deno.test("source collector distinguishes specifier-level type-only and mixed edges", () => {
  const dependencies = collectSourceDependencies({
    path: "src/specifier-kinds.ts",
    content: [
      'import { type FooA, type Bar as Baz } from "types-only-import";',
      'import { type FooB, value } from "mixed-import";',
      'export { type Foo, type Bar as Baz } from "types-only-export";',
      'export { type Foo, value } from "mixed-export";',
    ].join("\n"),
  });

  assertEquals(dependencySummary(dependencies), [
    {
      kind: "type-import",
      specifier: "types-only-import",
      loader: undefined,
      line: 1,
    },
    {
      kind: "static-import",
      specifier: "mixed-import",
      loader: undefined,
      line: 2,
    },
    {
      kind: "type-import",
      specifier: "types-only-export",
      loader: undefined,
      line: 3,
    },
    {
      kind: "static-export",
      specifier: "mixed-export",
      loader: undefined,
      line: 4,
    },
  ]);
});

Deno.test("source collector resolves loader bindings, immutable constants, and module worker URLs", () => {
  const dependencies = collectSourceDependencies({
    path: "src/loaders.ts",
    content: [
      'import { createRequire as makeRequire, register as registerModule } from "node:module";',
      'import { Worker as ThreadWorker } from "node:worker_threads";',
      'import * as nodeModule from "node:module";',
      'const SHARP_MODULE_SPECIFIER = "sharp";',
      "const IMPORT_TARGET = SHARP_MODULE_SPECIFIER;",
      'const WORKER_TARGET = "./worker.ts";',
      'const WORKER_URL = new URL("./worker-const.ts", import.meta.url);',
      "const runtimeRequire = makeRequire(import.meta.url);",
      "const requireAgain = runtimeRequire;",
      "await import(IMPORT_TARGET);",
      'require.resolve("react");',
      'requireAgain("react-dom");',
      'requireAgain.resolve("scheduler");',
      'import.meta.resolve("npm:resolved@1.0.0");',
      'new Worker(new URL(WORKER_TARGET, import.meta.url), { type: "module" });',
      "new Worker(WORKER_URL);",
      'new ThreadWorker(new URL("./node-worker.ts", import.meta.url));',
      'navigator.serviceWorker.register("./service-worker.ts");',
      'audioWorklet.addModule("./audio-worklet.ts");',
      'CSS.paintWorklet.addModule("./paint-worklet.ts");',
      'importScripts("./one.ts", "./two.ts");',
      'nodeModule.register("./hook.ts");',
      'registerModule("./direct-hook.ts");',
    ].join("\n"),
  }).filter((dependency) => dependency.loader !== undefined);

  assertEquals(
    dependencies.map(({ kind, specifier, loader }) => ({
      kind,
      specifier,
      loader,
    })),
    [
      { kind: "dynamic-import", specifier: "sharp", loader: "import" },
      { kind: "runtime-loader", specifier: "react", loader: "require.resolve" },
      { kind: "runtime-loader", specifier: "react-dom", loader: "require" },
      {
        kind: "runtime-loader",
        specifier: "scheduler",
        loader: "require.resolve",
      },
      {
        kind: "runtime-loader",
        specifier: "npm:resolved@1.0.0",
        loader: "import.meta.resolve",
      },
      { kind: "runtime-loader", specifier: "./worker.ts", loader: "Worker" },
      {
        kind: "runtime-loader",
        specifier: "./worker-const.ts",
        loader: "Worker",
      },
      {
        kind: "runtime-loader",
        specifier: "./node-worker.ts",
        loader: "node:worker_threads.Worker",
      },
      {
        kind: "runtime-loader",
        specifier: "./service-worker.ts",
        loader: "navigator.serviceWorker.register",
      },
      {
        kind: "runtime-loader",
        specifier: "./audio-worklet.ts",
        loader: "AudioWorklet.addModule",
      },
      {
        kind: "runtime-loader",
        specifier: "./paint-worklet.ts",
        loader: "CSS.paintWorklet.addModule",
      },
      {
        kind: "runtime-loader",
        specifier: "./one.ts",
        loader: "importScripts",
      },
      {
        kind: "runtime-loader",
        specifier: "./two.ts",
        loader: "importScripts",
      },
      {
        kind: "runtime-loader",
        specifier: "./hook.ts",
        loader: "module.register",
      },
      {
        kind: "runtime-loader",
        specifier: "./direct-hook.ts",
        loader: "module.register",
      },
    ],
  );
});

Deno.test("source collector resolves TypeScript-wrapped immutable loader constants", () => {
  const dependencies = collectSourceDependencies({
    path: "src/typescript-loader-constants.ts",
    content: [
      'const asserted = "./asserted-worker.ts" as const;',
      "const assertedUrl = new URL(asserted, import.meta.url);",
      "new Worker(assertedUrl);",
      'const satisfied = "./satisfied-worker.ts" satisfies string;',
      "new Worker(new URL(satisfied, import.meta.url));",
    ].join("\n"),
  });

  assertEquals(
    dependencySummary(dependencies).filter(({ loader }) => loader === "Worker"),
    [
      {
        kind: "runtime-loader",
        specifier: "./asserted-worker.ts",
        loader: "Worker",
        line: 3,
      },
      {
        kind: "runtime-loader",
        specifier: "./satisfied-worker.ts",
        loader: "Worker",
        line: 5,
      },
    ],
  );
});

Deno.test("source collector follows CommonJS module API provenance", () => {
  const dependencies = collectSourceDependencies({
    path: "src/commonjs-apis.cjs",
    content: [
      'const { Worker: ThreadWorker } = require("node:worker_threads");',
      'const nodeModule = require("node:module");',
      "const localRequire = nodeModule.createRequire(import.meta.url);",
      'localRequire.resolve("react");',
      'new ThreadWorker(new URL("./thread.cjs", import.meta.url));',
    ].join("\n"),
  });

  assertEquals(
    dependencies.filter((dependency) => dependency.loader).map(
      ({ specifier, loader, line }) => ({ specifier, loader, line }),
    ),
    [
      { specifier: "node:worker_threads", loader: "require", line: 1 },
      { specifier: "node:module", loader: "require", line: 2 },
      { specifier: "react", loader: "require.resolve", line: 4 },
      {
        specifier: "./thread.cjs",
        loader: "node:worker_threads.Worker",
        line: 5,
      },
    ],
  );
});

Deno.test("source collector follows immediate createRequire results", () => {
  const dependencies = collectSourceDependencies({
    path: "src/immediate-create-require.ts",
    content: [
      'import { createRequire } from "node:module";',
      'import * as nodeModule from "node:module";',
      'createRequire(import.meta.url)("npm:immediate@1");',
      'nodeModule.createRequire(import.meta.url)("npm:namespace@1");',
    ].join("\n"),
  });

  assertEquals(
    dependencySummary(dependencies).filter(({ loader }) =>
      loader === "require"
    ),
    [
      {
        kind: "runtime-loader",
        specifier: "npm:immediate@1",
        loader: "require",
        line: 3,
      },
      {
        kind: "runtime-loader",
        specifier: "npm:namespace@1",
        loader: "require",
        line: 4,
      },
    ],
  );
});

Deno.test("source collector follows the default node module namespace", () => {
  const dependencies = collectSourceDependencies({
    path: "src/default-node-module.ts",
    content: [
      'import Module from "node:module";',
      'Module.createRequire(import.meta.url)("npm:default-module@1");',
    ].join("\n"),
  });

  assertEquals(
    dependencySummary(dependencies).filter(({ loader }) =>
      loader === "require"
    ),
    [
      {
        kind: "runtime-loader",
        specifier: "npm:default-module@1",
        loader: "require",
        line: 2,
      },
    ],
  );
});

Deno.test("source collector invalidates mutated URL loader bindings", () => {
  const dependencies = collectSourceDependencies({
    path: "src/mutated-worker-url.ts",
    content: [
      'const workerUrl = new URL("./safe.ts", import.meta.url);',
      'workerUrl.href = "https://evil.test/worker.js";',
      "new Worker(workerUrl);",
    ].join("\n"),
  });

  assertEquals(
    dependencySummary(dependencies).filter(({ loader }) => loader === "Worker"),
    [
      {
        kind: "unresolved-runtime-loader",
        specifier: undefined,
        loader: "Worker",
        line: 3,
      },
    ],
  );
});

Deno.test("source collector invalidates every alias of a mutated URL binding", () => {
  const dependencies = collectSourceDependencies({
    path: "src/mutated-worker-url-alias.ts",
    content: [
      'const workerUrl = new URL("./safe.ts", import.meta.url);',
      "const alias = workerUrl;",
      'alias.href = "https://evil.test/worker.js";',
      "new Worker(workerUrl);",
    ].join("\n"),
  });

  assertEquals(
    dependencySummary(dependencies).filter(({ loader }) => loader === "Worker"),
    [
      {
        kind: "unresolved-runtime-loader",
        specifier: undefined,
        loader: "Worker",
        line: 4,
      },
    ],
  );
});

Deno.test("source collector invalidates URL bindings passed to unknown calls", () => {
  const dependencies = collectSourceDependencies({
    path: "src/escaped-worker-urls.ts",
    content: [
      'const assignedUrl = new URL("./assigned-safe.ts", import.meta.url);',
      'Object.assign(assignedUrl, { href: "https://evil.test/assigned.js" });',
      "new Worker(assignedUrl);",
      'const passedUrl = new URL("./passed-safe.ts", import.meta.url);',
      "mutate(passedUrl);",
      "new Worker(passedUrl);",
    ].join("\n"),
  });

  assertEquals(
    dependencySummary(dependencies).filter(({ loader }) => loader === "Worker"),
    [
      {
        kind: "unresolved-runtime-loader",
        specifier: undefined,
        loader: "Worker",
        line: 3,
      },
      {
        kind: "unresolved-runtime-loader",
        specifier: undefined,
        loader: "Worker",
        line: 6,
      },
    ],
  );
});

Deno.test("source collector follows satisfies and assignment-expression loader aliases", () => {
  const dependencies = collectSourceDependencies({
    path: "src/assignment-expression-loaders.ts",
    content: [
      "const WorkerAlias = Worker satisfies typeof Worker;",
      "new WorkerAlias(workerTarget);",
      "let load;",
      "(load = require)(assignedTarget);",
      "let first, second;",
      "first = second = require;",
      "first(chainedTarget);",
    ].join("\n"),
  });

  assertEquals(
    dependencySummary(dependencies).filter(({ kind }) =>
      kind === "unresolved-runtime-loader"
    ).map(({ loader, line }) => ({ loader, line })),
    [
      { loader: "Worker", line: 2 },
      { loader: "require-alias", line: 4 },
      { loader: "require-alias", line: 7 },
    ],
  );
});

Deno.test("source collector propagates default and literal destructuring aliases", () => {
  const dependencies = collectSourceDependencies({
    path: "src/pattern-loader-aliases.ts",
    content: [
      "function run(load = require, WorkerAlias = Worker) {",
      "  load(defaultTarget);",
      "  new WorkerAlias(defaultWorkerTarget);",
      "}",
      "const { load: objectLoad } = { load: require };",
      "objectLoad(objectTarget);",
      "const [arrayLoad] = [require];",
      "arrayLoad(arrayTarget);",
      "const { Worker: GlobalWorker } = globalThis;",
      "new GlobalWorker(globalTarget);",
    ].join("\n"),
  });

  assertEquals(
    dependencySummary(dependencies).filter(({ kind }) =>
      kind === "unresolved-runtime-loader"
    ).map(({ loader, line }) => ({ loader, line })),
    [
      { loader: "require-alias", line: 2 },
      { loader: "runtime-loader-alias", line: 3 },
      { loader: "require-alias", line: 6 },
      { loader: "require-alias", line: 8 },
      { loader: "Worker", line: 10 },
    ],
  );
});

Deno.test("source collector follows optional worklet module loaders", () => {
  const dependencies = collectSourceDependencies({
    path: "src/optional-worklet-loaders.ts",
    content: [
      'audioWorklet?.addModule("./audio.ts");',
      'CSS.paintWorklet?.addModule("./paint.ts");',
    ].join("\n"),
  });

  assertEquals(
    dependencySummary(dependencies).filter(({ loader }) =>
      loader?.endsWith("addModule")
    ),
    [
      {
        kind: "runtime-loader",
        specifier: "./audio.ts",
        loader: "AudioWorklet.addModule",
        line: 1,
      },
      {
        kind: "runtime-loader",
        specifier: "./paint.ts",
        loader: "CSS.paintWorklet.addModule",
        line: 2,
      },
    ],
  );
});

Deno.test("source collector follows qualified and extracted worklet APIs", () => {
  const dependencies = collectSourceDependencies({
    path: "src/worklet-api-aliases.ts",
    content: [
      "globalThis.CSS.paintWorklet.addModule(globalPaintTarget);",
      "window.CSS.layoutWorklet.addModule(windowLayoutTarget);",
      "const addPaintModule = CSS.paintWorklet.addModule;",
      "addPaintModule(extractedPaintTarget);",
      "const { addModule: addAudioModule } = audioWorklet;",
      "addAudioModule(extractedAudioTarget);",
      "const addContextAudioModule = context.audioWorklet.addModule;",
      "addContextAudioModule(contextAudioTarget);",
    ].join("\n"),
  });

  assertEquals(
    dependencySummary(dependencies).filter(({ kind }) =>
      kind === "unresolved-runtime-loader"
    ).map(({ loader, line }) => ({ loader, line })),
    [
      { loader: "CSS.paintWorklet.addModule", line: 1 },
      { loader: "CSS.layoutWorklet.addModule", line: 2 },
      { loader: "CSS.paintWorklet.addModule", line: 4 },
      { loader: "AudioWorklet.addModule", line: 6 },
      { loader: "AudioWorklet.addModule", line: 8 },
    ],
  );
});

Deno.test("source collector follows CommonJS module require APIs", () => {
  const dependencies = collectSourceDependencies({
    path: "src/commonjs-module-require.cjs",
    content: [
      'module.require("npm:module-require@1");',
      'require.main.require("npm:main-require@1");',
    ].join("\n"),
  });

  assertEquals(
    dependencySummary(dependencies).filter(({ loader }) =>
      loader === "require"
    ),
    [
      {
        kind: "runtime-loader",
        specifier: "npm:module-require@1",
        loader: "require",
        line: 1,
      },
      {
        kind: "runtime-loader",
        specifier: "npm:main-require@1",
        loader: "require",
        line: 2,
      },
    ],
  );
});

Deno.test("source collector resolves visible aliases inside direct eval source", () => {
  const dependencies = collectSourceDependencies({
    path: "src/direct-eval-alias.ts",
    content: [
      "const load = require;",
      'eval("load(target)");',
    ].join("\n"),
  });

  assertEquals(
    dependencySummary(dependencies).filter(({ loader }) => loader === "eval"),
    [
      {
        kind: "unresolved-runtime-loader",
        specifier: undefined,
        loader: "eval",
        line: 2,
      },
    ],
  );
});

Deno.test("source collector fails closed for Reflect loader invocation", () => {
  const dependencies = collectSourceDependencies({
    path: "src/reflect-loaders.ts",
    content: [
      'Reflect.apply(eval, globalThis, ["require(target)"]);',
      'Reflect.apply(Function, null, ["name", "return import(name)"]);',
      "Reflect.apply(require, null, [requireTarget]);",
      "Reflect.construct(Worker, [workerTarget]);",
    ].join("\n"),
  });

  assertEquals(
    dependencySummary(dependencies).filter(({ kind }) =>
      kind === "unresolved-runtime-loader"
    ).map(({ loader, line }) => ({ loader, line })),
    [
      { loader: "eval", line: 1 },
      { loader: "Function", line: 2 },
      { loader: "require", line: 3 },
      { loader: "Worker", line: 4 },
    ],
  );
});

Deno.test("source collector resolves immutable computed loader API names", () => {
  const dependencies = collectSourceDependencies({
    path: "src/computed-loader-properties.ts",
    content: [
      'const evalKey = "eval";',
      'const functionKey = "Function";',
      'const workerKey = "Worker";',
      'const scriptsKey = "importScripts";',
      'const resolveKey = "resolve";',
      'const registerKey = "register";',
      'const serviceWorkerKey = "serviceWorker";',
      'const addModuleKey = "addModule";',
      'const paintWorkletKey = "paintWorklet";',
      'globalThis[evalKey]("require(target)");',
      'globalThis[functionKey]("return import(target)");',
      "new globalThis[workerKey](workerTarget);",
      'globalThis[scriptsKey]("./worker-helper.ts");',
      'import.meta[resolveKey]("./resolved.ts");',
      'module[registerKey]("./registered.ts");',
      'navigator[serviceWorkerKey][registerKey]("./service.ts");',
      'audioWorklet[addModuleKey]("./audio.ts");',
      'CSS[paintWorkletKey][addModuleKey]("./paint.ts");',
    ].join("\n"),
  });

  assertEquals(
    dependencySummary(dependencies).filter(({ loader }) => loader !== undefined)
      .map(({ kind, specifier, loader, line }) => ({
        kind,
        specifier,
        loader,
        line,
      })),
    [
      {
        kind: "unresolved-runtime-loader",
        specifier: undefined,
        loader: "eval",
        line: 10,
      },
      {
        kind: "unresolved-runtime-loader",
        specifier: undefined,
        loader: "Function",
        line: 11,
      },
      {
        kind: "unresolved-runtime-loader",
        specifier: undefined,
        loader: "Worker",
        line: 12,
      },
      {
        kind: "runtime-loader",
        specifier: "./worker-helper.ts",
        loader: "importScripts",
        line: 13,
      },
      {
        kind: "runtime-loader",
        specifier: "./resolved.ts",
        loader: "import.meta.resolve",
        line: 14,
      },
      {
        kind: "runtime-loader",
        specifier: "./registered.ts",
        loader: "module.register",
        line: 15,
      },
      {
        kind: "runtime-loader",
        specifier: "./service.ts",
        loader: "navigator.serviceWorker.register",
        line: 16,
      },
      {
        kind: "runtime-loader",
        specifier: "./audio.ts",
        loader: "AudioWorklet.addModule",
        line: 17,
      },
      {
        kind: "runtime-loader",
        specifier: "./paint.ts",
        loader: "CSS.paintWorklet.addModule",
        line: 18,
      },
    ],
  );
});

Deno.test("source collector follows production-shaped dynamic module API bindings in lexical scopes", () => {
  const dependencies = collectSourceDependencies({
    path: "src/production-shapes.ts",
    content: [
      "async function run() {",
      '  const { Worker: DynamicWorker } = await import("node:worker_threads");',
      '  const workerThreads = await import("node:worker_threads");',
      "  const WorkerAlias = DynamicWorker;",
      '  const [{ createRequire }] = await Promise.all([import("node:module")]);',
      "  const localRequire = createRequire(import.meta.url);",
      '  localRequire.resolve("react");',
      '  new WorkerAlias(new URL("./dynamic-worker.ts", import.meta.url));',
      '  new workerThreads.Worker(new URL("./namespace-worker.ts", import.meta.url));',
      '  new globalThis.Worker(new URL("./browser-worker.ts", import.meta.url));',
      "}",
    ].join("\n"),
  }).filter((dependency) => dependency.loader !== undefined);

  assertEquals(
    dependencies.map(({ specifier, loader }) => ({ specifier, loader })),
    [
      { specifier: "node:worker_threads", loader: "import" },
      { specifier: "node:worker_threads", loader: "import" },
      { specifier: "node:module", loader: "import" },
      { specifier: "react", loader: "require.resolve" },
      {
        specifier: "./dynamic-worker.ts",
        loader: "node:worker_threads.Worker",
      },
      {
        specifier: "./namespace-worker.ts",
        loader: "node:worker_threads.Worker",
      },
      { specifier: "./browser-worker.ts", loader: "Worker" },
    ],
  );
});

Deno.test("source collector follows extracted require.resolve bindings", () => {
  const dependencies = collectSourceDependencies({
    path: "src/require-resolve-alias.ts",
    content: [
      'import { createRequire } from "node:module";',
      "const req = createRequire(import.meta.url);",
      "const resolveAlias = req.resolve;",
      "resolveAlias(dynamicName);",
    ].join("\n"),
  });

  assertEquals(
    dependencySummary(dependencies).filter(({ loader }) =>
      loader !== undefined
    ),
    [
      {
        kind: "unresolved-runtime-loader",
        specifier: undefined,
        loader: "require.resolve",
        line: 4,
      },
    ],
  );
});

Deno.test("source collector follows destructured worker namespace bindings", () => {
  const dependencies = collectSourceDependencies({
    path: "src/worker-destructure.ts",
    content: [
      'import * as workerThreads from "node:worker_threads";',
      "const { Worker: WorkerAlias } = workerThreads;",
      "new WorkerAlias(dynamicUrl);",
    ].join("\n"),
  });

  assertEquals(
    dependencySummary(dependencies).filter(({ loader }) =>
      loader !== undefined
    ),
    [
      {
        kind: "unresolved-runtime-loader",
        specifier: undefined,
        loader: "node:worker_threads.Worker",
        line: 3,
      },
    ],
  );
});

Deno.test("source collector follows destructured module.register namespace bindings", () => {
  const dependencies = collectSourceDependencies({
    path: "src/module-register-destructure.ts",
    content: [
      'import * as nodeModule from "node:module";',
      "const { register: registerAlias } = nodeModule;",
      "registerAlias(dynamicName);",
    ].join("\n"),
  });

  assertEquals(
    dependencySummary(dependencies).filter(({ loader }) =>
      loader !== undefined
    ),
    [
      {
        kind: "unresolved-runtime-loader",
        specifier: undefined,
        loader: "module.register",
        line: 3,
      },
    ],
  );
});

Deno.test("source collector fails closed for mutable and conditional require aliases", () => {
  const dependencies = collectSourceDependencies({
    path: "src/uncertain-require-aliases.ts",
    content: [
      "let mutableLoad = require;",
      'mutableLoad("mutable-target");',
      "const conditionalLoad = flag ? require : other;",
      'conditionalLoad("conditional-target");',
    ].join("\n"),
  });

  assertEquals(
    dependencySummary(dependencies).filter(({ kind }) =>
      kind === "unresolved-runtime-loader"
    ),
    [
      {
        kind: "unresolved-runtime-loader",
        specifier: undefined,
        loader: "require-alias",
        line: 2,
      },
      {
        kind: "unresolved-runtime-loader",
        specifier: undefined,
        loader: "require-alias",
        line: 4,
      },
    ],
  );
});

Deno.test("source collector follows extracted and optional service-worker registration", () => {
  const dependencies = collectSourceDependencies({
    path: "src/service-worker-aliases.ts",
    content: [
      "const registerServiceWorker = navigator.serviceWorker.register;",
      "registerServiceWorker(extractedTarget);",
      "navigator.serviceWorker?.register(optionalTarget);",
      "const serviceWorker = navigator.serviceWorker;",
      "serviceWorker.register(serviceWorkerTarget);",
      "const navigatorAlias = navigator;",
      "navigatorAlias.serviceWorker.register(navigatorTarget);",
    ].join("\n"),
  });

  assertEquals(
    dependencySummary(dependencies).filter(({ loader }) =>
      loader !== undefined
    ),
    [
      {
        kind: "unresolved-runtime-loader",
        specifier: undefined,
        loader: "navigator.serviceWorker.register",
        line: 2,
      },
      {
        kind: "unresolved-runtime-loader",
        specifier: undefined,
        loader: "navigator.serviceWorker.register",
        line: 3,
      },
      {
        kind: "unresolved-runtime-loader",
        specifier: undefined,
        loader: "navigator.serviceWorker.register",
        line: 5,
      },
      {
        kind: "unresolved-runtime-loader",
        specifier: undefined,
        loader: "navigator.serviceWorker.register",
        line: 7,
      },
    ],
  );
});

Deno.test("source collector follows import-meta namespace aliases", () => {
  const dependencies = collectSourceDependencies({
    path: "src/import-meta-alias.ts",
    content: [
      "const meta = import.meta;",
      "meta.resolve(resolveTarget);",
    ].join("\n"),
  });

  assertEquals(
    dependencySummary(dependencies).filter(({ loader }) =>
      loader === "import.meta.resolve"
    ),
    [
      {
        kind: "unresolved-runtime-loader",
        specifier: undefined,
        loader: "import.meta.resolve",
        line: 2,
      },
    ],
  );
});

Deno.test("source collector follows loader aliases through local containers", () => {
  const dependencies = collectSourceDependencies({
    path: "src/container-loader-aliases.ts",
    content: [
      "const box = { load: require };",
      "const { load: objectLoad } = box;",
      "objectLoad(objectTarget);",
      "const loaders = [require];",
      "const [arrayLoad] = loaders;",
      "arrayLoad(arrayTarget);",
      "loaders[0](memberTarget);",
      "const nested = { loaders: { load: require } };",
      "nested.loaders.load(nestedTarget);",
      "const { paintWorklet: { addModule } } = CSS;",
      "addModule(cssTarget);",
    ].join("\n"),
  });

  assertEquals(
    dependencySummary(dependencies).filter(({ kind }) =>
      kind === "unresolved-runtime-loader"
    ).map(({ loader, line }) => ({ loader, line })),
    [
      { loader: "require-alias", line: 3 },
      { loader: "require-alias", line: 6 },
      { loader: "require-alias", line: 7 },
      { loader: "require-alias", line: 9 },
      { loader: "CSS.paintWorklet.addModule", line: 11 },
    ],
  );
});

Deno.test("source collector fails closed when generated functions receive loaders", () => {
  const dependencies = collectSourceDependencies({
    path: "src/generated-loader-injection.ts",
    content: [
      'new Function("load", "return load(target)")(require);',
      "const returnedLoad = (() => require)();",
      "returnedLoad(returnedTarget);",
    ].join("\n"),
  });

  assertEquals(
    dependencySummary(dependencies).filter(({ loader }) =>
      loader === "Function"
    ),
    [
      {
        kind: "unresolved-runtime-loader",
        specifier: undefined,
        loader: "Function",
        line: 1,
      },
    ],
  );
  assertEquals(
    dependencySummary(dependencies).filter(({ loader }) =>
      loader === "require-alias"
    ),
    [
      {
        kind: "unresolved-runtime-loader",
        specifier: undefined,
        loader: "require-alias",
        line: 3,
      },
    ],
  );
});

Deno.test("source collector fails closed across generic loader data-flow boundaries", async (context) => {
  const cases = [
    {
      name: "ordinary parameter injection",
      content: [
        'function use(load: (specifier: string) => unknown) { load("npm:param-injection@1"); }',
        "use(require);",
      ].join("\n"),
      expected: {
        kind: "unresolved-runtime-loader",
        loader: "require-alias",
      },
    },
    {
      name: "named function return",
      content: [
        "function loader() { return require; }",
        "const load = loader();",
        'load("npm:named-return@1");',
      ].join("\n"),
      expected: {
        kind: "unresolved-runtime-loader",
        loader: "require-alias",
      },
    },
    {
      name: "nested member assignment",
      content: [
        "const box = { inner: {} as Record<string, unknown> };",
        "box.inner.load = require;",
        'box.inner.load("npm:nested-member@1");',
      ].join("\n"),
      expected: {
        kind: "unresolved-runtime-loader",
        loader: "require-alias",
      },
    },
    {
      name: "class static field alias",
      content: [
        "class Loaders { static load = require; }",
        'Loaders.load("npm:class-static@1");',
      ].join("\n"),
      expected: {
        kind: "unresolved-runtime-loader",
        loader: "require-alias",
      },
    },
    {
      name: "computed service worker method",
      content: [
        'const target = "npm:computed-service-worker@1";',
        'navigator.serviceWorker["reg" + "ister"](target);',
      ].join("\n"),
      expected: {
        kind: "runtime-loader",
        loader: "navigator.serviceWorker.register",
        specifier: "npm:computed-service-worker@1",
      },
    },
    {
      name: "createRequire call",
      content: [
        'import { createRequire } from "node:module";',
        "const load = createRequire.call(null, import.meta.url);",
        'load("npm:create-require-call@1");',
      ].join("\n"),
      expected: {
        kind: "runtime-loader",
        loader: "require",
        specifier: "npm:create-require-call@1",
      },
    },
    {
      name: "parameter injection through apply",
      content: [
        'function use(load: (specifier: string) => unknown) { load("npm:param-apply@1"); }',
        "use.apply(null, [require]);",
      ].join("\n"),
      expected: {
        kind: "unresolved-runtime-loader",
        loader: "require-alias",
      },
    },
    {
      name: "createRequire apply",
      content: [
        'import { createRequire } from "node:module";',
        "const load = createRequire.apply(null, [import.meta.url]);",
        'load("npm:create-require-apply@1");',
      ].join("\n"),
      expected: {
        kind: "runtime-loader",
        loader: "require",
        specifier: "npm:create-require-apply@1",
      },
    },
    {
      name: "computed constant nested member",
      content: [
        'const INNER = "inner";',
        'const LOAD = "load";',
        "const box = { inner: {} as Record<string, unknown> };",
        "box[INNER][LOAD] = require;",
        'box[INNER][LOAD]("npm:computed-member@1");',
      ].join("\n"),
      expected: {
        kind: "unresolved-runtime-loader",
        loader: "require-alias",
      },
    },
    {
      name: "concise named function return",
      content: [
        "const factory = () => require;",
        "const load = factory();",
        'load("npm:concise-return@1");',
      ].join("\n"),
      expected: {
        kind: "unresolved-runtime-loader",
        loader: "require-alias",
      },
    },
    {
      name: "nested conditional return inside iife",
      content: [
        "const load = (() => {",
        "  if (enabled) { return require; }",
        "  return undefined;",
        "})();",
        'load("npm:nested-iife-return@1");',
      ].join("\n"),
      expected: {
        kind: "unresolved-runtime-loader",
        loader: "require-alias",
      },
    },
    {
      name: "reflect apply parameter injection",
      content: [
        "function use(load: unknown) { return load; }",
        "Reflect.apply(use, null, [require]);",
      ].join("\n"),
      expected: {
        kind: "unresolved-runtime-loader",
        loader: "require-alias",
      },
    },
    {
      name: "reflect construct parameter injection",
      content: [
        "class Use { constructor(load: unknown) { void load; } }",
        "Reflect.construct(Use, [require]);",
      ].join("\n"),
      expected: {
        kind: "unresolved-runtime-loader",
        loader: "require-alias",
      },
    },
    {
      name: "constant template computed service worker method",
      content: [
        'const METHOD_SUFFIX = "ister";',
        'const target = "npm:template-service-worker@1";',
        "navigator.serviceWorker[\`reg\${METHOD_SUFFIX}\`](target);",
      ].join("\n"),
      expected: {
        kind: "runtime-loader",
        loader: "navigator.serviceWorker.register",
        specifier: "npm:template-service-worker@1",
      },
    },
    {
      name: "exported loader",
      content: "export const load = require;",
      expected: {
        kind: "unresolved-runtime-loader",
        loader: "require-alias",
      },
    },
    {
      name: "yielded loader",
      content: "function* loaders() { yield require; }",
      expected: {
        kind: "unresolved-runtime-loader",
        loader: "require-alias",
      },
    },
    {
      name: "aliased loader container",
      content: [
        "const loaders = { load: require };",
        "const alias = loaders;",
        'alias.load("npm:aliased-container@1");',
      ].join("\n"),
      expected: {
        kind: "unresolved-runtime-loader",
        loader: "require-alias",
      },
    },
    {
      name: "exported aliased loader container",
      content: [
        "const loaders = { load: require };",
        "export { loaders };",
      ].join("\n"),
      expected: {
        kind: "unresolved-runtime-loader",
        loader: "require-alias",
      },
    },
    {
      name: "returned aliased loader container",
      content: [
        "function expose() {",
        "  const loaders = { load: require };",
        "  return loaders;",
        "}",
      ].join("\n"),
      expected: {
        kind: "unresolved-runtime-loader",
        loader: "require-alias",
      },
    },
    {
      name: "returned global loader namespace",
      content: "function expose() { return globalThis; }",
      expected: {
        kind: "unresolved-runtime-loader",
        loader: "runtime-loader-alias",
      },
    },
    {
      name: "apply with aliased argument container",
      content: [
        "function use(load: unknown) { return load; }",
        "const values = [require];",
        "const alias = values;",
        "use.apply(null, alias);",
      ].join("\n"),
      expected: {
        kind: "unresolved-runtime-loader",
        loader: "require-alias",
      },
    },
    {
      name: "instance field loader",
      content: "class Loaders { load = require; }",
      expected: {
        kind: "unresolved-runtime-loader",
        loader: "require-alias",
      },
    },
    {
      name: "constructor parameter injection",
      content: [
        "class Use { constructor(load: unknown) { void load; } }",
        "new Use(require);",
      ].join("\n"),
      expected: {
        kind: "unresolved-runtime-loader",
        loader: "require-alias",
      },
    },
    {
      name: "call parameter injection",
      content: [
        "function use(load: unknown) { return load; }",
        "use.call(null, require);",
      ].join("\n"),
      expected: {
        kind: "unresolved-runtime-loader",
        loader: "require-alias",
      },
    },
    {
      name: "reflect apply createRequire",
      content: [
        'import { createRequire } from "node:module";',
        "const load = Reflect.apply(createRequire, null, [import.meta.url]);",
        'load("npm:reflect-create-require@1");',
      ].join("\n"),
      expected: {
        kind: "runtime-loader",
        loader: "require",
        specifier: "npm:reflect-create-require@1",
      },
    },
    {
      name: "reflect construct worker",
      content: 'Reflect.construct(Worker, ["npm:reflect-construct-worker@1"]);',
      expected: {
        kind: "runtime-loader",
        loader: "Worker",
        specifier: "npm:reflect-construct-worker@1",
      },
    },
  ] as const;

  for (const testCase of cases) {
    await context.step(testCase.name, () => {
      const dependencies = dependencySummary(collectSourceDependencies({
        path: `src/${testCase.name.replaceAll(" ", "-")}.ts`,
        content: testCase.content,
      })).filter(({ loader }) => loader !== undefined);
      assertEquals(
        dependencies.some((dependency) =>
          dependency.kind === testCase.expected.kind &&
          dependency.loader === testCase.expected.loader &&
          (!("specifier" in testCase.expected) ||
            dependency.specifier === testCase.expected.specifier)
        ),
        true,
        JSON.stringify(dependencies, null, 2),
      );
    });
  }
});

Deno.test("source collector retains loader facts through local container construction", async (context) => {
  const cases = [
    {
      name: "reverse alias member store",
      content: [
        "const original: Record<string, unknown> = {};",
        "const alias = original;",
        "alias.load = require;",
        "original.load(target);",
      ].join("\n"),
      expected: [{ loader: "require-alias", line: 4 }],
    },
    {
      name: "escaped original after alias store",
      content: [
        "const original: Record<string, unknown> = {};",
        "const alias = original;",
        "alias.load = require;",
        "use(original);",
      ].join("\n"),
      expected: [{ loader: "require-alias", line: 4 }],
    },
    {
      name: "object spread",
      content: [
        "const original = { load: require };",
        "const copy = { ...original };",
      ].join("\n"),
      expected: [],
    },
    {
      name: "array spread",
      content: [
        "const original = [require];",
        "const copy = [...original];",
      ].join("\n"),
      expected: [],
    },
    {
      name: "constant computed object key",
      content: [
        'const LOAD = "load";',
        "const original = { [LOAD]: require };",
        "original.load(target);",
      ].join("\n"),
      expected: [{ loader: "require-alias", line: 3 }],
    },
    {
      name: "unknown computed namespace call",
      content: [
        'import * as moduleApi from "node:module";',
        "moduleApi[method](target);",
      ].join("\n"),
      expected: [{ loader: "runtime-loader-alias", line: 2 }],
    },
    {
      name: "unknown computed namespace read",
      content: [
        'import * as moduleApi from "node:module";',
        "const maybeLoad = moduleApi[method];",
      ].join("\n"),
      expected: [{ loader: "runtime-loader-alias", line: 2 }],
    },
  ] as const;

  for (const testCase of cases) {
    await context.step(testCase.name, () => {
      const unresolved = dependencySummary(collectSourceDependencies({
        path: `src/${testCase.name.replaceAll(" ", "-")}.ts`,
        content: testCase.content,
      })).filter(({ kind }) => kind === "unresolved-runtime-loader");
      assertEquals(
        unresolved,
        testCase.expected.map(({ loader, line }) => ({
          kind: "unresolved-runtime-loader",
          specifier: undefined,
          loader,
          line,
        })),
      );
    });
  }
});

Deno.test("source collector gives normalized loader-returning IIFEs one stable issue", async (context) => {
  const cases = [
    ["direct", "(() => require)()(target);"],
    ["call", "(() => require).call(null)(target);"],
    ["apply", "(() => require).apply(null, [])(target);"],
    ["Reflect.apply", "Reflect.apply(() => require, null, [])(target);"],
    [
      "Reflect.construct",
      "Reflect.construct(function () { return require; }, [])(target);",
    ],
  ] as const;

  for (const [name, content] of cases) {
    await context.step(name, () => {
      const unresolved = collectSourceDependencies({
        path: `src/normalized-iife-${name.replaceAll(".", "-")}.ts`,
        content,
      }).filter(({ kind }) => kind === "unresolved-runtime-loader").map(
        ({ kind, loader, line, column }) => ({ kind, loader, line, column }),
      );
      assertEquals(unresolved, [{
        kind: "unresolved-runtime-loader",
        loader: "require-alias",
        line: 1,
        column: 1,
      }]);
    });
  }
});

Deno.test("source collector recognizes only unshadowed browser-global eval", () => {
  const dependencies = collectSourceDependencies({
    path: "src/browser-global-eval.ts",
    content: [
      'window.eval("import(target)");',
      "function shadowed(window: { eval(source: string): void }) {",
      '  window.eval("import(ignored)");',
      "}",
    ].join("\n"),
  });

  assertEquals(
    dependencySummary(dependencies).filter(({ loader }) =>
      loader !== undefined
    ),
    [
      {
        kind: "unresolved-runtime-loader",
        specifier: undefined,
        loader: "eval",
        line: 1,
      },
    ],
  );
});

Deno.test("source collector resolves const-indirected module API provenance", () => {
  const dependencies = collectSourceDependencies({
    path: "src/const-module-provenance.ts",
    content: [
      'const WORKER_MODULE = "node:worker_threads";',
      'const NODE_MODULE = "node:module";',
      "const { Worker: RequiredWorker } = require(WORKER_MODULE);",
      "const { Worker: ImportedWorker } = await import(WORKER_MODULE);",
      "const { createRequire } = require(NODE_MODULE);",
      "const localRequire = createRequire(import.meta.url);",
      "new RequiredWorker(requiredTarget);",
      "new ImportedWorker(importedTarget);",
      "localRequire.resolve(requiredModuleTarget);",
    ].join("\n"),
  });

  assertEquals(
    dependencySummary(dependencies).filter(({ kind }) =>
      kind === "unresolved-runtime-loader"
    ),
    [
      {
        kind: "unresolved-runtime-loader",
        specifier: undefined,
        loader: "node:worker_threads.Worker",
        line: 7,
      },
      {
        kind: "unresolved-runtime-loader",
        specifier: undefined,
        loader: "node:worker_threads.Worker",
        line: 8,
      },
      {
        kind: "unresolved-runtime-loader",
        specifier: undefined,
        loader: "require.resolve",
        line: 9,
      },
    ],
  );
});

Deno.test("source collector follows indirect eval calls", () => {
  const dependencies = collectSourceDependencies({
    path: "src/indirect-eval.ts",
    content: 'eval.call(globalThis, `import("npm:indirect@1")`);\n',
  });

  assertEquals(
    dependencySummary(dependencies).filter(({ loader }) =>
      loader !== undefined
    ),
    [
      {
        kind: "unresolved-runtime-loader",
        specifier: undefined,
        loader: "eval",
        line: 1,
      },
    ],
  );
});

Deno.test("source collector follows indirect Function constructor calls", () => {
  const dependencies = collectSourceDependencies({
    path: "src/indirect-function.ts",
    content: [
      'Function.call(null, "name", "return import(name)");',
      'Function.apply(null, ["name", "return import(name)"]);',
      'window.Function.call(null, "name", "return import(name)");',
      "function shadowed(Function: { call(...args: unknown[]): void }) {",
      '  Function.call(null, "return import(ignored)");',
      "}",
    ].join("\n"),
  });

  assertEquals(
    dependencySummary(dependencies).filter(({ kind }) =>
      kind === "unresolved-runtime-loader"
    ).map(({ loader, line }) => ({ loader, line })),
    [
      { loader: "Function", line: 1 },
      { loader: "Function", line: 2 },
      { loader: "Function", line: 3 },
    ],
  );
});

Deno.test("source collector fails closed for indirect loader API calls", () => {
  const dependencies = collectSourceDependencies({
    path: "src/indirect-loader-apis.ts",
    content: [
      "import.meta.resolve.call(import.meta, resolveTarget);",
      "module.register.call(module, registerTarget);",
      "navigator.serviceWorker.register.call(navigator.serviceWorker, serviceTarget);",
      "window.importScripts.call(window, scriptsTarget);",
      "audioWorklet.addModule.call(audioWorklet, audioTarget);",
      "CSS.paintWorklet.addModule.call(CSS.paintWorklet, paintTarget);",
    ].join("\n"),
  });

  assertEquals(
    dependencySummary(dependencies).filter(({ kind }) =>
      kind === "unresolved-runtime-loader"
    ).map(({ loader, line }) => ({ loader, line })),
    [
      { loader: "import.meta.resolve", line: 1 },
      { loader: "module.register", line: 2 },
      { loader: "navigator.serviceWorker.register", line: 3 },
      { loader: "importScripts", line: 4 },
      { loader: "AudioWorklet.addModule", line: 5 },
      { loader: "CSS.paintWorklet.addModule", line: 6 },
    ],
  );
});

Deno.test("source collector parses computed loader methods inside generated code", () => {
  const dependencies = collectSourceDependencies({
    path: "src/computed-generated-loaders.ts",
    content: [
      'eval(`module["register"]("npm:generated-register@1")`);',
      'Function(`navigator.serviceWorker["register"]("npm:generated-worker@1")`);',
    ].join("\n"),
  });

  assertEquals(
    dependencySummary(dependencies).filter(({ kind }) =>
      kind === "unresolved-runtime-loader"
    ).map(({ loader, line }) => ({ loader, line })),
    [
      { loader: "eval", line: 1 },
      { loader: "Function", line: 2 },
    ],
  );
});

Deno.test("source collector analyzes executable source semantically and anchors one outer finding", () => {
  const dependencies = dependencySummary(collectSourceDependencies({
    path: "src/semantic-executable-source.ts",
    content: [
      'eval(`import("npm:eval-source@1")`);',
      'eval("const {");',
      'new Function("return require(target)");',
      'eval("const require = 1; require;");',
      'eval("function Worker() {}; Worker;");',
      'eval("obj.register(value)");',
      'new Function("require", "return require(target)");',
      'new Function("obj", "return obj.register(value)");',
    ].join("\n"),
  })).filter(({ kind }) => kind === "unresolved-runtime-loader");

  assertEquals(dependencies, [
    {
      kind: "unresolved-runtime-loader",
      specifier: undefined,
      loader: "eval",
      line: 1,
    },
    {
      kind: "unresolved-runtime-loader",
      specifier: undefined,
      loader: "eval",
      line: 2,
    },
    {
      kind: "unresolved-runtime-loader",
      specifier: undefined,
      loader: "Function",
      line: 3,
    },
  ]);
});

Deno.test("source collector carries loader containers into direct eval", () => {
  const dependencies = dependencySummary(collectSourceDependencies({
    path: "src/direct-eval-containers.ts",
    content: [
      "const box = { load: require };",
      'eval("box.load(target)");',
      "const loaders = [require];",
      'eval("loaders[0](target)");',
      "const mixed = { load: require, safe(value: unknown) { return value; } };",
      'eval("mixed.safe(target)");',
      'eval("mixed.load(target)");',
      'eval("sink(mixed)");',
      "const nestedBox = { nested: { load: require, safe(value: unknown) { return value; } } };",
      'eval("nestedBox.nested.safe(target)");',
      'eval("sink(nestedBox.nested)");',
      'eval("sink(nestedBox)");',
      "const benign = { load(value: unknown) { return value; } };",
      'eval("benign.load(target)");',
      `eval('eval("box.load(target)")');`,
      `eval('eval("sink(nestedBox.nested)")');`,
      `eval('eval("sink(nestedBox)")');`,
      `eval('eval("mixed.safe(target)")');`,
      'eval("const alias = box; alias.load(target)");',
      'eval("const { load } = box; load(target)");',
      `eval('const nested = nestedBox.nested; eval("nested.load(target)")');`,
      'eval("const safe = mixed.safe; safe(target)");',
      'eval("const { nested: { load: nestedLoad } } = nestedBox; nestedLoad(target)");',
      `eval('const nestedAlias = nestedBox.nested; eval("sink(nestedAlias)")');`,
      'eval("const { safe } = mixed; safe(target)");',
    ].join("\n"),
  })).filter(({ kind }) => kind === "unresolved-runtime-loader");

  assertEquals(dependencies.map(({ loader, line }) => ({ loader, line })), [
    { loader: "eval", line: 2 },
    { loader: "eval", line: 4 },
    { loader: "eval", line: 7 },
    { loader: "eval", line: 8 },
    { loader: "eval", line: 11 },
    { loader: "eval", line: 12 },
    { loader: "eval", line: 15 },
    { loader: "eval", line: 16 },
    { loader: "eval", line: 17 },
    { loader: "eval", line: 19 },
    { loader: "eval", line: 20 },
    { loader: "eval", line: 21 },
    { loader: "eval", line: 23 },
    { loader: "eval", line: 24 },
  ]);
});

Deno.test("source collector fails closed when inherited member projections are truncated", () => {
  const loaderMembers = Array.from(
    { length: 300 },
    (_, index) => `load${index}: require`,
  ).join(", ");
  let diagnostics:
    | {
      inheritedMemberProjectionTruncations?: number;
      inheritedMemberProjectionVisits?: number;
    }
    | undefined;
  const dependencies = dependencySummary(collectSourceDependencies(
    {
      path: "src/direct-eval-projection-budget.ts",
      content: [
        `const box = { safe(value: unknown) { return value; }, ${loaderMembers} };`,
        'eval("box.safe(target)");',
      ].join("\n"),
    },
    {
      onAnalysisDiagnostics: (value) => {
        diagnostics = value as unknown as typeof diagnostics;
      },
    },
  )).filter(({ kind }) => kind === "unresolved-runtime-loader");

  assertEquals(dependencies.map(({ loader, line }) => ({ loader, line })), [
    { loader: "eval", line: 2 },
  ]);
  assertEquals(diagnostics?.inheritedMemberProjectionTruncations, 1);
  assertEquals(
    typeof diagnostics?.inheritedMemberProjectionVisits === "number" &&
      diagnostics.inheritedMemberProjectionVisits > 0,
    true,
  );
});

Deno.test("source collector fails closed at inherited member projection depth and visit budgets", () => {
  let deeplyNested = "require";
  for (let depth = 0; depth < 40; depth++) {
    deeplyNested = `{ next: ${deeplyNested} }`;
  }
  let depthDiagnostics:
    | { inheritedMemberProjectionTruncations?: number }
    | undefined;
  const depthDependencies = dependencySummary(collectSourceDependencies(
    {
      path: "src/direct-eval-projection-depth.ts",
      content: [
        `const box = { safe(value: unknown) { return value; }, nested: ${deeplyNested} };`,
        'eval("box.safe(target)");',
      ].join("\n"),
    },
    {
      onAnalysisDiagnostics: (value) => {
        depthDiagnostics = value as unknown as typeof depthDiagnostics;
      },
    },
  )).filter(({ kind }) => kind === "unresolved-runtime-loader");

  assertEquals(
    depthDependencies.map(({ loader, line }) => ({ loader, line })),
    [{ loader: "eval", line: 2 }],
  );
  assertEquals(depthDiagnostics?.inheritedMemberProjectionTruncations, 1);

  const expectedVisitBudget = 4_096;
  const benignMembers = Array.from(
    { length: expectedVisitBudget + 4 },
    (_, index) => `value${index}: ${index}`,
  ).join(", ");
  let visitDiagnostics:
    | {
      inheritedMemberProjectionTruncations?: number;
      inheritedMemberProjectionVisits?: number;
    }
    | undefined;
  const visitDependencies = dependencySummary(collectSourceDependencies(
    {
      path: "src/direct-eval-projection-visits.ts",
      content: [
        `const box = { safe(value: unknown) { return value; }, ${benignMembers}, load: require };`,
        'eval("box.safe(target)");',
      ].join("\n"),
    },
    {
      onAnalysisDiagnostics: (value) => {
        visitDiagnostics = value as unknown as typeof visitDiagnostics;
      },
    },
  )).filter(({ kind }) => kind === "unresolved-runtime-loader");

  assertEquals(
    visitDependencies.map(({ loader, line }) => ({ loader, line })),
    [{ loader: "eval", line: 2 }],
  );
  assertEquals(visitDiagnostics?.inheritedMemberProjectionTruncations, 1);
  assertEquals(
    visitDiagnostics?.inheritedMemberProjectionVisits,
    expectedVisitBudget,
  );
});

Deno.test("source collector preserves direct eval syntactic context", () => {
  const dependencies = dependencySummary(collectSourceDependencies({
    path: "src/direct-eval-context.ts",
    content: [
      "function Constructor() {",
      '  "use strict"; eval("new.target");',
      "}",
      "class Derived extends Base {",
      '  method() { eval("super.value"); }',
      "}",
      "class FieldDerived extends Base {",
      '  value = eval("super.value");',
      '  static target = eval("new.target");',
      '  static { eval("super.value"); }',
      "}",
      'eval("return 1");',
      'eval("new.target");',
      'eval("super.value");',
      'class InvalidFieldKey extends Base { [eval("super.value")] = 1; }',
    ].join("\n"),
  })).filter(({ kind }) => kind === "unresolved-runtime-loader");

  assertEquals(dependencies.map(({ loader, line }) => ({ loader, line })), [
    { loader: "eval", line: 12 },
    { loader: "eval", line: 13 },
    { loader: "eval", line: 14 },
    { loader: "eval", line: 15 },
  ]);
});

Deno.test("source collector bounds recursive executable-source work deterministically", () => {
  let recursiveDiagnostics:
    | {
      executableSourceAnalyses?: number;
      executableSourceCacheHits?: number;
      executableSourceCycleCuts?: number;
      executableSourceBudgetExhaustions?: number;
      executableSourceDepthExhaustions?: number;
    }
    | undefined;
  const recursive = dependencySummary(collectSourceDependencies(
    {
      path: "src/recursive-executable-source.ts",
      content: `eval('const s = "eval(s); eval(s)"; eval(s)');`,
    },
    {
      onAnalysisDiagnostics: (value) => {
        recursiveDiagnostics = value as unknown as typeof recursiveDiagnostics;
      },
    },
  )).filter(({ kind }) => kind === "unresolved-runtime-loader");

  assertEquals(recursive.map(({ loader, line }) => ({ loader, line })), [
    { loader: "eval", line: 1 },
  ]);
  assertEquals(recursiveDiagnostics?.executableSourceAnalyses, 2);
  assertEquals(recursiveDiagnostics?.executableSourceCycleCuts, 2);
  assertEquals(recursiveDiagnostics?.executableSourceBudgetExhaustions, 0);

  let boundedDiagnostics: typeof recursiveDiagnostics;
  const boundedOptions = {
    maximumExecutableSourceAnalyses: 2,
    onAnalysisDiagnostics: (value) => {
      boundedDiagnostics = value as unknown as typeof boundedDiagnostics;
    },
  } as SourceDependencyCollectionOptions & {
    maximumExecutableSourceAnalyses: number;
  };
  const bounded = dependencySummary(collectSourceDependencies(
    {
      path: "src/bounded-executable-source.ts",
      content: [
        'eval("const first = 1");',
        'eval("const second = 2");',
        'eval("const third = 3");',
      ].join("\n"),
    },
    boundedOptions,
  )).filter(({ kind }) => kind === "unresolved-runtime-loader");

  assertEquals(bounded.map(({ loader, line }) => ({ loader, line })), [
    { loader: "eval", line: 3 },
  ]);
  assertEquals(boundedDiagnostics?.executableSourceAnalyses, 2);
  assertEquals(boundedDiagnostics?.executableSourceBudgetExhaustions, 1);

  let memoizedDiagnostics: typeof recursiveDiagnostics;
  const memoized = dependencySummary(collectSourceDependencies(
    {
      path: "src/memoized-executable-source.ts",
      content: [
        'eval("const stable = 1");',
        'eval("const stable = 1");',
      ].join("\n"),
    },
    {
      onAnalysisDiagnostics: (value) => {
        memoizedDiagnostics = value;
      },
    },
  )).filter(({ kind }) => kind === "unresolved-runtime-loader");

  assertEquals(memoized, []);
  assertEquals(memoizedDiagnostics?.executableSourceAnalyses, 1);
  assertEquals(memoizedDiagnostics?.executableSourceCacheHits, 1);

  let nestedSource = "const leaf = 1;";
  for (let depth = 0; depth < 20; depth++) {
    nestedSource = `eval(${JSON.stringify(nestedSource)});`;
  }
  let depthDiagnostics: typeof recursiveDiagnostics;
  const depthBounded = dependencySummary(collectSourceDependencies(
    {
      path: "src/depth-bounded-executable-source.ts",
      content: `eval(${JSON.stringify(nestedSource)});`,
    },
    {
      onAnalysisDiagnostics: (value) => {
        depthDiagnostics = value;
      },
    },
  )).filter(({ kind }) => kind === "unresolved-runtime-loader");

  assertEquals(depthBounded.map(({ loader, line }) => ({ loader, line })), [
    { loader: "eval", line: 1 },
  ]);
  assertEquals(depthDiagnostics?.executableSourceAnalyses, 16);
  assertEquals(depthDiagnostics?.executableSourceDepthExhaustions, 1);
});

Deno.test("source collector derives executable function constructors only from fresh function provenance", () => {
  const dependencies = dependencySummary(collectSourceDependencies({
    path: "src/executable-function-constructors.ts",
    content: [
      "const DerivedAsyncFunction = (async function () {}).constructor;",
      'DerivedAsyncFunction("return import(target)");',
      'new DerivedAsyncFunction("return import(target)");',
      'DerivedAsyncFunction.call(null, "return import(target)");',
      'DerivedAsyncFunction.apply(null, ["return import(target)"]);',
      'Reflect.apply(DerivedAsyncFunction, null, ["return import(target)"]);',
      'Reflect.construct(DerivedAsyncFunction, ["return import(target)"]);',
      "const GeneratorFunction = Object.getPrototypeOf(function* () {}).constructor;",
      'new GeneratorFunction("yield import(target)");',
      "const AsyncGeneratorFunction = Object.getPrototypeOf(async function* () {}).constructor;",
      'Reflect.construct(AsyncGeneratorFunction, ["yield import(target)"]);',
      "const ComputedAsyncFunction = (async () => {})['constructor'];",
      "ComputedAsyncFunction(source);",
      'ComputedAsyncFunction("return 1");',
      'ComputedAsyncFunction("require", "return require(target)");',
      'AsyncFunction("return import(ignored)");',
      "function shadow(Object: unknown) {",
      "  const Constructor = Object.getPrototypeOf(async function () {}).constructor;",
      '  Constructor("return import(ignored)");',
      "}",
      "const freshAsync = async () => {};",
      'freshAsync.constructor("return import(target)");',
      'Reflect.getPrototypeOf(async function () {}).constructor("return import(target)");',
      "function shadowReflect(Reflect: unknown) {",
      "  const Constructor = Reflect.getPrototypeOf(async function () {}).constructor;",
      '  Constructor("return import(ignored)");',
      "}",
      "const mutatedFresh = async () => {};",
      'mutatedFresh.constructor("return import(target)");',
      "mutatedFresh.constructor = function () {};",
      'mutatedFresh.constructor("return import(ignored)");',
      "async function declaredAsync() {}",
      'declaredAsync.constructor("return import(target)");',
      "function* declaredGenerator() {}",
      'declaredGenerator.constructor("yield import(target)");',
      "async function* declaredAsyncGenerator() {}",
      'declaredAsyncGenerator.constructor("yield import(target)");',
      "function declaredOrdinary() {}",
      'declaredOrdinary.constructor("return import(target)");',
      "const conditionallyMutated = async () => {};",
      "if (condition) conditionallyMutated.constructor = function () {};",
      'conditionallyMutated.constructor("return import(target)");',
      "async function reassignedDeclaration() {}",
      "reassignedDeclaration = { constructor() {} } as any;",
      'reassignedDeclaration.constructor("return import(ignored)");',
      "async function conditionallyReassignedDeclaration() {}",
      "if (condition) conditionallyReassignedDeclaration = { constructor() {} } as any;",
      'conditionallyReassignedDeclaration.constructor("return import(target)");',
      "async function laterReassignedDeclaration() {}",
      'laterReassignedDeclaration.constructor("return import(target)");',
      "laterReassignedDeclaration = { constructor() {} } as any;",
      "async function logicalMemberNoop() {}",
      "logicalMemberNoop.constructor ||= function () {};",
      'logicalMemberNoop.constructor("return import(target)");',
      "async function deletedInheritedMember() {}",
      "delete deletedInheritedMember.constructor;",
      'deletedInheritedMember.constructor("return import(target)");',
      "async function logicalBindingNoop() {}",
      "logicalBindingNoop ||= ({ constructor() {} } as any);",
      'logicalBindingNoop.constructor("return import(target)");',
    ].join("\n"),
  })).filter(({ kind }) => kind === "unresolved-runtime-loader");

  assertEquals(
    dependencies.map(({ loader, line, specifier }) => ({
      loader,
      line,
      specifier,
    })),
    [
      { loader: "AsyncFunction", line: 2, specifier: undefined },
      { loader: "AsyncFunction", line: 3, specifier: undefined },
      { loader: "AsyncFunction", line: 4, specifier: undefined },
      { loader: "AsyncFunction", line: 5, specifier: undefined },
      { loader: "AsyncFunction", line: 6, specifier: undefined },
      { loader: "AsyncFunction", line: 7, specifier: undefined },
      { loader: "GeneratorFunction", line: 9, specifier: undefined },
      { loader: "AsyncGeneratorFunction", line: 11, specifier: undefined },
      { loader: "AsyncFunction", line: 13, specifier: undefined },
      { loader: "AsyncFunction", line: 22, specifier: undefined },
      { loader: "AsyncFunction", line: 23, specifier: undefined },
      { loader: "AsyncFunction", line: 29, specifier: undefined },
      { loader: "AsyncFunction", line: 33, specifier: undefined },
      { loader: "GeneratorFunction", line: 35, specifier: undefined },
      { loader: "AsyncGeneratorFunction", line: 37, specifier: undefined },
      { loader: "Function", line: 39, specifier: undefined },
      { loader: "AsyncFunction", line: 42, specifier: undefined },
      { loader: "AsyncFunction", line: 48, specifier: undefined },
      { loader: "AsyncFunction", line: 50, specifier: undefined },
      { loader: "AsyncFunction", line: 54, specifier: undefined },
      { loader: "AsyncFunction", line: 57, specifier: undefined },
      { loader: "AsyncFunction", line: 60, specifier: undefined },
    ],
  );
});

Deno.test("source collector follows node vm executable-source APIs through provenance", () => {
  const dependencies = dependencySummary(collectSourceDependencies({
    path: "src/node-vm-source.ts",
    content: [
      'import vm from "node:vm";',
      'import { runInThisContext as run } from "node:vm";',
      'import vmEquals = require("node:vm");',
      'const required = require("node:vm");',
      'const awaited = await import("node:vm");',
      'run("import(unknownTarget)");',
      'vm["runInContext"].call(null, "require(target)", context);',
      'vmEquals.runInNewContext.apply(null, ["eval(source)", context]);',
      'Reflect.apply(required.runInThisContext, null, ["new Worker(target)"]);',
      'vm.compileFunction("return import(target)", ["target"]);',
      "vm.compileFunction(source, parameters);",
      'new required.Script("import(target)");',
      "Reflect.construct(awaited.SourceTextModule, [\"import target from 'npm:module-source@1'\"]);",
      'required.Script("import(ignored)");',
      "required.SourceTextModule.call(null, \"import ignored from 'npm:ignored@1'\");",
      'vm.compileFunction("return require(target)", ["require"]);',
      "function shadow(vm: { runInThisContext(source: string): void }) {",
      '  vm.runInThisContext("import(ignored)");',
      "}",
      'const awaitedDefault = (await import("node:vm")).default;',
      'awaitedDefault.runInThisContext("import(defaultTarget)");',
      'vm.createScript("import(createScriptTarget)");',
      'vm.runInNewContext("load(target)", { load: require });',
      'vm.compileFunction("return load(target)", [], { contextExtensions: [{ load: require }] });',
      'vm.runInNewContext("value + 1", { value: 1 });',
      'new vm.SourceTextModule("export {}", { importModuleDynamically: require });',
      'new vm.Script("1", { importModuleDynamically: require });',
      'vm.runInThisContext("1", { importModuleDynamically: require });',
      'import { createScript } from "node:vm";',
      'createScript("require(namedTarget)");',
    ].join("\n"),
  })).filter(({ kind }) => kind === "unresolved-runtime-loader");

  assertEquals(
    dependencies.map(({ loader, line, specifier }) => ({
      loader,
      line,
      specifier,
    })),
    [
      { loader: "node:vm.runInThisContext", line: 6, specifier: undefined },
      { loader: "node:vm.runInContext", line: 7, specifier: undefined },
      { loader: "node:vm.runInNewContext", line: 8, specifier: undefined },
      { loader: "node:vm.runInThisContext", line: 9, specifier: undefined },
      { loader: "node:vm.compileFunction", line: 10, specifier: undefined },
      { loader: "node:vm.compileFunction", line: 11, specifier: undefined },
      { loader: "node:vm.Script", line: 12, specifier: undefined },
      { loader: "node:vm.SourceTextModule", line: 13, specifier: undefined },
      { loader: "node:vm.runInThisContext", line: 21, specifier: undefined },
      { loader: "node:vm.createScript", line: 22, specifier: undefined },
      { loader: "node:vm.runInNewContext", line: 23, specifier: undefined },
      { loader: "node:vm.compileFunction", line: 24, specifier: undefined },
      { loader: "node:vm.SourceTextModule", line: 26, specifier: undefined },
      { loader: "node:vm.Script", line: 27, specifier: undefined },
      { loader: "node:vm.runInThisContext", line: 28, specifier: undefined },
      { loader: "node:vm.createScript", line: 30, specifier: undefined },
    ],
  );
});

Deno.test("source collector analyzes only non-callable browser timer handlers as source", () => {
  const dependencies = dependencySummary(collectSourceDependencies({
    path: "src/browser-string-timers.ts",
    content: [
      'setTimeout("import(target)", 0);',
      'globalThis["setInterval"].call(null, "require(target)", 0);',
      "const schedule = setTimeout;",
      'schedule.apply(null, ["eval(source)", 0]);',
      'Reflect.apply(setInterval, null, ["new Worker(target)", 0]);',
      "setTimeout(handler, 0);",
      'setInterval("const {", 0);',
      "setTimeout(42, 0);",
      "setInterval(null, 0);",
      'setTimeout(() => import("npm:callback@1"), 0);',
      "function shadow(setTimeout: unknown, setInterval: unknown) {",
      '  setTimeout("import(ignored)", 0);',
      '  setInterval("require(ignored)", 0);',
      "}",
      'import { setTimeout as nodeTimeout } from "node:timers";',
      'nodeTimeout("import(ignored)", 0);',
    ].join("\n"),
  }));

  assertEquals(
    dependencies.filter(({ kind }) => kind === "unresolved-runtime-loader")
      .map(({ loader, line, specifier }) => ({ loader, line, specifier })),
    [
      { loader: "setTimeout", line: 1, specifier: undefined },
      { loader: "setInterval", line: 2, specifier: undefined },
      { loader: "setTimeout", line: 4, specifier: undefined },
      { loader: "setInterval", line: 5, specifier: undefined },
      { loader: "setTimeout", line: 6, specifier: undefined },
      { loader: "setInterval", line: 7, specifier: undefined },
    ],
  );
  assertEquals(
    dependencies.filter(({ kind }) => kind === "dynamic-import"),
    [{
      kind: "dynamic-import",
      specifier: "npm:callback@1",
      loader: "import",
      line: 10,
    }],
  );
});

Deno.test("source collector does not reduce URL calls through a shadowed globalThis", () => {
  const dependencies = collectSourceDependencies({
    path: "src/shadowed-global-url.ts",
    content: [
      "function run(globalThis: { URL: typeof URL }) {",
      '  new Worker(new globalThis.URL("npm:not-a-static-worker", import.meta.url));',
      "}",
    ].join("\n"),
  });

  assertEquals(
    dependencySummary(dependencies).filter(({ loader }) =>
      loader !== undefined
    ),
    [
      {
        kind: "unresolved-runtime-loader",
        specifier: undefined,
        loader: "Worker",
        line: 2,
      },
    ],
  );
});

Deno.test("source collector fails closed for assignment, object-member, and bind aliases", () => {
  const dependencies = collectSourceDependencies({
    path: "src/escaped-loader-capabilities.ts",
    content: [
      "let assignedLoad;",
      "assignedLoad = require;",
      "assignedLoad(assignedTarget);",
      "const box = { load: require };",
      "box.load(memberTarget);",
      "const boundLoad = require.bind(null);",
      "boundLoad(boundTarget);",
      "function shadowed(require: (value: string) => void) {",
      "  let localLoad;",
      "  localLoad = require;",
      "  const localBox = { load: require };",
      '  localLoad("ignored-assignment");',
      '  localBox.load("ignored-member");',
      "}",
    ].join("\n"),
  });

  assertEquals(
    dependencySummary(dependencies).filter(({ kind }) =>
      kind === "unresolved-runtime-loader"
    ),
    [
      {
        kind: "unresolved-runtime-loader",
        specifier: undefined,
        loader: "require-alias",
        line: 3,
      },
      {
        kind: "unresolved-runtime-loader",
        specifier: undefined,
        loader: "require-alias",
        line: 5,
      },
      {
        kind: "unresolved-runtime-loader",
        specifier: undefined,
        loader: "require-alias",
        line: 7,
      },
    ],
  );
});

Deno.test("source collector reports uncertain constructor aliases", () => {
  const dependencies = collectSourceDependencies({
    path: "src/uncertain-constructors.ts",
    content: [
      "let WorkerAlias = Worker;",
      "new WorkerAlias(workerTarget);",
      "const ConditionalWorker = flag ? Worker : Worker;",
      "new ConditionalWorker(conditionalTarget);",
      "const ConditionalFunction = flag ? Function : Other;",
      'new ConditionalFunction("return import(target)");',
    ].join("\n"),
  });

  assertEquals(
    dependencySummary(dependencies).filter(({ kind }) =>
      kind === "unresolved-runtime-loader"
    ).map(({ loader, line }) => ({ loader, line })),
    [
      { loader: "runtime-loader-alias", line: 2 },
      { loader: "runtime-loader-alias", line: 4 },
      { loader: "runtime-loader-alias", line: 6 },
    ],
  );
});

Deno.test("source collector fails closed for eval.apply argument containers", () => {
  const dependencies = collectSourceDependencies({
    path: "src/eval-apply.ts",
    content: 'eval.apply("benign", [`import("npm:indirect-apply@1")`]);\n',
  });

  assertEquals(
    dependencySummary(dependencies).filter(({ loader }) =>
      loader !== undefined
    ),
    [
      {
        kind: "unresolved-runtime-loader",
        specifier: undefined,
        loader: "eval",
        line: 1,
      },
    ],
  );
});

Deno.test("source collector fails closed when higher-order invocation receivers carry loaders", async (context) => {
  const cases = [
    [
      "nested call",
      'require.call.call(require, null, "npm:nested-call@1");',
      "require-alias",
    ],
    [
      "nested apply",
      'require.apply.call(require, null, ["npm:nested-apply@1"]);',
      "require-alias",
    ],
    [
      "Reflect.apply receiver",
      'Reflect.apply(Function.prototype.call, require, [null, "npm:reflect-receiver@1"]);',
      "require-alias",
    ],
    [
      "meta bind",
      'const load = Function.prototype.bind.call(require, null);\nload("npm:meta-bind@1");',
      "require-alias",
    ],
    [
      "namespace receiver",
      'import * as nodeModule from "node:module";\nfunction use() { this.register(target); }\nuse.call(nodeModule);',
      "runtime-loader-alias",
    ],
  ] as const;

  for (const [name, content, loader] of cases) {
    await context.step(name, () => {
      const dependencies = dependencySummary(collectSourceDependencies({
        path: `src/${name.replaceAll(" ", "-")}.ts`,
        content,
      })).filter(({ kind }) => kind === "unresolved-runtime-loader");
      assertEquals(dependencies, [{
        kind: "unresolved-runtime-loader",
        specifier: undefined,
        loader,
        line: name === "namespace receiver" ? 3 : 1,
      }]);
    });
  }

  assertEquals(
    dependencySummary(collectSourceDependencies({
      path: "src/benign-higher-order-receiver.ts",
      content: "Reflect.apply(Function.prototype.call, benign, []);",
    })).filter(({ kind }) => kind === "unresolved-runtime-loader"),
    [],
  );
});

Deno.test("source collector treats namespace-valued ordinary invocation arguments as capability boundaries", async (context) => {
  const cases = [
    [
      "direct global namespace",
      "function consume(value: unknown) { return value; }\nconsume(globalThis);",
      "runtime-loader-alias",
    ],
    [
      "constructor global namespace",
      "class Consumer { constructor(value: unknown) { void value; } }\nnew Consumer(globalThis);",
      "runtime-loader-alias",
    ],
    [
      "direct module namespace",
      'import * as nodeModule from "node:module";\nconsume(nodeModule);',
      "runtime-loader-alias",
    ],
  ] as const;

  for (const [name, content, loader] of cases) {
    await context.step(name, () => {
      const unresolved = dependencySummary(collectSourceDependencies({
        path: `src/${name.replaceAll(" ", "-")}.ts`,
        content,
      })).filter(({ kind }) => kind === "unresolved-runtime-loader");
      assertEquals(unresolved, [{
        kind: "unresolved-runtime-loader",
        specifier: undefined,
        loader,
        line: 2,
      }]);
    });
  }

  assertEquals(
    dependencySummary(collectSourceDependencies({
      path: "src/benign-ordinary-arguments.ts",
      content: "consume(benign);\nclass Consumer {}\nnew Consumer(alsoBenign);",
    })).filter(({ kind }) => kind === "unresolved-runtime-loader"),
    [],
  );
});

Deno.test("source collector retains Reflect.construct newTarget as a capability input", async (context) => {
  const cases = [
    [
      "loader newTarget",
      "function Target() { return new.target; }\nReflect.construct(Target, [], require);",
      "require-alias",
    ],
    [
      "namespace newTarget",
      "function Target() { return new.target; }\nReflect.construct(Target, [], globalThis);",
      "runtime-loader-alias",
    ],
  ] as const;

  for (const [name, content, loader] of cases) {
    await context.step(name, () => {
      const unresolved = dependencySummary(collectSourceDependencies({
        path: `src/${name.replaceAll(" ", "-")}.ts`,
        content,
      })).filter(({ kind }) => kind === "unresolved-runtime-loader");
      assertEquals(unresolved, [{
        kind: "unresolved-runtime-loader",
        specifier: undefined,
        loader,
        line: 2,
      }]);
    });
  }

  assertEquals(
    dependencySummary(collectSourceDependencies({
      path: "src/benign-new-target.ts",
      content: "Reflect.construct(Target, [], BenignTarget);",
    })).filter(({ kind }) => kind === "unresolved-runtime-loader"),
    [],
  );
});

Deno.test("source collector binds TS import-equals module namespaces", () => {
  const dependencies = collectSourceDependencies({
    path: "src/import-equals-provenance.ts",
    content: [
      'import workerThreads = require("node:worker_threads");',
      'import nodeModule = require("node:module");',
      "const localRequire = nodeModule.createRequire(import.meta.url);",
      "new workerThreads.Worker(workerTarget);",
      "localRequire.resolve(moduleTarget);",
    ].join("\n"),
  });

  assertEquals(
    dependencySummary(dependencies).filter(({ kind }) =>
      kind === "unresolved-runtime-loader"
    ),
    [
      {
        kind: "unresolved-runtime-loader",
        specifier: undefined,
        loader: "node:worker_threads.Worker",
        line: 4,
      },
      {
        kind: "unresolved-runtime-loader",
        specifier: undefined,
        loader: "require.resolve",
        line: 5,
      },
    ],
  );
});

Deno.test("source collector follows inline member and destructuring-assignment module APIs", () => {
  const dependencies = collectSourceDependencies({
    path: "src/inline-module-apis.ts",
    content: [
      'const ImportedWorker = (await import("node:worker_threads")).Worker;',
      'const RequiredWorker = require("node:worker_threads").Worker;',
      "let AssignedWorker;",
      '({ Worker: AssignedWorker } = await import("node:worker_threads"));',
      "new ImportedWorker(importedTarget);",
      "new RequiredWorker(requiredTarget);",
      "new AssignedWorker(assignedTarget);",
    ].join("\n"),
  });

  assertEquals(
    dependencySummary(dependencies).filter(({ kind }) =>
      kind === "unresolved-runtime-loader"
    ).map(({ loader, line }) => ({ loader, line })),
    [
      { loader: "node:worker_threads.Worker", line: 5 },
      { loader: "node:worker_threads.Worker", line: 6 },
      { loader: "runtime-loader-alias", line: 7 },
    ],
  );
});

Deno.test("source collector resolves loader API provenance through a supplied module alias resolver", () => {
  const aliases = new Map([
    ["#worker-api", "node:worker_threads"],
    ["#module-api", "node:module"],
  ]);
  const dependencies = collectSourceDependencies(
    {
      path: "src/aliased-module-apis.ts",
      content: [
        'import { Worker as WorkerAlias } from "#worker-api";',
        'import { createRequire, register } from "#module-api";',
        "const localRequire = createRequire(import.meta.url);",
        "new WorkerAlias(workerTarget);",
        "localRequire.resolve(requireTarget);",
        "register(registerTarget);",
      ].join("\n"),
    },
    {
      resolveModuleSpecifier: (specifier) =>
        aliases.get(specifier) ?? specifier,
    },
  );

  assertEquals(
    dependencySummary(dependencies).filter(({ kind }) =>
      kind === "unresolved-runtime-loader"
    ).map(({ loader, line }) => ({ loader, line })),
    [
      { loader: "node:worker_threads.Worker", line: 4 },
      { loader: "require.resolve", line: 5 },
      { loader: "module.register", line: 6 },
    ],
  );
});

Deno.test("source collector fails closed for indirect require calls", () => {
  const dependencies = collectSourceDependencies({
    path: "src/indirect-require.ts",
    content: [
      "require.call(null, callTarget);",
      "require.apply(null, [applyTarget]);",
      "require.resolve.call(require, resolveTarget);",
    ].join("\n"),
  });

  assertEquals(
    dependencySummary(dependencies).filter(({ kind }) =>
      kind === "unresolved-runtime-loader"
    ).map(({ loader, line }) => ({ loader, line })),
    [
      { loader: "require", line: 1 },
      { loader: "require", line: 2 },
      { loader: "require.resolve", line: 3 },
    ],
  );
});

Deno.test("source collector accepts XML whitespace in triple-slash references", () => {
  const dependencies = collectSourceDependencies({
    path: "src/spaced-references.ts",
    content: [
      '/// <reference types = "npm:spaced-types@1" />',
      '/// <reference path= "./spaced-reference.d.ts" />',
      "export {};",
    ].join("\n"),
  });

  assertEquals(dependencySummary(dependencies), [
    {
      kind: "triple-slash-reference",
      specifier: "npm:spaced-types@1",
      loader: undefined,
      line: 1,
    },
    {
      kind: "triple-slash-reference",
      specifier: "./spaced-reference.d.ts",
      loader: undefined,
      line: 2,
    },
  ]);
});

Deno.test("source collector reports every unresolved runtime loader without identifier exceptions", () => {
  const dependencies = collectSourceDependencies({
    path: "cli/runtime-loaders.ts",
    content: [
      "await import(importTarget);",
      "require(requireTarget);",
      "const load = require;",
      'load("aliased-runtime");',
      "require[resolveName](resolveTarget);",
      "new Worker(workerTarget);",
      "navigator.serviceWorker.register(serviceWorkerTarget);",
      "audioWorklet.addModule(audioTarget);",
      "CSS.layoutWorklet.addModule(cssTarget);",
      "importScripts(...scriptTargets);",
      "module.register(registerTarget);",
      'new Function("specifier", "return import(specifier)");',
      'eval("require(runtimeName)");',
    ].join("\n"),
  }).filter((dependency) => dependency.kind === "unresolved-runtime-loader");

  assertEquals(dependencies.map((dependency) => dependency.loader), [
    "import",
    "require",
    "require-alias",
    "require.resolve",
    "runtime-loader-alias",
    "Worker",
    "navigator.serviceWorker.register",
    "AudioWorklet.addModule",
    "CSS.layoutWorklet.addModule",
    "importScripts",
    "module.register",
    "Function",
    "eval",
  ]);
  assertEquals(
    dependencies.every((dependency) => dependency.specifier === undefined),
    true,
  );
});

Deno.test("source collector recognizes Function and eval aliases without flagging benign strings", () => {
  const dependencies = collectSourceDependencies({
    path: "src/dynamic-code.ts",
    content: [
      "const RuntimeFunction = Function;",
      "const indirectEval = eval;",
      'const computedEval = globalThis["eval"];',
      'new RuntimeFunction("left", "right", "return import(left + right)");',
      'indirectEval("require(runtimeName)");',
      'computedEval("import(dynamicName)");',
      'new Function("value", "return value + 1");',
      "eval(\"const message = 'require() as documentation'\");",
      "const benign = \"new Function('return import(x)')\";",
    ].join("\n"),
  });

  assertEquals(
    dependencies.map(({ kind, loader, line }) => ({ kind, loader, line })),
    [
      { kind: "unresolved-runtime-loader", loader: "Function", line: 4 },
      { kind: "unresolved-runtime-loader", loader: "eval", line: 5 },
      { kind: "unresolved-runtime-loader", loader: "eval", line: 6 },
    ],
  );
});

Deno.test("source collector resolves global, sequence, constructor, and import-meta callee aliases", () => {
  const dependencies = collectSourceDependencies({
    path: "src/callee-aliases.ts",
    content: [
      'globalThis.eval("import(runtimeName)");',
      '(0, eval)("require(runtimeName)");',
      'globalThis.Function("name", "return import(name)");',
      'new globalThis.Function("name", "return import(name)");',
      "const resolveModule = import.meta.resolve;",
      'resolveModule("npm:resolved@1");',
      "const runEval = (0, eval);",
      'runEval("require(otherName)");',
      "function shadow(globalThis) {",
      '  globalThis.eval("import(ignored)");',
      '  globalThis.importScripts("ignored.ts");',
      '  new globalThis.Worker("ignored.ts");',
      "}",
    ].join("\n"),
  });

  assertEquals(
    dependencies.filter((dependency) => dependency.loader).map(
      ({ kind, specifier, loader, line }) => ({
        kind,
        specifier,
        loader,
        line,
      }),
    ),
    [
      {
        kind: "unresolved-runtime-loader",
        specifier: undefined,
        loader: "eval",
        line: 1,
      },
      {
        kind: "unresolved-runtime-loader",
        specifier: undefined,
        loader: "eval",
        line: 2,
      },
      {
        kind: "unresolved-runtime-loader",
        specifier: undefined,
        loader: "Function",
        line: 3,
      },
      {
        kind: "unresolved-runtime-loader",
        specifier: undefined,
        loader: "Function",
        line: 4,
      },
      {
        kind: "runtime-loader",
        specifier: "npm:resolved@1",
        loader: "import.meta.resolve",
        line: 6,
      },
      {
        kind: "unresolved-runtime-loader",
        specifier: undefined,
        loader: "eval",
        line: 8,
      },
    ],
  );
});

Deno.test("source collector reads dependency directives only from real parser comments", () => {
  const dependencies = collectSourceDependencies({
    path: "src/directives.tsx",
    content: [
      '/// <reference types="npm:@types/node@24" />',
      "/** @jsxImportSource npm:preact@10 */",
      '// @deno-types="npm:@types/vendor@1"',
      'import vendor from "https://vendor.test/mod.js";',
      '/** @typedef {import("jsr:@vendor/contracts@1").Contract} Contract */',
      '/** Documents `import("not-a-type")` expressions without declaring a type. */',
      '/** Documentation may quote @type {import("not-a-type-tag").Value}. */',
      '/** Documentation may quote @import { Value } from "not-an-import-tag". */',
      'const template = `/// <reference types="npm:false-positive" />`;',
      "// prose mentioning @jsxImportSource npm:false-positive is not a directive",
      '/// <reference types="npm:late-reference" />',
      "export { vendor };",
    ].join("\n"),
  });

  assertEquals(
    dependencies.map(({ kind, specifier, loader, line }) => ({
      kind,
      specifier,
      loader,
      line,
    })),
    [
      {
        kind: "triple-slash-reference",
        specifier: "npm:@types/node@24",
        loader: undefined,
        line: 1,
      },
      {
        kind: "runtime-loader",
        specifier: "npm:preact@10",
        loader: "@jsxImportSource",
        line: 2,
      },
      {
        kind: "type-import",
        specifier: "npm:@types/vendor@1",
        loader: "@deno-types",
        line: 3,
      },
      {
        kind: "static-import",
        specifier: "https://vendor.test/mod.js",
        loader: undefined,
        line: 4,
      },
      {
        kind: "type-import",
        specifier: "jsr:@vendor/contracts@1",
        loader: "JSDoc import",
        line: 5,
      },
    ],
  );
});

Deno.test("source collector covers JSDoc type-bearing tags and import declarations", () => {
  const dependencies = collectSourceDependencies({
    path: "src/jsdoc-dependencies.js",
    content: [
      '/** @template {import("evil-template").Base} T */',
      '/** @throws {import("evil-throws").Failure} */',
      '/** @yields {import("evil-yields").Value} */',
      '/** @enum {import("evil-enum").Value} */',
      '/** @member {import("evil-member").Value} */',
      '/** @const {import("evil-const").Value} */',
      '/** @import { Remote } from "evil-import" */',
      "export const value = 1;",
    ].join("\n"),
  });

  assertEquals(
    dependencies.map(({ kind, specifier, loader, line }) => ({
      kind,
      specifier,
      loader,
      line,
    })),
    [
      {
        kind: "type-import",
        specifier: "evil-template",
        loader: "JSDoc import",
        line: 1,
      },
      {
        kind: "type-import",
        specifier: "evil-throws",
        loader: "JSDoc import",
        line: 2,
      },
      {
        kind: "type-import",
        specifier: "evil-yields",
        loader: "JSDoc import",
        line: 3,
      },
      {
        kind: "type-import",
        specifier: "evil-enum",
        loader: "JSDoc import",
        line: 4,
      },
      {
        kind: "type-import",
        specifier: "evil-member",
        loader: "JSDoc import",
        line: 5,
      },
      {
        kind: "type-import",
        specifier: "evil-const",
        loader: "JSDoc import",
        line: 6,
      },
      {
        kind: "type-import",
        specifier: "evil-import",
        loader: "JSDoc @import",
        line: 7,
      },
    ],
  );
});

Deno.test("source collector chooses TypeScript and JSX parser plugins by extension", () => {
  const fixtures: Array<[string, string]> = [
    ["src/value.ts", "const value = <string> unknown;"],
    ["src/value.cts", "const value = <string> unknown;"],
    ["src/value.mts", "const value = <string> unknown;"],
    ["src/view.tsx", "const view: JSX.Element = <main />;"],
    ["src/value.js", "const value = { ok: true };"],
    ["src/value.cjs", "module.exports = { ok: true };"],
    ["src/value.mjs", "export const value = { ok: true };"],
    ["src/view.jsx", "export const view = <main />;"],
  ];
  for (const [path, content] of fixtures) {
    assertEquals(collectSourceDependencies({ path, content }), [], path);
  }
});

Deno.test("source collector ignores shadowed loader spellings", () => {
  const dependencies = collectSourceDependencies({
    path: "src/shadowed.ts",
    content: [
      "function run(require, Worker, navigator, audioWorklet, CSS, importScripts, module, eval, Function) {",
      '  require("vendor-a");',
      '  require.resolve("vendor-b");',
      '  new Worker("vendor-c");',
      '  navigator.serviceWorker.register("vendor-d");',
      '  audioWorklet.addModule("vendor-e");',
      '  CSS.paintWorklet.addModule("vendor-f");',
      '  importScripts("vendor-g");',
      '  module.register("vendor-h");',
      '  eval("require(vendor)");',
      '  new Function("return import(vendor)");',
      "}",
    ].join("\n"),
  });

  assertEquals(dependencies, []);
});

Deno.test("source collector turns parser failures into structured fatal errors", () => {
  assertThrows(
    () =>
      collectSourceDependencies({
        path: "src/broken.ts",
        content: "import {",
      }),
    SourceImportCollectorError,
    "parse-failure: src/broken.ts",
  );
});

Deno.test("source collector turns binding convergence exhaustion into a structured fatal error", () => {
  assertThrows(
    () =>
      collectSourceDependencies(
        {
          path: "src/non-converging-bindings.ts",
          content: "const load = require;\nload(target);\n",
        },
        { maximumBindingPasses: 0 },
      ),
    SourceImportCollectorError,
    "binding-resolution-failure: src/non-converging-bindings.ts: loader provenance binding analysis did not converge",
  );
});

Deno.test("source collector resolves reverse binding chains with affine transfer work", () => {
  const collect = (width: number) => {
    const content: string[] = [];
    for (let index = 0; index < width - 1; index++) {
      content.push(`const load${index} = load${index + 1};`);
    }
    content.push(`const load${width - 1} = require;`);
    content.push("load0(target);");

    let diagnostics:
      | {
        bindingDependencyEdges: number;
        bindingTransferEvaluations: number;
        bindingWorklistEnqueues: number;
      }
      | undefined;
    const started = performance.now();
    const dependencies = dependencySummary(collectSourceDependencies(
      {
        path: `src/reverse-binding-chain-${width}.ts`,
        content: content.join("\n"),
      },
      {
        onAnalysisDiagnostics: (value) => {
          diagnostics = value;
        },
      },
    ));
    const elapsed = performance.now() - started;

    if (!diagnostics) {
      throw new Error("binding analysis did not report work diagnostics");
    }
    assertEquals(dependencies, [{
      kind: "unresolved-runtime-loader",
      specifier: undefined,
      loader: "require-alias",
      line: width + 1,
    }]);
    assertEquals(diagnostics.bindingTransferEvaluations, 2 * width - 1);
    // Each alias transfer permanently subscribes to both its value provenance
    // and its potential constant-string provenance.
    assertEquals(diagnostics.bindingDependencyEdges, 2 * (width - 1));
    assertEquals(diagnostics.bindingWorklistEnqueues, 2 * width - 1);
    if (elapsed >= 5_000) {
      throw new Error(
        `reverse binding chain analysis took ${elapsed.toFixed(1)}ms`,
      );
    }
    return diagnostics;
  };

  assertEquals(collect(64).bindingTransferEvaluations, 127);
  assertEquals(collect(128).bindingTransferEvaluations, 255);
});

Deno.test("source collector structurally bounds cyclic composite facts", () => {
  const collect = () =>
    collectSourceDependencies({
      path: "src/cyclic-composite-facts.ts",
      content: [
        "const left = {};",
        "const right = {};",
        "left.next = right;",
        "right.next = left;",
        "consume(left);",
      ].join("\n"),
    });

  assertEquals(collect(), []);
  assertEquals(collect(), []);
});

Deno.test("source collector bounds shared and deep container graphs", async (context) => {
  await context.step("shared diamond", () => {
    const depth = 20;
    const content = ["const c0 = {};"];
    for (let index = 1; index <= depth; index++) {
      content.push(
        `const c${index} = { left: c${index - 1}, right: c${index - 1} };`,
      );
    }
    content.push("c0.load = require;");
    content.push('c0.pending = import("node:worker_threads");');
    content.push(`consume(c${depth});`);

    const started = performance.now();
    const dependencies = dependencySummary(collectSourceDependencies({
      path: "src/shared-container-diamond.ts",
      content: content.join("\n"),
    })).filter(({ kind }) => kind === "unresolved-runtime-loader");
    const elapsed = performance.now() - started;
    if (elapsed >= 1_000) {
      throw new Error(
        `shared container traversal took ${elapsed.toFixed(1)}ms`,
      );
    }
    assertEquals(dependencies.length, 1);
    assertEquals(dependencies.at(-1), {
      kind: "unresolved-runtime-loader",
      specifier: undefined,
      loader: "runtime-loader-alias",
      line: depth + 4,
    });
  });

  await context.step("capability cycle", () => {
    const dependencies = dependencySummary(collectSourceDependencies({
      path: "src/cyclic-container-capability.ts",
      content: [
        "const left = {}; const right = {};",
        "left.next = right;",
        "right.next = left;",
        "left.load = require;",
        "consume(right);",
      ].join("\n"),
    })).filter(({ kind }) => kind === "unresolved-runtime-loader");

    assertEquals(dependencies, [
      {
        kind: "unresolved-runtime-loader",
        specifier: undefined,
        loader: "require-alias",
        line: 5,
      },
    ]);
  });

  await context.step("deep chain", () => {
    const depth = 512;
    const content = ["const c0 = {};"];
    for (let index = 1; index <= depth; index++) {
      content.push(`const c${index} = { next: c${index - 1} };`);
    }
    content.push(`consume(c${depth});`);

    assertEquals(
      collectSourceDependencies({
        path: "src/deep-container-chain.ts",
        content: content.join("\n"),
      }),
      [],
    );
  });

  await context.step("wide local member accumulation", () => {
    const collect = (width: number) => {
      const content = ["const box = {};"];
      for (let index = 0; index < width; index++) {
        content.push(`box.p${index} = value${index};`);
      }
      content.push("consume(box);");
      let containerMapEntryCopies: number | undefined;
      let containerMemberJoins: number | undefined;
      const started = performance.now();
      collectSourceDependencies(
        {
          path: `src/wide-local-member-accumulation-${width}.ts`,
          content: content.join("\n"),
        },
        {
          onAnalysisDiagnostics: (diagnostics) => {
            containerMapEntryCopies = diagnostics.containerMapEntryCopies;
            containerMemberJoins = diagnostics.containerMemberJoins;
          },
        },
      );
      return {
        containerMapEntryCopies,
        containerMemberJoins,
        elapsed: performance.now() - started,
      };
    };

    const narrow = collect(400);
    const wide = collect(800);
    if (
      narrow.containerMapEntryCopies === undefined ||
      wide.containerMapEntryCopies === undefined ||
      narrow.containerMemberJoins === undefined ||
      wide.containerMemberJoins === undefined
    ) {
      throw new Error("container analysis did not report work diagnostics");
    }
    if (
      wide.containerMapEntryCopies >
        2 * narrow.containerMapEntryCopies + 32 ||
      wide.containerMemberJoins > 2 * narrow.containerMemberJoins + 32
    ) {
      throw new Error(
        `wide member work grew superlinearly: copies ${narrow.containerMapEntryCopies} -> ${wide.containerMapEntryCopies}, joins ${narrow.containerMemberJoins} -> ${wide.containerMemberJoins}`,
      );
    }
    if (wide.elapsed >= 5_000) {
      throw new Error(
        `wide local member accumulation took ${wide.elapsed.toFixed(1)}ms`,
      );
    }
  });

  await context.step("wide container identity accumulation", () => {
    const collect = (width: number) => {
      const content: string[] = [];
      for (let index = 0; index < width; index++) {
        content.push(`const c${index} = {};`);
      }
      content.push("let all = c0;");
      for (let index = 1; index < width; index++) {
        content.push(`all = flag${index} ? all : c${index};`);
      }
      content.push("consume(all);");
      let diagnostics:
        | {
          containerIdentityElementVisits: number;
          containerIdentityInsertions: number;
          containerSnapshotForkElementCopies: number;
        }
        | undefined;
      collectSourceDependencies(
        {
          path: `src/wide-container-identity-accumulation-${width}.ts`,
          content: content.join("\n"),
        },
        {
          onAnalysisDiagnostics: (value) => {
            diagnostics = value;
          },
        },
      );
      if (!diagnostics) {
        throw new Error("container analysis did not report work diagnostics");
      }
      return diagnostics;
    };

    const narrow = collect(40);
    const wide = collect(80);
    if (
      wide.containerIdentityElementVisits >
        2 * narrow.containerIdentityElementVisits + 32 ||
      wide.containerIdentityInsertions >
        2 * narrow.containerIdentityInsertions + 32 ||
      narrow.containerSnapshotForkElementCopies !== 0 ||
      wide.containerSnapshotForkElementCopies !== 0
    ) {
      throw new Error(
        `wide identity work grew superlinearly: visits ${narrow.containerIdentityElementVisits} -> ${wide.containerIdentityElementVisits}, insertions ${narrow.containerIdentityInsertions} -> ${wide.containerIdentityInsertions}, fork copies ${narrow.containerSnapshotForkElementCopies} -> ${wide.containerSnapshotForkElementCopies}`,
      );
    }
  });
});

Deno.test("source collector keeps mixed traversal policy state across shared cycles", () => {
  const collect = () =>
    dependencySummary(collectSourceDependencies({
      path: "src/mixed-container-policy-cycle.ts",
      content: [
        'const batch = await Promise.all([import("node:module")]);',
        'const shared = flag ? batch : await import("node:module");',
        "const denied = { value: shared };",
        "denied.self = denied;",
        "const allowed = await Promise.all([shared]);",
        "const graph = { allowed, denied };",
        "consume(graph);",
      ].join("\n"),
    })).filter(({ kind }) => kind === "unresolved-runtime-loader");

  const first = collect();
  assertEquals(collect(), first);
  assertEquals(
    first.some(({ line, loader }) =>
      line === 7 && loader === "runtime-loader-alias"
    ),
    true,
  );
});

Deno.test("source collector bounds shared and deep promise-origin graphs", async (context) => {
  await context.step("shared Promise.all diamond", () => {
    const depth = 20;
    const content = ['const p0 = import("node:module");'];
    for (let index = 1; index <= depth; index++) {
      content.push(
        `const p${index} = Promise.all([p${index - 1}, p${index - 1}]);`,
      );
    }
    content.push(`consume(p${depth});`);

    const started = performance.now();
    const dependencies = dependencySummary(collectSourceDependencies({
      path: "src/shared-promise-diamond.ts",
      content: content.join("\n"),
    })).filter(({ kind }) => kind === "unresolved-runtime-loader");
    const elapsed = performance.now() - started;
    if (elapsed >= 1_000) {
      throw new Error(
        `shared promise traversal took ${elapsed.toFixed(1)}ms`,
      );
    }
    assertEquals(dependencies.at(-1), {
      kind: "unresolved-runtime-loader",
      specifier: undefined,
      loader: "runtime-loader-alias",
      line: depth + 2,
    });
  });

  await context.step("awaited diamond projection", () => {
    const depth = 20;
    const content = ['const p0 = import("node:module");'];
    for (let index = 1; index <= depth; index++) {
      content.push(
        `const p${index} = Promise.all([p${index - 1}, p${index - 1}]);`,
      );
    }
    content.push(`const resolved = await p${depth};`);
    content.push(`resolved${"[0]".repeat(depth)}.register(target);`);

    const started = performance.now();
    const dependencies = dependencySummary(collectSourceDependencies({
      path: "src/awaited-promise-diamond.ts",
      content: content.join("\n"),
    })).filter(({ kind }) => kind === "unresolved-runtime-loader");
    const elapsed = performance.now() - started;
    if (elapsed >= 500) {
      throw new Error(
        `awaited promise projection took ${elapsed.toFixed(1)}ms`,
      );
    }
    assertEquals(dependencies.at(-1), {
      kind: "unresolved-runtime-loader",
      specifier: undefined,
      loader: "module.register",
      line: depth + 3,
    });
  });

  await context.step("promise-origin cycle", () => {
    const collect = () =>
      dependencySummary(collectSourceDependencies({
        path: "src/cyclic-promise-origins.ts",
        content: [
          'let left = import("node:module");',
          "let right;",
          "left = Promise.all([right]);",
          "right = Promise.all([left]);",
          "consume(right);",
        ].join("\n"),
      })).filter(({ kind }) => kind === "unresolved-runtime-loader");

    const first = collect();
    assertEquals(collect(), first);
    assertEquals(
      first.some(({ line, loader }) =>
        line === 5 && loader === "runtime-loader-alias"
      ),
      true,
    );
  });

  await context.step("deep Promise.all chain", () => {
    const depth = 512;
    const content = ['const p0 = import("node:worker_threads");'];
    for (let index = 1; index <= depth; index++) {
      content.push(`const p${index} = Promise.all([p${index - 1}]);`);
    }
    content.push(`consume(p${depth});`);

    const dependencies = dependencySummary(collectSourceDependencies({
      path: "src/deep-promise-chain.ts",
      content: content.join("\n"),
    })).filter(({ kind }) => kind === "unresolved-runtime-loader");
    assertEquals(
      dependencies.some(({ line, loader }) =>
        line === depth + 2 && loader === "runtime-loader-alias"
      ),
      true,
    );
  });

  await context.step("shared multi-origin capability facts", () => {
    const collect = (width: number) => {
      const content = ["let pending;"];
      for (let index = 0; index < width; index++) {
        content.push('pending = import("node:module");');
      }
      content.push(
        `const values = [${Array(width).fill("pending").join(",")}];`,
      );
      content.push("consume(values);");

      let promiseOriginElementVisits: number | undefined;
      const started = performance.now();
      const dependencies = dependencySummary(collectSourceDependencies(
        {
          path: `src/shared-multi-origin-capability-${width}.ts`,
          content: content.join("\n"),
        },
        {
          onAnalysisDiagnostics: (diagnostics) => {
            promiseOriginElementVisits = diagnostics.promiseOriginElementVisits;
          },
        },
      )).filter(({ kind }) => kind === "unresolved-runtime-loader");
      return {
        dependencies,
        elapsed: performance.now() - started,
        promiseOriginElementVisits,
      };
    };

    const narrow = collect(400);
    const wide = collect(800);
    assertEquals(narrow.dependencies, [{
      kind: "unresolved-runtime-loader",
      specifier: undefined,
      loader: "runtime-loader-alias",
      line: 403,
    }]);
    assertEquals(wide.dependencies, [{
      kind: "unresolved-runtime-loader",
      specifier: undefined,
      loader: "runtime-loader-alias",
      line: 803,
    }]);
    if (
      narrow.promiseOriginElementVisits === undefined ||
      wide.promiseOriginElementVisits === undefined
    ) {
      throw new Error("binding analysis did not report work diagnostics");
    }
    if (
      narrow.promiseOriginElementVisits > 4 * 400 + 32 ||
      wide.promiseOriginElementVisits >
        2 * narrow.promiseOriginElementVisits + 32
    ) {
      throw new Error(
        `shared provenance work grew superlinearly: ${narrow.promiseOriginElementVisits} -> ${wide.promiseOriginElementVisits}`,
      );
    }
    if (wide.elapsed >= 1_000) {
      throw new Error(
        `shared multi-origin capability traversal took ${
          wide.elapsed.toFixed(1)
        }ms`,
      );
    }
  });

  await context.step("shared multi-origin awaited facts", () => {
    const width = 1_600;
    const content = ["let pending;"];
    for (let index = 0; index < width; index++) {
      content.push('pending = import("node:module");');
    }
    content.push(
      `const values = await Promise.all([${
        Array(width).fill("pending").join(",")
      }]);`,
    );
    content.push("values[0].register(target);");

    let awaitedPromiseOriginElementVisits: number | undefined;
    const started = performance.now();
    const dependencies = dependencySummary(collectSourceDependencies(
      {
        path: "src/shared-multi-origin-awaited.ts",
        content: content.join("\n"),
      },
      {
        onAnalysisDiagnostics: (diagnostics) => {
          awaitedPromiseOriginElementVisits =
            diagnostics.awaitedPromiseOriginElementVisits;
        },
      },
    )).filter(({ kind }) => kind === "unresolved-runtime-loader");
    const elapsed = performance.now() - started;
    if (
      awaitedPromiseOriginElementVisits === undefined ||
      awaitedPromiseOriginElementVisits > 8 * width + 64
    ) {
      throw new Error(
        `shared awaited provenance work was not linear: ${awaitedPromiseOriginElementVisits}`,
      );
    }
    if (elapsed >= 5_000) {
      throw new Error(
        `shared multi-origin awaited traversal took ${elapsed.toFixed(1)}ms`,
      );
    }
    assertEquals(dependencies.at(-1), {
      kind: "unresolved-runtime-loader",
      specifier: undefined,
      loader: "module.register",
      line: width + 3,
    });
  });

  await context.step("shared local Promise.all iterable", () => {
    const width = 1_600;
    const content = [
      `const inputs = [${
        Array(width).fill('import("node:module")').join(",")
      }];`,
      "let pending;",
    ];
    for (let index = 0; index < width; index++) {
      content.push("pending = Promise.all(inputs);");
    }
    content.push("const values = await pending;");
    content.push("values[0].register(target);");

    let awaitedIterableMemberVisits: number | undefined;
    const started = performance.now();
    const dependencies = dependencySummary(collectSourceDependencies(
      {
        path: "src/shared-local-promise-iterable.ts",
        content: content.join("\n"),
      },
      {
        onAnalysisDiagnostics: (diagnostics) => {
          awaitedIterableMemberVisits = diagnostics.awaitedIterableMemberVisits;
        },
      },
    )).filter(({ kind }) => kind === "unresolved-runtime-loader");
    const elapsed = performance.now() - started;
    if (
      awaitedIterableMemberVisits === undefined ||
      awaitedIterableMemberVisits > 8 * width + 64
    ) {
      throw new Error(
        `shared local iterable work was not linear: ${awaitedIterableMemberVisits}`,
      );
    }
    if (elapsed >= 5_000) {
      throw new Error(
        `shared local Promise.all traversal took ${elapsed.toFixed(1)}ms`,
      );
    }
    assertEquals(dependencies.at(-1), {
      kind: "unresolved-runtime-loader",
      specifier: undefined,
      loader: "module.register",
      line: width + 4,
    });
  });
});

Deno.test("source collector bounds frozen config bridge facts by allocation identity", () => {
  const collect = () =>
    collectSourceDependencies(
      {
        path: "src/config/config-shim.ts",
        content: [
          'import { defineConfig, mergeConfigs } from "./define-config.ts";',
          'import { getEnv } from "#veryfront/platform/compat/process.ts";',
          "function createConfigShimModule(name, bridge) {",
          "  const bridgeKey = `__veryfrontConfigShimBridgeV1:${name}`;",
          "  const frozenBridge = Object.freeze({ ...bridge });",
          "  Object.defineProperty(globalThis, bridgeKey, {",
          "    configurable: false,",
          "    enumerable: false,",
          "    writable: false,",
          "    value: frozenBridge,",
          "  });",
          "  const source = `const bridge = globalThis[${JSON.stringify(bridgeKey)}];`;",
          "  return Object.freeze({",
          "    source,",
          "    url: `data:text/javascript;base64,${source}`,",
          "  });",
          "}",
          'const shim = createConfigShimModule("loader", {',
          "  defineConfig,",
          "  getEnv,",
          "  mergeConfigs,",
          "});",
          "export const SOURCE = shim.source;",
          "export const URL = shim.url;",
        ].join("\n"),
      },
      { maximumBindingPasses: 8 },
    );

  const expected = [
    {
      path: "src/config/config-shim.ts",
      line: 1,
      column: 1,
      kind: "static-import" as const,
      specifier: "./define-config.ts",
    },
    {
      path: "src/config/config-shim.ts",
      line: 2,
      column: 1,
      kind: "static-import" as const,
      specifier: "#veryfront/platform/compat/process.ts",
    },
    {
      path: "src/config/config-shim.ts",
      line: 6,
      column: 3,
      kind: "unresolved-runtime-loader" as const,
      loader: "runtime-loader-alias",
    },
  ];
  assertEquals(collect(), expected);
  assertEquals(collect(), expected);
});

Deno.test("source collector joins scalar facts and honors the last definite local slot write", () => {
  const dependencies = dependencySummary(collectSourceDependencies({
    path: "src/alternating-loader-facts.ts",
    content: [
      "let load = require;",
      "load = Worker;",
      "load = require;",
      "load(target);",
      "const box = { load: require };",
      "box.load = Worker;",
      "box.load = require;",
      "box.load(memberTarget);",
    ].join("\n"),
  })).filter(({ kind }) => kind === "unresolved-runtime-loader");

  assertEquals(dependencies, [
    {
      kind: "unresolved-runtime-loader",
      specifier: undefined,
      loader: "runtime-loader-alias",
      line: 4,
    },
    {
      kind: "unresolved-runtime-loader",
      specifier: undefined,
      loader: "require-alias",
      line: 8,
    },
  ]);
});

Deno.test("source collector keeps direct constructor loader returns fail-closed", () => {
  const dependencies = dependencySummary(collectSourceDependencies({
    path: "src/direct-constructor-loader-return.ts",
    content: "new (function () { return require; })();",
  })).filter(({ kind }) => kind === "unresolved-runtime-loader");

  assertEquals(dependencies, [{
    kind: "unresolved-runtime-loader",
    specifier: undefined,
    loader: "require-alias",
    line: 1,
  }]);
});

Deno.test("source collector distinguishes unknown namespace reads from pure writes", () => {
  const dependencies = dependencySummary(collectSourceDependencies({
    path: "src/computed-namespace-writes.ts",
    content: [
      "globalThis[key] = 1;",
      "delete globalThis[key];",
      "globalThis[key] += 1;",
      "globalThis[key] = require;",
    ].join("\n"),
  })).filter(({ kind }) => kind === "unresolved-runtime-loader");

  assertEquals(dependencies, [
    {
      kind: "unresolved-runtime-loader",
      specifier: undefined,
      loader: "runtime-loader-alias",
      line: 3,
    },
    {
      kind: "unresolved-runtime-loader",
      specifier: undefined,
      loader: "require-alias",
      line: 4,
    },
  ]);
});

Deno.test("source collector treats raw dynamic imports as promises and awaited imports as namespaces", () => {
  const rawDependencies = dependencySummary(collectSourceDependencies({
    path: "src/raw-dynamic-import-promises.ts",
    content: [
      "const raw = Promise.all([",
      '  import("node:module"),',
      '  import("node:fs"),',
      '  import("node:path"),',
      "]);",
      "void raw;",
      "import(computedTarget);",
    ].join("\n"),
  }));

  assertEquals(rawDependencies.filter(({ loader }) => loader === "import"), [
    {
      kind: "dynamic-import",
      specifier: "node:module",
      loader: "import",
      line: 2,
    },
    {
      kind: "dynamic-import",
      specifier: "node:fs",
      loader: "import",
      line: 3,
    },
    {
      kind: "dynamic-import",
      specifier: "node:path",
      loader: "import",
      line: 4,
    },
    {
      kind: "unresolved-runtime-loader",
      specifier: undefined,
      loader: "import",
      line: 7,
    },
  ]);
  assertEquals(
    rawDependencies.filter(({ loader }) => loader === "runtime-loader-alias"),
    [],
  );

  const unawaitedDestructuring = dependencySummary(collectSourceDependencies({
    path: "src/unawaited-promise-all-destructuring.ts",
    content: [
      "const [{ createRequire }] = Promise.all([",
      '  import("node:module"),',
      "]);",
      "const impossibleLoad = createRequire(import.meta.url);",
      'impossibleLoad("npm:not-actually-callable@1");',
    ].join("\n"),
  })).filter(({ loader }) => loader !== undefined);
  assertEquals(unawaitedDestructuring, [{
    kind: "dynamic-import",
    specifier: "node:module",
    loader: "import",
    line: 2,
  }]);

  const awaitedDependencies = dependencySummary(collectSourceDependencies({
    path: "src/awaited-dynamic-import-namespaces.ts",
    content: [
      'const moduleApi = await import("node:module");',
      "moduleApi.register(registerTarget);",
      'const workerApi = (await import("node:worker_threads"))!;',
      "new workerApi.Worker(workerTarget);",
      "const [{ createRequire }] = await Promise.all([",
      '  import("node:module"),',
      "]);",
      "const load = createRequire(import.meta.url);",
      'load("node:fs");',
    ].join("\n"),
  })).filter(({ loader }) => loader !== undefined);

  assertEquals(awaitedDependencies, [
    {
      kind: "dynamic-import",
      specifier: "node:module",
      loader: "import",
      line: 1,
    },
    {
      kind: "unresolved-runtime-loader",
      specifier: undefined,
      loader: "module.register",
      line: 2,
    },
    {
      kind: "dynamic-import",
      specifier: "node:worker_threads",
      loader: "import",
      line: 3,
    },
    {
      kind: "unresolved-runtime-loader",
      specifier: undefined,
      loader: "node:worker_threads.Worker",
      line: 4,
    },
    {
      kind: "dynamic-import",
      specifier: "node:module",
      loader: "import",
      line: 6,
    },
    {
      kind: "runtime-loader",
      specifier: "node:fs",
      loader: "require",
      line: 9,
    },
  ]);
});

Deno.test("source collector preserves loader provenance through stored dynamic import promises", () => {
  const dependencies = dependencySummary(collectSourceDependencies({
    path: "src/stored-dynamic-import-promises.ts",
    content: [
      'const modulePromise = import("node:module");',
      "const promiseAlias = modulePromise;",
      "const chainedAlias = promiseAlias;",
      "const moduleApi = await chainedAlias;",
      "moduleApi.register(registerTarget);",
      'const workerPromise = import("node:worker_threads");',
      "let assignedPromise;",
      "assignedPromise = workerPromise;",
      "const workerApi = await assignedPromise;",
      "new workerApi.Worker(workerTarget);",
      "const batchedPromise = Promise.all([",
      '  import("node:module"),',
      "]);",
      "const batchedAlias = batchedPromise;",
      "const [{ createRequire }] = await batchedAlias;",
      "const load = createRequire(import.meta.url);",
      'load("npm:stored-promise@1");',
      'const promiseBox = { pending: import("node:module") };',
      "const { pending: boxedPromise } = promiseBox;",
      "const boxedApi = await boxedPromise;",
      "boxedApi.register(boxedTarget);",
      'const promiseList = [import("node:worker_threads")];',
      "const listedApi = await promiseList[0];",
      "new listedApi.Worker(listedTarget);",
    ].join("\n"),
  })).filter(({ loader }) => loader !== undefined);

  assertEquals(dependencies, [
    {
      kind: "dynamic-import",
      specifier: "node:module",
      loader: "import",
      line: 1,
    },
    {
      kind: "unresolved-runtime-loader",
      specifier: undefined,
      loader: "module.register",
      line: 5,
    },
    {
      kind: "dynamic-import",
      specifier: "node:worker_threads",
      loader: "import",
      line: 6,
    },
    {
      kind: "unresolved-runtime-loader",
      specifier: undefined,
      loader: "node:worker_threads.Worker",
      line: 10,
    },
    {
      kind: "dynamic-import",
      specifier: "node:module",
      loader: "import",
      line: 12,
    },
    {
      kind: "runtime-loader",
      specifier: "npm:stored-promise@1",
      loader: "require",
      line: 17,
    },
    {
      kind: "dynamic-import",
      specifier: "node:module",
      loader: "import",
      line: 18,
    },
    {
      kind: "unresolved-runtime-loader",
      specifier: undefined,
      loader: "module.register",
      line: 21,
    },
    {
      kind: "dynamic-import",
      specifier: "node:worker_threads",
      loader: "import",
      line: 22,
    },
    {
      kind: "unresolved-runtime-loader",
      specifier: undefined,
      loader: "node:worker_threads.Worker",
      line: 24,
    },
  ]);
});

Deno.test("source collector joins conflicting promise provenance without treating raw promises as namespaces", () => {
  const dependencies = dependencySummary(collectSourceDependencies({
    path: "src/dynamic-import-promise-lattice.ts",
    content: [
      'const raw = import("node:module");',
      "const rawAlias = raw;",
      "rawAlias.register(notCallable);",
      "let mixedPromise = raw;",
      'mixedPromise = import("node:worker_threads");',
      "const mixedApi = await mixedPromise;",
      "mixedApi.register(uncertainTarget);",
      "const rawBatch = Promise.all([raw]);",
      "const [notANamespace] = rawBatch;",
      "notANamespace.register(stillNotCallable);",
      "const computedPromise = import(computedTarget);",
      "const computedApi = await computedPromise;",
      "computedApi.register(computedRegisterTarget);",
    ].join("\n"),
  })).filter(({ loader }) => loader !== undefined);

  assertEquals(dependencies, [
    {
      kind: "dynamic-import",
      specifier: "node:module",
      loader: "import",
      line: 1,
    },
    {
      kind: "dynamic-import",
      specifier: "node:worker_threads",
      loader: "import",
      line: 5,
    },
    {
      kind: "unresolved-runtime-loader",
      specifier: undefined,
      loader: "runtime-loader-alias",
      line: 7,
    },
    {
      kind: "unresolved-runtime-loader",
      specifier: undefined,
      loader: "import",
      line: 11,
    },
  ]);
});

Deno.test("source collector never mutates promise facts while joining independent values", async (context) => {
  const branchOrders = [
    "p1 = flag ? p0 : p2;",
    "p1 = flag ? p2 : p0;",
  ];

  for (const [index, conditional] of branchOrders.entries()) {
    await context.step(`conditional order ${index + 1}`, () => {
      const dependencies = dependencySummary(collectSourceDependencies({
        path: `src/independent-promise-facts-${index}.ts`,
        content: [
          "let p0, p1, p2;",
          'p0 = import("node:fs");',
          'p0 = import("node:fs");',
          'p2 = import("node:module");',
          conditional,
          "const api = await p0;",
          'api.register("npm:must-not-be-inferred@1");',
        ].join("\n"),
      })).filter(({ kind }) => kind === "unresolved-runtime-loader");

      assertEquals(dependencies, []);
    });
  }

  await context.step("duplicate exact origins remain exact", () => {
    const dependencies = dependencySummary(collectSourceDependencies({
      path: "src/duplicate-exact-promise-origins.ts",
      content: [
        "let pending;",
        'pending = import("node:module");',
        'pending = import("node:module");',
        "const api = await pending;",
        "api.register(target);",
      ].join("\n"),
    })).filter(({ kind }) => kind === "unresolved-runtime-loader");

    assertEquals(dependencies, [{
      kind: "unresolved-runtime-loader",
      specifier: undefined,
      loader: "module.register",
      line: 5,
    }]);
  });

  await context.step(
    "derived unions cannot contaminate source or sibling facts",
    () => {
      const dependencies = dependencySummary(collectSourceDependencies({
        path: "src/promise-origin-siblings.ts",
        content: [
          "let source, left, right, other, union;",
          'source = import("node:fs");',
          "left = source;",
          "right = source;",
          'other = import("node:module");',
          "union = flag ? left : other;",
          "const sourceApi = await source;",
          "const siblingApi = await right;",
          'sourceApi.register("npm:source-contamination@1");',
          'siblingApi.register("npm:sibling-contamination@1");',
        ].join("\n"),
      })).filter(({ kind }) => kind === "unresolved-runtime-loader");

      assertEquals(dependencies, []);
    },
  );
});

Deno.test("source collector fails closed when loader-bearing promises cross unmodeled boundaries", async (context) => {
  const cases = [
    [
      "named return",
      'function load() { return import("node:module"); }\nload();',
      1,
    ],
    [
      "concise return",
      'const load = () => import("node:module");\nload();',
      1,
    ],
    [
      "iife return",
      'const api = await (function () { return import("node:module"); })();\napi.register(target);',
      1,
    ],
    [
      "call argument",
      'function consume(value) { return value; }\nconsume(import("node:module"));',
      2,
    ],
    [
      "container argument",
      'const box = { pending: import("node:module") };\nconsume(box);',
      2,
    ],
    [
      "array argument",
      'const values = [import("node:module")];\nconsume(values);',
      2,
    ],
    ["export", 'export const pending = import("node:module");', 1],
    [
      "batched export",
      'export const pending = Promise.all([import("node:module")]);',
      1,
    ],
    [
      "nested batched export",
      'export const pending = Promise.all([Promise.all([import("node:module")])]);',
      1,
    ],
    [
      "yield",
      'function* values() { yield import("node:module"); }',
      1,
    ],
    [
      "throw container",
      'const box = {};\nbox.pending = import("node:module");\nthrow box;',
      3,
    ],
    ["instance field", 'class Box { pending = import("node:module"); }', 1],
    [
      "static field",
      'class Box { static pending = import("node:module"); }',
      1,
    ],
    [
      "Promise.resolve boundary",
      'Promise.resolve(import("node:module"));',
      1,
    ],
    [
      "Promise.race boundary",
      'Promise.race([import("node:module")]);',
      1,
    ],
    [
      "then receiver boundary",
      'import("node:module").then((value) => value);',
      1,
    ],
  ] as const;

  for (const [name, content, line] of cases) {
    await context.step(name, () => {
      const dependencies = dependencySummary(collectSourceDependencies({
        path: `src/${name.replaceAll(" ", "-")}.ts`,
        content,
      })).filter(({ kind }) => kind === "unresolved-runtime-loader");
      const unresolved = {
        kind: "unresolved-runtime-loader",
        specifier: undefined,
        loader: "runtime-loader-alias",
        line,
      } as const;
      assertEquals(
        dependencies,
        [unresolved],
      );
    });
  }

  const localControls = dependencySummary(collectSourceDependencies({
    path: "src/local-promise-controls.ts",
    content: [
      'const pending = import("node:module");',
      "const alias = pending;",
      "const box = { pending: alias };",
      "const list = [box.pending];",
      "void list;",
      "await Promise.all([alias]);",
      'function loadFs() { return import("node:fs"); }',
      "loadFs();",
    ].join("\n"),
  })).filter(({ kind }) => kind === "unresolved-runtime-loader");
  assertEquals(localControls, []);
});

Deno.test("source collector resolves direct and nested promise-container projections", async (context) => {
  const exactCases = [
    [
      "direct index declaration",
      'const api = (await Promise.all([import("node:module")]))[0];\napi.register(target);',
      2,
    ],
    [
      "direct index call",
      '(await Promise.all([import("node:module")]))[0].register(target);',
      1,
    ],
    [
      "stored batch index",
      'const pending = Promise.all([import("node:module")]);\n(await pending)[0].register(target);',
      2,
    ],
    [
      "member batch index",
      'const box = { pending: Promise.all([import("node:module")]) };\n(await box.pending)[0].register(target);',
      2,
    ],
  ] as const;
  for (const [name, content, line] of exactCases) {
    await context.step(name, () => {
      const dependencies = dependencySummary(collectSourceDependencies({
        path: `src/${name.replaceAll(" ", "-")}.ts`,
        content,
      })).filter(({ loader }) => loader !== undefined);
      const dynamicImport = {
        kind: "dynamic-import" as const,
        specifier: "node:module",
        loader: "import",
        line: 1,
      };
      const registration = {
        kind: "unresolved-runtime-loader" as const,
        specifier: undefined,
        loader: "module.register",
        line,
      };
      assertEquals(
        dependencies,
        name === "direct index call"
          ? [registration, dynamicImport]
          : [dynamicImport, registration],
      );
    });
  }

  const nestedCases = [
    [
      "nested object",
      'const box = { nested: { pending: import("node:module") } };\nconst api = await box.nested.pending;\napi.register(target);',
      3,
    ],
    [
      "nested array",
      'const values = [[import("node:module")]];\nconst api = await values[0][0];\napi.register(target);',
      3,
    ],
    [
      "nested object destructuring",
      'const box = { nested: { pending: import("node:module") } };\nconst { nested: { pending } } = box;\nconst api = await pending;\napi.register(target);',
      4,
    ],
  ] as const;
  for (const [name, content, line] of nestedCases) {
    await context.step(name, () => {
      const unresolved = dependencySummary(collectSourceDependencies({
        path: `src/${name.replaceAll(" ", "-")}.ts`,
        content,
      })).filter(({ kind }) => kind === "unresolved-runtime-loader");
      assertEquals(unresolved, [{
        kind: "unresolved-runtime-loader",
        specifier: undefined,
        loader: "module.register",
        line,
      }]);
    });
  }

  assertEquals(
    dependencySummary(collectSourceDependencies({
      path: "src/nested-non-loader-promise.ts",
      content: 'const box = { nested: { pending: import("node:fs") } };',
    })).filter(({ kind }) => kind === "unresolved-runtime-loader"),
    [],
  );
});

Deno.test("source collector binds Promise.all projections through member targets and numeric patterns", () => {
  const dependencies = dependencySummary(collectSourceDependencies({
    path: "src/promise-all-pattern-projections.ts",
    content: [
      "const box = {};",
      '[box.api] = await Promise.all([import("node:module")]);',
      "box.api.register(memberTarget);",
      'const { 0: api } = await Promise.all([import("node:module")]);',
      "api.register(numericTarget);",
    ].join("\n"),
  })).filter(({ kind }) => kind === "unresolved-runtime-loader");

  assertEquals(dependencies, [
    {
      kind: "unresolved-runtime-loader",
      specifier: undefined,
      loader: "runtime-loader-alias",
      line: 2,
    },
    {
      kind: "unresolved-runtime-loader",
      specifier: undefined,
      loader: "module.register",
      line: 5,
    },
  ]);
});

Deno.test("source collector fails closed for indeterminate Promise.all projections", async (context) => {
  const cases = [
    [
      "array rest",
      'const [...apis] = await Promise.all([import("node:module")]);\napis[0].register(target);',
      "module.register",
      2,
    ],
    [
      "namespace object rest",
      'const [{ ...api }] = await Promise.all([import("node:module")]);\napi.register(target);',
      "runtime-loader-alias",
      2,
    ],
    [
      "computed member",
      'const api = (await Promise.all([import("node:module")]))[key];\napi.register(target);',
      "runtime-loader-alias",
      2,
    ],
    [
      "computed object pattern",
      'const { [key]: api } = await Promise.all([import("node:module")]);\napi.register(target);',
      "runtime-loader-alias",
      2,
    ],
    [
      "object rest",
      'const { ...apis } = await Promise.all([import("node:module")]);\napis[0].register(target);',
      "module.register",
      2,
    ],
  ] as const;

  for (const [name, content, loader, line] of cases) {
    await context.step(name, () => {
      const unresolved = dependencySummary(collectSourceDependencies({
        path: `src/${name.replaceAll(" ", "-")}.ts`,
        content,
      })).filter(({ kind }) => kind === "unresolved-runtime-loader");
      assertEquals(unresolved, [{
        kind: "unresolved-runtime-loader",
        specifier: undefined,
        loader,
        line,
      }]);
    });
  }

  assertEquals(
    dependencySummary(collectSourceDependencies({
      path: "src/non-loader-indeterminate-projection.ts",
      content:
        'const api = (await Promise.all([import("node:fs")]))[key];\napi.readFile(target);',
    })).filter(({ kind }) => kind === "unresolved-runtime-loader"),
    [],
  );
});

Deno.test("source collector transfers ordinary promise-container projections exhaustively", async (context) => {
  const cases = [
    [
      "object rest declaration",
      'const box = { pending: import("node:module") };\nconst { ...rest } = box;\nconst api = await rest.pending;\napi.register(target);',
      "module.register",
      4,
    ],
    [
      "array rest declaration",
      'const values = [import("node:module")];\nconst [...rest] = values;\nconst api = await rest[0];\napi.register(target);',
      "module.register",
      4,
    ],
    [
      "computed declaration",
      'const box = { pending: import("node:module") };\nconst pending = box[key];\nconst api = await pending;\napi.register(target);',
      "runtime-loader-alias",
      4,
    ],
    [
      "empty string property",
      'const box = { "": import("node:module") };\nconst pending = box[""];\nconst api = await pending;\napi.register(target);',
      "module.register",
      4,
    ],
    [
      "object rest assignment",
      'const box = { pending: import("node:module") };\nlet rest;\n({ ...rest } = box);\nconst api = await rest.pending;\napi.register(target);',
      "module.register",
      5,
    ],
    [
      "array rest assignment",
      'const values = [import("node:module")];\nlet rest;\n[...rest] = values;\nconst api = await rest[0];\napi.register(target);',
      "module.register",
      5,
    ],
    [
      "computed assignment",
      'const box = { pending: import("node:module") };\nlet pending;\n({ [key]: pending } = box);\nconst api = await pending;\napi.register(target);',
      "runtime-loader-alias",
      5,
    ],
  ] as const;

  for (const [name, content, loader, line] of cases) {
    await context.step(name, () => {
      const unresolved = dependencySummary(collectSourceDependencies({
        path: `src/${name.replaceAll(" ", "-")}.ts`,
        content,
      })).filter(({ kind }) => kind === "unresolved-runtime-loader");
      assertEquals(unresolved, [{
        kind: "unresolved-runtime-loader",
        specifier: undefined,
        loader,
        line,
      }]);
    });
  }

  assertEquals(
    dependencySummary(collectSourceDependencies({
      path: "src/local-computed-object-store.ts",
      content: 'const box = { [key]: import("node:module") };\nvoid box;',
    })).filter(({ kind }) => kind === "unresolved-runtime-loader"),
    [],
  );

  assertEquals(
    dependencySummary(collectSourceDependencies({
      path: "src/non-loader-ordinary-rest.ts",
      content:
        'const box = { pending: import("node:fs") };\nconst { ...rest } = box;\nconst api = await rest.pending;\napi.readFile(target);',
    })).filter(({ kind }) => kind === "unresolved-runtime-loader"),
    [],
  );
});

Deno.test("source collector widens joined and overwritten promise provenance to unknown", async (context) => {
  const cases = [
    [
      "conditional",
      'const pending = flag ? import("node:module") : external;\nconst api = await pending;\napi.register(target);',
      3,
    ],
    [
      "logical",
      'const pending = flag && import("node:module");\nconst api = await pending;\napi.register(target);',
      3,
    ],
    [
      "nullish",
      'const pending = external ?? import("node:module");\nconst api = await pending;\napi.register(target);',
      3,
    ],
    [
      "overwrite",
      'let pending = import("node:module");\npending = external;\nconst api = await pending;\napi.register(target);',
      4,
    ],
    [
      "update",
      'let pending = import("node:module");\npending++;\nconst api = await pending;\napi.register(target);',
      4,
    ],
    [
      "logical assignment",
      'let pending = external;\npending ||= import("node:module");\nconst api = await pending;\napi.register(target);',
      4,
    ],
    [
      "Promise.all input",
      'const [api] = await Promise.all([flag ? import("node:module") : external]);\napi.register(target);',
      2,
    ],
    [
      "object member",
      'const box = { pending: flag ? import("node:module") : external };\nconst api = await box.pending;\napi.register(target);',
      3,
    ],
  ] as const;

  for (const [name, content, line] of cases) {
    await context.step(name, () => {
      const collect = () =>
        dependencySummary(collectSourceDependencies({
          path: `src/${name.replaceAll(" ", "-")}.ts`,
          content,
        })).filter(({ kind }) => kind === "unresolved-runtime-loader");
      const unresolved = collect();
      assertEquals(unresolved, [{
        kind: "unresolved-runtime-loader",
        specifier: undefined,
        loader: "runtime-loader-alias",
        line,
      }]);
      assertEquals(collect(), unresolved);
    });
  }
});

Deno.test("source collector transfers promise provenance through loop targets and conditional containers", async (context) => {
  const cases = [
    [
      "for-of declaration",
      'const values = [import("node:module")];\nfor (const pending of values) {\n  const api = await pending;\n  api.register(target);\n}',
      "module.register",
      4,
    ],
    [
      "for-of assignment",
      'const values = [import("node:module")];\nlet pending;\nfor (pending of values) {\n  const api = await pending;\n  api.register(target);\n}',
      "module.register",
      5,
    ],
    [
      "for-await declaration",
      'const values = [import("node:module")];\nfor await (const api of values) {\n  api.register(target);\n}',
      "module.register",
      3,
    ],
    [
      "for-await assignment",
      'const values = [import("node:module")];\nlet api;\nfor await (api of values) {\n  api.register(target);\n}',
      "module.register",
      4,
    ],
    [
      "conditional object",
      'const box = flag ? { pending: import("node:module") } : external;\nconst { pending } = box;\nconst api = await pending;\napi.register(target);',
      "runtime-loader-alias",
      4,
    ],
    [
      "conditional array",
      'const values = flag ? [import("node:module")] : external;\nconst [pending] = values;\nconst api = await pending;\napi.register(target);',
      "runtime-loader-alias",
      4,
    ],
  ] as const;

  for (const [name, content, loader, line] of cases) {
    await context.step(name, () => {
      const unresolved = dependencySummary(collectSourceDependencies({
        path: `src/${name.replaceAll(" ", "-")}.ts`,
        content,
      })).filter(({ kind }) => kind === "unresolved-runtime-loader");
      assertEquals(unresolved, [{
        kind: "unresolved-runtime-loader",
        specifier: undefined,
        loader,
        line,
      }]);
    });
  }
});

Deno.test("source collector widens overridable assignment-pattern defaults", async (context) => {
  const cases = [
    [
      "parameter default",
      'async function load(pending = import("node:module")) {\n  const api = await pending;\n  api.register(target);\n}',
      3,
    ],
    [
      "object declaration default",
      'const { pending = import("node:module") } = source;\nconst api = await pending;\napi.register(target);',
      3,
    ],
    [
      "array declaration default",
      'const [pending = import("node:module")] = source;\nconst api = await pending;\napi.register(target);',
      3,
    ],
    [
      "object assignment default",
      'let pending;\n({ pending = import("node:module") } = source);\nconst api = await pending;\napi.register(target);',
      4,
    ],
    [
      "array assignment default",
      'let pending;\n[pending = import("node:module")] = source;\nconst api = await pending;\napi.register(target);',
      4,
    ],
  ] as const;

  for (const [name, content, line] of cases) {
    await context.step(name, () => {
      const collect = () =>
        dependencySummary(collectSourceDependencies({
          path: `src/default-${name.replaceAll(" ", "-")}.ts`,
          content,
        })).filter(({ kind }) => kind === "unresolved-runtime-loader");
      const expected = [{
        kind: "unresolved-runtime-loader" as const,
        specifier: undefined,
        loader: "runtime-loader-alias",
        line,
      }];
      assertEquals(collect(), expected);
      assertEquals(collect(), expected);
    });
  }
});

Deno.test("source collector transfers iterable element facts through every loop target", async (context) => {
  const exactCases = [
    [
      "local literal namespace",
      'const values = [await import("node:module")];\nfor (const api of values) api.register(target);',
      2,
    ],
    [
      "awaited values declaration",
      'const values = await Promise.all([import("node:module")]);\nfor (const api of values) api.register(target);',
      2,
    ],
    [
      "awaited values assignment",
      'const values = await Promise.all([import("node:module")]);\nlet api;\nfor (api of values) api.register(target);',
      3,
    ],
    [
      "awaited values for-await declaration",
      'const values = await Promise.all([import("node:module")]);\nfor await (const api of values) api.register(target);',
      2,
    ],
    [
      "awaited values for-await assignment",
      'const values = await Promise.all([import("node:module")]);\nlet api;\nfor await (api of values) api.register(target);',
      3,
    ],
    [
      "inline awaited values",
      'for (const api of await Promise.all([import("node:module")])) api.register(target);',
      1,
    ],
    [
      "nested array declaration target",
      'const batches = [await Promise.all([import("node:module")])];\nfor (const [api] of batches) api.register(target);',
      2,
    ],
    [
      "nested array assignment target",
      'const batches = [await Promise.all([import("node:module")])];\nlet api;\nfor ([api] of batches) api.register(target);',
      3,
    ],
    [
      "nested rest target",
      'const batches = [await Promise.all([import("node:module")])];\nfor (const [...apis] of batches) apis[0].register(target);',
      2,
    ],
    [
      "for-await nested Promise.all",
      'for await (const apis of [Promise.all([import("node:module")])]) apis[0].register(target);',
      1,
    ],
  ] as const;

  for (const [name, content, line] of exactCases) {
    await context.step(name, () => {
      const unresolved = dependencySummary(collectSourceDependencies({
        path: `src/loop-${name.replaceAll(" ", "-")}.ts`,
        content,
      })).filter(({ kind }) => kind === "unresolved-runtime-loader");
      assertEquals(unresolved, [{
        kind: "unresolved-runtime-loader",
        specifier: undefined,
        loader: "module.register",
        line,
      }]);
    });
  }

  const uncertainCases = [
    [
      "mixed awaited values",
      'const values = await Promise.all([import("node:module"), external]);\nfor (const api of values) api.register(target);',
    ],
    [
      "conflicting awaited values",
      'const values = await Promise.all([import("node:module"), import("node:worker_threads")]);\nfor (const api of values) api.register(target);',
    ],
    [
      "conditional iterable",
      'const values = flag ? await Promise.all([import("node:module")]) : external;\nfor (const api of values) api.register(target);',
    ],
  ] as const;
  for (const [name, content] of uncertainCases) {
    await context.step(name, () => {
      const unresolved = dependencySummary(collectSourceDependencies({
        path: `src/loop-${name.replaceAll(" ", "-")}.ts`,
        content,
      })).filter(({ kind }) => kind === "unresolved-runtime-loader");
      assertEquals(unresolved, [{
        kind: "unresolved-runtime-loader",
        specifier: undefined,
        loader: "runtime-loader-alias",
        line: 2,
      }]);
    });
  }

  for (
    const [name, content] of [
      [
        "non-loader awaited values",
        'const values = await Promise.all([import("node:fs")]);\nfor (const api of values) api.readFile(target);',
      ],
      [
        "ordinary benign values",
        "const values = [1, 2];\nfor (const value of values) consume(value);",
      ],
    ] as const
  ) {
    await context.step(name, () => {
      assertEquals(
        dependencySummary(collectSourceDependencies({
          path: `src/loop-${name.replaceAll(" ", "-")}.ts`,
          content,
        })).filter(({ kind }) => kind === "unresolved-runtime-loader"),
        [],
      );
    });
  }
});

Deno.test("source collector treats fresh literal construction as containment and reports real escapes", async (context) => {
  const exactCases = [
    [
      "array member use",
      'const values = [await import("node:module")];\nvalues[0].register(target);',
      2,
    ],
    [
      "object member use",
      'const box = { api: await import("node:module") };\nbox.api.register(target);',
      2,
    ],
  ] as const;
  for (const [name, content, line] of exactCases) {
    await context.step(name, () => {
      assertEquals(
        dependencySummary(collectSourceDependencies({
          path: `src/local-literal-${name.replaceAll(" ", "-")}.ts`,
          content,
        })).filter(({ kind }) => kind === "unresolved-runtime-loader"),
        [{
          kind: "unresolved-runtime-loader",
          specifier: undefined,
          loader: "module.register",
          line,
        }],
      );
    });
  }

  const escapeCases = [
    [
      "array argument",
      'const values = [await import("node:module")];\nconsume(values);',
      2,
    ],
    [
      "computed object argument",
      'const box = { [key]: await import("node:module") };\nconsume(box);',
      2,
    ],
    [
      "spread array argument",
      'const values = [await import("node:module")];\nconst copy = [...values];\nconsume(copy);',
      3,
    ],
  ] as const;
  for (const [name, content, line] of escapeCases) {
    await context.step(name, () => {
      assertEquals(
        dependencySummary(collectSourceDependencies({
          path: `src/local-literal-${name.replaceAll(" ", "-")}.ts`,
          content,
        })).filter(({ kind }) => kind === "unresolved-runtime-loader"),
        [{
          kind: "unresolved-runtime-loader",
          specifier: undefined,
          loader: "runtime-loader-alias",
          line,
        }],
      );
    });
  }
});

Deno.test("source collector joins scalar API facts across logical assignments", async (context) => {
  const cases = [
    [
      "require ||=",
      "let loader = external;\nloader ||= require;\nloader(target);",
      "require-alias",
    ],
    [
      "require &&=",
      "let loader = external;\nloader &&= require;\nloader(target);",
      "require-alias",
    ],
    [
      "require ??=",
      "let loader = external;\nloader ??= require;\nloader(target);",
      "require-alias",
    ],
    [
      "Function ||=",
      "let loader = external;\nloader ||= Function;\nloader(code);",
      "runtime-loader-alias",
    ],
    [
      "Function &&=",
      "let loader = external;\nloader &&= Function;\nloader(code);",
      "runtime-loader-alias",
    ],
    [
      "Function ??=",
      "let loader = external;\nloader ??= Function;\nloader(code);",
      "runtime-loader-alias",
    ],
    [
      "namespace ||=",
      "let api = external;\napi ||= globalThis;\napi.eval(code);",
      "runtime-loader-alias",
    ],
    [
      "namespace &&=",
      "let api = external;\napi &&= globalThis;\napi.eval(code);",
      "runtime-loader-alias",
    ],
    [
      "namespace ??=",
      "let api = external;\napi ??= globalThis;\napi.eval(code);",
      "runtime-loader-alias",
    ],
    [
      "conflicting facts",
      "let loader = require;\nloader ||= Function;\nloader(target);",
      "runtime-loader-alias",
    ],
  ] as const;

  for (const [name, content, loader] of cases) {
    await context.step(name, () => {
      const collect = () =>
        dependencySummary(collectSourceDependencies({
          path: `src/logical-api-${name.replaceAll(" ", "-")}.ts`,
          content,
        })).filter(({ kind }) => kind === "unresolved-runtime-loader");
      const expected = [{
        kind: "unresolved-runtime-loader" as const,
        specifier: undefined,
        loader,
        line: 3,
      }];
      assertEquals(collect(), expected);
      assertEquals(collect(), expected);
    });
  }

  assertEquals(
    dependencySummary(collectSourceDependencies({
      path: "src/benign-logical-api-assignments.ts",
      content: [
        "let value = external;",
        "value ||= fallback;",
        "value &&= alternate;",
        "value ??= finalValue;",
        "consume(value);",
      ].join("\n"),
    })).filter(({ kind }) => kind === "unresolved-runtime-loader"),
    [],
  );
});

Deno.test("source collector recursively transfers nested rest targets", async (context) => {
  const cases = [
    [
      "array rest declaration",
      'const values = [import("node:module")];\nconst [...[pending]] = values;\nconst api = await pending;\napi.register(target);',
      "module.register",
      4,
    ],
    [
      "array rest assignment",
      'const values = [import("node:module")];\nlet pending;\n[...[pending]] = values;\nconst api = await pending;\napi.register(target);',
      "module.register",
      5,
    ],
    [
      "object rest declaration",
      'const values = [import("node:module")];\nconst [...{ 0: pending }] = values;\nconst api = await pending;\napi.register(target);',
      "module.register",
      4,
    ],
    [
      "object rest assignment",
      'const values = [import("node:module")];\nlet pending;\n[...{ 0: pending }] = values;\nconst api = await pending;\napi.register(target);',
      "module.register",
      5,
    ],
    [
      "awaited API rest declaration",
      'const [...[api]] = await Promise.all([import("node:module")]);\napi.register(target);',
      "module.register",
      2,
    ],
    [
      "awaited API rest assignment",
      'let api;\n[...[api]] = await Promise.all([import("node:module")]);\napi.register(target);',
      "runtime-loader-alias",
      3,
    ],
    [
      "awaited API object rest",
      'const [...{ 0: api }] = await Promise.all([import("node:module")]);\napi.register(target);',
      "module.register",
      2,
    ],
  ] as const;

  for (const [name, content, loader, line] of cases) {
    await context.step(name, () => {
      const unresolved = dependencySummary(collectSourceDependencies({
        path: `src/nested-rest-${name.replaceAll(" ", "-")}.ts`,
        content,
      })).filter(({ kind }) => kind === "unresolved-runtime-loader");
      assertEquals(unresolved, [{
        kind: "unresolved-runtime-loader",
        specifier: undefined,
        loader,
        line,
      }]);
    });
  }

  assertEquals(
    dependencySummary(collectSourceDependencies({
      path: "src/benign-nested-rest.ts",
      content:
        'const values = [import("node:fs")];\nconst [...[pending]] = values;\nconst api = await pending;\napi.readFile(target);',
    })).filter(({ kind }) => kind === "unresolved-runtime-loader"),
    [],
  );
});

Deno.test("source collector invalidates exact API and promise member facts monotonically", async (context) => {
  const apiMemberCases = [
    ["plain assignment", "box[0] = external;", "runtime-loader-alias"],
    ["truthy logical and", "box[0] &&= external;", "runtime-loader-alias"],
    ["compound assignment", "box[0] += external;", "runtime-loader-alias"],
    ["update", "box[0]++;", "runtime-loader-alias"],
    ["delete", "delete box[0];", "runtime-loader-alias"],
    ["truthy logical or no-op", "box[0] ||= external;", "module.register"],
    ["non-nullish assignment no-op", "box[0] ??= external;", "module.register"],
  ] as const;
  for (const [name, mutation, loader] of apiMemberCases) {
    await context.step(`API member ${name}`, () => {
      const content = [
        'const box = await Promise.all([import("node:module")]);',
        mutation,
        "box[0].register(target);",
      ].join("\n");
      const collect = () =>
        dependencySummary(collectSourceDependencies({
          path: `src/api-member-${name.replaceAll(" ", "-")}.ts`,
          content,
        })).filter(({ kind }) => kind === "unresolved-runtime-loader");
      const expected = [{
        kind: "unresolved-runtime-loader" as const,
        specifier: undefined,
        loader,
        line: 3,
      }];
      assertEquals(collect(), expected);
      assertEquals(collect(), expected);
    });
  }

  const promiseMemberCases = [
    ["plain assignment", "box[0] = external;", "runtime-loader-alias"],
    ["truthy logical and", "box[0] &&= external;", "runtime-loader-alias"],
    ["compound assignment", "box[0] += external;", "runtime-loader-alias"],
    ["update", "box[0]++;", "runtime-loader-alias"],
    ["delete", "delete box[0];", "runtime-loader-alias"],
    ["truthy logical or no-op", "box[0] ||= external;", "module.register"],
    ["non-nullish assignment no-op", "box[0] ??= external;", "module.register"],
  ] as const;
  for (const [name, mutation, loader] of promiseMemberCases) {
    await context.step(`promise member ${name}`, () => {
      const content = [
        'const box = [import("node:module")];',
        mutation,
        "const api = await box[0];",
        "api.register(target);",
      ].join("\n");
      const collect = () =>
        dependencySummary(collectSourceDependencies({
          path: `src/promise-member-${name.replaceAll(" ", "-")}.ts`,
          content,
        })).filter(({ kind }) => kind === "unresolved-runtime-loader");
      const expected = [{
        kind: "unresolved-runtime-loader" as const,
        specifier: undefined,
        loader,
        line: 4,
      }];
      assertEquals(collect(), expected);
      assertEquals(collect(), expected);
    });
  }

  for (
    const [name, operator, loader] of [
      ["scalar logical and", "&&=", "runtime-loader-alias"],
      ["scalar logical or no-op", "||=", "module.register"],
      ["scalar non-nullish no-op", "??=", "module.register"],
    ] as const
  ) {
    await context.step(name, () => {
      const unresolved = dependencySummary(collectSourceDependencies({
        path: `src/${name.replaceAll(" ", "-")}.ts`,
        content:
          `let pending = import("node:module");\npending ${operator} external;\nconst api = await pending;\napi.register(target);`,
      })).filter(({ kind }) => kind === "unresolved-runtime-loader");
      assertEquals(unresolved, [{
        kind: "unresolved-runtime-loader",
        specifier: undefined,
        loader,
        line: 4,
      }]);
    });
  }

  assertEquals(
    dependencySummary(collectSourceDependencies({
      path: "src/benign-member-mutations.ts",
      content: [
        "const box = [1];",
        "box[0] = external;",
        "box[0] &&= external;",
        "box[0] += 1;",
        "box[0]++;",
        "delete box[0];",
      ].join("\n"),
    })).filter(({ kind }) => kind === "unresolved-runtime-loader"),
    [],
  );
});

Deno.test("source collector fails closed for loop member assignment targets", async (context) => {
  const cases = [
    [
      "raw promise owned target",
      'const values = [import("node:module")];\nconst box = {};\nfor (box.pending of values) {}',
      3,
    ],
    [
      "raw promise global target",
      'const values = [import("node:module")];\nfor (globalThis.pending of values) {}',
      2,
    ],
    [
      "resolved API owned target",
      'const values = [import("node:module")];\nconst box = {};\nfor await (box.api of values) {}',
      3,
    ],
    [
      "resolved API global target",
      'const values = [import("node:module")];\nfor await (globalThis.api of values) {}',
      2,
    ],
    [
      "awaited values owned target",
      'const values = await Promise.all([import("node:module")]);\nconst box = {};\nfor (box.api of values) {}',
      3,
    ],
    [
      "awaited values global target",
      'const values = await Promise.all([import("node:module")]);\nfor (globalThis.api of values) {}',
      2,
    ],
    [
      "nested Promise.all owned target",
      'const box = {};\nfor await (box.apis of [Promise.all([import("node:module")])]) {}',
      2,
    ],
  ] as const;

  for (const [name, content, line] of cases) {
    await context.step(name, () => {
      const unresolved = dependencySummary(collectSourceDependencies({
        path: `src/loop-member-${name.replaceAll(" ", "-")}.ts`,
        content,
      })).filter(({ kind }) => kind === "unresolved-runtime-loader");
      assertEquals(unresolved, [{
        kind: "unresolved-runtime-loader",
        specifier: undefined,
        loader: "runtime-loader-alias",
        line,
      }]);
    });
  }
});

Deno.test("source collector shares member mutation state across container aliases", async (context) => {
  const cases = [
    [
      "resolved alias mutates original reads",
      'const box = await Promise.all([import("node:module")]);\nconst alias = box;\nalias[0] = external;\nbox[0].register(target);',
      4,
    ],
    [
      "resolved original mutates alias reads",
      'const box = await Promise.all([import("node:module")]);\nconst alias = box;\nbox[0] = external;\nalias[0].register(target);',
      4,
    ],
    [
      "resolved mutation precedes alias",
      'const box = await Promise.all([import("node:module")]);\nbox[0] = external;\nconst alias = box;\nalias[0].register(target);',
      4,
    ],
    [
      "resolved alias chain",
      'const box = await Promise.all([import("node:module")]);\nconst first = box;\nconst second = first;\nsecond[0] = external;\nbox[0].register(target);',
      5,
    ],
    [
      "resolved destructured alias",
      'const box = await Promise.all([import("node:module")]);\nconst [alias] = [box];\nalias[0] = external;\nbox[0].register(target);',
      4,
    ],
    [
      "promise alias mutates original reads",
      'const box = [import("node:module")];\nconst alias = box;\nalias[0] = external;\nconst api = await box[0];\napi.register(target);',
      5,
    ],
    [
      "promise original mutates alias reads",
      'const box = [import("node:module")];\nconst alias = box;\nbox[0] = external;\nconst api = await alias[0];\napi.register(target);',
      5,
    ],
    [
      "computed alias mutation",
      'const box = await Promise.all([import("node:module"), import("node:fs")]);\nconst alias = box;\nalias[key] = external;\nbox[0].register(target);',
      4,
    ],
  ] as const;

  for (const [name, content, line] of cases) {
    await context.step(name, () => {
      const collect = () =>
        dependencySummary(collectSourceDependencies({
          path: `src/shared-container-${name.replaceAll(" ", "-")}.ts`,
          content,
        })).filter(({ kind }) => kind === "unresolved-runtime-loader");
      const expected = [{
        kind: "unresolved-runtime-loader" as const,
        specifier: undefined,
        loader: "runtime-loader-alias",
        line,
      }];
      assertEquals(collect(), expected);
      assertEquals(collect(), expected);
    });
  }

  const benign = () =>
    dependencySummary(collectSourceDependencies({
      path: "src/shared-benign-container.ts",
      content:
        'const box = await Promise.all([import("node:fs")]);\nconst alias = box;\nalias[0] = external;\nbox[0].readFile(target);',
    })).filter(({ kind }) => kind === "unresolved-runtime-loader");
  assertEquals(benign(), []);
  assertEquals(benign(), []);

  await context.step("mutable points-to union", () => {
    const collect = () =>
      dependencySummary(collectSourceDependencies({
        path: "src/shared-container-points-to-union.ts",
        content: [
          'const left = await Promise.all([import("node:module")]);',
          'const right = await Promise.all([import("node:module")]);',
          "let selected = flag ? left : right;",
          "selected[0] = external;",
          "left[0].register(first);",
          "right[0].register(second);",
        ].join("\n"),
      })).filter(({ kind }) => kind === "unresolved-runtime-loader");
    const expected = [5, 6].map((line) => ({
      kind: "unresolved-runtime-loader" as const,
      specifier: undefined,
      loader: "runtime-loader-alias",
      line,
    }));
    assertEquals(collect(), expected);
    assertEquals(collect(), expected);
  });
});

Deno.test("source collector applies strong local slot updates only on definite paths", async (context) => {
  const collect = (name: string, content: string) =>
    dependencySummary(collectSourceDependencies({
      path: `src/strong-slot-${name}.ts`,
      content,
    })).filter(({ kind }) => kind === "unresolved-runtime-loader");
  const benign = "const benign = { register(value) { consume(value); } };";

  await context.step("definite overwrite", () => {
    assertEquals(
      collect(
        "definite",
        [
          benign,
          'const box = await Promise.all([import("node:module")]);',
          "box[0] = benign;",
          "box[0].register(target);",
        ].join("\n"),
      ),
      [],
    );
  });

  await context.step("definite overwrite through alias", () => {
    assertEquals(
      collect(
        "alias",
        [
          benign,
          'const box = await Promise.all([import("node:module")]);',
          "const alias = box;",
          "alias[0] = benign;",
          "box[0].register(target);",
        ].join("\n"),
      ),
      [],
    );
  });

  await context.step("use before overwrite", () => {
    assertEquals(
      collect(
        "prior-use",
        [
          benign,
          'const box = await Promise.all([import("node:module")]);',
          "box[0].register(before);",
          "box[0] = benign;",
          "box[0].register(after);",
        ].join("\n"),
      ),
      [{
        kind: "unresolved-runtime-loader",
        specifier: undefined,
        loader: "module.register",
        line: 3,
      }],
    );
  });

  for (
    const [name, write, loader] of [
      [
        "conditional",
        "if (flag) box[0] = benign;",
        "runtime-loader-alias",
      ],
      ["loop", "while (flag) box[0] = benign;", "module.register"],
      [
        "conditional expression",
        "flag ? box[0] = benign : undefined;",
        "runtime-loader-alias",
      ],
      [
        "logical expression",
        "flag && (box[0] = benign);",
        "runtime-loader-alias",
      ],
      [
        "switch",
        "switch (value) { case 1: box[0] = benign; break; }",
        "module.register",
      ],
      [
        "try",
        "try { box[0] = benign; mayThrow(); } catch {}",
        "module.register",
      ],
    ] as const
  ) {
    await context.step(`${name} overwrite`, () => {
      assertEquals(
        collect(
          name,
          [
            benign,
            'const box = await Promise.all([import("node:module")]);',
            write,
            "box[0].register(target);",
          ].join("\n"),
        ),
        [{
          kind: "unresolved-runtime-loader",
          specifier: undefined,
          loader,
          line: 4,
        }],
      );
    });
  }

  await context.step("unknown overwrite remains fail closed", () => {
    assertEquals(
      collect(
        "unknown",
        [
          'const box = await Promise.all([import("node:module")]);',
          "box[0] = external;",
          "box[0].register(target);",
        ].join("\n"),
      ),
      [{
        kind: "unresolved-runtime-loader",
        specifier: undefined,
        loader: "runtime-loader-alias",
        line: 3,
      }],
    );
  });

  for (
    const [name, preparation] of [
      ["escaped owner", "consume(box);"],
      ["prototype operation", "Object.setPrototypeOf(box, proto);"],
      [
        "descriptor operation",
        'Object.defineProperty(box, "0", { value: benign });',
      ],
    ] as const
  ) {
    await context.step(name, () => {
      assertEquals(
        collect(
          name.replaceAll(" ", "-"),
          [
            benign,
            'const box = await Promise.all([import("node:module")]);',
            preparation,
            "box[0] = benign;",
            "box[0].register(target);",
          ].join("\n"),
        ),
        [3, 5].map((line) => ({
          kind: "unresolved-runtime-loader" as const,
          specifier: undefined,
          loader: "runtime-loader-alias",
          line,
        })),
      );
    });
  }

  await context.step(
    "cross-function mutation is never strongly refined",
    () => {
      assertEquals(
        collect(
          "cross-function",
          [
            benign,
            'const box = await Promise.all([import("node:module")]);',
            "function replace() { box[0] = benign; }",
            "if (flag) replace();",
            "box[0].register(target);",
          ].join("\n"),
        ),
        [{
          kind: "unresolved-runtime-loader",
          specifier: undefined,
          loader: "module.register",
          line: 5,
        }],
      );
    },
  );
});

Deno.test("source collector keeps strong slot facts sound across control-flow boundaries", async (context) => {
  const cases = [
    {
      name: "loop back edge",
      content: [
        'import * as api from "node:module";',
        "const benign = { register(_value) {} };",
        "const box = [benign];",
        "for (let index = 0; index < 2; index++) {",
        '  box[0].register("npm:loop-backedge@1");',
        "  box[0] = api;",
        "}",
      ].join("\n"),
      line: 5,
      specifier: "npm:loop-backedge@1",
    },
    {
      name: "switch fallthrough",
      content: [
        'import * as api from "node:module";',
        "const benign = { register(_value) {} };",
        "const box = [benign];",
        "switch (mode) {",
        "  case 1: box[0] = api;",
        '  case 2: box[0].register("npm:switch-fallthrough@1");',
        "}",
      ].join("\n"),
      line: 6,
      specifier: "npm:switch-fallthrough@1",
    },
    {
      name: "catch receives thrown state",
      content: [
        'import * as api from "node:module";',
        "const benign = { register(_value) {} };",
        "const box = [benign];",
        "try {",
        "  box[0] = api;",
        "  throw 0;",
        "} catch {",
        '  box[0].register("npm:catch-state@1");',
        "}",
      ].join("\n"),
      line: 8,
      specifier: "npm:catch-state@1",
    },
    {
      name: "abrupt completion before finally",
      content: [
        'import * as api from "node:module";',
        "const benign = { register(_value) {} };",
        "function run() {",
        "  const box = [benign];",
        "  try {",
        "    box[0] = api;",
        "    return;",
        "    box[0] = benign;",
        "  } finally {",
        '    box[0].register("npm:return-finally@1");',
        "  }",
        "}",
        "run();",
      ].join("\n"),
      line: 10,
      specifier: "npm:return-finally@1",
    },
  ] as const;

  for (const { name, content, line, specifier } of cases) {
    await context.step(name, () => {
      const unresolved = dependencySummary(collectSourceDependencies({
        path: `src/control-flow-${name.replaceAll(" ", "-")}.ts`,
        content,
      })).filter(({ kind }) =>
        kind === "runtime-loader" || kind === "unresolved-runtime-loader"
      );
      assertEquals(unresolved, [{
        kind: "runtime-loader",
        specifier,
        loader: "module.register",
        line,
      }]);
    });
  }
});

Deno.test("source collector treats unmodeled receiver and syntax invocations as capability boundaries", async (context) => {
  await context.step("container receiver", () => {
    const unresolved = dependencySummary(collectSourceDependencies({
      path: "src/container-receiver-boundary.ts",
      content: [
        'import * as api from "node:module";',
        "const benign = { register(_value) {} };",
        "const box = [benign, api];",
        "box.reverse();",
        'box[0].register("npm:receiver-mutation@1");',
      ].join("\n"),
    })).filter(({ kind }) => kind === "unresolved-runtime-loader");
    assertEquals(unresolved, [{
      kind: "unresolved-runtime-loader",
      specifier: undefined,
      loader: "runtime-loader-alias",
      line: 4,
    }]);
  });

  await context.step("tagged template", () => {
    const unresolved = dependencySummary(collectSourceDependencies({
      path: "src/tagged-template-boundary.ts",
      content: [
        'import { register } from "node:module";',
        "function invoke(_parts, loader) {",
        '  loader("npm:tagged-template@1");',
        "}",
        "invoke`${register}`;",
      ].join("\n"),
    })).filter(({ kind }) => kind === "unresolved-runtime-loader");
    assertEquals(unresolved, [{
      kind: "unresolved-runtime-loader",
      specifier: undefined,
      loader: "runtime-loader-alias",
      line: 5,
    }]);
  });

  await context.step("JSX property", () => {
    const unresolved = dependencySummary(collectSourceDependencies({
      path: "src/jsx-capability-boundary.tsx",
      content: [
        'import { register } from "node:module";',
        "function Component({ loader }) {",
        '  loader("npm:jsx-property@1");',
        "  return null;",
        "}",
        "const view = <Component loader={register} />;",
      ].join("\n"),
    })).filter(({ kind }) => kind === "unresolved-runtime-loader");
    assertEquals(unresolved, [{
      kind: "unresolved-runtime-loader",
      specifier: undefined,
      loader: "runtime-loader-alias",
      line: 6,
    }]);
  });
});

Deno.test("source collector reports default capabilities flowing into member targets once", async (context) => {
  const cases = [
    [
      "assignment API",
      "const box = {};\n({ value: box.load = require } = source);",
      "require-alias",
      2,
    ],
    [
      "assignment promise",
      'const box = {};\n({ value: box.load = import("node:module") } = source);',
      "runtime-loader-alias",
      2,
    ],
    [
      "nested assignment",
      "const box = {};\n({ value: [box.load = require] } = source);",
      "require-alias",
      2,
    ],
    [
      "rest assignment",
      "const box = {};\n[...[box.load = require]] = source;",
      "require-alias",
      2,
    ],
    [
      "loop API",
      "const box = {};\nfor ([box.load = require] of source) {}",
      "require-alias",
      2,
    ],
    [
      "loop promise",
      'const box = {};\nfor ([box.load = import("node:module")] of source) {}',
      "runtime-loader-alias",
      2,
    ],
    [
      "nested loop",
      "const box = {};\nfor ({ value: [box.load = require] } of source) {}",
      "require-alias",
      2,
    ],
    [
      "rest loop",
      "const box = {};\nfor ([...[box.load = require]] of source) {}",
      "require-alias",
      2,
    ],
    [
      "computed assignment",
      "const box = {};\n({ value: box[key] = require } = source);",
      "require-alias",
      2,
    ],
    [
      "global loop",
      'for ([globalThis.load = import("node:module")] of source) {}',
      "runtime-loader-alias",
      1,
    ],
    [
      "unbound assignment API",
      "({ value: missing = require } = source);",
      "require-alias",
      1,
    ],
    [
      "unbound assignment promise",
      '({ value: missing = import("node:module") } = source);',
      "runtime-loader-alias",
      1,
    ],
    [
      "unbound loop API",
      "for ([missing = require] of source) {}",
      "require-alias",
      1,
    ],
    [
      "unbound loop promise",
      'for ([missing = import("node:module")] of source) {}',
      "runtime-loader-alias",
      1,
    ],
  ] as const;

  for (const [name, content, loader, line] of cases) {
    await context.step(name, () => {
      const collect = () =>
        dependencySummary(collectSourceDependencies({
          path: `src/member-default-${name.replaceAll(" ", "-")}.ts`,
          content,
        })).filter(({ kind }) => kind === "unresolved-runtime-loader");
      const expected = [{
        kind: "unresolved-runtime-loader" as const,
        specifier: undefined,
        loader,
        line,
      }];
      assertEquals(collect(), expected);
      assertEquals(collect(), expected);
    });
  }

  await context.step("declaration controls", () => {
    assertEquals(
      dependencySummary(collectSourceDependencies({
        path: "src/declaration-default-controls.ts",
        content: [
          "const { value: [load = require] } = source;",
          "load(target);",
          'const [...[pending = import("node:module")]] = source;',
          "const api = await pending;",
          "api.register(target);",
        ].join("\n"),
      })).filter(({ kind }) => kind === "unresolved-runtime-loader"),
      [
        {
          kind: "unresolved-runtime-loader",
          specifier: undefined,
          loader: "require-alias",
          line: 2,
        },
        {
          kind: "unresolved-runtime-loader",
          specifier: undefined,
          loader: "runtime-loader-alias",
          line: 5,
        },
      ],
    );
  });

  assertEquals(
    dependencySummary(collectSourceDependencies({
      path: "src/benign-member-default.ts",
      content: "const box = {};\n({ value: box.load = fallback } = source);",
    })).filter(({ kind }) => kind === "unresolved-runtime-loader"),
    [],
  );
  assertEquals(
    dependencySummary(collectSourceDependencies({
      path: "src/benign-unbound-default.ts",
      content: "({ value: missing = fallback } = source);",
    })).filter(({ kind }) => kind === "unresolved-runtime-loader"),
    [],
  );
});

Deno.test("source collector projects and mutates bounded nested resolved containers", async (context) => {
  const exactCases = [
    [
      "object direct",
      'const box = { inner: await Promise.all([import("node:module")]) };\nbox.inner[0].register(target);',
      2,
    ],
    [
      "array direct",
      'const box = [await Promise.all([import("node:module")])];\nbox[0][0].register(target);',
      2,
    ],
    [
      "object nested pattern",
      'const box = { inner: await Promise.all([import("node:module")]) };\nconst { inner: [api] } = box;\napi.register(target);',
      3,
    ],
    [
      "nested rest pattern",
      'const box = { inner: await Promise.all([import("node:module")]) };\nconst { inner: [...apis] } = box;\napis[0].register(target);',
      3,
    ],
    [
      "deep direct",
      'const box = { outer: { inner: await Promise.all([import("node:module")]) } };\nbox.outer.inner[0].register(target);',
      2,
    ],
    [
      "nested Promise.all pattern",
      'const [[api]] = await Promise.all([Promise.all([import("node:module")])]);\napi.register(target);',
      2,
    ],
    [
      "late assignment into literal",
      'let batch;\nbatch = await Promise.all([import("node:module")]);\nconst box = { inner: batch };\nbox.inner[0].register(target);',
      4,
    ],
    [
      "loop binding into literal",
      'const batches = [await Promise.all([import("node:module")])];\nfor (const batch of batches) {\n  const box = { inner: batch };\n  box.inner[0].register(target);\n}',
      4,
    ],
    [
      "late raw promise into literal",
      'let pending;\npending = import("node:module");\nconst box = { pending };\nconst api = await box.pending;\napi.register(target);',
      5,
    ],
  ] as const;

  for (const [name, content, line] of exactCases) {
    await context.step(name, () => {
      const collect = () =>
        dependencySummary(collectSourceDependencies({
          path: `src/nested-resolved-${name.replaceAll(" ", "-")}.ts`,
          content,
        })).filter(({ kind }) => kind === "unresolved-runtime-loader");
      const expected = [{
        kind: "unresolved-runtime-loader" as const,
        specifier: undefined,
        loader: "module.register",
        line,
      }];
      assertEquals(collect(), expected);
      assertEquals(collect(), expected);
    });
  }

  const mutationCases = [
    [
      "nested mutation then extraction",
      'const box = { inner: await Promise.all([import("node:module")]) };\nbox.inner[0] = external;\nconst { inner: [api] } = box;\napi.register(target);',
      4,
    ],
    [
      "nested alias mutation",
      'const box = { inner: await Promise.all([import("node:module")]) };\nconst alias = box;\nalias.inner[0] = external;\nbox.inner[0].register(target);',
      4,
    ],
    [
      "projected nested alias mutation",
      'const box = { inner: await Promise.all([import("node:module")]) };\nconst inner = box.inner;\ninner[0] = external;\nbox.inner[0].register(target);',
      4,
    ],
    [
      "nested references survive outer rest",
      'const inner = await Promise.all([import("node:module")]);\nconst source = [inner];\nconst [...rest] = source;\nrest[0][0] = external;\nsource[0][0].register(target);',
      5,
    ],
  ] as const;
  for (const [name, content, line] of mutationCases) {
    await context.step(name, () => {
      const collect = () =>
        dependencySummary(collectSourceDependencies({
          path: `src/nested-resolved-${name.replaceAll(" ", "-")}.ts`,
          content,
        })).filter(({ kind }) => kind === "unresolved-runtime-loader");
      const expected = [{
        kind: "unresolved-runtime-loader" as const,
        specifier: undefined,
        loader: "runtime-loader-alias",
        line,
      }];
      assertEquals(collect(), expected);
      assertEquals(collect(), expected);
    });
  }

  await context.step("rest creates a fresh outer container", () => {
    const collect = () =>
      dependencySummary(collectSourceDependencies({
        path: "src/nested-resolved-fresh-rest.ts",
        content: [
          'const source = await Promise.all([import("node:module")]);',
          "const [...rest] = source;",
          "rest[0] = external;",
          "source[0].register(target);",
        ].join("\n"),
      })).filter(({ kind }) => kind === "unresolved-runtime-loader");
    const expected = [{
      kind: "unresolved-runtime-loader" as const,
      specifier: undefined,
      loader: "module.register",
      line: 4,
    }];
    assertEquals(collect(), expected);
    assertEquals(collect(), expected);
  });

  await context.step("computed nested projection", () => {
    const collect = () =>
      dependencySummary(collectSourceDependencies({
        path: "src/nested-resolved-computed.ts",
        content:
          'const box = { inner: await Promise.all([import("node:module")]) };\nbox.inner[key].register(target);',
      })).filter(({ kind }) => kind === "unresolved-runtime-loader");
    const expected = [{
      kind: "unresolved-runtime-loader" as const,
      specifier: undefined,
      loader: "runtime-loader-alias",
      line: 2,
    }];
    assertEquals(collect(), expected);
    assertEquals(collect(), expected);
  });

  assertEquals(
    dependencySummary(collectSourceDependencies({
      path: "src/benign-nested-resolved-container.ts",
      content:
        'const box = { inner: await Promise.all([import("node:fs")]) };\nbox.inner[0].readFile(target);',
    })).filter(({ kind }) => kind === "unresolved-runtime-loader"),
    [],
  );
});

Deno.test("source collector treats logical promise member assignments as boundaries", async (context) => {
  for (const operator of ["||=", "&&=", "??="] as const) {
    await context.step(operator, () => {
      const unresolved = dependencySummary(collectSourceDependencies({
        path: `src/logical-member-${operator.slice(0, -1)}.ts`,
        content:
          `const box = {};\nbox.pending ${operator} import("node:module");\nvoid box.pending;`,
      })).filter(({ kind }) => kind === "unresolved-runtime-loader");
      assertEquals(unresolved, [{
        kind: "unresolved-runtime-loader",
        specifier: undefined,
        loader: "runtime-loader-alias",
        line: 2,
      }]);
    });
  }
});

Deno.test("source collector keeps direct local promise stores exact and rejects unowned stores", async (context) => {
  await context.step("unknown-only local member stays clean", () => {
    const unresolved = dependencySummary(collectSourceDependencies({
      path: "src/unknown-only-local-promise-store.ts",
      content: [
        "const box = {};",
        "box.pending = external;",
        "consume(box.pending);",
      ].join("\n"),
    })).filter(({ kind }) => kind === "unresolved-runtime-loader");

    assertEquals(unresolved, []);
  });

  await context.step("direct local member", () => {
    const dependencies = dependencySummary(collectSourceDependencies({
      path: "src/direct-local-promise-store.ts",
      content: [
        "const box = {};",
        'box.pending = import("node:module");',
        "void box.pending;",
        "const api = await box.pending;",
        "api.register(target);",
      ].join("\n"),
    })).filter(({ loader }) => loader !== undefined);

    assertEquals(dependencies, [
      {
        kind: "dynamic-import",
        specifier: "node:module",
        loader: "import",
        line: 2,
      },
      {
        kind: "unresolved-runtime-loader",
        specifier: undefined,
        loader: "module.register",
        line: 5,
      },
    ]);
  });

  const unownedStores = [
    [
      "unknown computed",
      'const box = {};\nbox[key] = import("node:module");',
      2,
    ],
    [
      "nested member",
      'const box = {};\nbox.inner.pending = import("node:module");',
      2,
    ],
    [
      "wrapped member",
      'const box = {};\n(box.pending as unknown) = import("node:module");',
      2,
    ],
    [
      "parameter owner",
      'function attach(box: Record<string, unknown>) {\n  box.pending = import("node:module");\n}',
      2,
    ],
    [
      "imported owner",
      'import { box } from "./box.ts";\nbox.pending = import("node:module");',
      2,
    ],
    [
      "factory owner",
      'const box = getBox();\nbox.pending = import("node:module");',
      2,
    ],
    [
      "global alias owner",
      'const box = globalThis;\nbox.pending = import("node:module");',
      2,
    ],
    [
      "escaped local allocation",
      'const box = {};\nconsume(box);\nbox.pending = import("node:module");',
      2,
    ],
    [
      "inline exported owner",
      'export const box = {};\nbox.pending = import("node:module");',
      2,
    ],
    [
      "setter owner",
      'const box = { set pending(value) { consume(value); } };\nbox.pending = import("node:module");',
      2,
    ],
    [
      "custom prototype owner",
      'const box = { __proto__: externalPrototype };\nbox.pending = import("node:module");',
      2,
    ],
    [
      "prototype mutated after initialization",
      [
        "const proto = { set pending(value) { consume(value); } };",
        "const box = {};",
        "box.__proto__ = proto;",
        'box.pending = import("node:module");',
      ].join("\n"),
      4,
    ],
    [
      "prototype mutated through alias",
      [
        "const proto = { set pending(value) { consume(value); } };",
        "const box = {};",
        "const alias = box;",
        "alias.__proto__ = proto;",
        'box.pending = import("node:module");',
      ].join("\n"),
      5,
    ],
    ["external owner", 'globalThis.pending = import("node:module");', 1],
  ] as const;
  for (const [name, content, line] of unownedStores) {
    await context.step(name, () => {
      const unresolved = dependencySummary(collectSourceDependencies({
        path: `src/${name.replaceAll(" ", "-")}.ts`,
        content,
      })).filter(({ kind }) => kind === "unresolved-runtime-loader");
      assertEquals(unresolved, [{
        kind: "unresolved-runtime-loader",
        specifier: undefined,
        loader: "runtime-loader-alias",
        line,
      }]);
    });
  }

  await context.step("local allocation alias", () => {
    assertEquals(
      dependencySummary(collectSourceDependencies({
        path: "src/local-allocation-alias.ts",
        content:
          'const box = {};\nconst alias = box;\nalias.pending = import("node:module");',
      })).filter(({ kind }) => kind === "unresolved-runtime-loader"),
      [],
    );
  });

  await context.step("null prototype data owner", () => {
    const dependencies = dependencySummary(collectSourceDependencies({
      path: "src/null-prototype-data-owner.ts",
      content: [
        "const box = { __proto__: null };",
        'box.pending = import("node:module");',
        "const api = await box.pending;",
        "api.register(target);",
      ].join("\n"),
    })).filter(({ kind }) => kind === "unresolved-runtime-loader");

    assertEquals(dependencies, [{
      kind: "unresolved-runtime-loader",
      specifier: undefined,
      loader: "module.register",
      line: 4,
    }]);
  });
});

Deno.test("source collector walks transparent wrappers before classifying namespace writes", () => {
  const dependencies = dependencySummary(collectSourceDependencies({
    path: "src/wrapped-computed-namespace-writes.ts",
    content: [
      "(globalThis[key] as any) = 1;",
      "globalThis[key]! = 1;",
      "delete (globalThis[key] as any);",
      "(globalThis[key] as any) += 1;",
      "(globalThis[key] as any) != null;",
    ].join("\n"),
  })).filter(({ kind }) => kind === "unresolved-runtime-loader");

  assertEquals(dependencies, [
    {
      kind: "unresolved-runtime-loader",
      specifier: undefined,
      loader: "runtime-loader-alias",
      line: 4,
    },
    {
      kind: "unresolved-runtime-loader",
      specifier: undefined,
      loader: "runtime-loader-alias",
      line: 5,
    },
  ]);
});

Deno.test("production file collection covers every supported extension and excludes non-production descendants", async () => {
  const root = await Deno.makeTempDir();
  try {
    for (
      const extension of ["ts", "tsx", "mts", "cts", "js", "jsx", "mjs", "cjs"]
    ) {
      await Deno.mkdir(`${root}/src/runtime`, { recursive: true });
      await Deno.writeTextFile(
        `${root}/src/runtime/example.${extension}`,
        "export {};\n",
      );
    }
    await Deno.mkdir(`${root}/src/__fixtures__`, { recursive: true });
    await Deno.mkdir(`${root}/src/testing`, { recursive: true });
    await Deno.mkdir(`${root}/cli/templates/files/example`, {
      recursive: true,
    });
    await Deno.writeTextFile(
      `${root}/src/runtime/example.test.ts`,
      "export {};\n",
    );
    await Deno.writeTextFile(
      `${root}/src/runtime/example_test.ts`,
      "export {};\n",
    );
    await Deno.writeTextFile(
      `${root}/src/runtime/example_test.tsx`,
      "export {};\n",
    );
    await Deno.writeTextFile(
      `${root}/src/__fixtures__/ignored.ts`,
      "export {};\n",
    );
    await Deno.writeTextFile(`${root}/src/testing/bdd.ts`, "export {};\n");
    await Deno.writeTextFile(
      `${root}/cli/templates/files/example/ignored.ts`,
      "export {};\n",
    );

    const result = await collectCoreProductionFiles(root, {
      requiredRoots: ["src"],
    });

    assertEquals(result.visitedFileCount, 9);
    assertEquals(result.files.map((file) => file.path), [
      "src/runtime/example.cjs",
      "src/runtime/example.cts",
      "src/runtime/example.js",
      "src/runtime/example.jsx",
      "src/runtime/example.mjs",
      "src/runtime/example.mts",
      "src/runtime/example.ts",
      "src/runtime/example.tsx",
      "src/testing/bdd.ts",
    ]);
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("production file collection fails structurally for missing or escaped registered roots", async () => {
  const root = await Deno.makeTempDir();
  const outside = await Deno.makeTempDir();
  try {
    await assertRejects(
      () => collectCoreProductionFiles(root, { requiredRoots: ["src"] }),
      SourceImportCollectorError,
      "traversal-failure: src: registered production root is missing",
    );
    await Deno.writeTextFile(`${outside}/external.ts`, "export {};\n");
    await Deno.symlink(outside, `${root}/src`);
    await assertRejects(
      () => collectCoreProductionFiles(root, { requiredRoots: ["src"] }),
      SourceImportCollectorError,
      "traversal-failure: src: registered production root is a symbolic link",
    );
  } finally {
    await Deno.remove(root, { recursive: true });
    await Deno.remove(outside, { recursive: true });
  }
});
