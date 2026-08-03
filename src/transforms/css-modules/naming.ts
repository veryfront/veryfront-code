/**
 * CSS Module naming and selector rewriting helpers.
 *
 * Provides deterministic class-name scoping that is stable across
 * transform/runtime boundaries and HTML CSS aggregation.
 */

const CSS_MODULE_EXTENSION = ".module.css";

/**
 * Normalize a module key to a stable slash-based format.
 * Removes query/hash suffixes and normalizes duplicate separators.
 */
export function normalizeCssModuleKey(path: string): string {
  const withoutFilePrefix = path.startsWith("file://") ? path.slice("file://".length) : path;
  const withoutQuery = withoutFilePrefix.replace(/[?#].*$/, "");
  const slashed = withoutQuery.replace(/\\/g, "/");
  const collapsed = slashed.replace(/\/{2,}/g, "/");
  if (collapsed.startsWith("/")) return collapsed;
  if (collapsed.startsWith("http://") || collapsed.startsWith("https://")) return collapsed;
  return `/${collapsed.replace(/^\/+/, "")}`;
}

function dirname(path: string): string {
  const normalized = normalizeCssModuleKey(path);
  const lastSlash = normalized.lastIndexOf("/");
  return lastSlash <= 0 ? "/" : normalized.slice(0, lastSlash);
}

function normalizePathSegments(path: string): string {
  const normalized = normalizeCssModuleKey(path);
  if (normalized.startsWith("http://") || normalized.startsWith("https://")) return normalized;

  const parts = normalized.split("/").filter(Boolean);
  const resolved: string[] = [];

  for (const part of parts) {
    if (part === ".") continue;
    if (part === "..") {
      resolved.pop();
      continue;
    }
    resolved.push(part);
  }

  return `/${resolved.join("/")}`;
}

/**
 * Resolve a CSS import specifier to a deterministic module key.
 * Supports relative imports, @/ aliases, absolute paths, and URLs.
 */
export function resolveCssModuleKey(
  specifier: string,
  importerFilePath: string,
  projectDir: string,
): string {
  if (specifier.startsWith("http://") || specifier.startsWith("https://")) {
    return normalizeCssModuleKey(specifier);
  }

  if (specifier.startsWith("@/")) {
    const aliasPath = specifier.slice(2).replace(/^\/+/, "");
    return normalizePathSegments(`${normalizeCssModuleKey(projectDir)}/${aliasPath}`);
  }

  if (specifier.startsWith("/")) {
    return normalizePathSegments(specifier);
  }

  if (specifier.startsWith("./") || specifier.startsWith("../")) {
    const importerDir = dirname(importerFilePath);
    return normalizePathSegments(`${importerDir}/${specifier}`);
  }

  // Bare specifiers are uncommon for CSS in this system, but keep deterministic behavior.
  return normalizeCssModuleKey(specifier);
}

function hashString(input: string): string {
  let hash = 5381;
  for (let i = 0; i < input.length; i++) {
    hash = ((hash << 5) + hash) ^ input.charCodeAt(i);
  }
  return (hash >>> 0).toString(36);
}

function sanitizeToken(token: string): string {
  return token.replace(/[^\w-]/g, "_");
}

/**
 * Build deterministic module scope info.
 */
export function getCssModuleScope(moduleKey: string): { base: string; hash: string } {
  const normalized = normalizeCssModuleKey(moduleKey);
  const filename = normalized.split("/").pop() || "module";
  const base = sanitizeToken(
    filename.endsWith(CSS_MODULE_EXTENSION)
      ? filename.slice(0, -CSS_MODULE_EXTENSION.length)
      : filename.replace(/\.css$/, ""),
  ) || "module";
  const hash = hashString(normalized).slice(0, 6);
  return { base, hash };
}

/**
 * Convert a local class name to its scoped CSS Module class.
 */
export function toScopedCssModuleClass(moduleKey: string, localName: string): string {
  const { base, hash } = getCssModuleScope(moduleKey);
  const normalizedLocal = sanitizeToken(localName);
  return `${base}_${normalizedLocal}__${hash}`;
}

const CSS_REWRITE_BUILD_CHUNK_CODE_UNITS = 8 * 1024;

interface CssModuleRewriteSink {
  copySource(start: number, end: number): void;
  writeScopedClass(start: number, end: number): void;
}

export interface RewrittenCssModuleContent {
  content: string;
  byteLength: number;
}

function addSafeInteger(current: number, increment: number, label: string): number {
  if (
    !Number.isSafeInteger(increment) ||
    increment < 0 ||
    current > Number.MAX_SAFE_INTEGER - increment
  ) {
    throw new RangeError(`${label} exceeds the safe-integer range`);
  }
  return current + increment;
}

function assertCssRewriteByteLimit(maximumBytes: number): number {
  if (!Number.isSafeInteger(maximumBytes) || maximumBytes < 0) {
    throw new RangeError(
      "CSS module output byte limit must be a non-negative safe integer",
    );
  }
  return maximumBytes;
}

function isClassStart(codeUnit: number): boolean {
  return codeUnit === 0x5f ||
    codeUnit >= 0x41 && codeUnit <= 0x5a ||
    codeUnit >= 0x61 && codeUnit <= 0x7a;
}

function isClassContinuation(codeUnit: number): boolean {
  return isClassStart(codeUnit) || codeUnit === 0x2d ||
    codeUnit >= 0x30 && codeUnit <= 0x39;
}

function skipCssComment(content: string, start: number): number {
  let cursor = start + 2;
  while (cursor < content.length - 1) {
    if (content.charCodeAt(cursor) === 0x2a && content.charCodeAt(cursor + 1) === 0x2f) {
      return cursor + 2;
    }
    cursor++;
  }
  return content.length;
}

function skipCssString(content: string, start: number, quote: number): number {
  let cursor = start + 1;
  while (cursor < content.length) {
    const codeUnit = content.charCodeAt(cursor);
    if (codeUnit === 0x5c) {
      cursor = Math.min(content.length, cursor + 2);
      continue;
    }
    cursor++;
    if (codeUnit === quote) return cursor;
  }
  return content.length;
}

function startsFlatGlobal(content: string, start: number): boolean {
  return content.startsWith(":global(", start);
}

function findFlatGlobalEnd(content: string, start: number): number {
  let cursor = start + ":global(".length;
  while (cursor < content.length) {
    const codeUnit = content.charCodeAt(cursor);
    if (codeUnit === 0x2f && content.charCodeAt(cursor + 1) === 0x2a) {
      cursor = skipCssComment(content, cursor);
      continue;
    }
    if (codeUnit === 0x22 || codeUnit === 0x27) {
      cursor = skipCssString(content, cursor, codeUnit);
      continue;
    }
    if (codeUnit === 0x28) return -1;
    if (codeUnit === 0x29) return cursor + 1;
    cursor++;
  }
  return -1;
}

/**
 * Visit authored and rewritten spans in output order. Both the measurement
 * and emission passes use this scanner so admission cannot disagree with the
 * bytes that are ultimately built.
 */
function scanCssModuleRewrite(content: string, sink: CssModuleRewriteSink): void {
  let cursor = 0;
  let sourceStart = 0;

  while (cursor < content.length) {
    const codeUnit = content.charCodeAt(cursor);
    if (codeUnit === 0x2f && content.charCodeAt(cursor + 1) === 0x2a) {
      cursor = skipCssComment(content, cursor);
      continue;
    }
    if (codeUnit === 0x22 || codeUnit === 0x27) {
      cursor = skipCssString(content, cursor, codeUnit);
      continue;
    }
    if (codeUnit === 0x3a && startsFlatGlobal(content, cursor)) {
      const globalEnd = findFlatGlobalEnd(content, cursor);
      if (globalEnd >= 0) {
        cursor = globalEnd;
        continue;
      }
    }
    if (codeUnit === 0x2e && isClassStart(content.charCodeAt(cursor + 1))) {
      sink.copySource(sourceStart, cursor);
      let classEnd = cursor + 2;
      while (
        classEnd < content.length &&
        isClassContinuation(content.charCodeAt(classEnd))
      ) {
        classEnd++;
      }
      sink.writeScopedClass(cursor + 1, classEnd);
      cursor = classEnd;
      sourceStart = classEnd;
      continue;
    }
    cursor++;
  }

  sink.copySource(sourceStart, content.length);
}

class CssModuleRewriteMeter implements CssModuleRewriteSink {
  byteLength = 0;
  codeUnits = 0;

  constructor(
    private readonly content: string,
    private readonly scopedPrefix: string,
    private readonly scopedSuffix: string,
    private readonly maximumBytes: number,
    private readonly label: string,
  ) {}

  copySource(start: number, end: number): void {
    this.codeUnits = addSafeInteger(
      this.codeUnits,
      end - start,
      "Rewritten CSS module length",
    );
    for (let cursor = start; cursor < end; cursor++) {
      const codeUnit = this.content.charCodeAt(cursor);
      if (
        codeUnit >= 0xd800 && codeUnit <= 0xdbff && cursor + 1 < end
      ) {
        const low = this.content.charCodeAt(cursor + 1);
        if (low >= 0xdc00 && low <= 0xdfff) {
          this.addBytes(4);
          cursor++;
          continue;
        }
      }
      this.addBytes(
        codeUnit <= 0x7f ? 1 : codeUnit <= 0x7ff ? 2 : 3,
      );
    }
  }

  writeScopedClass(start: number, end: number): void {
    const replacementCodeUnits = addSafeInteger(
      addSafeInteger(
        this.scopedPrefix.length,
        end - start,
        "Scoped CSS class length",
      ),
      this.scopedSuffix.length,
      "Scoped CSS class length",
    );
    this.codeUnits = addSafeInteger(
      this.codeUnits,
      replacementCodeUnits,
      "Rewritten CSS module length",
    );
    // Prefix, local class, and suffix are all restricted to ASCII.
    this.addBytes(replacementCodeUnits);
  }

  private addBytes(increment: number): void {
    if (increment > this.maximumBytes - this.byteLength) {
      throw new TypeError(`${this.label} exceeds ${this.maximumBytes} bytes`);
    }
    this.byteLength = addSafeInteger(
      this.byteLength,
      increment,
      "Rewritten CSS module byte length",
    );
  }
}

class CssModuleRewriteBuilder implements CssModuleRewriteSink {
  private readonly buffer: Uint16Array;
  private readonly chunks: string[] = [];
  private bufferLength = 0;
  private writtenCodeUnits = 0;

  constructor(
    private readonly content: string,
    private readonly scopedPrefix: string,
    private readonly scopedSuffix: string,
    private readonly expectedCodeUnits: number,
  ) {
    this.buffer = new Uint16Array(
      Math.min(expectedCodeUnits, CSS_REWRITE_BUILD_CHUNK_CODE_UNITS),
    );
  }

  copySource(start: number, end: number): void {
    for (let cursor = start; cursor < end; cursor++) {
      this.writeCodeUnit(this.content.charCodeAt(cursor));
    }
  }

  writeScopedClass(start: number, end: number): void {
    this.writeString(this.scopedPrefix);
    for (let cursor = start; cursor < end; cursor++) {
      this.writeCodeUnit(this.content.charCodeAt(cursor));
    }
    this.writeString(this.scopedSuffix);
  }

  finish(): string {
    this.flush();
    if (this.writtenCodeUnits !== this.expectedCodeUnits) {
      throw new Error("CSS module rewrite measurement disagreed with emission");
    }
    return this.chunks.join("");
  }

  private writeString(value: string): void {
    for (let index = 0; index < value.length; index++) {
      this.writeCodeUnit(value.charCodeAt(index));
    }
  }

  private writeCodeUnit(codeUnit: number): void {
    this.buffer[this.bufferLength++] = codeUnit;
    this.writtenCodeUnits++;
    if (this.bufferLength === this.buffer.length) this.flush();
  }

  private flush(): void {
    if (this.bufferLength === 0) return;
    this.chunks.push(
      String.fromCharCode(...this.buffer.subarray(0, this.bufferLength)),
    );
    this.bufferLength = 0;
  }
}

/**
 * Rewrite a CSS Module only after its exact emitted UTF-8 size fits the
 * supplied byte budget. The first pass retains no rewrite spans or output
 * chunks; the second pass stores at most the admitted output.
 */
export function rewriteCssModuleContentWithinLimit(
  content: string,
  moduleKey: string,
  maximumBytes: number,
  label = "Rewritten CSS module",
): RewrittenCssModuleContent {
  const admittedMaximum = assertCssRewriteByteLimit(maximumBytes);
  const { base, hash } = getCssModuleScope(moduleKey);
  const scopedPrefix = `.${base}_`;
  const scopedSuffix = `__${hash}`;
  const meter = new CssModuleRewriteMeter(
    content,
    scopedPrefix,
    scopedSuffix,
    admittedMaximum,
    label,
  );
  scanCssModuleRewrite(content, meter);

  const builder = new CssModuleRewriteBuilder(
    content,
    scopedPrefix,
    scopedSuffix,
    meter.codeUnits,
  );
  scanCssModuleRewrite(content, builder);
  return { content: builder.finish(), byteLength: meter.byteLength };
}

/**
 * Rewrite `.module.css` selectors to deterministic scoped class names.
 * Keeps `:global(...)` segments untouched.
 */
export function rewriteCssModuleContent(content: string, moduleKey: string): string {
  return rewriteCssModuleContentWithinLimit(
    content,
    moduleKey,
    Number.MAX_SAFE_INTEGER,
  ).content;
}
