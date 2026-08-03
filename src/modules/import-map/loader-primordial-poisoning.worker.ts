import type { VeryfrontConfig } from "#veryfront/config";
import type { RuntimeAdapter } from "#veryfront/platform/adapters/base.ts";
import { loadImportMap } from "./loader.ts";

const denoJson = JSON.stringify({
  imports: {
    "deno-only": "https://example.com/deno.ts",
    package: "https://example.com/deno-package.ts",
  },
});
const adapter = {
  fs: {
    getAdapterType: () => "VeryfrontFSAdapter",
    getUnderlyingAdapter: () => ({}),
    isVeryfrontAdapter: () => true,
    isMultiProjectMode: () => false,
    readFile: () => denoJson,
  },
  env: { get: () => undefined },
} as unknown as RuntimeAdapter;
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

try {
  postMessage({ ok: true, result: await runRegression() });
} catch (error) {
  postMessage({
    ok: false,
    error: error instanceof Error ? (error.stack ?? error.message) : String(error),
  });
}
