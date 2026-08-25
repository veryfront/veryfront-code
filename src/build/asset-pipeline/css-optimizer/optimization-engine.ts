/**
 * Validated invocation boundary for extension-provided CSS optimizers.
 *
 * @module build/asset-pipeline/css-optimizer/optimization-engine
 */

import {
  captureCSSOptimizationEngine,
  type CSSOptimizationEngine,
  CSSOptimizationEngineName,
  type CSSOptimizationRequest,
  type CSSOptimizationResult,
} from "#veryfront/extensions/css/index.ts";
import { resolve } from "#veryfront/extensions/contracts.ts";
import { isWellFormedString } from "#veryfront/utils/is-well-formed-string.ts";
import {
  MAX_CSS_FILE_BYTES,
  MAX_CSS_FILES,
  MAX_CSS_OUTPUT_FILE_BYTES,
  MAX_CSS_SELECTOR_TOKEN_CHARACTERS,
  MAX_CSS_SELECTOR_TOKENS,
} from "./constants.ts";
import { isSafeCSSRelativePath } from "./path-validation.ts";

const apply = Reflect.apply;
const arrayIsArray = Array.isArray;
const freeze = Object.freeze;
const getOwnPropertyDescriptors = Object.getOwnPropertyDescriptors;
const hasOwn = Object.hasOwn;
const ownKeys = Reflect.ownKeys;
const parseJSON = JSON.parse;
const isSafeInteger = Number.isSafeInteger;
const floorNumber = Math.floor;
const encodeText = TextEncoder.prototype.encode;
const charCodeAtString = String.prototype.charCodeAt;
const indexOfString = String.prototype.indexOf;
const sliceString = String.prototype.slice;
const setHas = Set.prototype.has;
const setAdd = Set.prototype.add;
const arrayPush = Array.prototype.push;
const SetConstructor = Set;
const encoder = new TextEncoder();

const REQUEST_PROPERTIES = new SetConstructor<PropertyKey>([
  "css",
  "sourcePath",
  "minify",
  "sourceMap",
]);
const RESULT_PROPERTIES = new SetConstructor<PropertyKey>(["css", "sourceMap"]);
const SOURCE_MAP_PROPERTIES = new SetConstructor<PropertyKey>([
  "version",
  "sources",
  "names",
  "mappings",
  "file",
  "sourceRoot",
  "sourcesContent",
  "ignoreList",
  "x_google_ignoreList",
]);
const SOURCE_MAP_BASE64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

/** Immutable pairing of one captured engine identity and its validated runner. */
export interface CSSOptimizationSession {
  readonly cacheIdentity: string;
  run(request: CSSOptimizationRequest): CSSOptimizationResult;
}

function encodedLength(value: string): number {
  return apply(encodeText, encoder, [value]).length;
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

function requireSafeSourcePath(value: unknown): asserts value is string {
  if (!isSafeCSSRelativePath(value)) {
    throw new TypeError(
      "CSS optimization sourcePath must be a safe canonical non-empty path",
    );
  }
}

function ownDescriptors(
  value: object,
  label: string,
): PropertyDescriptorMap {
  try {
    return getOwnPropertyDescriptors(value);
  } catch (cause) {
    throw new TypeError(`${label} properties could not be inspected`, { cause });
  }
}

function rejectUnknownProperties(
  descriptors: PropertyDescriptorMap,
  allowed: ReadonlySet<PropertyKey>,
  label: string,
): void {
  const keys = ownKeys(descriptors);
  for (let index = 0; index < keys.length; index++) {
    if (!apply(setHas, allowed, [keys[index]])) {
      throw new TypeError(`${label} contains unsupported properties`);
    }
  }
}

function readDataProperty(
  descriptors: PropertyDescriptorMap,
  property: string,
  label: string,
  optional = false,
): unknown {
  const descriptor = descriptors[property];
  if (descriptor === undefined) {
    if (optional) return undefined;
    throw new TypeError(`${label} must define ${property}`);
  }
  if (!hasOwn(descriptor, "value")) {
    throw new TypeError(`${label} ${property} must be a data property`);
  }
  return descriptor.value;
}

function snapshotRequest(
  request: CSSOptimizationRequest,
): CSSOptimizationRequest {
  let requestIsArray: boolean;
  try {
    requestIsArray = arrayIsArray(request);
  } catch (cause) {
    throw new TypeError("CSS optimization request could not be inspected", {
      cause,
    });
  }
  if (typeof request !== "object" || request === null || requestIsArray) {
    throw new TypeError("CSS optimization request must be an object");
  }

  const descriptors = ownDescriptors(request, "CSS optimization request");
  rejectUnknownProperties(
    descriptors,
    REQUEST_PROPERTIES,
    "CSS optimization request",
  );
  const css = readDataProperty(
    descriptors,
    "css",
    "CSS optimization request",
  );
  const sourcePath = readDataProperty(
    descriptors,
    "sourcePath",
    "CSS optimization request",
  );
  const minify = readDataProperty(
    descriptors,
    "minify",
    "CSS optimization request",
  );
  const sourceMap = readDataProperty(
    descriptors,
    "sourceMap",
    "CSS optimization request",
  );

  if (
    typeof css !== "string" ||
    !isWellFormedString(css)
  ) {
    throw new TypeError("CSS optimization input must be a well-formed string");
  }
  if (encodedLength(css) > MAX_CSS_FILE_BYTES) {
    throw new TypeError(`CSS input exceeds ${MAX_CSS_FILE_BYTES} bytes`);
  }
  requireSafeSourcePath(sourcePath);
  if (typeof minify !== "boolean") {
    throw new TypeError("CSS optimization minify must be a boolean");
  }
  if (typeof sourceMap !== "boolean") {
    throw new TypeError("CSS optimization sourceMap must be a boolean");
  }

  return freeze({ css, sourcePath, minify, sourceMap });
}

function isDenseArray(
  value: unknown,
  maximumLength: number,
): value is unknown[] {
  let brandedArray: boolean;
  try {
    brandedArray = arrayIsArray(value);
  } catch {
    return false;
  }
  if (!brandedArray) return false;

  const descriptors = ownDescriptors(value as unknown[], "CSS source-map array");
  const length = readDataProperty(
    descriptors,
    "length",
    "CSS source-map array",
  );
  if (
    !isSafeInteger(length) ||
    (length as number) < 0 ||
    (length as number) > maximumLength
  ) {
    return false;
  }

  const keys = ownKeys(descriptors);
  if (keys.length !== (length as number) + 1) return false;
  for (let index = 0; index < keys.length; index++) {
    if (typeof keys[index] !== "string") return false;
  }
  for (let index = 0; index < (length as number); index++) {
    const descriptor = descriptors[String(index)];
    if (
      descriptor === undefined ||
      !hasOwn(descriptor, "value") ||
      descriptor.enumerable !== true
    ) {
      return false;
    }
  }
  return true;
}

function invalidSourceMap(logicalPath: string): TypeError {
  return new TypeError(`CSS source map is invalid for ${logicalPath}`);
}

function decodeSourceMapVLQ(segment: string): number[] | undefined {
  const values: number[] = [];
  let accumulated = 0;
  let shift = 0;
  let continuing = false;

  for (let index = 0; index < segment.length; index++) {
    const digit = apply(indexOfString, SOURCE_MAP_BASE64, [segment[index]!]);
    if (digit < 0) return undefined;
    const payload = digit % 32;
    continuing = digit >= 32;
    accumulated += payload * 2 ** shift;
    if (!isSafeInteger(accumulated)) return undefined;

    if (continuing) {
      shift += 5;
      if (shift > 50) return undefined;
      continue;
    }

    const negative = accumulated % 2 === 1;
    const magnitude = floorNumber(accumulated / 2);
    if (negative && magnitude === 0) return undefined;
    apply(arrayPush, values, [negative ? -magnitude : magnitude]);
    accumulated = 0;
    shift = 0;
  }

  return continuing ? undefined : values;
}

function validateSourceMapMappings(
  mappings: string,
  sourceCount: number,
  nameCount: number,
  logicalPath: string,
): void {
  let previousSource = 0;
  let previousOriginalLine = 0;
  let previousOriginalColumn = 0;
  let previousName = 0;
  let segmentCount = 0;
  let lineCount = 0;
  let lineStart = 0;

  while (lineStart <= mappings.length) {
    lineCount++;
    if (lineCount > MAX_CSS_SELECTOR_TOKENS) {
      throw invalidSourceMap(logicalPath);
    }
    const separator = apply(indexOfString, mappings, [";", lineStart]);
    const lineEnd = separator < 0 ? mappings.length : separator;
    let previousGeneratedColumn = 0;
    let segmentStart = lineStart;

    while (segmentStart < lineEnd) {
      const comma = apply(indexOfString, mappings, [",", segmentStart]);
      const segmentEnd = comma < 0 || comma > lineEnd ? lineEnd : comma;
      if (segmentEnd === segmentStart) throw invalidSourceMap(logicalPath);
      const values = decodeSourceMapVLQ(
        apply(sliceString, mappings, [segmentStart, segmentEnd]),
      );
      segmentCount++;
      if (
        values === undefined ||
        segmentCount > MAX_CSS_SELECTOR_TOKENS ||
        (values.length !== 1 && values.length !== 4 && values.length !== 5)
      ) {
        throw invalidSourceMap(logicalPath);
      }

      const generatedDelta = values[0]!;
      previousGeneratedColumn += generatedDelta;
      if (
        generatedDelta < 0 ||
        !isSafeInteger(previousGeneratedColumn)
      ) {
        throw invalidSourceMap(logicalPath);
      }

      if (values.length > 1) {
        previousSource += values[1]!;
        previousOriginalLine += values[2]!;
        previousOriginalColumn += values[3]!;
        if (
          !isSafeInteger(previousSource) ||
          previousSource < 0 ||
          previousSource >= sourceCount ||
          !isSafeInteger(previousOriginalLine) ||
          previousOriginalLine < 0 ||
          !isSafeInteger(previousOriginalColumn) ||
          previousOriginalColumn < 0
        ) {
          throw invalidSourceMap(logicalPath);
        }
      }

      if (values.length === 5) {
        previousName += values[4]!;
        if (
          !isSafeInteger(previousName) ||
          previousName < 0 ||
          previousName >= nameCount
        ) {
          throw invalidSourceMap(logicalPath);
        }
      }

      if (segmentEnd === lineEnd) break;
      segmentStart = segmentEnd + 1;
      if (segmentStart === lineEnd) throw invalidSourceMap(logicalPath);
    }

    if (separator < 0) break;
    lineStart = lineEnd + 1;
  }
}

function validateIgnoreList(
  value: unknown,
  sourceCount: number,
  logicalPath: string,
): void {
  if (value === undefined) return;
  if (!isDenseArray(value, sourceCount)) throw invalidSourceMap(logicalPath);
  const seen = new SetConstructor<number>();
  for (let index = 0; index < value.length; index++) {
    const entry = value[index];
    if (
      !isSafeInteger(entry) ||
      (entry as number) < 0 ||
      (entry as number) >= sourceCount ||
      apply(setHas, seen, [entry])
    ) {
      throw invalidSourceMap(logicalPath);
    }
    apply(setAdd, seen, [entry]);
  }
}

function ignoreListsEqual(left: unknown, right: unknown): boolean {
  if (!arrayIsArray(left) || !arrayIsArray(right)) return false;
  if (left.length !== right.length) return false;
  for (let index = 0; index < left.length; index++) {
    if (left[index] !== right[index]) return false;
  }
  return true;
}

/** Validate the complete flat source-map v3 shape accepted at CSS boundaries. */
export function validateCSSSourceMap(
  sourceMap: string,
  logicalPath: string,
): void {
  requireSafeSourcePath(logicalPath);
  if (typeof sourceMap !== "string" || !isWellFormedString(sourceMap)) {
    throw new TypeError(
      `CSS source map must be a well-formed string for ${logicalPath}`,
    );
  }
  if (encodedLength(sourceMap) > MAX_CSS_OUTPUT_FILE_BYTES) {
    throw new TypeError(
      `CSS source map exceeds ${MAX_CSS_OUTPUT_FILE_BYTES} bytes for ${logicalPath}`,
    );
  }

  let parsed: unknown;
  try {
    parsed = apply(parseJSON, JSON, [sourceMap]);
  } catch (cause) {
    throw new TypeError(`CSS source map is malformed for ${logicalPath}`, {
      cause,
    });
  }
  if (
    typeof parsed !== "object" ||
    parsed === null ||
    arrayIsArray(parsed)
  ) {
    throw invalidSourceMap(logicalPath);
  }

  const descriptors = ownDescriptors(parsed, "CSS source map");
  rejectUnknownProperties(
    descriptors,
    SOURCE_MAP_PROPERTIES,
    "CSS source map is invalid",
  );
  const version = readDataProperty(descriptors, "version", "CSS source map");
  const sources = readDataProperty(descriptors, "sources", "CSS source map");
  const names = readDataProperty(descriptors, "names", "CSS source map");
  const mappings = readDataProperty(descriptors, "mappings", "CSS source map");
  const file = readDataProperty(descriptors, "file", "CSS source map", true);
  const sourceRoot = readDataProperty(
    descriptors,
    "sourceRoot",
    "CSS source map",
    true,
  );
  const sourcesContent = readDataProperty(
    descriptors,
    "sourcesContent",
    "CSS source map",
    true,
  );
  const ignoreList = readDataProperty(
    descriptors,
    "ignoreList",
    "CSS source map",
    true,
  );
  const googleIgnoreList = readDataProperty(
    descriptors,
    "x_google_ignoreList",
    "CSS source map",
    true,
  );

  if (
    version !== 3 ||
    !isDenseArray(sources, MAX_CSS_FILES) ||
    sources.length === 0 ||
    !isDenseArray(names, MAX_CSS_SELECTOR_TOKENS) ||
    typeof mappings !== "string" ||
    !isWellFormedString(mappings)
  ) {
    throw invalidSourceMap(logicalPath);
  }
  validateSourceMapMappings(
    mappings,
    sources.length,
    names.length,
    logicalPath,
  );

  for (let index = 0; index < sources.length; index++) {
    if (!isSafeCSSRelativePath(sources[index])) {
      throw invalidSourceMap(logicalPath);
    }
  }
  for (let index = 0; index < names.length; index++) {
    const name = names[index];
    if (
      typeof name !== "string" ||
      name.length > MAX_CSS_SELECTOR_TOKEN_CHARACTERS ||
      !isWellFormedString(name) ||
      hasControlOrLineSeparator(name)
    ) {
      throw invalidSourceMap(logicalPath);
    }
  }
  if (file !== undefined && !isSafeCSSRelativePath(file)) {
    throw invalidSourceMap(logicalPath);
  }
  if (
    sourceRoot !== undefined &&
    sourceRoot !== null &&
    sourceRoot !== "" &&
    !isSafeCSSRelativePath(sourceRoot)
  ) {
    throw invalidSourceMap(logicalPath);
  }
  if (sourcesContent !== undefined) {
    if (
      !isDenseArray(sourcesContent, MAX_CSS_FILES) ||
      sourcesContent.length !== sources.length
    ) {
      throw invalidSourceMap(logicalPath);
    }
    for (let index = 0; index < sourcesContent.length; index++) {
      const content = sourcesContent[index];
      if (
        content !== null &&
        (typeof content !== "string" ||
          !isWellFormedString(content) ||
          encodedLength(content) > MAX_CSS_FILE_BYTES)
      ) {
        throw invalidSourceMap(logicalPath);
      }
    }
  }
  validateIgnoreList(ignoreList, sources.length, logicalPath);
  validateIgnoreList(googleIgnoreList, sources.length, logicalPath);
  if (
    ignoreList !== undefined &&
    googleIgnoreList !== undefined &&
    !ignoreListsEqual(ignoreList, googleIgnoreList)
  ) {
    throw invalidSourceMap(logicalPath);
  }
}

function validateResult(
  value: unknown,
  request: CSSOptimizationRequest,
): CSSOptimizationResult {
  let resultIsArray: boolean;
  try {
    resultIsArray = arrayIsArray(value);
  } catch (cause) {
    throw new TypeError("CSSOptimizationEngine result could not be inspected", {
      cause,
    });
  }
  if (typeof value !== "object" || value === null || resultIsArray) {
    throw new TypeError("CSSOptimizationEngine must return an object");
  }

  const descriptors = ownDescriptors(value, "CSSOptimizationEngine result");
  const css = readDataProperty(
    descriptors,
    "css",
    "CSSOptimizationEngine result",
  );
  rejectUnknownProperties(
    descriptors,
    RESULT_PROPERTIES,
    "CSSOptimizationEngine result",
  );
  const sourceMap = readDataProperty(
    descriptors,
    "sourceMap",
    "CSSOptimizationEngine result",
    true,
  );
  if (typeof css !== "string" || !isWellFormedString(css)) {
    throw new TypeError(
      "CSSOptimizationEngine must return CSS as a well-formed string",
    );
  }
  if (encodedLength(css) > MAX_CSS_OUTPUT_FILE_BYTES) {
    throw new TypeError(`CSS output exceeds ${MAX_CSS_OUTPUT_FILE_BYTES} bytes`);
  }
  if (request.sourceMap) {
    if (typeof sourceMap !== "string") {
      throw new TypeError(
        "CSSOptimizationEngine did not return the requested source map",
      );
    }
    validateCSSSourceMap(sourceMap, request.sourcePath);
    return freeze({ css, sourceMap });
  }
  if (sourceMap !== undefined) {
    throw new TypeError(
      "CSSOptimizationEngine returned an unrequested source map",
    );
  }
  return freeze({ css });
}

/** Invoke one concrete engine through the validated, immutable boundary. */
export function runCSSOptimizationEngine(
  engine: CSSOptimizationEngine,
  request: CSSOptimizationRequest,
): CSSOptimizationResult {
  return createCSSOptimizationSession(engine).run(request);
}

/** Capture one engine exactly once for both cache identity and execution. */
export function createCSSOptimizationSession(
  engine: CSSOptimizationEngine,
): CSSOptimizationSession {
  const captured = captureCSSOptimizationEngine(engine);
  return freeze({
    cacheIdentity: captured.cacheIdentity,
    run(request: CSSOptimizationRequest): CSSOptimizationResult {
      const input = snapshotRequest(request);
      return validateResult(captured.optimize(input), input);
    },
  });
}

/** Resolve the explicitly composed engine and invoke it synchronously. */
export function runConfiguredCSSOptimization(
  request: CSSOptimizationRequest,
): CSSOptimizationResult {
  return acquireConfiguredCSSOptimization().run(request);
}

/** Resolve and capture one configured engine/identity pair for an operation. */
export function acquireConfiguredCSSOptimization(): CSSOptimizationSession {
  const engine = resolve<unknown>(CSSOptimizationEngineName);
  return createCSSOptimizationSession(engine as CSSOptimizationEngine);
}
