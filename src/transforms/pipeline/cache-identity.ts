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

// Transform identities are derived after project code may have run in the
// shared realm. Keep descriptor inspection, freezing, and bounded string
// handling independent from later primordial replacement.
const ArrayIsArray = Array.isArray;
const ArrayPrototypePush = Array.prototype.push;
const IntrinsicTextEncoder = TextEncoder;
const IntrinsicRangeError = RangeError;
const IntrinsicTypeError = TypeError;
const JSONStringify = JSON.stringify;
const MathAbs = Math.abs;
const NumberIsFinite = Number.isFinite;
const ObjectCreate = Object.create;
const ObjectFreeze = Object.freeze;
const ObjectGetOwnPropertyDescriptor = Object.getOwnPropertyDescriptor;
const ObjectGetPrototypeOf = Object.getPrototypeOf;
const ObjectPrototype = Object.prototype;
const ReflectApply = Reflect.apply;
const ReflectOwnKeys = Reflect.ownKeys;
const RegExpPrototypeTest = RegExp.prototype.test;
const StringPrototypeTrim = String.prototype.trim;
const TextEncoderPrototypeEncode = TextEncoder.prototype.encode;
const controlCharacterPattern = /\p{Cc}/u;
const encoder = new IntrinsicTextEncoder();

interface ImportMapBudget {
  entries: number;
  bytes: number;
}

function readOwnDataProperty(value: object, key: PropertyKey, label: string): unknown {
  const descriptor = ObjectGetOwnPropertyDescriptor(value, key);
  if (!descriptor) return undefined;
  if (descriptor.get || descriptor.set) {
    throw new IntrinsicTypeError(`${label} cannot contain accessor properties`);
  }
  return descriptor.value;
}

function countIdentityString(
  value: string,
  budget: ImportMapBudget,
  label: string,
  maxBytes = MAX_IDENTITY_STRING_BYTES,
): string {
  const bytes = (
    ReflectApply(TextEncoderPrototypeEncode, encoder, [value]) as Uint8Array
  ).byteLength;
  if (bytes > maxBytes) throw new IntrinsicTypeError(`${label} is too large`);
  budget.bytes += bytes;
  if (budget.bytes > MAX_IMPORT_MAP_IDENTITY_BYTES) {
    throw new IntrinsicTypeError("Import map cache identity exceeds its byte limit");
  }
  return value;
}

function snapshotStringRecord(
  value: unknown,
  label: string,
  budget: ImportMapBudget,
): Readonly<Record<string, string>> {
  if (value === undefined) {
    return ObjectFreeze(ObjectCreate(null) as Record<string, string>);
  }
  if (value === null || typeof value !== "object" || ArrayIsArray(value)) {
    throw new IntrinsicTypeError(`${label} must be a plain object`);
  }
  const prototype = ObjectGetPrototypeOf(value);
  if (prototype !== ObjectPrototype && prototype !== null) {
    throw new IntrinsicTypeError(`${label} must be a plain object`);
  }

  const snapshot = ObjectCreate(null) as Record<string, string>;
  const keys = ReflectOwnKeys(value);
  for (let index = 0; index < keys.length; index++) {
    const key = keys[index];
    if (typeof key !== "string") {
      throw new IntrinsicTypeError(`${label} cannot contain symbol keys`);
    }
    const descriptor = ObjectGetOwnPropertyDescriptor(value, key);
    if (!descriptor) continue;
    if (descriptor.get || descriptor.set) {
      throw new IntrinsicTypeError(`${label} cannot contain accessor properties`);
    }
    if (!descriptor.enumerable) continue;

    budget.entries++;
    if (budget.entries > MAX_IMPORT_MAP_ENTRIES) {
      throw new IntrinsicTypeError("Import map cache identity contains too many entries");
    }
    countIdentityString(key, budget, `${label} key`);
    if (typeof descriptor.value !== "string") {
      throw new IntrinsicTypeError(`${label}.${key} must be a string`);
    }
    snapshot[key] = countIdentityString(descriptor.value, budget, `${label}.${key}`);
  }
  return ObjectFreeze(snapshot);
}

/**
 * Take a descriptor-only immutable snapshot before an import map is shared by
 * cache identity computation and transform stages. This prevents later caller
 * mutation (or getters with side effects) from making those two views diverge.
 */
export function snapshotImportMap(value: unknown): ImportMapConfig {
  if (value === null || typeof value !== "object" || ArrayIsArray(value)) {
    throw new IntrinsicTypeError("Import map must be a plain object");
  }
  const prototype = ObjectGetPrototypeOf(value);
  if (prototype !== ObjectPrototype && prototype !== null) {
    throw new IntrinsicTypeError("Import map must be a plain object");
  }

  const keys = ReflectOwnKeys(value);
  for (let index = 0; index < keys.length; index++) {
    const key = keys[index];
    if (typeof key !== "string") {
      throw new IntrinsicTypeError("Import map cannot contain symbol keys");
    }
    if (key !== "imports" && key !== "scopes") {
      const descriptor = ObjectGetOwnPropertyDescriptor(value, key);
      if (descriptor?.enumerable) {
        throw new IntrinsicTypeError(`Unknown import map field: ${key}`);
      }
    }
  }

  const budget: ImportMapBudget = { entries: 0, bytes: 0 };
  const imports = snapshotStringRecord(
    readOwnDataProperty(value, "imports", "Import map"),
    "Import map imports",
    budget,
  );
  const rawScopes = readOwnDataProperty(value, "scopes", "Import map");
  const scopes = ObjectCreate(null) as Record<string, Readonly<Record<string, string>>>;

  if (rawScopes !== undefined) {
    if (rawScopes === null || typeof rawScopes !== "object" || ArrayIsArray(rawScopes)) {
      throw new IntrinsicTypeError("Import map scopes must be a plain object");
    }
    const scopesPrototype = ObjectGetPrototypeOf(rawScopes);
    if (scopesPrototype !== ObjectPrototype && scopesPrototype !== null) {
      throw new IntrinsicTypeError("Import map scopes must be a plain object");
    }
    const scopeKeys = ReflectOwnKeys(rawScopes);
    for (let index = 0; index < scopeKeys.length; index++) {
      const scope = scopeKeys[index];
      if (typeof scope !== "string") {
        throw new IntrinsicTypeError("Import map scopes cannot contain symbol keys");
      }
      const descriptor = ObjectGetOwnPropertyDescriptor(rawScopes, scope);
      if (!descriptor) continue;
      if (descriptor.get || descriptor.set) {
        throw new IntrinsicTypeError("Import map scopes cannot contain accessor properties");
      }
      if (!descriptor.enumerable) continue;
      budget.entries++;
      if (budget.entries > MAX_IMPORT_MAP_ENTRIES) {
        throw new IntrinsicTypeError("Import map cache identity contains too many entries");
      }
      countIdentityString(scope, budget, "Import map scope");
      scopes[scope] = snapshotStringRecord(
        descriptor.value,
        `Import map scope ${scope}`,
        budget,
      );
    }
  }

  return ObjectFreeze({
    imports,
    scopes: ObjectFreeze(scopes),
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
  if (!plugins || plugins.length === 0) {
    return { cacheable: true, identity: ObjectFreeze([]) };
  }
  if (plugins.length > MAX_CUSTOM_PLUGINS) {
    throw new IntrinsicRangeError(
      `Transform pipeline cannot contain more than ${MAX_CUSTOM_PLUGINS} plugins`,
    );
  }

  const identity: Array<readonly [number, string, number, string]> = [];
  for (let index = 0; index < plugins.length; index++) {
    const plugin = plugins[index];
    if (plugin === null || typeof plugin !== "object") {
      throw new IntrinsicTypeError(`Transform plugin at index ${index} must be an object`);
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
      (ReflectApply(StringPrototypeTrim, name, []) as string) !== name ||
      (ReflectApply(RegExpPrototypeTest, controlCharacterPattern, [name]) as boolean)
    ) {
      throw new IntrinsicTypeError(`Transform plugin at index ${index} has an invalid name`);
    }
    if (typeof stage !== "number" || !NumberIsFinite(stage) || MathAbs(stage) > 1_000_000) {
      throw new IntrinsicTypeError(`Transform plugin ${name} has an invalid stage`);
    }
    if (cacheIdentity === undefined) {
      return {
        cacheable: false,
        reason: `custom transform plugin ${name} has no cacheIdentity`,
      };
    }
    if (
      typeof cacheIdentity !== "string" || cacheIdentity.length === 0 ||
      (ReflectApply(TextEncoderPrototypeEncode, encoder, [cacheIdentity]) as Uint8Array)
          .byteLength >
        MAX_PLUGIN_IDENTITY_BYTES
    ) {
      throw new IntrinsicTypeError(`Transform plugin ${name} has an invalid cacheIdentity`);
    }
    ReflectApply(
      ArrayPrototypePush,
      identity,
      [ObjectFreeze([index, name, stage, cacheIdentity] as const)],
    );
  }
  return { cacheable: true, identity: ObjectFreeze(identity) };
}

function boundedOption(value: string | undefined, label: string): string | null {
  if (value === undefined) return null;
  if (typeof value !== "string") {
    throw new IntrinsicTypeError(`${label} must be a string`);
  }
  if (
    (ReflectApply(TextEncoderPrototypeEncode, encoder, [value]) as Uint8Array)
      .byteLength >
      MAX_IDENTITY_STRING_BYTES
  ) {
    throw new IntrinsicTypeError(`${label} is too large for transform cache identity`);
  }
  return value;
}

function boundedRequiredOption(value: string, label: string): string {
  const bounded = boundedOption(value, label);
  if (bounded === null) throw new IntrinsicTypeError(`${label} must be a string`);
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
    throw new IntrinsicTypeError("Transform pipeline mode identity fields must be booleans");
  }
  if (!ArrayIsArray(input.customPlugins) || input.customPlugins.length > MAX_CUSTOM_PLUGINS) {
    throw new IntrinsicRangeError(
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
  return computeHash(JSONStringify(identity));
}
