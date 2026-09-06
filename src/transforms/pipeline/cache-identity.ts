import { computeHash } from "#veryfront/utils/hash-utils.ts";
import { computeConfigHash } from "#veryfront/cache/config-hash.ts";
import { fingerprintImportMap } from "../esm/http-cache-helpers.ts";
import type { ImportMapConfig } from "#veryfront/modules/import-map/types.ts";
import type { PipelineConfig, TransformPlugin } from "./types.ts";
import { canonicalizeServerExternalPackages } from "#veryfront/config/server-external-packages.ts";

const MAX_IMPORT_MAP_ENTRIES = 20_000;
const MAX_IDENTITY_STRING_BYTES = 64 * 1024;
const MAX_IMPORT_MAP_IDENTITY_BYTES = 8 * 1024 * 1024;
const MAX_PLUGIN_IDENTITY_BYTES = 4 * 1024;
const MAX_CUSTOM_PLUGINS = 1_000;
const MAX_TRANSFORM_STAGE_MAGNITUDE = 1_000_000;

// Transform identities are derived after project code may have run in the
// shared realm. Keep descriptor inspection, freezing, and bounded string
// handling independent from later primordial replacement.
const ArrayIsArray = Array.isArray;
const ArrayPrototypePush = Array.prototype.push;
const IntrinsicTextEncoder = TextEncoder;
const IntrinsicUint8Array = Uint8Array;
const IntrinsicRangeError = RangeError;
const IntrinsicTypeError = TypeError;
const JSONStringify = JSON.stringify;
const MathAbs = Math.abs;
const NumberIsFinite = Number.isFinite;
const NumberIsSafeInteger = Number.isSafeInteger;
const ObjectCreate = Object.create;
const ObjectFreeze = Object.freeze;
const ObjectGetOwnPropertyDescriptor = Object.getOwnPropertyDescriptor;
const ObjectGetPrototypeOf = Object.getPrototypeOf;
const ObjectPrototypeHasOwnProperty = Object.prototype.hasOwnProperty;
const ObjectPrototype = Object.prototype;
const ReflectApply = Reflect.apply;
const ReflectOwnKeys = Reflect.ownKeys;
const RegExpPrototypeTest = RegExp.prototype.test;
const StringPrototypeTrim = String.prototype.trim;
const TextEncoderPrototypeEncode = TextEncoder.prototype.encode;
const controlCharacterPattern = /\p{Cc}/u;
const encoder = new IntrinsicTextEncoder();
const TypedArrayPrototype = ObjectGetPrototypeOf(IntrinsicUint8Array.prototype);
const TypedArrayByteLengthGetter = ObjectGetOwnPropertyDescriptor(
  TypedArrayPrototype,
  "byteLength",
)!.get!;

function encodedByteLength(value: string): number {
  const bytes = ReflectApply(
    TextEncoderPrototypeEncode,
    encoder,
    [value],
  ) as Uint8Array;
  return ReflectApply(TypedArrayByteLengthGetter, bytes, []) as number;
}

function hasOwn(object: PropertyDescriptor, key: PropertyKey): boolean {
  return ReflectApply(ObjectPrototypeHasOwnProperty, object, [key]) as boolean;
}

/**
 * Transform stages are ordered numeric coordinates, not enum membership.
 * Built-in and custom plugins deliberately use fractional coordinates to run
 * between the public enum anchors, so every finite bounded number is valid.
 */
function isValidTransformStage(value: unknown): value is number {
  return typeof value === "number" && NumberIsFinite(value) &&
    MathAbs(value) <= MAX_TRANSFORM_STAGE_MAGNITUDE;
}

interface ImportMapBudget {
  entries: number;
  bytes: number;
}

function readOwnDataProperty(value: object, key: PropertyKey, label: string): unknown {
  const descriptor = ObjectGetOwnPropertyDescriptor(value, key);
  if (!descriptor) return undefined;
  if (!hasOwn(descriptor, "value")) {
    throw new IntrinsicTypeError(`${label} cannot contain accessor properties`);
  }
  return descriptor.value;
}

function readPluginDataProperty(value: object, key: PropertyKey, label: string): unknown {
  let current: object | null = value;
  while (current !== null && current !== ObjectPrototype) {
    const descriptor = ObjectGetOwnPropertyDescriptor(current, key);
    if (descriptor) {
      if (!hasOwn(descriptor, "value")) {
        throw new IntrinsicTypeError(`${label} cannot contain accessor properties`);
      }
      return descriptor.value;
    }
    current = ObjectGetPrototypeOf(current);
  }
  return undefined;
}

function countIdentityString(
  value: string,
  budget: ImportMapBudget,
  label: string,
  maxBytes = MAX_IDENTITY_STRING_BYTES,
): string {
  const bytes = encodedByteLength(value);
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
    if (!hasOwn(descriptor, "value")) {
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
      if (!hasOwn(descriptor, "value")) {
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
  | {
    cacheable: true;
    identity: ReadonlyArray<readonly [number, string, number, string]>;
    plugins: ReadonlyArray<TransformPlugin>;
  }
  | { cacheable: false; reason: string; plugins: ReadonlyArray<TransformPlugin> };

/** Require explicit versioned identities for caller-supplied executable code. */
export function getCustomPluginCacheIdentity(
  plugins: readonly TransformPlugin[] | undefined,
): CustomPluginCacheIdentity {
  if (plugins === undefined) {
    return {
      cacheable: true,
      identity: ObjectFreeze([]),
      plugins: ObjectFreeze([]),
    };
  }
  if (!ArrayIsArray(plugins)) {
    throw new IntrinsicTypeError("Transform pipeline plugins must be an array");
  }
  const pluginCount = readArrayLength(plugins, "Transform pipeline plugins");
  if (pluginCount === 0) {
    return {
      cacheable: true,
      identity: ObjectFreeze([]),
      plugins: ObjectFreeze([]),
    };
  }
  if (pluginCount > MAX_CUSTOM_PLUGINS) {
    throw new IntrinsicRangeError(
      `Transform pipeline cannot contain more than ${MAX_CUSTOM_PLUGINS} plugins`,
    );
  }

  const identity: Array<readonly [number, string, number, string]> = [];
  const pluginSnapshot: TransformPlugin[] = [];
  let uncacheableReason: string | undefined;
  for (let index = 0; index < pluginCount; index++) {
    const plugin = readArrayElement(plugins, index, "Transform pipeline plugins");
    if (plugin === null || typeof plugin !== "object") {
      throw new IntrinsicTypeError(`Transform plugin at index ${index} must be an object`);
    }
    const name = readPluginDataProperty(plugin, "name", `Transform plugin ${index}`);
    const stage = readPluginDataProperty(plugin, "stage", `Transform plugin ${index}`);
    const cacheIdentity = readPluginDataProperty(
      plugin,
      "cacheIdentity",
      `Transform plugin ${index}`,
    );
    const condition = readPluginDataProperty(plugin, "condition", `Transform plugin ${index}`);
    const transform = readPluginDataProperty(plugin, "transform", `Transform plugin ${index}`);
    if (
      typeof name !== "string" || name.length === 0 || name.length > 256 ||
      (ReflectApply(StringPrototypeTrim, name, []) as string) !== name ||
      (ReflectApply(RegExpPrototypeTest, controlCharacterPattern, [name]) as boolean)
    ) {
      throw new IntrinsicTypeError(`Transform plugin at index ${index} has an invalid name`);
    }
    if (!isValidTransformStage(stage)) {
      throw new IntrinsicTypeError(`Transform plugin ${name} has an invalid stage`);
    }
    if (condition !== undefined && typeof condition !== "function") {
      throw new IntrinsicTypeError(`Transform plugin ${name} has an invalid condition`);
    }
    if (typeof transform !== "function") {
      throw new IntrinsicTypeError(`Transform plugin ${name} has an invalid transform`);
    }

    const exactPlugin = ObjectCreate(null) as TransformPlugin;
    exactPlugin.name = name;
    exactPlugin.stage = stage;
    if (cacheIdentity !== undefined) exactPlugin.cacheIdentity = cacheIdentity as string;
    if (condition !== undefined) exactPlugin.condition = condition as TransformPlugin["condition"];
    exactPlugin.transform = transform as TransformPlugin["transform"];
    ReflectApply(ArrayPrototypePush, pluginSnapshot, [ObjectFreeze(exactPlugin)]);

    if (cacheIdentity === undefined) {
      uncacheableReason ??= `custom transform plugin ${name} has no cacheIdentity`;
      continue;
    }
    if (
      typeof cacheIdentity !== "string" || cacheIdentity.length === 0 ||
      encodedByteLength(cacheIdentity) > MAX_PLUGIN_IDENTITY_BYTES
    ) {
      throw new IntrinsicTypeError(`Transform plugin ${name} has an invalid cacheIdentity`);
    }
    ReflectApply(
      ArrayPrototypePush,
      identity,
      [ObjectFreeze([index, name, stage, cacheIdentity] as const)],
    );
  }
  const exactPlugins = ObjectFreeze(pluginSnapshot);
  if (uncacheableReason !== undefined) {
    return { cacheable: false, reason: uncacheableReason, plugins: exactPlugins };
  }
  return {
    cacheable: true,
    identity: ObjectFreeze(identity),
    plugins: exactPlugins,
  };
}

function boundedOption(value: unknown, label: string): string | null {
  if (value === undefined) return null;
  if (typeof value !== "string") {
    throw new IntrinsicTypeError(`${label} must be a string`);
  }
  if (
    encodedByteLength(value) > MAX_IDENTITY_STRING_BYTES
  ) {
    throw new IntrinsicTypeError(`${label} is too large for transform cache identity`);
  }
  return value;
}

function boundedRequiredOption(value: unknown, label: string): string {
  const bounded = boundedOption(value, label);
  if (bounded === null) throw new IntrinsicTypeError(`${label} must be a string`);
  return bounded;
}

function readArrayLength(value: readonly unknown[], label: string): number {
  const length = readOwnDataProperty(value, "length", label);
  if (
    typeof length !== "number" || !NumberIsSafeInteger(length) || length < 0
  ) {
    throw new IntrinsicTypeError(`${label} has an invalid length`);
  }
  return length;
}

function readArrayElement(
  value: readonly unknown[],
  index: number,
  label: string,
): unknown {
  const descriptor = ObjectGetOwnPropertyDescriptor(value, index);
  if (!descriptor || !hasOwn(descriptor, "value")) {
    throw new IntrinsicTypeError(`${label} must contain own data elements`);
  }
  return descriptor.value;
}

function encodeIdentityPrimitive(value: string | number | boolean | null): string {
  return JSONStringify(value) as string;
}

function encodeCustomPluginIdentities(
  plugins: ReadonlyArray<readonly [number, string, number, string]>,
): string {
  if (!ArrayIsArray(plugins)) {
    throw new IntrinsicTypeError("Transform pipeline custom plugin identity must be an array");
  }
  const length = readArrayLength(plugins, "Transform pipeline custom plugin identity");
  if (length > MAX_CUSTOM_PLUGINS) {
    throw new IntrinsicRangeError(
      `Transform pipeline cache identity cannot contain more than ${MAX_CUSTOM_PLUGINS} plugins`,
    );
  }

  let encoded = `${encodeIdentityPrimitive(length)};`;
  for (let index = 0; index < length; index++) {
    const tuple = readArrayElement(
      plugins,
      index,
      `Transform pipeline custom plugin identity ${index}`,
    );
    if (!ArrayIsArray(tuple) || readArrayLength(tuple, `Custom plugin identity ${index}`) !== 4) {
      throw new IntrinsicTypeError(`Custom plugin identity ${index} must be a four-item tuple`);
    }
    const pluginIndex = readArrayElement(tuple, 0, `Custom plugin identity ${index}`);
    const name = readArrayElement(tuple, 1, `Custom plugin identity ${index}`);
    const stage = readArrayElement(tuple, 2, `Custom plugin identity ${index}`);
    const cacheIdentity = readArrayElement(tuple, 3, `Custom plugin identity ${index}`);
    if (pluginIndex !== index) {
      throw new IntrinsicTypeError(`Custom plugin identity ${index} has an invalid index`);
    }
    if (
      typeof name !== "string" || name.length === 0 || name.length > 256 ||
      (ReflectApply(StringPrototypeTrim, name, []) as string) !== name ||
      (ReflectApply(RegExpPrototypeTest, controlCharacterPattern, [name]) as boolean)
    ) {
      throw new IntrinsicTypeError(`Custom plugin identity ${index} has an invalid name`);
    }
    if (!isValidTransformStage(stage)) {
      throw new IntrinsicTypeError(`Custom plugin identity ${index} has an invalid stage`);
    }
    if (
      typeof cacheIdentity !== "string" || cacheIdentity.length === 0 ||
      encodedByteLength(cacheIdentity) > MAX_PLUGIN_IDENTITY_BYTES
    ) {
      throw new IntrinsicTypeError(
        `Custom plugin identity ${index} has an invalid cache identity`,
      );
    }
    encoded += `${encodeIdentityPrimitive(pluginIndex)},${encodeIdentityPrimitive(name)},`;
    encoded += `${encodeIdentityPrimitive(stage)},${encodeIdentityPrimitive(cacheIdentity)};`;
  }
  return encoded;
}

export interface PipelineConfigIdentityInput {
  ssrImports?: PipelineConfig["ssrImports"];
  reactVersion: string;
  jsxImportSource: string;
  studioEmbed: boolean;
  dev: boolean;
  ssr: boolean;
  projectDir: string;
  moduleServerUrl?: string;
  moduleServerOrigin?: string;
  vendorBundleHash?: string;
  apiBaseUrl?: string;
  importMapFingerprint?: string;
  dependencyPinningCacheKey?: string;
  serverExternalPackages?: readonly string[];
  customPlugins: ReadonlyArray<readonly [number, string, number, string]>;
}

/** Hash every known output-affecting pipeline input using full SHA-256. */
export async function computePipelineConfigIdentity(
  input: PipelineConfigIdentityInput,
): Promise<string> {
  const reactVersion = boundedRequiredOption(
    readOwnDataProperty(input, "reactVersion", "Transform pipeline identity"),
    "React version",
  );
  const jsxImportSource = boundedRequiredOption(
    readOwnDataProperty(input, "jsxImportSource", "Transform pipeline identity"),
    "JSX import source",
  );
  const projectDir = boundedRequiredOption(
    readOwnDataProperty(input, "projectDir", "Transform pipeline identity"),
    "Project directory",
  );
  const studioEmbed = readOwnDataProperty(
    input,
    "studioEmbed",
    "Transform pipeline identity",
  );
  const dev = readOwnDataProperty(input, "dev", "Transform pipeline identity");
  const ssr = readOwnDataProperty(input, "ssr", "Transform pipeline identity");
  const ssrImports = readOwnDataProperty(input, "ssrImports", "Transform pipeline identity");
  if (ssrImports !== undefined && ssrImports !== "files" && ssrImports !== "references") {
    throw new IntrinsicTypeError("SSR imports must be files or references");
  }
  if (
    typeof studioEmbed !== "boolean" || typeof dev !== "boolean" ||
    typeof ssr !== "boolean"
  ) {
    throw new IntrinsicTypeError("Transform pipeline mode identity fields must be booleans");
  }
  const customPlugins = encodeCustomPluginIdentities(
    readOwnDataProperty(
      input,
      "customPlugins",
      "Transform pipeline identity",
    ) as ReadonlyArray<readonly [number, string, number, string]>,
  );
  const baseIdentity = await computeConfigHash({
    reactVersion,
    jsxImportSource,
    studioEmbed,
    dev,
  });
  // v5 preserves MDX layout exports before minification.
  let identity = "veryfront:transform-pipeline:v5;";
  if (ssrImports === "references") identity += "ssr-imports=references-v1;";
  identity += `base=${encodeIdentityPrimitive(baseIdentity)};`;
  identity += `ssr=${encodeIdentityPrimitive(ssr)};`;
  identity += `project=${encodeIdentityPrimitive(projectDir)};`;
  const moduleServerUrl = boundedOption(
    readOwnDataProperty(input, "moduleServerUrl", "Transform pipeline identity"),
    "Module server URL",
  );
  const moduleServerOrigin = boundedOption(
    readOwnDataProperty(input, "moduleServerOrigin", "Transform pipeline identity"),
    "Module server origin",
  );
  const vendorBundleHash = boundedOption(
    readOwnDataProperty(input, "vendorBundleHash", "Transform pipeline identity"),
    "Vendor bundle hash",
  );
  const apiBaseUrl = boundedOption(
    readOwnDataProperty(input, "apiBaseUrl", "Transform pipeline identity"),
    "API base URL",
  );
  const importMapFingerprint = boundedOption(
    readOwnDataProperty(input, "importMapFingerprint", "Transform pipeline identity"),
    "Import map fingerprint",
  );
  const dependencyPinningCacheKey = boundedOption(
    readOwnDataProperty(
      input,
      "dependencyPinningCacheKey",
      "Transform pipeline identity",
    ),
    "Dependency pinning cache key",
  );
  identity += `module-url=${encodeIdentityPrimitive(moduleServerUrl)};`;
  identity += `module-origin=${encodeIdentityPrimitive(moduleServerOrigin)};`;
  identity += `vendor=${encodeIdentityPrimitive(vendorBundleHash)};`;
  identity += `api=${encodeIdentityPrimitive(apiBaseUrl)};`;
  identity += `import-map=${encodeIdentityPrimitive(importMapFingerprint)};`;
  identity += `dependency-pins=${encodeIdentityPrimitive(dependencyPinningCacheKey)};`;
  const serverExternalPackages = readOwnDataProperty(
    input,
    "serverExternalPackages",
    "Transform pipeline identity",
  );
  if (serverExternalPackages !== undefined) {
    if (!ArrayIsArray(serverExternalPackages)) {
      throw new IntrinsicTypeError("Server external packages must be an array");
    }
    const canonical = canonicalizeServerExternalPackages(
      serverExternalPackages as readonly string[],
    );
    if (canonical) {
      identity += "server-externals=";
      for (let index = 0; index < canonical.length; index++) {
        identity += `${encodeIdentityPrimitive(canonical[index]!)},`;
      }
      identity += ";";
    }
  }
  identity += `plugins=${customPlugins}`;
  return computeHash(identity);
}
