import type { VeryfrontConfig } from "#veryfront/config";
import type { RuntimeAdapter } from "#veryfront/platform/adapters/base.ts";
import { loadImportMap } from "./loader.ts";

const denoJson = JSON.stringify({
  imports: {
    "deno-only": "https://example.com/deno.ts",
    package: "https://example.com/deno-package.ts",
  },
});
const adapterMock: unknown = {
  fs: {
    getAdapterType: () => "VeryfrontFSAdapter",
    getUnderlyingAdapter: () => ({}),
    isVeryfrontAdapter: () => true,
    isMultiProjectMode: () => false,
    readFile: () => denoJson,
  },
  env: { get: () => undefined },
};
const adapter = adapterMock as RuntimeAdapter;
const config = {
  resolve: {
    importMap: {
      imports: { package: "npm:package@1.0.0" },
    },
  },
} as VeryfrontConfig;

async function runRegression() {
  const original = {
    arrayFilter: Array.prototype.filter,
    arrayMap: Array.prototype.map,
    arrayPush: Array.prototype.push,
    jsonParse: JSON.parse,
    objectAssign: Object.assign,
    objectEntries: Object.entries,
    objectFromEntries: Object.fromEntries,
    stringIndexOf: String.prototype.indexOf,
    stringSlice: String.prototype.slice,
    stringSplit: String.prototype.split,
    stringStartsWith: String.prototype.startsWith,
  };
  const poisoned = () => {
    throw new Error("poisoned primordial");
  };
  let loaded: Awaited<ReturnType<typeof loadImportMap>> | undefined;
  try {
    Reflect.set(Array.prototype, "filter", poisoned);
    Reflect.set(Array.prototype, "map", poisoned);
    Reflect.set(Array.prototype, "push", poisoned);
    Reflect.set(JSON, "parse", poisoned);
    Reflect.set(Object, "assign", poisoned);
    Reflect.set(Object, "entries", poisoned);
    Reflect.set(Object, "fromEntries", poisoned);
    Reflect.set(String.prototype, "indexOf", poisoned);
    Reflect.set(String.prototype, "slice", poisoned);
    Reflect.set(String.prototype, "split", poisoned);
    Reflect.set(String.prototype, "startsWith", poisoned);
    loaded = await loadImportMap("/project", adapter, config);
  } finally {
    Reflect.set(Array.prototype, "filter", original.arrayFilter);
    Reflect.set(Array.prototype, "map", original.arrayMap);
    Reflect.set(Array.prototype, "push", original.arrayPush);
    Reflect.set(JSON, "parse", original.jsonParse);
    Reflect.set(Object, "assign", original.objectAssign);
    Reflect.set(Object, "entries", original.objectEntries);
    Reflect.set(Object, "fromEntries", original.objectFromEntries);
    Reflect.set(String.prototype, "indexOf", original.stringIndexOf);
    Reflect.set(String.prototype, "slice", original.stringSlice);
    Reflect.set(String.prototype, "split", original.stringSplit);
    Reflect.set(String.prototype, "startsWith", original.stringStartsWith);
  }

  return {
    denoOnly: loaded?.imports?.["deno-only"],
    package: loaded?.imports?.package,
    react: loaded?.imports?.react,
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
  await postWorkerMessage({ ok: true, result: await runRegression() });
} catch (error) {
  await postWorkerMessage({
    ok: false,
    error: error instanceof Error ? (error.stack ?? error.message) : String(error),
  });
}
