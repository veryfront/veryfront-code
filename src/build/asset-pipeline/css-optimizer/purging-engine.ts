/** Validated invocation boundary for extension-provided CSS purging engines. */

import {
  captureCSSPurgingEngine,
  type CSSPurgeContentSource,
  type CSSPurgingEngine,
  CSSPurgingEngineName,
  type CSSPurgingRequest,
  type CSSPurgingResult,
} from "#veryfront/extensions/css/index.ts";
import { resolve } from "#veryfront/extensions/contracts.ts";
import {
  MAX_CSS_FILE_BYTES,
  MAX_CSS_FILES,
  MAX_CSS_OUTPUT_FILE_BYTES,
  MAX_CSS_PURGE_SAFELIST_ENTRIES,
  MAX_CSS_SELECTOR_TOKEN_CHARACTERS,
  MAX_CSS_TOTAL_BYTES,
  MAX_CSS_TOTAL_OUTPUT_BYTES,
} from "./constants.ts";
import {
  inspectedProperty,
  inspectOwnProperties,
  isArrayValue,
  readOwnDataProperty,
  rejectUnknownOwnProperties,
  snapshotDenseDataArray,
} from "./data-snapshot.ts";

const apply = Reflect.apply;
const encode = TextEncoder.prototype.encode;
const executeRegularExpression = RegExp.prototype.exec;
const freeze = Object.freeze;
const isWellFormed = String.prototype.isWellFormed;
const normalize = String.prototype.normalize;
const stringCharacterCodeAt = String.prototype.charCodeAt;
const weakSetAdd = WeakSet.prototype.add;
const weakSetHas = WeakSet.prototype.has;
const encoder = new TextEncoder();
const capturedSessions = new WeakSet<object>();
const CONTENT_EXTENSION_PATTERN = /^[a-z0-9]+$/;
const REQUEST_KEYS = freeze(
  [
    "css",
    "content",
    "safelist",
    "includeRejectedCSS",
  ] as const,
);
const CONTENT_KEYS = freeze(["raw", "extension"] as const);
const RESULT_KEYS = freeze(["css", "rejectedCSS"] as const);

export interface CSSPurgingSession {
  /** Immutable provider/version identity captured with the implementation. */
  readonly cacheIdentity: string;
  /** Run one operation through the captured implementation. */
  run(request: CSSPurgingRequest): Promise<CSSPurgingResult>;
}

/** Ensure callers cannot substitute a session that bypasses this boundary. */
export function assertCSSPurgingSession(
  value: unknown,
): asserts value is CSSPurgingSession {
  if (
    typeof value !== "object" ||
    value === null ||
    !apply(weakSetHas, capturedSessions, [value])
  ) {
    throw new TypeError("CSS purging session must be created by core");
  }
}

function byteLength(value: string): number {
  return apply(encode, encoder, [value]).byteLength;
}

function matches(pattern: RegExp, value: string): boolean {
  return apply(executeRegularExpression, pattern, [value]) !== null;
}

function hasControlCharacters(value: string): boolean {
  for (let index = 0; index < value.length; index++) {
    const code = apply(stringCharacterCodeAt, value, [index]) as number;
    if (code <= 0x1f || (code >= 0x7f && code <= 0x9f)) return true;
  }
  return false;
}

function snapshotContent(value: unknown): readonly CSSPurgeContentSource[] {
  const candidates = snapshotDenseDataArray(
    value,
    MAX_CSS_FILES,
    "CSS purge content",
  );
  if (candidates.length === 0) {
    throw new TypeError("CSS purging requires at least one content source");
  }

  let totalBytes = 0;
  const result: CSSPurgeContentSource[] = [];
  for (let index = 0; index < candidates.length; index++) {
    const candidate = candidates[index];
    if (
      typeof candidate !== "object" ||
      candidate === null ||
      isArrayValue(candidate, "CSS purge content source")
    ) {
      throw new TypeError("CSS purge content source is malformed");
    }
    const values = inspectOwnProperties(candidate, "CSS purge content source");
    rejectUnknownOwnProperties(
      values,
      CONTENT_KEYS,
      "CSS purge content source",
    );
    const raw = readOwnDataProperty(
      values,
      "raw",
      "CSS purge content source",
      true,
    );
    const extension = readOwnDataProperty(
      values,
      "extension",
      "CSS purge content source",
      true,
    );
    if (
      typeof raw !== "string" ||
      typeof extension !== "string" ||
      extension.length === 0 ||
      extension.length > 32 ||
      !matches(CONTENT_EXTENSION_PATTERN, extension)
    ) {
      throw new TypeError("CSS purge content source is malformed");
    }
    const bytes = byteLength(raw);
    if (bytes > MAX_CSS_FILE_BYTES) {
      throw new TypeError(
        `CSS purge content exceeds ${MAX_CSS_FILE_BYTES} bytes`,
      );
    }
    totalBytes += bytes;
    if (totalBytes > MAX_CSS_TOTAL_BYTES) {
      throw new TypeError(
        `CSS purge content exceeds ${MAX_CSS_TOTAL_BYTES} total bytes`,
      );
    }
    result[result.length] = freeze({ raw, extension });
  }
  return freeze(result);
}

function snapshotSafelist(value: unknown): readonly string[] {
  const candidates = snapshotDenseDataArray(
    value,
    MAX_CSS_PURGE_SAFELIST_ENTRIES,
    "CSS purge safelist",
  );
  const result: string[] = [];
  for (let index = 0; index < candidates.length; index++) {
    const candidate = candidates[index];
    if (
      typeof candidate !== "string" ||
      candidate.length === 0 ||
      candidate.length > MAX_CSS_SELECTOR_TOKEN_CHARACTERS ||
      !apply(isWellFormed, candidate, []) ||
      apply(normalize, candidate, ["NFC"]) !== candidate ||
      hasControlCharacters(candidate) ||
      matches(/\s/u, candidate)
    ) {
      throw new TypeError("CSS purge safelist contains an unsafe token");
    }
    result[result.length] = candidate;
  }
  return freeze(result);
}

function snapshotRequest(value: CSSPurgingRequest): CSSPurgingRequest {
  if (
    typeof value !== "object" ||
    value === null ||
    isArrayValue(value, "CSS purging request")
  ) {
    throw new TypeError("CSS purging request must be an object");
  }
  const values = inspectOwnProperties(value, "CSS purging request");
  rejectUnknownOwnProperties(values, REQUEST_KEYS, "CSS purging request");
  const css = readOwnDataProperty(values, "css", "CSS purging request", true);
  const includeRejectedCSS = readOwnDataProperty(
    values,
    "includeRejectedCSS",
    "CSS purging request",
    true,
  );
  if (typeof css !== "string" || byteLength(css) > MAX_CSS_FILE_BYTES) {
    throw new TypeError(
      `CSS purge input must be a string of at most ${MAX_CSS_FILE_BYTES} bytes`,
    );
  }
  if (typeof includeRejectedCSS !== "boolean") {
    throw new TypeError("CSS purging includeRejectedCSS must be a boolean");
  }
  return freeze({
    css,
    content: snapshotContent(
      readOwnDataProperty(values, "content", "CSS purging request", true),
    ),
    safelist: snapshotSafelist(
      readOwnDataProperty(values, "safelist", "CSS purging request", true),
    ),
    includeRejectedCSS,
  });
}

function snapshotResult(
  value: unknown,
  includeRejectedCSS: boolean,
): CSSPurgingResult {
  if (
    typeof value !== "object" ||
    value === null ||
    isArrayValue(value, "CSS purging result")
  ) {
    throw new TypeError("CSSPurgingEngine returned an invalid result");
  }
  const values = inspectOwnProperties(value, "CSS purging result");
  rejectUnknownOwnProperties(values, RESULT_KEYS, "CSS purging result");
  const css = readOwnDataProperty(values, "css", "CSS purging result", true);
  const rejectedDescriptor = inspectedProperty(values, "rejectedCSS");
  if (typeof css !== "string") {
    throw new TypeError("CSSPurgingEngine result css must be a string");
  }

  let rejectedCSS: string | undefined;
  if (includeRejectedCSS) {
    rejectedCSS = readOwnDataProperty(
      values,
      "rejectedCSS",
      "CSS purging result",
      true,
    ) as string;
    if (typeof rejectedCSS !== "string") {
      throw new TypeError(
        "CSSPurgingEngine did not return requested rejected CSS",
      );
    }
  } else if (rejectedDescriptor !== undefined) {
    throw new TypeError("CSSPurgingEngine returned unrequested rejected CSS");
  }

  const cssBytes = byteLength(css);
  const rejectedBytes = rejectedCSS === undefined ? 0 : byteLength(rejectedCSS);
  if (
    cssBytes > MAX_CSS_OUTPUT_FILE_BYTES ||
    rejectedBytes > MAX_CSS_OUTPUT_FILE_BYTES ||
    cssBytes + rejectedBytes > MAX_CSS_TOTAL_OUTPUT_BYTES
  ) {
    throw new TypeError(
      "CSS purging output exceeds the configured resource limits",
    );
  }
  return freeze({
    css,
    ...(rejectedCSS === undefined ? {} : { rejectedCSS }),
  });
}

/** Capture a provider and validate every request/result crossing its boundary. */
export function createCSSPurgingSession(
  engine: CSSPurgingEngine,
): CSSPurgingSession {
  const captured = captureCSSPurgingEngine(engine);
  const session: CSSPurgingSession = freeze({
    cacheIdentity: captured.cacheIdentity,
    async run(request: CSSPurgingRequest): Promise<CSSPurgingResult> {
      const input = snapshotRequest(request);
      const result = await captured.purge(input);
      return snapshotResult(result, input.includeRejectedCSS);
    },
  });
  apply(weakSetAdd, capturedSessions, [session]);
  return session;
}

/** Resolve and capture the currently configured provider for one operation. */
export function acquireConfiguredCSSPurging(): CSSPurgingSession {
  return createCSSPurgingSession(
    resolve<CSSPurgingEngine>(CSSPurgingEngineName),
  );
}
