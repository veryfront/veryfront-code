import type { VeryfrontConfig } from "#veryfront/config";
import type { RuntimeAdapter } from "#veryfront/platform/adapters/base.ts";
import { ImportMapPreloader } from "./preloader.ts";

const adapterMock: unknown = {
  fs: {},
  env: {},
};
const adapter = adapterMock as RuntimeAdapter;
const configA = {
  resolve: {
    importMap: {
      imports: { package: "https://example.com/package-a.ts" },
    },
  },
} as VeryfrontConfig;
const configB = {
  resolve: {
    importMap: {
      imports: { package: "https://example.com/package-b.ts" },
    },
  },
} as VeryfrontConfig;

async function runPoisoningRegression() {
  const original = {
    arrayMap: Array.prototype.map,
    arrayPush: Array.prototype.push,
    arraySort: Array.prototype.sort,
    dateNow: Date.now,
    jsonStringify: JSON.stringify,
    map: Map,
    mapClear: Map.prototype.clear,
    mapDelete: Map.prototype.delete,
    mapForEach: Map.prototype.forEach,
    mapGet: Map.prototype.get,
    mapSet: Map.prototype.set,
    mapSize: Object.getOwnPropertyDescriptor(Map.prototype, "size")!,
    mathMin: Math.min,
    numberIsFinite: Number.isFinite,
    numberIsSafeInteger: Number.isSafeInteger,
    objectEntries: Object.entries,
    promise: Promise,
    promiseResolve: Promise.resolve,
    set: Set,
    setAdd: Set.prototype.add,
    setDelete: Set.prototype.delete,
    setForEach: Set.prototype.forEach,
    setSize: Object.getOwnPropertyDescriptor(Set.prototype, "size")!,
  };
  const poisoned = () => {
    throw new Error("poisoned primordial");
  };
  let first: Awaited<ReturnType<ImportMapPreloader["preload"]>> | undefined;
  let firstAgain: Awaited<ReturnType<ImportMapPreloader["preload"]>> | undefined;
  let second: Awaited<ReturnType<ImportMapPreloader["preload"]>> | undefined;
  let evicted:
    | Awaited<ReturnType<ImportMapPreloader["getCached"]>>
    | undefined;
  let loads = 0;

  try {
    Reflect.set(Array.prototype, "map", poisoned);
    Reflect.set(Array.prototype, "push", poisoned);
    Reflect.set(Array.prototype, "sort", poisoned);
    Reflect.set(Date, "now", poisoned);
    Reflect.set(JSON, "stringify", poisoned);
    Reflect.set(globalThis, "Map", class PoisonedMap {});
    Reflect.set(original.map.prototype, "clear", poisoned);
    Reflect.set(original.map.prototype, "delete", poisoned);
    Reflect.set(original.map.prototype, "forEach", poisoned);
    Reflect.set(original.map.prototype, "get", poisoned);
    Reflect.set(original.map.prototype, "set", poisoned);
    Object.defineProperty(original.map.prototype, "size", {
      configurable: true,
      get: poisoned,
    });
    Reflect.set(Math, "min", poisoned);
    Reflect.set(Number, "isFinite", poisoned);
    Reflect.set(Number, "isSafeInteger", poisoned);
    Reflect.set(Object, "entries", poisoned);
    Reflect.set(globalThis, "Promise", class PoisonedPromise {});
    Reflect.set(original.promise, "resolve", poisoned);
    Reflect.set(globalThis, "Set", class PoisonedSet {});
    Reflect.set(original.set.prototype, "add", poisoned);
    Reflect.set(original.set.prototype, "delete", poisoned);
    Reflect.set(original.set.prototype, "forEach", poisoned);
    Object.defineProperty(original.set.prototype, "size", {
      configurable: true,
      get: poisoned,
    });

    const preloader = new ImportMapPreloader({
      maxProjects: 1,
      maxVariantsPerProject: 1,
      ttlMs: 1_000,
      loadImportMap: async (_path, _adapter, config) => ({
        imports: {
          loaded: String(++loads),
          package: config?.resolve?.importMap?.imports?.package ?? "",
        },
      }),
    });
    const contextA = {
      contentSourceId: "source",
      config: configA,
      projectDir: "/project",
    };
    const contextB = {
      contentSourceId: "source",
      config: configB,
      projectDir: "/project",
    };

    first = await preloader.preload("/project", adapter, "project", contextA);
    firstAgain = await preloader.preload(
      "/project",
      adapter,
      "project",
      contextA,
    );
    second = await preloader.preload("/project", adapter, "project", contextB);
    evicted = await preloader.getCached("project", contextA);
  } finally {
    Reflect.set(Array.prototype, "map", original.arrayMap);
    Reflect.set(Array.prototype, "push", original.arrayPush);
    Reflect.set(Array.prototype, "sort", original.arraySort);
    Reflect.set(Date, "now", original.dateNow);
    Reflect.set(JSON, "stringify", original.jsonStringify);
    Reflect.set(original.map.prototype, "clear", original.mapClear);
    Reflect.set(original.map.prototype, "delete", original.mapDelete);
    Reflect.set(original.map.prototype, "forEach", original.mapForEach);
    Reflect.set(original.map.prototype, "get", original.mapGet);
    Reflect.set(original.map.prototype, "set", original.mapSet);
    Object.defineProperty(original.map.prototype, "size", original.mapSize);
    Reflect.set(Math, "min", original.mathMin);
    Reflect.set(Number, "isFinite", original.numberIsFinite);
    Reflect.set(Number, "isSafeInteger", original.numberIsSafeInteger);
    Reflect.set(Object, "entries", original.objectEntries);
    Reflect.set(original.promise, "resolve", original.promiseResolve);
    Reflect.set(original.set.prototype, "add", original.setAdd);
    Reflect.set(original.set.prototype, "delete", original.setDelete);
    Reflect.set(original.set.prototype, "forEach", original.setForEach);
    Object.defineProperty(original.set.prototype, "size", original.setSize);
    Reflect.set(globalThis, "Map", original.map);
    Reflect.set(globalThis, "Promise", original.promise);
    Reflect.set(globalThis, "Set", original.set);
  }

  return {
    firstLoaded: first?.imports?.loaded,
    firstSame: firstAgain === first,
    secondLoaded: second?.imports?.loaded,
    secondPackage: second?.imports?.package,
    evicted: evicted === undefined,
    loads,
  };
}

async function postWorkerMessage(message: unknown): Promise<void> {
  if (typeof globalThis.postMessage === "function") {
    globalThis.postMessage(message);
    return;
  }

  const { parentPort } = await import("node:worker_threads");
  if (parentPort === null) {
    throw new TypeError("Primordial poisoning test worker requires a parent port");
  }
  parentPort.postMessage(message);
}

try {
  const result = await runPoisoningRegression();
  await postWorkerMessage({ ok: true, result });
} catch (error) {
  await postWorkerMessage({
    ok: false,
    error: error instanceof Error ? (error.stack ?? error.message) : String(error),
  });
}
