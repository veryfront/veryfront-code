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

const MAX_BROWSER_QUERIES = 32;
const MAX_BROWSER_QUERY_CHARACTERS = 256;
const ENGINE_SEMANTICS_VERSION = "veryfront.css-lightning.v2";
const encoder = new TextEncoder();
const decoder = new TextDecoder("utf-8", { fatal: true });

export interface LightningCSSOptimizationConfig {
  /** Browserslist expressions resolved once when the extension is created. */
  readonly browserQueries?: readonly string[];
}

interface ResolvedTargets {
  readonly targets: Readonly<Record<string, number>>;
  readonly identity: string;
}

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function runtimeFlavor(): string {
  const wasm = process.env.CSS_TRANSFORMER_WASM;
  return wasm ? "wasm" : `native:${process.platform}:${process.arch}`;
}

// Lightning selects native versus WASM while its module is evaluated. Capture
// that flavor once so later environment mutation cannot forge cache identity.
const loadedRuntimeFlavor = runtimeFlavor();

function snapshotBrowserQueries(value: unknown): readonly string[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) {
    throw new TypeError("ext-css-lightning browserQueries must be an array");
  }

  let descriptors: Record<PropertyKey, PropertyDescriptor>;
  try {
    descriptors = Object.getOwnPropertyDescriptors(value) as unknown as Record<
      PropertyKey,
      PropertyDescriptor
    >;
  } catch (cause) {
    throw new TypeError(
      "ext-css-lightning browserQueries could not be inspected",
      { cause },
    );
  }
  const lengthDescriptor = descriptors.length;
  if (
    lengthDescriptor === undefined ||
    !("value" in lengthDescriptor) ||
    !Number.isSafeInteger(lengthDescriptor.value) ||
    lengthDescriptor.value < 1 ||
    lengthDescriptor.value > MAX_BROWSER_QUERIES ||
    Reflect.ownKeys(descriptors).some((key) =>
      typeof key !== "string" ||
      (key !== "length" && !/^\d+$/.test(key))
    )
  ) {
    throw new TypeError(
      "ext-css-lightning browserQueries must be a bounded dense array",
    );
  }

  const queries: string[] = [];
  for (let index = 0; index < lengthDescriptor.value; index++) {
    const descriptor = descriptors[String(index)];
    if (
      descriptor === undefined ||
      !("value" in descriptor) ||
      descriptor.enumerable !== true ||
      typeof descriptor.value !== "string" ||
      descriptor.value.length === 0 ||
      descriptor.value.length > MAX_BROWSER_QUERY_CHARACTERS ||
      descriptor.value.normalize("NFC") !== descriptor.value ||
      /\p{Cc}/u.test(descriptor.value)
    ) {
      throw new TypeError(
        "ext-css-lightning browserQueries must contain bounded data-property strings",
      );
    }
    queries.push(descriptor.value);
  }
  if (Reflect.ownKeys(descriptors).length !== queries.length + 1) {
    throw new TypeError(
      "ext-css-lightning browserQueries must not define custom properties or iterators",
    );
  }
  return Object.freeze(queries);
}

function readConfig(value: unknown): LightningCSSOptimizationConfig {
  if (value === undefined) return Object.freeze({});
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new TypeError("ext-css-lightning config must be an object");
  }

  let descriptors: Record<PropertyKey, PropertyDescriptor>;
  let prototype: object | null;
  try {
    prototype = Object.getPrototypeOf(value);
    descriptors = Object.getOwnPropertyDescriptors(value) as Record<
      PropertyKey,
      PropertyDescriptor
    >;
  } catch (cause) {
    throw new TypeError("ext-css-lightning config could not be inspected", {
      cause,
    });
  }
  if (prototype !== Object.prototype && prototype !== null) {
    throw new TypeError("ext-css-lightning config must not inherit configuration");
  }
  if (
    prototype === Object.prototype &&
    Object.getOwnPropertyDescriptor(prototype, "browserQueries") !== undefined
  ) {
    throw new TypeError("ext-css-lightning config must not inherit browserQueries");
  }
  if (
    Reflect.ownKeys(descriptors).some((key) => key !== "browserQueries")
  ) {
    throw new TypeError("ext-css-lightning config contains unsupported properties");
  }
  const descriptor = descriptors.browserQueries;
  if (descriptor !== undefined && !("value" in descriptor)) {
    throw new TypeError(
      "ext-css-lightning browserQueries must be a data property",
    );
  }
  const browserQueries = snapshotBrowserQueries(descriptor?.value);
  return Object.freeze(
    browserQueries === undefined ? {} : { browserQueries },
  );
}

function copyQueries(queries: readonly string[]): string[] {
  const copy: string[] = [];
  for (let index = 0; index < queries.length; index++) {
    copy.push(queries[index]!);
  }
  return copy;
}

function createIsolatedBrowserQueryOptions(): browserslist.Options {
  return {
    path: false,
    stats: {},
    dangerousExtend: false,
  };
}

function rejectExternalBrowserQuerySources(queries: readonly string[]): void {
  const parsed = browserslist.parse(
    copyQueries(queries),
    createIsolatedBrowserQueryOptions(),
  );
  for (const query of parsed) {
    if (
      query.type === "browserslist_config" ||
      query.type === "extends" ||
      query.type === "popularity_in_config_stats" ||
      query.type === "cover_config"
    ) {
      throw new TypeError(
        "CSS browser queries must not load external configuration or statistics",
      );
    }
  }
}

function snapshotResolvedTargets(value: unknown): Readonly<Record<string, number>> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new TypeError("Lightning CSS returned invalid browser targets");
  }
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const targets: Record<string, number> = Object.create(null);
  for (const key of Object.keys(descriptors).sort()) {
    const descriptor = descriptors[key]!;
    if (
      !/^[a-z][a-z0-9_]*$/.test(key) ||
      !("value" in descriptor) ||
      !Number.isSafeInteger(descriptor.value) ||
      descriptor.value < 0 ||
      descriptor.value > 0xff_ffff
    ) {
      throw new TypeError("Lightning CSS returned invalid browser targets");
    }
    targets[key] = descriptor.value;
  }
  if (Object.keys(targets).length === 0) {
    throw new TypeError("CSS browser queries resolved to no browser targets");
  }
  return Object.freeze(targets);
}

function datasetIdentity(): string {
  return sha256(JSON.stringify({
    data: browserslist.data,
    defaults: browserslist.defaults,
    nodeVersions: browserslist.nodeVersions,
    usage: browserslist.usage.global,
    versionAliases: browserslist.versionAliases,
  }));
}

function resolveBrowserTargets(
  queries: readonly string[] | undefined,
): ResolvedTargets {
  if (queries !== undefined) rejectExternalBrowserQuerySources(queries);
  const browsers = browserslist(
    copyQueries(queries ?? browserslist.defaults),
    createIsolatedBrowserQueryOptions(),
  );
  if (browsers.length === 0) {
    throw new TypeError("CSS browser queries resolved to no browser targets");
  }
  const targets = snapshotResolvedTargets(browserslistToTargets(browsers));
  const targetTuple = Object.keys(targets).sort().map((name) => [
    name,
    targets[name],
  ]);
  return {
    targets,
    identity: sha256(JSON.stringify({
      dataset: datasetIdentity(),
      targets: targetTuple,
    })),
  };
}

function implementationVersion(specifier: string): string {
  const match = specifier.match(/@([^@/]+)$/);
  if (!match?.[1]) {
    throw new TypeError("ext-css-lightning dependency versions must be exact");
  }
  return match[1];
}

/** Parser-backed CSS optimizer provided by this extension. */
export class LightningCSSOptimizationEngine implements CSSOptimizationEngine {
  readonly cacheIdentity: string;
  readonly #targets: Readonly<Record<string, number>>;

  constructor(config: LightningCSSOptimizationConfig = {}) {
    const resolved = resolveBrowserTargets(
      readConfig(config).browserQueries,
    );
    this.#targets = resolved.targets;
    this.cacheIdentity = [
      ENGINE_SEMANTICS_VERSION,
      `ext-css-lightning@${extensionPackage.version}`,
      `lightningcss@${implementationVersion(extensionPackage.imports.lightningcss)}`,
      `browserslist@${implementationVersion(extensionPackage.imports.browserslist)}`,
      loadedRuntimeFlavor,
      `targets+data=${resolved.identity}`,
    ].join(";");
    if (
      this.cacheIdentity.length >
        MAX_CSS_OPTIMIZATION_ENGINE_IDENTITY_CHARACTERS
    ) {
      throw new TypeError("ext-css-lightning cache identity exceeds the core limit");
    }
    Object.freeze(this);
  }

  optimize(request: CSSOptimizationRequest): CSSOptimizationResult {
    const result = transform({
      filename: request.sourcePath,
      code: encoder.encode(request.css),
      minify: request.minify,
      sourceMap: request.sourceMap,
      targets: this.#targets,
      analyzeDependencies: false,
    });
    const map = result.map ?? undefined;

    if (!(result.code instanceof Uint8Array)) {
      throw new TypeError("Lightning CSS returned invalid output bytes");
    }
    if (request.sourceMap && !(map instanceof Uint8Array)) {
      throw new TypeError(
        "Lightning CSS did not return the requested source map",
      );
    }
    if (!request.sourceMap && map !== undefined) {
      throw new TypeError("Lightning CSS returned an unrequested source map");
    }

    return {
      css: decoder.decode(result.code),
      ...(map === undefined ? {} : { sourceMap: decoder.decode(map) }),
    };
  }
}

const extCSSLightning: ExtensionFactory = (config) => {
  const resolvedConfig = readConfig(config);
  const engine = new LightningCSSOptimizationEngine(resolvedConfig);
  return {
    name: "ext-css-lightning",
    version: extensionPackage.version,
    contracts: {
      provides: [CSSOptimizationEngineName],
    },
    capabilities: [
      {
        type: "env:read",
        keys: [
          "CSS_TRANSFORMER_WASM",
          "BROWSERSLIST_DISABLE_CACHE",
          "BROWSERSLIST_DANGEROUS_EXTEND",
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
