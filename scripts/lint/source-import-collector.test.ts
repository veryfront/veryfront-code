import { win32 } from "node:path";
import { assertEquals, assertRejects, assertThrows } from "#std/assert";
import {
  collectCoreProductionFiles,
  collectSourceDependencies,
  isPathContained as isSourcePathContained,
  type SourceDependency,
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
      { loader: "require-alias", line: 3 },
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
      { loader: "runtime-loader-alias", line: 9 },
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
      { loader: "require-alias", line: 1 },
      { loader: "require-alias", line: 2 },
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
