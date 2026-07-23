import type { PageDataResponse } from "./ClientApp.tsx";
import type { LayoutInfo } from "./LayoutShell.tsx";
import { assertSafeModulePath, snapshotReleaseAssetModules } from "./path-utils.ts";

const MAX_PAGE_DATA_BYTES = 4 * 1_024 * 1_024;
const MAX_PAGE_DATA_CONTAINER_ENTRIES = 10_000;
const MAX_PAGE_DATA_TOTAL_ENTRIES = 50_000;
const MAX_PAGE_DATA_DEPTH = 64;
const MAX_PAGE_MODULES = 64;
const MAX_PAGE_PARAMS = 100;
const MAX_PAGE_PARAM_VALUES = 100;
const MAX_PAGE_HEADINGS = 1_000;
const MAX_PAGE_PATH_BYTES = 4_096;
const MAX_PAGE_SLUG_BYTES = 2_048;
const MAX_RELEASE_ID_BYTES = 256;
const MAX_ROUTE_CSS_BYTES = 2 * 1_024 * 1_024;
const MAX_CSS_ERROR_BYTES = 16 * 1_024;
const MAX_METADATA_TEXT_BYTES = 16 * 1_024;
const PAGE_TYPES = new Set(["mdx", "md", "tsx", "jsx", "ts", "js"]);
const METADATA_TEXT_KEYS = ["title", "description"] as const;
const textEncoder = new TextEncoder();

interface SnapshotBudget {
  bytes: number;
  entries: number;
}

function byteLength(value: string): number {
  return textEncoder.encode(value).byteLength;
}

function consumeBytes(value: string, budget: SnapshotBudget, label: string): void {
  budget.bytes += byteLength(value);
  if (budget.bytes > MAX_PAGE_DATA_BYTES) {
    throw new TypeError(`${label} exceeds the size limit`);
  }
}

function consumeEntry(budget: SnapshotBudget, label: string): void {
  budget.entries++;
  if (budget.entries > MAX_PAGE_DATA_TOTAL_ENTRIES) {
    throw new TypeError(`${label} exceeds the entry limit`);
  }
}

function inspectOwnKeys(value: object, label: string): (string | symbol)[] {
  try {
    return Reflect.ownKeys(value);
  } catch {
    throw new TypeError(`${label} cannot be inspected`);
  }
}

function inspectDescriptor(
  value: object,
  key: string | symbol,
  label: string,
): PropertyDescriptor | undefined {
  try {
    return Object.getOwnPropertyDescriptor(value, key);
  } catch {
    throw new TypeError(`${label} cannot be inspected`);
  }
}

function snapshotJsonValue(
  value: unknown,
  label: string,
  budget: SnapshotBudget,
  ancestors: WeakSet<object>,
  depth: number,
): unknown {
  if (depth > MAX_PAGE_DATA_DEPTH) throw new TypeError(`${label} exceeds the depth limit`);
  if (value === null || typeof value === "boolean") return value;
  if (typeof value === "string") {
    consumeBytes(value, budget, label);
    return value;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new TypeError(`${label} contains a non-finite number`);
    return value;
  }
  if (typeof value !== "object") {
    throw new TypeError(`${label} contains a value that JSON cannot represent`);
  }
  if (value instanceof Date) {
    const iso = Date.prototype.toISOString.call(value);
    consumeBytes(iso, budget, label);
    return iso;
  }
  if (ancestors.has(value)) throw new TypeError(`${label} contains a cycle`);
  ancestors.add(value);

  try {
    if (Array.isArray(value)) {
      const lengthDescriptor = inspectDescriptor(value, "length", label);
      const length = lengthDescriptor?.value;
      if (
        !Number.isSafeInteger(length) || length < 0 ||
        length > MAX_PAGE_DATA_CONTAINER_ENTRIES
      ) {
        throw new TypeError(`${label} exceeds the container limit`);
      }
      const keys = inspectOwnKeys(value, label);
      if (keys.length > length + 1) {
        throw new TypeError(`${label} contains unsupported array properties`);
      }
      const snapshot: unknown[] = [];
      for (let index = 0; index < length; index++) {
        const descriptor = inspectDescriptor(value, String(index), label);
        if (!descriptor || descriptor.get || descriptor.set || !("value" in descriptor)) {
          throw new TypeError(`${label} cannot be inspected`);
        }
        consumeEntry(budget, label);
        snapshot.push(
          snapshotJsonValue(
            descriptor.value,
            `${label}[${index}]`,
            budget,
            ancestors,
            depth + 1,
          ),
        );
      }
      return Object.freeze(snapshot);
    }

    let prototype: object | null;
    try {
      prototype = Object.getPrototypeOf(value);
    } catch {
      throw new TypeError(`${label} cannot be inspected`);
    }
    if (prototype !== Object.prototype && prototype !== null) {
      throw new TypeError(`${label} must contain plain data`);
    }

    const keys = inspectOwnKeys(value, label);
    if (keys.length > MAX_PAGE_DATA_CONTAINER_ENTRIES) {
      throw new TypeError(`${label} exceeds the container limit`);
    }
    const snapshot: Record<string, unknown> = {};
    for (const key of keys) {
      const descriptor = inspectDescriptor(value, key, label);
      if (!descriptor?.enumerable) continue;
      if (typeof key !== "string" || descriptor.get || descriptor.set || !("value" in descriptor)) {
        throw new TypeError(`${label} cannot be inspected`);
      }
      consumeEntry(budget, label);
      consumeBytes(key, budget, label);
      Object.defineProperty(snapshot, key, {
        configurable: false,
        enumerable: true,
        value: snapshotJsonValue(
          descriptor.value,
          `${label}.${key}`,
          budget,
          ancestors,
          depth + 1,
        ),
        writable: false,
      });
    }
    return Object.freeze(snapshot);
  } finally {
    ancestors.delete(value);
  }
}

function assertRecord(value: unknown, label: string): asserts value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object`);
  }
}

function assertBoundedString(
  value: unknown,
  label: string,
  maxBytes: number,
  allowEmpty = false,
): asserts value is string {
  if (
    typeof value !== "string" || (!allowEmpty && value.length === 0) ||
    value.length > maxBytes || byteLength(value) > maxBytes
  ) {
    throw new TypeError(`${label} is invalid`);
  }
}

function hasUnsafeTransportCharacter(value: string): boolean {
  for (let index = 0; index < value.length; index++) {
    const code = value.charCodeAt(index);
    if (
      code <= 31 || (code >= 127 && code <= 159) || code === 0x200e ||
      code === 0x200f || (code >= 0x202a && code <= 0x202e) ||
      (code >= 0x2066 && code <= 0x2069)
    ) return true;
    if (code >= 0xdc00 && code <= 0xdfff) return true;
    if (code < 0xd800 || code > 0xdbff) continue;
    const next = value.charCodeAt(index + 1);
    if (!Number.isFinite(next) || next < 0xdc00 || next > 0xdfff) return true;
    index++;
  }
  return false;
}

function validateLayouts(value: unknown): asserts value is LayoutInfo[] {
  if (!Array.isArray(value) || value.length > MAX_PAGE_MODULES) {
    throw new TypeError("Page layouts are invalid");
  }
  for (const layout of value) {
    assertRecord(layout, "Page layout");
    if (layout.kind !== "mdx" && layout.kind !== "tsx") {
      throw new TypeError("Page layout kind is invalid");
    }
    assertBoundedString(layout.path, "Page layout path", MAX_PAGE_PATH_BYTES);
    assertSafeModulePath(layout.path);
  }
}

function validateLayoutProps(
  value: unknown,
): asserts value is Record<string, Record<string, unknown>> {
  assertRecord(value, "Page layout props");
  const layoutPropsEntries = Object.entries(value);
  if (layoutPropsEntries.length > MAX_PAGE_MODULES) {
    throw new TypeError("Page layout props exceed the limit");
  }
  for (const [path, props] of layoutPropsEntries) {
    assertBoundedString(path, "Page layout props path", MAX_PAGE_PATH_BYTES);
    assertSafeModulePath(path);
    assertRecord(props, "Page layout props");
  }
}

function validateReleaseId(value: unknown): asserts value is string {
  assertBoundedString(value, "Release id", MAX_RELEASE_ID_BYTES);
  if (hasUnsafeTransportCharacter(value)) {
    throw new TypeError("Release id is invalid");
  }
}

function validatePageData(data: Record<string, unknown>): void {
  assertBoundedString(data.slug, "Page slug", MAX_PAGE_SLUG_BYTES, true);
  if (hasUnsafeTransportCharacter(data.slug)) throw new TypeError("Page slug is invalid");
  assertBoundedString(data.pagePath, "Page module path", MAX_PAGE_PATH_BYTES);
  assertSafeModulePath(data.pagePath);
  if (typeof data.pageType !== "string" || !PAGE_TYPES.has(data.pageType)) {
    throw new TypeError("Page type is invalid");
  }

  validateLayouts(data.layouts);

  if (!Array.isArray(data.providers) || data.providers.length > MAX_PAGE_MODULES) {
    throw new TypeError("Page providers are invalid");
  }
  for (const provider of data.providers) {
    assertBoundedString(provider, "Page provider path", MAX_PAGE_PATH_BYTES);
    assertSafeModulePath(provider);
  }

  assertRecord(data.frontmatter, "Page frontmatter");
  for (const key of METADATA_TEXT_KEYS) {
    const value = data.frontmatter[key];
    if (typeof value === "string") {
      assertBoundedString(value, `Page ${key}`, MAX_METADATA_TEXT_BYTES, true);
    }
  }
  assertRecord(data.props, "Page props");
  assertRecord(data.params, "Page params");
  const paramEntries = Object.entries(data.params);
  if (paramEntries.length > MAX_PAGE_PARAMS) throw new TypeError("Page params exceed the limit");
  for (const [key, value] of paramEntries) {
    assertBoundedString(key, "Page param key", MAX_PAGE_PATH_BYTES);
    if (typeof value === "string") {
      assertBoundedString(value, "Page param value", MAX_PAGE_PATH_BYTES, true);
      continue;
    }
    if (!Array.isArray(value) || value.length > MAX_PAGE_PARAM_VALUES) {
      throw new TypeError("Page param value is invalid");
    }
    for (const item of value) {
      assertBoundedString(item, "Page param value", MAX_PAGE_PATH_BYTES, true);
    }
    if (byteLength(value.join("/")) > MAX_PAGE_PATH_BYTES) {
      throw new TypeError("Page param value exceeds the size limit");
    }
  }

  validateLayoutProps(data.layoutProps);

  if (data.headings !== undefined) {
    if (!Array.isArray(data.headings) || data.headings.length > MAX_PAGE_HEADINGS) {
      throw new TypeError("Page headings are invalid");
    }
    for (const heading of data.headings) {
      assertRecord(heading, "Page heading");
      assertBoundedString(heading.id, "Page heading id", MAX_PAGE_PATH_BYTES, true);
      assertBoundedString(heading.text, "Page heading text", MAX_PAGE_PATH_BYTES, true);
      if (
        !Number.isSafeInteger(heading.level) || Number(heading.level) < 1 ||
        Number(heading.level) > 6
      ) {
        throw new TypeError("Page heading level is invalid");
      }
    }
  }

  if (data.css !== undefined) {
    assertBoundedString(data.css, "Route CSS", MAX_ROUTE_CSS_BYTES, true);
  }
  if (data.cssAction !== undefined && data.cssAction !== "clear") {
    throw new TypeError("Route CSS action is invalid");
  }
  if (data.css !== undefined && data.cssAction !== undefined) {
    throw new TypeError("Route CSS payload is ambiguous");
  }
  if (data.cssError !== undefined) {
    assertBoundedString(data.cssError, "Route CSS error", MAX_CSS_ERROR_BYTES);
    if (data.css !== undefined || data.cssAction !== undefined) {
      throw new TypeError("Route CSS payload is ambiguous");
    }
  }
  if (data.appPath !== undefined) {
    assertBoundedString(data.appPath, "Application module path", MAX_PAGE_PATH_BYTES);
    assertSafeModulePath(data.appPath);
  }
  if (
    data.requiresFullDocumentNavigation !== undefined &&
    typeof data.requiresFullDocumentNavigation !== "boolean"
  ) {
    throw new TypeError("Full document navigation flag is invalid");
  }
  if (data.releaseId !== undefined) {
    validateReleaseId(data.releaseId);
  }
  if (data.releaseAssetModules !== undefined) {
    assertRecord(data.releaseAssetModules, "Release asset module map");
    snapshotReleaseAssetModules(data.releaseAssetModules as Record<string, string>);
  }
}

/** Create an immutable, validated copy of server-provided SPA page data. */
export function snapshotPageData(value: PageDataResponse): PageDataResponse {
  const snapshot = snapshotJsonValue(
    value,
    "Page data",
    { bytes: 0, entries: 0 },
    new WeakSet(),
    0,
  );
  assertRecord(snapshot, "Page data");
  validatePageData(snapshot);
  return snapshot as unknown as PageDataResponse;
}

/** Snapshot and validate the standalone layout shell's data inputs. */
export function snapshotLayoutInputs(
  layouts: LayoutInfo[],
  layoutProps: Record<string, Record<string, unknown>>,
  releaseAssetModules: Record<string, string> | null = null,
  releaseId: string | null = null,
): {
  layouts: LayoutInfo[];
  layoutProps: Record<string, Record<string, unknown>>;
  releaseAssetModules: Record<string, string> | null;
  releaseId: string | null;
} {
  const snapshot = snapshotJsonValue(
    { layouts, layoutProps, releaseAssetModules, releaseId },
    "Layout shell data",
    { bytes: 0, entries: 0 },
    new WeakSet(),
    0,
  );
  assertRecord(snapshot, "Layout shell data");
  validateLayouts(snapshot.layouts);
  validateLayoutProps(snapshot.layoutProps);
  if (snapshot.releaseAssetModules !== null) {
    assertRecord(snapshot.releaseAssetModules, "Release asset module map");
    snapshotReleaseAssetModules(snapshot.releaseAssetModules as Record<string, string>);
  }
  if (snapshot.releaseId !== null) validateReleaseId(snapshot.releaseId);
  return snapshot as {
    layouts: LayoutInfo[];
    layoutProps: Record<string, Record<string, unknown>>;
    releaseAssetModules: Record<string, string> | null;
    releaseId: string | null;
  };
}
