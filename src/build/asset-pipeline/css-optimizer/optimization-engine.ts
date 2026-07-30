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
import { MAX_PATH_LENGTH_CHARS } from "#veryfront/utils/constants/limits.ts";
import { hasControlCharacters } from "../../utils/string-validation.ts";
import {
  MAX_CSS_FILE_BYTES,
  MAX_CSS_FILES,
  MAX_CSS_OUTPUT_FILE_BYTES,
  MAX_CSS_SELECTOR_TOKEN_CHARACTERS,
  MAX_CSS_SELECTOR_TOKENS,
} from "./constants.ts";
import { isSafeCSSRelativePath } from "./path-validation.ts";

const encoder = new TextEncoder();
const REQUEST_PROPERTIES = new Set<PropertyKey>([
  "css",
  "sourcePath",
  "minify",
  "sourceMap",
]);
const RESULT_PROPERTIES = new Set<PropertyKey>(["css", "sourceMap"]);
const SOURCE_MAP_PROPERTIES = new Set([
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

function requireSafeSourcePath(value: unknown): asserts value is string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > MAX_PATH_LENGTH_CHARS ||
    value.normalize("NFC") !== value ||
    hasControlCharacters(value)
  ) {
    throw new TypeError("CSS optimization sourcePath must be a safe non-empty path");
  }
}

function ownDescriptors(
  value: object,
  label: string,
): PropertyDescriptorMap {
  try {
    return Object.getOwnPropertyDescriptors(value);
  } catch (cause) {
    throw new TypeError(`${label} properties could not be inspected`, { cause });
  }
}

function rejectUnknownProperties(
  descriptors: PropertyDescriptorMap,
  allowed: ReadonlySet<PropertyKey>,
  label: string,
): void {
  const unknown = Reflect.ownKeys(descriptors).filter((key) => !allowed.has(key));
  if (unknown.length > 0) {
    throw new TypeError(`${label} contains unsupported properties`);
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
  if (!("value" in descriptor)) {
    throw new TypeError(`${label} ${property} must be a data property`);
  }
  return descriptor.value;
}

function snapshotRequest(request: CSSOptimizationRequest): CSSOptimizationRequest {
  if (typeof request !== "object" || request === null || Array.isArray(request)) {
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

  if (typeof css !== "string") {
    throw new TypeError("CSS optimization input must be a string");
  }
  if (encoder.encode(css).length > MAX_CSS_FILE_BYTES) {
    throw new TypeError(`CSS input exceeds ${MAX_CSS_FILE_BYTES} bytes`);
  }
  requireSafeSourcePath(sourcePath);
  if (typeof minify !== "boolean") {
    throw new TypeError("CSS optimization minify must be a boolean");
  }
  if (typeof sourceMap !== "boolean") {
    throw new TypeError("CSS optimization sourceMap must be a boolean");
  }

  return Object.freeze({
    css,
    sourcePath,
    minify,
    sourceMap,
  });
}

function isDenseArray(value: unknown, maximumLength: number): value is unknown[] {
  if (!Array.isArray(value) || value.length > maximumLength) return false;
  const descriptors = ownDescriptors(value, "CSS source-map array");
  const keys = Reflect.ownKeys(descriptors);
  if (keys.some((key) => typeof key !== "string" || (key !== "length" && !/^\d+$/.test(key)))) {
    return false;
  }
  for (let index = 0; index < value.length; index++) {
    const descriptor = descriptors[String(index)];
    if (
      descriptor === undefined ||
      !("value" in descriptor) ||
      descriptor.enumerable !== true
    ) {
      return false;
    }
  }
  return keys.length === value.length + 1;
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
    const digit = SOURCE_MAP_BASE64.indexOf(segment[index]!);
    if (digit < 0) return undefined;
    const payload = digit % 32;
    continuing = digit >= 32;
    accumulated += payload * 2 ** shift;
    if (!Number.isSafeInteger(accumulated)) return undefined;

    if (continuing) {
      shift += 5;
      if (shift > 50) return undefined;
      continue;
    }

    const negative = accumulated % 2 === 1;
    const magnitude = Math.floor(accumulated / 2);
    values.push(negative ? -magnitude : magnitude);
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
    const separator = mappings.indexOf(";", lineStart);
    const lineEnd = separator < 0 ? mappings.length : separator;
    let previousGeneratedColumn = 0;
    let segmentStart = lineStart;

    while (segmentStart < lineEnd) {
      const comma = mappings.indexOf(",", segmentStart);
      const segmentEnd = comma < 0 || comma > lineEnd ? lineEnd : comma;
      if (segmentEnd === segmentStart) throw invalidSourceMap(logicalPath);
      const values = decodeSourceMapVLQ(
        mappings.slice(segmentStart, segmentEnd),
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
        !Number.isSafeInteger(previousGeneratedColumn)
      ) {
        throw invalidSourceMap(logicalPath);
      }

      if (values.length > 1) {
        previousSource += values[1]!;
        previousOriginalLine += values[2]!;
        previousOriginalColumn += values[3]!;
        if (
          !Number.isSafeInteger(previousSource) ||
          previousSource < 0 ||
          previousSource >= sourceCount ||
          !Number.isSafeInteger(previousOriginalLine) ||
          previousOriginalLine < 0 ||
          !Number.isSafeInteger(previousOriginalColumn) ||
          previousOriginalColumn < 0
        ) {
          throw invalidSourceMap(logicalPath);
        }
      }

      if (values.length === 5) {
        previousName += values[4]!;
        if (
          !Number.isSafeInteger(previousName) ||
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
  const seen = new Set<number>();
  for (let index = 0; index < value.length; index++) {
    const entry = value[index];
    if (
      !Number.isSafeInteger(entry) ||
      (entry as number) < 0 ||
      (entry as number) >= sourceCount ||
      seen.has(entry as number)
    ) {
      throw invalidSourceMap(logicalPath);
    }
    seen.add(entry as number);
  }
}

/** Validate the complete source-map v3 shape accepted at every CSS boundary. */
export function validateCSSSourceMap(
  sourceMap: string,
  logicalPath: string,
): void {
  if (
    typeof sourceMap !== "string" ||
    encoder.encode(sourceMap).length > MAX_CSS_OUTPUT_FILE_BYTES
  ) {
    throw new TypeError(
      `CSS source map exceeds ${MAX_CSS_OUTPUT_FILE_BYTES} bytes for ${logicalPath}`,
    );
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(sourceMap);
  } catch (cause) {
    throw new TypeError(`CSS source map is malformed for ${logicalPath}`, {
      cause,
    });
  }
  if (
    typeof parsed !== "object" ||
    parsed === null ||
    Array.isArray(parsed)
  ) {
    throw invalidSourceMap(logicalPath);
  }

  const map = parsed as Record<string, unknown>;
  if (Object.keys(map).some((property) => !SOURCE_MAP_PROPERTIES.has(property))) {
    throw invalidSourceMap(logicalPath);
  }
  const sources = map.sources;
  const names = map.names;
  const mappings = map.mappings;
  if (
    map.version !== 3 ||
    !isDenseArray(sources, MAX_CSS_FILES) ||
    sources.length === 0 ||
    !isDenseArray(names, MAX_CSS_SELECTOR_TOKENS) ||
    typeof mappings !== "string"
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
      hasControlCharacters(name)
    ) {
      throw invalidSourceMap(logicalPath);
    }
  }
  if (map.file !== undefined && !isSafeCSSRelativePath(map.file)) {
    throw invalidSourceMap(logicalPath);
  }
  if (
    map.sourceRoot !== undefined &&
    map.sourceRoot !== null &&
    !isSafeCSSRelativePath(map.sourceRoot)
  ) {
    throw invalidSourceMap(logicalPath);
  }
  if (map.sourcesContent !== undefined) {
    if (
      !isDenseArray(map.sourcesContent, MAX_CSS_FILES) ||
      map.sourcesContent.length !== sources.length
    ) {
      throw invalidSourceMap(logicalPath);
    }
    for (let index = 0; index < map.sourcesContent.length; index++) {
      const content = map.sourcesContent[index];
      if (
        content !== null &&
        (typeof content !== "string" ||
          encoder.encode(content).length > MAX_CSS_FILE_BYTES)
      ) {
        throw invalidSourceMap(logicalPath);
      }
    }
  }
  validateIgnoreList(map.ignoreList, sources.length, logicalPath);
  validateIgnoreList(map.x_google_ignoreList, sources.length, logicalPath);
  if (
    map.ignoreList !== undefined &&
    map.x_google_ignoreList !== undefined &&
    JSON.stringify(map.ignoreList) !== JSON.stringify(map.x_google_ignoreList)
  ) {
    throw invalidSourceMap(logicalPath);
  }
}

function validateResult(
  value: unknown,
  request: CSSOptimizationRequest,
): CSSOptimizationResult {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new TypeError("CSSOptimizationEngine must return an object");
  }
  const descriptors = ownDescriptors(value, "CSSOptimizationEngine result");
  rejectUnknownProperties(
    descriptors,
    RESULT_PROPERTIES,
    "CSSOptimizationEngine result",
  );
  const css = readDataProperty(
    descriptors,
    "css",
    "CSSOptimizationEngine result",
  );
  const sourceMap = readDataProperty(
    descriptors,
    "sourceMap",
    "CSSOptimizationEngine result",
    true,
  );
  if (typeof css !== "string") {
    throw new TypeError("CSSOptimizationEngine must return CSS as a string");
  }
  if (encoder.encode(css).length > MAX_CSS_OUTPUT_FILE_BYTES) {
    throw new TypeError(`CSS output exceeds ${MAX_CSS_OUTPUT_FILE_BYTES} bytes`);
  }
  if (request.sourceMap) {
    if (typeof sourceMap !== "string") {
      throw new TypeError("CSSOptimizationEngine did not return the requested source map");
    }
    validateCSSSourceMap(sourceMap, request.sourcePath);
    return { css, sourceMap };
  }
  if (sourceMap !== undefined) {
    throw new TypeError("CSSOptimizationEngine returned an unrequested source map");
  }
  return { css };
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
  return Object.freeze({
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
