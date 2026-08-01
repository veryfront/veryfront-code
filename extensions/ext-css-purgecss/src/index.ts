/** PurgeCSS implementation of the provider-neutral CSS purging contract. */

import type { ExtensionFactory } from "veryfront/extensions";
import {
  type CSSPurgeContentSource,
  type CSSPurgingEngine,
  CSSPurgingEngineName,
  type CSSPurgingRequest,
  type CSSPurgingResult,
} from "veryfront/extensions/css";
import { PurgeCSS } from "purgecss";
import extensionPackage from "../deno.json" with { type: "json" };

const arrayIsArray = Array.isArray;
const freeze = Object.freeze;
const getOwnPropertyDescriptor = Object.getOwnPropertyDescriptor;
const getOwnPropertyDescriptors = Object.getOwnPropertyDescriptors;
const getPrototypeOf = Object.getPrototypeOf;
const hasOwn = Object.hasOwn;
const objectPrototype = Object.prototype;
const ownKeys = Reflect.ownKeys;
const executeRegularExpression = RegExp.prototype.exec;
const apply = Reflect.apply;
const purgeCSSPurge = PurgeCSS.prototype.purge;
const EXACT_NPM_SPECIFIER_PATTERN =
  /^npm:purgecss@((?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*))$/;
const ENGINE_SEMANTICS_VERSION = "veryfront.css-purgecss.v1";
const PROVIDER_RESULT_KEYS = freeze(
  [
    "css",
    "file",
    "rejectedCss",
  ] as const,
);

function dependencyVersion(specifier: string): string {
  const match = apply(executeRegularExpression, EXACT_NPM_SPECIFIER_PATTERN, [
    specifier,
  ]) as RegExpExecArray | null;
  if (match?.[1] === undefined) {
    throw new TypeError(
      "ext-css-purgecss dependency must use an exact npm version",
    );
  }
  return match[1];
}

function assertEmptyConfig(value: unknown): void {
  if (value === undefined) return;
  if (typeof value !== "object" || value === null) {
    throw new TypeError("ext-css-purgecss config must be an object");
  }
  let isArray: boolean;
  let prototype: object | null;
  let keys: PropertyKey[];
  try {
    isArray = arrayIsArray(value);
    prototype = getPrototypeOf(value);
    keys = ownKeys(getOwnPropertyDescriptors(value));
  } catch (cause) {
    throw new TypeError("ext-css-purgecss config could not be inspected", {
      cause,
    });
  }
  if (isArray) {
    throw new TypeError("ext-css-purgecss config must be an object");
  }
  if (prototype !== objectPrototype && prototype !== null) {
    throw new TypeError(
      "ext-css-purgecss config must not inherit configuration",
    );
  }
  if (keys.length !== 0) {
    throw new TypeError(
      "ext-css-purgecss does not accept configuration properties",
    );
  }
}

function inspectArray(value: unknown, label: string): value is unknown[] {
  try {
    return arrayIsArray(value);
  } catch (cause) {
    throw new TypeError(`${label} could not be inspected`, { cause });
  }
}

function descriptorValue(
  value: object,
  property: string,
  label: string,
  required: boolean,
  enumerable = true,
): unknown {
  let descriptor: PropertyDescriptor | undefined;
  try {
    descriptor = getOwnPropertyDescriptor(value, property);
  } catch (cause) {
    throw new TypeError(`${label} could not be inspected`, { cause });
  }
  if (descriptor === undefined) {
    if (!required) return undefined;
    throw new TypeError(`${label} must define ${property}`);
  }
  if (!hasOwn(descriptor, "value") || descriptor.enumerable !== enumerable) {
    throw new TypeError(`${label} ${property} must be an own data property`);
  }
  return descriptor.value;
}

function copyContent(
  content: readonly CSSPurgeContentSource[],
): Array<{ raw: string; extension: string }> {
  const copied: Array<{ raw: string; extension: string }> = [];
  for (let index = 0; index < content.length; index++) {
    const source = content[index]!;
    copied[index] = { raw: source.raw, extension: source.extension };
  }
  return copied;
}

function copyStrings(values: readonly string[]): string[] {
  const copied: string[] = [];
  for (let index = 0; index < values.length; index++) {
    copied[index] = values[index]!;
  }
  return copied;
}

function providerResult(
  value: unknown,
  includeRejectedCSS: boolean,
): CSSPurgingResult {
  if (!inspectArray(value, "PurgeCSS result")) {
    throw new TypeError("PurgeCSS returned a non-array result");
  }
  const length = descriptorValue(
    value,
    "length",
    "PurgeCSS result",
    true,
    false,
  );
  if (length !== 1) {
    throw new TypeError("PurgeCSS must return exactly one result");
  }
  let arrayKeys: PropertyKey[];
  try {
    arrayKeys = ownKeys(getOwnPropertyDescriptors(value));
  } catch (cause) {
    throw new TypeError("PurgeCSS result could not be inspected", { cause });
  }
  let hasEntry = false;
  let hasLength = false;
  for (let index = 0; index < arrayKeys.length; index++) {
    if (arrayKeys[index] === "0") hasEntry = true;
    if (arrayKeys[index] === "length") hasLength = true;
  }
  if (arrayKeys.length !== 2 || !hasEntry || !hasLength) {
    throw new TypeError("PurgeCSS returned unsupported result entries");
  }
  const entry = descriptorValue(value, "0", "PurgeCSS result", true);
  if (
    typeof entry !== "object" ||
    entry === null ||
    inspectArray(entry, "PurgeCSS result entry")
  ) {
    throw new TypeError("PurgeCSS returned an invalid result entry");
  }
  let keys: PropertyKey[];
  try {
    keys = ownKeys(getOwnPropertyDescriptors(entry));
  } catch (cause) {
    throw new TypeError("PurgeCSS result entry could not be inspected", {
      cause,
    });
  }
  for (let keyIndex = 0; keyIndex < keys.length; keyIndex++) {
    const key = keys[keyIndex]!;
    let allowed = false;
    for (let index = 0; index < PROVIDER_RESULT_KEYS.length; index++) {
      if (PROVIDER_RESULT_KEYS[index] === key) {
        allowed = true;
        break;
      }
    }
    if (!allowed) {
      throw new TypeError("PurgeCSS returned unsupported result properties");
    }
  }

  const css = descriptorValue(entry, "css", "PurgeCSS result entry", true);
  if (typeof css !== "string") {
    throw new TypeError("PurgeCSS result css must be a string");
  }
  const file = descriptorValue(
    entry,
    "file",
    "PurgeCSS result entry",
    false,
  );
  if (file !== undefined) {
    throw new TypeError("PurgeCSS returned an unexpected file-backed result");
  }
  let rejectedDescriptor: PropertyDescriptor | undefined;
  try {
    rejectedDescriptor = getOwnPropertyDescriptor(entry, "rejectedCss");
  } catch (cause) {
    throw new TypeError("PurgeCSS result entry could not be inspected", {
      cause,
    });
  }
  const rejectedCSS = includeRejectedCSS
    ? descriptorValue(
      entry,
      "rejectedCss",
      "PurgeCSS result entry",
      true,
    )
    : undefined;
  if (includeRejectedCSS && typeof rejectedCSS !== "string") {
    throw new TypeError("PurgeCSS omitted requested rejected CSS");
  }
  if (!includeRejectedCSS && rejectedDescriptor !== undefined) {
    throw new TypeError("PurgeCSS returned unrequested rejected CSS");
  }
  return freeze({
    css,
    ...(typeof rejectedCSS === "string" ? { rejectedCSS } : {}),
  });
}

/** Explicit PurgeCSS provider. Invoke it through core's validated session. */
class PurgeCSSPurgingEngine implements CSSPurgingEngine {
  readonly cacheIdentity: string;

  constructor() {
    this.cacheIdentity =
      `${ENGINE_SEMANTICS_VERSION};ext-css-purgecss@${extensionPackage.version};purgecss@${
        dependencyVersion(extensionPackage.imports.purgecss)
      }`;
    freeze(this);
  }

  async purge(request: CSSPurgingRequest): Promise<CSSPurgingResult> {
    const results = await apply(purgeCSSPurge, new PurgeCSS(), [{
      content: copyContent(request.content),
      css: [{ raw: request.css }],
      safelist: copyStrings(request.safelist),
      rejectedCss: request.includeRejectedCSS,
    }]);
    return providerResult(results, request.includeRejectedCSS);
  }
}

const extCSSPurgeCSS: ExtensionFactory = (config) => {
  assertEmptyConfig(config);
  const engine = new PurgeCSSPurgingEngine();
  return {
    name: "ext-css-purgecss",
    version: extensionPackage.version,
    contracts: { provides: ["CSSPurgingEngine"] },
    capabilities: [{ type: "system:read", apis: ["cpus"] }],
    setup(ctx) {
      ctx.provide(CSSPurgingEngineName, engine);
      ctx.logger.debug(
        `[ext-css-purgecss] ${CSSPurgingEngineName} registered`,
      );
    },
  };
};

export default extCSSPurgeCSS;
