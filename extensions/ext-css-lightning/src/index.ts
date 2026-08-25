/**
 * Lightning CSS and Browserslist implementation of CSSOptimizationEngine.
 *
 * @module extensions/ext-css-lightning
 */

import { createHash } from "node:crypto";
import process from "node:process";
import type { ExtensionFactory } from "veryfront/extensions";
import {
  type CSSOptimizationEngine,
  CSSOptimizationEngineName,
  type CSSOptimizationRequest,
  type CSSOptimizationResult,
  MAX_CSS_OPTIMIZATION_ENGINE_IDENTITY_CHARACTERS,
} from "veryfront/extensions/css";
import browserslist from "browserslist";
import { browserslistToTargets, transform } from "lightningcss";
import extensionPackage from "../deno.json" with { type: "json" };
import { isWellFormedString } from "./is-well-formed-string.ts";

const MAX_BROWSER_QUERIES = 32;
const MAX_BROWSER_QUERY_CHARACTERS = 256;
const MAX_RESOLVED_BROWSERS = 4_096;
const MAX_SOURCE_PATH_CHARACTERS = 4_096;
const ENGINE_SEMANTICS_VERSION = "veryfront.css-lightning.v3";

const apply = Reflect.apply;
const arrayIsArray = Array.isArray;
const freeze = Object.freeze;
const getOwnPropertyDescriptor = Object.getOwnPropertyDescriptor;
const getOwnPropertyDescriptors = Object.getOwnPropertyDescriptors;
const getPrototypeOf = Object.getPrototypeOf;
const hasOwn = Object.hasOwn;
const ownKeys = Reflect.ownKeys;
const createObject = Object.create;
const defineProperty = Object.defineProperty;
const arrayPush = Array.prototype.push;
const arraySort = Array.prototype.sort;
const arrayJoin = Array.prototype.join;
const encodeText = TextEncoder.prototype.encode;
const decodeText = TextDecoder.prototype.decode;
const normalizeString = String.prototype.normalize;
const trimString = String.prototype.trim;
const charCodeAtString = String.prototype.charCodeAt;
const executeRegularExpression = RegExp.prototype.exec;
const stringifyJSON = JSON.stringify;
const isSafeInteger = Number.isSafeInteger;
const isArrayBufferView = ArrayBuffer.isView;
const objectToString = Object.prototype.toString;
const ObjectPrototype = Object.prototype;
const encoder = new TextEncoder();
const decoder = new TextDecoder("utf-8", { fatal: true });
const EXACT_NPM_SPECIFIER = /^npm:(?:@[^/]+\/)?[^@/]+@([^@/]+)$/;
const INEXACT_VERSION_CHARACTER = /[~^*<>=|\s]/u;
const TARGET_NAME = /^[a-z][a-z0-9_]*$/;

export interface LightningCSSOptimizationConfig {
  /** Browserslist expressions resolved once when the extension is created. */
  readonly browserQueries?: readonly string[];
}

interface ResolvedConfig {
  readonly browserQueries: readonly string[] | undefined;
}

interface ResolvedTargets {
  readonly targets: Readonly<Record<string, number>>;
  readonly identity: string;
}

function descriptorValue(
  object: object,
  property: PropertyKey,
  label: string,
): unknown {
  const descriptor = getOwnPropertyDescriptor(object, property);
  if (descriptor === undefined || !hasOwn(descriptor, "value")) {
    throw new TypeError(`${label} must be an own data property`);
  }
  return descriptor.value;
}

function dataPropertyValue(
  descriptors: PropertyDescriptorMap,
  property: string,
  label: string,
): unknown {
  const descriptor = descriptors[property];
  if (descriptor === undefined || !hasOwn(descriptor, "value")) {
    throw new TypeError(`${label} must be a data property`);
  }
  return descriptor.value;
}

function exactNpmVersion(value: unknown, dependency: string): string {
  if (typeof value !== "string") {
    throw new TypeError(`${dependency} dependency must use an exact npm version`);
  }
  const match = apply(executeRegularExpression, EXACT_NPM_SPECIFIER, [value]);
  if (
    match?.[1] === undefined ||
    apply(executeRegularExpression, INEXACT_VERSION_CHARACTER, [match[1]]) !==
      null
  ) {
    throw new TypeError(`${dependency} dependency must use an exact npm version`);
  }
  return match[1];
}

const extensionVersion = descriptorValue(
  extensionPackage,
  "version",
  "ext-css-lightning version",
);
const extensionImports = descriptorValue(
  extensionPackage,
  "imports",
  "ext-css-lightning imports",
);
if (
  typeof extensionVersion !== "string" ||
  typeof extensionImports !== "object" ||
  extensionImports === null ||
  arrayIsArray(extensionImports)
) {
  throw new TypeError("ext-css-lightning manifest is invalid");
}
const lightningCSSVersion = exactNpmVersion(
  descriptorValue(extensionImports, "lightningcss", "lightningcss import"),
  "lightningcss",
);
const browserslistVersion = exactNpmVersion(
  descriptorValue(extensionImports, "browserslist", "browserslist import"),
  "browserslist",
);

const hashPrototype = getPrototypeOf(createHash("sha256"));
const updateHashValue = descriptorValue(hashPrototype, "update", "Hash.update");
const digestHashValue = descriptorValue(hashPrototype, "digest", "Hash.digest");
if (
  typeof updateHashValue !== "function" ||
  typeof digestHashValue !== "function"
) {
  throw new TypeError("SHA-256 implementation is unavailable");
}
type HashInstance = ReturnType<typeof createHash>;
const updateHash = updateHashValue as (
  this: HashInstance,
  value: string,
  encoding: "utf8",
) => HashInstance;
const digestHash = digestHashValue as (
  this: HashInstance,
  encoding: "hex",
) => string;

function sha256(value: string): string {
  const hash = createHash("sha256");
  apply(updateHash, hash, [value, "utf8"]);
  return apply(digestHash, hash, ["hex"]) as string;
}

function hasControlOrLineSeparator(value: string): boolean {
  for (let index = 0; index < value.length; index++) {
    const code = apply(charCodeAtString, value, [index]);
    if (
      code <= 0x1f ||
      (code >= 0x7f && code <= 0x9f) ||
      code === 0x2028 ||
      code === 0x2029
    ) {
      return true;
    }
  }
  return false;
}

function frozenResolvedConfig(
  browserQueries: readonly string[] | undefined,
): ResolvedConfig {
  const config = createObject(null) as ResolvedConfig;
  defineProperty(config, "browserQueries", {
    value: browserQueries,
    enumerable: true,
  });
  return freeze(config);
}

function snapshotBrowserQueries(value: unknown): readonly string[] | undefined {
  if (value === undefined) return undefined;
  let isArray: boolean;
  try {
    isArray = arrayIsArray(value);
  } catch (cause) {
    throw new TypeError(
      "ext-css-lightning browserQueries could not be inspected",
      { cause },
    );
  }
  if (!isArray) {
    throw new TypeError("ext-css-lightning browserQueries must be an array");
  }

  let descriptors: PropertyDescriptorMap;
  try {
    descriptors = getOwnPropertyDescriptors(
      value as Record<PropertyKey, unknown>,
    );
  } catch (cause) {
    throw new TypeError(
      "ext-css-lightning browserQueries could not be inspected",
      { cause },
    );
  }
  const length = dataPropertyValue(
    descriptors,
    "length",
    "ext-css-lightning browserQueries length",
  );
  if (
    !isSafeInteger(length) ||
    (length as number) < 1 ||
    (length as number) > MAX_BROWSER_QUERIES ||
    ownKeys(descriptors).length !== (length as number) + 1
  ) {
    throw new TypeError(
      "ext-css-lightning browserQueries must be a bounded dense array",
    );
  }

  const queries: string[] = [];
  for (let index = 0; index < (length as number); index++) {
    const descriptor = descriptors[String(index)];
    if (
      descriptor === undefined ||
      !hasOwn(descriptor, "value") ||
      descriptor.enumerable !== true
    ) {
      throw new TypeError(
        "ext-css-lightning browserQueries must contain data-property strings",
      );
    }
    const query = descriptor.value;
    if (
      typeof query !== "string" ||
      query.length === 0 ||
      query.length > MAX_BROWSER_QUERY_CHARACTERS ||
      !isWellFormedString(query) ||
      apply(normalizeString, query, ["NFC"]) !== query ||
      apply(trimString, query, []) !== query ||
      hasControlOrLineSeparator(query)
    ) {
      throw new TypeError(
        "ext-css-lightning browserQueries must contain canonical bounded strings",
      );
    }
    apply(arrayPush, queries, [query]);
  }
  return freeze(queries);
}

function readConfig(value: unknown): ResolvedConfig {
  if (value === undefined) return frozenResolvedConfig(undefined);
  let valueIsArray: boolean;
  try {
    valueIsArray = arrayIsArray(value);
  } catch (cause) {
    throw new TypeError("ext-css-lightning config could not be inspected", {
      cause,
    });
  }
  if (typeof value !== "object" || value === null || valueIsArray) {
    throw new TypeError("ext-css-lightning config must be an object");
  }

  let descriptors: PropertyDescriptorMap;
  let prototype: object | null;
  try {
    prototype = getPrototypeOf(value);
    descriptors = getOwnPropertyDescriptors(value);
  } catch (cause) {
    throw new TypeError("ext-css-lightning config could not be inspected", {
      cause,
    });
  }
  if (prototype !== ObjectPrototype && prototype !== null) {
    throw new TypeError("ext-css-lightning config must not inherit configuration");
  }
  const keys = ownKeys(descriptors);
  if (keys.length > 1 || (keys.length === 1 && keys[0] !== "browserQueries")) {
    throw new TypeError("ext-css-lightning config contains unsupported properties");
  }
  const descriptor = descriptors.browserQueries;
  if (descriptor !== undefined && !hasOwn(descriptor, "value")) {
    throw new TypeError(
      "ext-css-lightning browserQueries must be a data property",
    );
  }
  return frozenResolvedConfig(
    snapshotBrowserQueries(descriptor?.value),
  );
}

function copyStrings(values: readonly string[]): string[] {
  const copy: string[] = [];
  for (let index = 0; index < values.length; index++) {
    apply(arrayPush, copy, [values[index]]);
  }
  return copy;
}

function createIsolatedBrowserQueryOptions(): browserslist.Options {
  return {
    path: false,
    stats: createObject(null) as browserslist.Stats,
    dangerousExtend: false,
  };
}

function rejectExternalBrowserQuerySources(queries: readonly string[]): void {
  const parsed = browserslist.parse(
    copyStrings(queries),
    createIsolatedBrowserQueryOptions(),
  );
  if (!arrayIsArray(parsed) || parsed.length > MAX_BROWSER_QUERIES * 4) {
    throw new TypeError("CSS browser queries produced an invalid parse result");
  }
  for (let index = 0; index < parsed.length; index++) {
    const type = parsed[index]?.type;
    if (
      type === "browserslist_config" ||
      type === "extends" ||
      type === "popularity_in_config_stats" ||
      type === "cover_config"
    ) {
      throw new TypeError(
        "CSS browser queries must not load external configuration or statistics",
      );
    }
  }
}

function snapshotResolvedTargets(value: unknown): Readonly<Record<string, number>> {
  if (typeof value !== "object" || value === null || arrayIsArray(value)) {
    throw new TypeError("Lightning CSS returned invalid browser targets");
  }
  const descriptors = getOwnPropertyDescriptors(value);
  const keys = ownKeys(descriptors);
  if (keys.length === 0 || keys.length > 128) {
    throw new TypeError("Lightning CSS returned invalid browser targets");
  }
  for (let index = 0; index < keys.length; index++) {
    if (typeof keys[index] !== "string") {
      throw new TypeError("Lightning CSS returned invalid browser targets");
    }
  }
  apply(arraySort, keys, []);

  const targets = createObject(null) as Record<string, number>;
  for (let index = 0; index < keys.length; index++) {
    const key = keys[index] as string;
    const descriptor = descriptors[key]!;
    if (
      apply(executeRegularExpression, TARGET_NAME, [key]) === null ||
      !hasOwn(descriptor, "value")
    ) {
      throw new TypeError("Lightning CSS returned invalid browser targets");
    }
    const version = descriptor.value;
    if (
      !isSafeInteger(version) ||
      version < 0 ||
      version > 0xff_ffff
    ) {
      throw new TypeError("Lightning CSS returned invalid browser targets");
    }
    defineProperty(targets, key, {
      value: version,
      enumerable: true,
    });
  }
  return freeze(targets);
}

function datasetIdentity(): string {
  const serialized = apply(stringifyJSON, JSON, [{
    data: browserslist.data,
    defaults: browserslist.defaults,
    nodeVersions: browserslist.nodeVersions,
    usage: browserslist.usage.global,
    versionAliases: browserslist.versionAliases,
  }]);
  if (typeof serialized !== "string") {
    throw new TypeError("Browserslist dataset could not be identified");
  }
  return sha256(serialized);
}

const defaultBrowserQueries = snapshotBrowserQueries(browserslist.defaults)!;
const loadedDatasetIdentity = datasetIdentity();
const loadedRuntimeFlavor = process.env.CSS_TRANSFORMER_WASM
  ? "wasm"
  : `native:${process.platform}:${process.arch}`;

function resolveBrowserTargets(
  queries: readonly string[] | undefined,
): ResolvedTargets {
  const selectedQueries = queries ?? defaultBrowserQueries;
  rejectExternalBrowserQuerySources(selectedQueries);
  const browsers = browserslist(
    copyStrings(selectedQueries),
    createIsolatedBrowserQueryOptions(),
  );
  if (
    !arrayIsArray(browsers) ||
    browsers.length === 0 ||
    browsers.length > MAX_RESOLVED_BROWSERS
  ) {
    throw new TypeError("CSS browser queries resolved to no bounded browser targets");
  }
  const targets = snapshotResolvedTargets(browserslistToTargets(browsers));
  const identityParts = [`dataset=${loadedDatasetIdentity}`];
  const targetKeys = ownKeys(targets) as string[];
  apply(arraySort, targetKeys, []);
  for (let index = 0; index < targetKeys.length; index++) {
    const name = targetKeys[index]!;
    apply(arrayPush, identityParts, [`${name}=${targets[name]!}`]);
  }
  return freeze({
    targets,
    identity: sha256(apply(arrayJoin, identityParts, ["\n"])),
  });
}

function snapshotRequest(request: CSSOptimizationRequest): CSSOptimizationRequest {
  if (typeof request !== "object" || request === null || arrayIsArray(request)) {
    throw new TypeError("CSS optimization request must be an object");
  }
  const descriptors = getOwnPropertyDescriptors(request);
  const keys = ownKeys(descriptors);
  if (
    keys.length !== 4 ||
    !hasOwn(descriptors, "css") ||
    !hasOwn(descriptors, "sourcePath") ||
    !hasOwn(descriptors, "minify") ||
    !hasOwn(descriptors, "sourceMap")
  ) {
    throw new TypeError("CSS optimization request has an invalid shape");
  }
  for (let index = 0; index < keys.length; index++) {
    if (
      keys[index] !== "css" &&
      keys[index] !== "sourcePath" &&
      keys[index] !== "minify" &&
      keys[index] !== "sourceMap"
    ) {
      throw new TypeError("CSS optimization request has an invalid shape");
    }
  }
  const css = dataPropertyValue(descriptors, "css", "CSS optimization css");
  const sourcePath = dataPropertyValue(
    descriptors,
    "sourcePath",
    "CSS optimization sourcePath",
  );
  const minify = dataPropertyValue(
    descriptors,
    "minify",
    "CSS optimization minify",
  );
  const sourceMap = dataPropertyValue(
    descriptors,
    "sourceMap",
    "CSS optimization sourceMap",
  );
  if (typeof css !== "string" || !isWellFormedString(css)) {
    throw new TypeError("CSS optimization css must be a well-formed string");
  }
  if (
    typeof sourcePath !== "string" ||
    sourcePath.length === 0 ||
    sourcePath.length > MAX_SOURCE_PATH_CHARACTERS ||
    !isWellFormedString(sourcePath) ||
    apply(normalizeString, sourcePath, ["NFC"]) !== sourcePath ||
    hasControlOrLineSeparator(sourcePath)
  ) {
    throw new TypeError("CSS optimization sourcePath must be a canonical path");
  }
  if (typeof minify !== "boolean" || typeof sourceMap !== "boolean") {
    throw new TypeError("CSS optimization flags must be booleans");
  }
  return freeze({ css, sourcePath, minify, sourceMap });
}

function isByteView(value: unknown): value is Uint8Array {
  return isArrayBufferView(value) &&
    apply(objectToString, value, []) === "[object Uint8Array]";
}

/** Parser-backed CSS optimizer provided by this extension. */
export class LightningCSSOptimizationEngine implements CSSOptimizationEngine {
  readonly cacheIdentity: string;
  readonly #targets: Readonly<Record<string, number>>;

  constructor(config: LightningCSSOptimizationConfig = {}) {
    const resolved = resolveBrowserTargets(readConfig(config).browserQueries);
    this.#targets = resolved.targets;
    const identityParts = [
      ENGINE_SEMANTICS_VERSION,
      `ext-css-lightning@${extensionVersion}`,
      `lightningcss@${lightningCSSVersion}`,
      `browserslist@${browserslistVersion}`,
      loadedRuntimeFlavor,
      `targets+data=${resolved.identity}`,
    ];
    this.cacheIdentity = apply(arrayJoin, identityParts, [";"]);
    if (
      this.cacheIdentity.length >
        MAX_CSS_OPTIMIZATION_ENGINE_IDENTITY_CHARACTERS
    ) {
      throw new TypeError("ext-css-lightning cache identity exceeds the core limit");
    }
    freeze(this);
  }

  optimize(request: CSSOptimizationRequest): CSSOptimizationResult {
    const input = snapshotRequest(request);
    const result = transform({
      filename: input.sourcePath,
      code: apply(encodeText, encoder, [input.css]),
      minify: input.minify,
      sourceMap: input.sourceMap,
      targets: this.#targets,
      analyzeDependencies: false,
    });
    const descriptors = getOwnPropertyDescriptors(result);
    const code = dataPropertyValue(descriptors, "code", "Lightning CSS code");
    const mapDescriptor = descriptors.map;
    if (mapDescriptor !== undefined && !hasOwn(mapDescriptor, "value")) {
      throw new TypeError("Lightning CSS source map must be a data property");
    }
    const map = mapDescriptor?.value;

    if (!isByteView(code)) {
      throw new TypeError("Lightning CSS returned invalid output bytes");
    }
    if (input.sourceMap && !isByteView(map)) {
      throw new TypeError(
        "Lightning CSS did not return the requested source map",
      );
    }
    if (!input.sourceMap && map !== undefined && map !== null) {
      throw new TypeError("Lightning CSS returned an unrequested source map");
    }

    const css = apply(decodeText, decoder, [code]) as string;
    if (map === undefined || map === null) return freeze({ css });
    return freeze({
      css,
      sourceMap: apply(decodeText, decoder, [map]) as string,
    });
  }
}

const extCSSLightning: ExtensionFactory = (config) => {
  const engine = new LightningCSSOptimizationEngine(readConfig(config));
  return {
    name: "ext-css-lightning",
    version: extensionVersion,
    contracts: {
      provides: ["CSSOptimizationEngine"],
    },
    capabilities: [
      {
        type: "env:read",
        keys: [
          "CSS_TRANSFORMER_WASM",
          "BROWSERSLIST_DISABLE_CACHE",
          "BROWSERSLIST_IGNORE_OLD_DATA",
          "BROWSERSLIST_TRACE_WARNING",
        ],
      },
      { type: "native:ffi" },
    ],
    setup(ctx) {
      ctx.provide(CSSOptimizationEngineName, engine);
      ctx.logger.debug(
        `[ext-css-lightning] ${CSSOptimizationEngineName} registered`,
      );
    },
  };
};

export default extCSSLightning;
