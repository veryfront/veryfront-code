import { computeHash } from "#veryfront/utils/hash-utils.ts";
import { computeConfigHash } from "#veryfront/cache/config-hash.ts";
import { fingerprintImportMap } from "../esm/http-cache-helpers.ts";
import type { ImportMapConfig } from "#veryfront/modules/import-map/types.ts";
import type { TransformPlugin } from "./types.ts";

const MAX_IMPORT_MAP_ENTRIES = 20_000;
const MAX_IDENTITY_STRING_BYTES = 64 * 1024;
const MAX_IMPORT_MAP_IDENTITY_BYTES = 8 * 1024 * 1024;
const MAX_PLUGIN_IDENTITY_BYTES = 4 * 1024;
const MAX_CUSTOM_PLUGINS = 1_000;
const encoder = new TextEncoder();

interface ImportMapBudget {
  entries: number;
  bytes: number;
}

function readOwnDataProperty(value: object, key: PropertyKey, label: string): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  if (!descriptor) return undefined;
  if (descriptor.get || descriptor.set) {
    throw new TypeError(`${label} cannot contain accessor properties`);
  }
  return descriptor.value;
}

function countIdentityString(
  value: string,
  budget: ImportMapBudget,
  label: string,
  maxBytes = MAX_IDENTITY_STRING_BYTES,
): string {
  const bytes = encoder.encode(value).byteLength;
  if (bytes > maxBytes) throw new TypeError(`${label} is too large`);
  budget.bytes += bytes;
  if (budget.bytes > MAX_IMPORT_MAP_IDENTITY_BYTES) {
    throw new TypeError("Import map cache identity exceeds its byte limit");
  }
  return value;
}

function snapshotStringRecord(
  value: unknown,
  label: string,
  budget: ImportMapBudget,
): Readonly<Record<string, string>> {
  if (value === undefined) return Object.freeze(Object.create(null) as Record<string, string>);
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${label} must be a plain object`);
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new TypeError(`${label} must be a plain object`);
  }

  const snapshot = Object.create(null) as Record<string, string>;
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== "string") throw new TypeError(`${label} cannot contain symbol keys`);
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor) continue;
    if (descriptor.get || descriptor.set) {
      throw new TypeError(`${label} cannot contain accessor properties`);
    }
    if (!descriptor.enumerable) continue;

    budget.entries++;
    if (budget.entries > MAX_IMPORT_MAP_ENTRIES) {
      throw new TypeError("Import map cache identity contains too many entries");
    }
    countIdentityString(key, budget, `${label} key`);
    if (typeof descriptor.value !== "string") {
      throw new TypeError(`${label}.${key} must be a string`);
    }
    snapshot[key] = countIdentityString(descriptor.value, budget, `${label}.${key}`);
  }
  return Object.freeze(snapshot);
}

/**
 * Take a descriptor-only immutable snapshot before an import map is shared by
 * cache identity computation and transform stages. This prevents later caller
 * mutation (or getters with side effects) from making those two views diverge.
 */
export function snapshotImportMap(value: unknown): ImportMapConfig {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("Import map must be a plain object");
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new TypeError("Import map must be a plain object");
  }

  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== "string") throw new TypeError("Import map cannot contain symbol keys");
    if (key !== "imports" && key !== "scopes") {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (descriptor?.enumerable) throw new TypeError(`Unknown import map field: ${key}`);
    }
  }

  const budget: ImportMapBudget = { entries: 0, bytes: 0 };
  const imports = snapshotStringRecord(
    readOwnDataProperty(value, "imports", "Import map"),
    "Import map imports",
    budget,
  );
  const rawScopes = readOwnDataProperty(value, "scopes", "Import map");
  const scopes = Object.create(null) as Record<string, Readonly<Record<string, string>>>;

  if (rawScopes !== undefined) {
    if (rawScopes === null || typeof rawScopes !== "object" || Array.isArray(rawScopes)) {
      throw new TypeError("Import map scopes must be a plain object");
    }
    const scopesPrototype = Object.getPrototypeOf(rawScopes);
    if (scopesPrototype !== Object.prototype && scopesPrototype !== null) {
      throw new TypeError("Import map scopes must be a plain object");
    }
    for (const scope of Reflect.ownKeys(rawScopes)) {
      if (typeof scope !== "string") {
        throw new TypeError("Import map scopes cannot contain symbol keys");
      }
      const descriptor = Object.getOwnPropertyDescriptor(rawScopes, scope);
      if (!descriptor) continue;
      if (descriptor.get || descriptor.set) {
        throw new TypeError("Import map scopes cannot contain accessor properties");
      }
      if (!descriptor.enumerable) continue;
      budget.entries++;
      if (budget.entries > MAX_IMPORT_MAP_ENTRIES) {
        throw new TypeError("Import map cache identity contains too many entries");
      }
      countIdentityString(scope, budget, "Import map scope");
      scopes[scope] = snapshotStringRecord(
        descriptor.value,
        `Import map scope ${scope}`,
        budget,
      );
    }
  }

  return Object.freeze({
    imports,
    scopes: Object.freeze(scopes),
  });
}

export function fingerprintPipelineImportMap(importMap: ImportMapConfig): Promise<string> {
  return fingerprintImportMap(importMap);
}

export type CustomPluginCacheIdentity =
  | { cacheable: true; identity: ReadonlyArray<readonly [number, string, number, string]> }
  | { cacheable: false; reason: string };

/** Require explicit versioned identities for caller-supplied executable code. */
export function getCustomPluginCacheIdentity(
  plugins: readonly TransformPlugin[] | undefined,
): CustomPluginCacheIdentity {
  if (!plugins || plugins.length === 0) return { cacheable: true, identity: Object.freeze([]) };
  if (plugins.length > MAX_CUSTOM_PLUGINS) {
    throw new RangeError(
      `Transform pipeline cannot contain more than ${MAX_CUSTOM_PLUGINS} plugins`,
    );
  }

  const identity: Array<readonly [number, string, number, string]> = [];
  for (let index = 0; index < plugins.length; index++) {
    const plugin = plugins[index];
    if (plugin === null || typeof plugin !== "object") {
      throw new TypeError(`Transform plugin at index ${index} must be an object`);
    }
    const name = readOwnDataProperty(plugin, "name", `Transform plugin ${index}`);
    const stage = readOwnDataProperty(plugin, "stage", `Transform plugin ${index}`);
    const cacheIdentity = readOwnDataProperty(
      plugin,
      "cacheIdentity",
      `Transform plugin ${index}`,
    );
    if (
      typeof name !== "string" || name.length === 0 || name.length > 256 ||
      name.trim() !== name || /\p{Cc}/u.test(name)
    ) {
      throw new TypeError(`Transform plugin at index ${index} has an invalid name`);
    }
    if (typeof stage !== "number" || !Number.isFinite(stage) || Math.abs(stage) > 1_000_000) {
      throw new TypeError(`Transform plugin ${name} has an invalid stage`);
    }
    if (cacheIdentity === undefined) {
      return {
        cacheable: false,
        reason: `custom transform plugin ${name} has no cacheIdentity`,
      };
    }
    if (
      typeof cacheIdentity !== "string" || cacheIdentity.length === 0 ||
      encoder.encode(cacheIdentity).byteLength > MAX_PLUGIN_IDENTITY_BYTES
    ) {
      throw new TypeError(`Transform plugin ${name} has an invalid cacheIdentity`);
    }
    identity.push(Object.freeze([index, name, stage, cacheIdentity] as const));
  }
  return { cacheable: true, identity: Object.freeze(identity) };
}

function boundedOption(value: string | undefined, label: string): string | null {
  if (value === undefined) return null;
  if (typeof value !== "string") {
    throw new TypeError(`${label} must be a string`);
  }
  if (encoder.encode(value).byteLength > MAX_IDENTITY_STRING_BYTES) {
    throw new TypeError(`${label} is too large for transform cache identity`);
  }
  return value;
}

function boundedRequiredOption(value: string, label: string): string {
  const bounded = boundedOption(value, label);
  if (bounded === null) throw new TypeError(`${label} must be a string`);
  return bounded;
}

export interface PipelineConfigIdentityInput {
  reactVersion: string;
  jsxImportSource: string;
  studioEmbed: boolean;
  dev: boolean;
  ssr: boolean;
  projectDir: string;
  moduleServerUrl?: string;
  vendorBundleHash?: string;
  apiBaseUrl?: string;
  importMapFingerprint?: string;
  customPlugins: ReadonlyArray<readonly [number, string, number, string]>;
}

/** Hash every known output-affecting pipeline input using full SHA-256. */
export async function computePipelineConfigIdentity(
  input: PipelineConfigIdentityInput,
): Promise<string> {
  const reactVersion = boundedRequiredOption(input.reactVersion, "React version");
  const jsxImportSource = boundedRequiredOption(input.jsxImportSource, "JSX import source");
  const projectDir = boundedRequiredOption(input.projectDir, "Project directory");
  if (
    typeof input.studioEmbed !== "boolean" || typeof input.dev !== "boolean" ||
    typeof input.ssr !== "boolean"
  ) {
    throw new TypeError("Transform pipeline mode identity fields must be booleans");
  }
  if (!Array.isArray(input.customPlugins) || input.customPlugins.length > MAX_CUSTOM_PLUGINS) {
    throw new RangeError(
      `Transform pipeline cache identity cannot contain more than ${MAX_CUSTOM_PLUGINS} plugins`,
    );
  }
  const baseIdentity = await computeConfigHash({
    reactVersion,
    jsxImportSource,
    studioEmbed: input.studioEmbed,
    dev: input.dev,
  });
  const identity = [
    "veryfront:transform-pipeline:v2",
    baseIdentity,
    input.ssr,
    projectDir,
    boundedOption(input.moduleServerUrl, "Module server URL"),
    boundedOption(input.vendorBundleHash, "Vendor bundle hash"),
    boundedOption(input.apiBaseUrl, "API base URL"),
    boundedOption(input.importMapFingerprint, "Import map fingerprint"),
    input.customPlugins,
  ];
  return computeHash(JSON.stringify(identity));
}
