import type { MDXFrontmatter, MDXFrontmatterValue } from "#veryfront/types";
import type { MDXFrontmatter as HTMLFrontmatter } from "#veryfront/transforms/mdx/types.ts";

const STRING_FIELDS = new Set(["title", "description", "provider"]);
const HTML_STRING_FIELDS = new Set([
  "title",
  "description",
  "provider",
  "viewport",
  "themeColor",
  "lang",
  "bodyClass",
]);
const MAX_METADATA_DEPTH = 8;
const MAX_FRONTMATTER_DEPTH = 64;
const MAX_FRONTMATTER_CONTAINER_ENTRIES = 10_000;
const MAX_FRONTMATTER_TOTAL_ENTRIES = 50_000;
const MAX_FRONTMATTER_INSPECTIONS = 50_000;
const MAX_FRONTMATTER_STRING_BYTES = 4 * 1024 * 1024;
const textEncoder = new TextEncoder();

interface FrontmatterWorkBudget {
  inspections: number;
}

interface FrontmatterSnapshotState {
  readonly ancestors: WeakSet<object>;
  readonly work: FrontmatterWorkBudget;
  entries: number;
  stringBytes: number;
}

/**
 * Snapshots parser-facing frontmatter for the public rendering contract.
 *
 * The conversion snapshots own enumerable data properties without invoking
 * accessors. Legacy scalar tags and Date values retain their observable shapes,
 * while mutable arrays, records, and dates are copied so page code cannot mutate
 * the entity's parsed frontmatter through a rendering result.
 */
export function toMDXFrontmatter(value: unknown): MDXFrontmatter {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return {};

  const work: FrontmatterWorkBudget = { inspections: 0 };
  const properties = getOwnEnumerableDataProperties(
    value,
    MAX_FRONTMATTER_CONTAINER_ENTRIES,
    work,
  );
  if (!properties || properties.length > MAX_FRONTMATTER_CONTAINER_ENTRIES) return {};

  const state: FrontmatterSnapshotState = {
    ancestors: new WeakSet([value]),
    work,
    entries: 0,
    stringBytes: 0,
  };
  const canonical: MDXFrontmatter = {};
  for (const [key, propertyValue] of properties) {
    const branch = forkSnapshotState(state);
    if (!consumeEntries(branch, 1) || !consumeString(branch, key)) continue;
    const normalized = canonicalizePublicValue(key, propertyValue, branch, 1);
    if (normalized === undefined) continue;

    Object.defineProperty(canonical, key, {
      configurable: true,
      enumerable: true,
      value: normalized,
      writable: true,
    });
    commitSnapshotState(state, branch);
  }

  return canonical;
}

/**
 * Snapshots the richer frontmatter contract consumed by HTML metadata rendering.
 *
 * Unlike the public page contract, HTML metadata supports structured fields.
 * Every retained object and array is rebuilt from own enumerable data
 * properties so inherited values and accessors never reach metadata extraction.
 */
export function toHTMLFrontmatter(value: unknown): HTMLFrontmatter {
  const publicSnapshot = toMDXFrontmatter(value);
  return snapshotHTMLFrontmatter(publicSnapshot, new WeakSet<object>(), 0) ?? {};
}

function canonicalizePublicValue(
  key: string,
  value: unknown,
  state: FrontmatterSnapshotState,
  depth: number,
): MDXFrontmatterValue | undefined {
  if (key === "tags") {
    if (typeof value === "string") return consumeString(state, value) ? value : undefined;
    return snapshotStringArray(value, state);
  }

  if (key === "date") {
    if (typeof value === "string") return consumeString(state, value) ? value : undefined;
    return snapshotDate(value);
  }

  if (STRING_FIELDS.has(key)) {
    return typeof value === "string" && consumeString(state, value) ? value : undefined;
  }

  if (key === "layout") {
    if (typeof value === "string") return consumeString(state, value) ? value : undefined;
    return typeof value === "boolean" ? value : undefined;
  }

  if (key === "published") {
    return typeof value === "boolean" ? value : undefined;
  }

  if (key === "priority") {
    return typeof value === "number" && Number.isFinite(value) ? value : undefined;
  }

  return snapshotPublicValue(value, state, depth);
}

function snapshotHTMLFrontmatter(
  value: unknown,
  ancestors: WeakSet<object>,
  depth: number,
): HTMLFrontmatter | undefined {
  if (!isObjectRecord(value) || depth > MAX_METADATA_DEPTH || ancestors.has(value)) {
    return undefined;
  }

  const properties = getOwnEnumerableDataProperties(value);
  if (!properties) return undefined;

  ancestors.add(value);
  try {
    const snapshot: HTMLFrontmatter = {};
    for (const [key, propertyValue] of properties) {
      const normalized = canonicalizeHTMLValue(key, propertyValue, ancestors, depth);
      if (normalized === undefined) continue;
      defineEnumerableDataProperty(snapshot, key, normalized);
    }
    return snapshot;
  } finally {
    ancestors.delete(value);
  }
}

function canonicalizeHTMLValue(
  key: string,
  value: unknown,
  ancestors: WeakSet<object>,
  depth: number,
): unknown {
  switch (key) {
    case "headings":
      return snapshotObjectArray(value, snapshotHeading);
    case "metadata":
      return snapshotHTMLFrontmatter(value, ancestors, depth + 1);
    case "og":
    case "twitter":
      return snapshotSocialRecord(value);
    case "meta":
      return snapshotObjectArray(value, snapshotMetaEntry);
    case "links":
      return snapshotObjectArray(value, (entry) => snapshotStringRecord(entry, ["rel", "href"]));
    case "icons":
      return snapshotObjectArray(value, (entry) => snapshotStringRecord(entry, ["href"]));
    case "scripts":
    case "styles":
      return snapshotObjectArray(value, snapshotStringRecord);
    default:
      if (HTML_STRING_FIELDS.has(key)) {
        return typeof value === "string" ? value : undefined;
      }
      return value;
  }
}

function snapshotHeading(value: unknown): { text: string; level: number } | undefined {
  const properties = getOwnEnumerableDataPropertyMap(value);
  if (!properties) return undefined;

  const text = properties.get("text");
  const level = properties.get("level");
  if (typeof text !== "string" || typeof level !== "number" || !Number.isFinite(level)) {
    return undefined;
  }
  return { text, level };
}

function snapshotMetaEntry(
  value: unknown,
): { name?: string; property?: string; content: string } | undefined {
  const properties = getOwnEnumerableDataPropertyMap(value);
  if (!properties) return undefined;

  const content = properties.get("content");
  if (typeof content !== "string") return undefined;

  const name = properties.get("name");
  const property = properties.get("property");
  if (name !== undefined && typeof name !== "string") return undefined;
  if (property !== undefined && typeof property !== "string") return undefined;

  return {
    ...(typeof name === "string" ? { name } : {}),
    ...(typeof property === "string" ? { property } : {}),
    content,
  };
}

function snapshotStringRecord(
  value: unknown,
  requiredKeys: readonly string[] = [],
): Record<string, string> | undefined {
  const properties = getOwnEnumerableDataProperties(value);
  if (!properties) return undefined;

  const snapshot: Record<string, string> = {};
  for (const [key, propertyValue] of properties) {
    if (typeof propertyValue !== "string") continue;
    defineEnumerableDataProperty(snapshot, key, propertyValue);
  }

  return requiredKeys.every((key) => Object.hasOwn(snapshot, key)) ? snapshot : undefined;
}

function snapshotSocialRecord(
  value: unknown,
): Record<string, string | number | boolean> | undefined {
  const properties = getOwnEnumerableDataProperties(value);
  if (!properties) return undefined;

  const snapshot: Record<string, string | number | boolean> = {};
  for (const [key, propertyValue] of properties) {
    if (
      typeof propertyValue !== "string" &&
      typeof propertyValue !== "boolean" &&
      !(typeof propertyValue === "number" && Number.isFinite(propertyValue))
    ) {
      continue;
    }
    defineEnumerableDataProperty(snapshot, key, propertyValue);
  }
  return snapshot;
}

function snapshotObjectArray<T>(
  value: unknown,
  snapshotItem: (value: unknown) => T | undefined,
): T[] | undefined {
  const entries = getDenseArrayDataValues(value);
  if (!entries) return undefined;

  const snapshot: T[] = [];
  for (const entry of entries) {
    const item = snapshotItem(entry);
    if (item === undefined) return undefined;
    snapshot.push(item);
  }
  return snapshot;
}

function snapshotDate(value: unknown): Date | undefined {
  try {
    const timestamp = Date.prototype.getTime.call(value);
    return Number.isFinite(timestamp) ? new Date(timestamp) : undefined;
  } catch {
    return undefined;
  }
}

function snapshotStringArray(
  value: unknown,
  state: FrontmatterSnapshotState,
): string[] | undefined {
  const entries = getDenseArrayDataValues(
    value,
    MAX_FRONTMATTER_CONTAINER_ENTRIES,
    state.work,
  );
  if (!entries || entries.some((entry) => typeof entry !== "string")) return undefined;
  if (!consumeEntries(state, entries.length)) return undefined;
  for (const entry of entries) {
    if (!consumeString(state, entry as string)) return undefined;
  }
  return entries as string[];
}

function snapshotPublicValue(
  value: unknown,
  state: FrontmatterSnapshotState,
  depth: number,
): MDXFrontmatterValue | undefined {
  if (depth > MAX_FRONTMATTER_DEPTH) return undefined;
  if (value === null || typeof value === "boolean") return value;
  if (typeof value === "string") return consumeString(state, value) ? value : undefined;
  if (typeof value === "number") return Number.isFinite(value) ? value : undefined;
  if (typeof value !== "object") return undefined;

  const date = snapshotDate(value);
  if (date) return date;
  if (state.ancestors.has(value)) return undefined;

  let isArray: boolean;
  try {
    isArray = Array.isArray(value);
  } catch {
    return undefined;
  }

  state.ancestors.add(value);
  try {
    if (isArray) {
      const entries = getDenseArrayDataValues(
        value,
        MAX_FRONTMATTER_CONTAINER_ENTRIES,
        state.work,
      );
      if (!entries || !consumeEntries(state, entries.length)) return undefined;

      const snapshot: MDXFrontmatterValue[] = [];
      for (const entry of entries) {
        const item = snapshotPublicValue(entry, state, depth + 1);
        if (item === undefined) return undefined;
        snapshot.push(item);
      }
      return snapshot;
    }

    if (!hasPlainObjectPrototype(value)) return undefined;
    const properties = getOwnEnumerableDataProperties(
      value,
      MAX_FRONTMATTER_CONTAINER_ENTRIES,
      state.work,
    );
    if (!properties || properties.length > MAX_FRONTMATTER_CONTAINER_ENTRIES) {
      return undefined;
    }

    const snapshot: { [key: string]: MDXFrontmatterValue } = {};
    for (const [key, propertyValue] of properties) {
      const branch = forkSnapshotState(state);
      if (!consumeEntries(branch, 1) || !consumeString(branch, key)) continue;
      const item = snapshotPublicValue(propertyValue, branch, depth + 1);
      if (item === undefined) continue;
      defineEnumerableDataProperty(snapshot, key, item);
      commitSnapshotState(state, branch);
    }
    if (properties.length > 0 && Object.keys(snapshot).length === 0) return undefined;
    return snapshot;
  } finally {
    state.ancestors.delete(value);
  }
}

function hasPlainObjectPrototype(value: object): boolean {
  try {
    const prototype = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null;
  } catch {
    return false;
  }
}

function forkSnapshotState(
  state: FrontmatterSnapshotState,
): FrontmatterSnapshotState {
  return {
    ancestors: state.ancestors,
    work: state.work,
    entries: state.entries,
    stringBytes: state.stringBytes,
  };
}

function commitSnapshotState(
  target: FrontmatterSnapshotState,
  source: FrontmatterSnapshotState,
): void {
  target.entries = source.entries;
  target.stringBytes = source.stringBytes;
}

function consumeEntries(
  state: FrontmatterSnapshotState,
  count: number,
): boolean {
  if (
    !Number.isSafeInteger(count) || count < 0 ||
    count > MAX_FRONTMATTER_CONTAINER_ENTRIES ||
    state.entries > MAX_FRONTMATTER_TOTAL_ENTRIES - count
  ) {
    return false;
  }
  state.entries += count;
  return true;
}

function consumeString(
  state: FrontmatterSnapshotState,
  value: string,
): boolean {
  const remaining = MAX_FRONTMATTER_STRING_BYTES - state.stringBytes;
  if (value.length > remaining) return false;

  let byteLength: number;
  try {
    byteLength = textEncoder.encode(value).byteLength;
  } catch {
    return false;
  }
  if (byteLength > remaining) return false;
  state.stringBytes += byteLength;
  return true;
}

function getDenseArrayDataValues(
  value: unknown,
  maxEntries = Number.MAX_SAFE_INTEGER,
  work?: FrontmatterWorkBudget,
): unknown[] | undefined {
  try {
    if (!Array.isArray(value)) return undefined;

    const lengthDescriptor = Reflect.getOwnPropertyDescriptor(value, "length");
    if (!lengthDescriptor || !("value" in lengthDescriptor)) return undefined;

    const length = lengthDescriptor.value;
    if (
      typeof length !== "number" || !Number.isSafeInteger(length) || length < 0 ||
      length > maxEntries
    ) {
      return undefined;
    }

    if (work && !consumeInspectionBudget(work, length + 1)) return undefined;
    if (Reflect.ownKeys(value).length !== length + 1) return undefined;

    const snapshot: unknown[] = [];
    for (let index = 0; index < length; index++) {
      const descriptor = Reflect.getOwnPropertyDescriptor(value, String(index));
      if (
        !descriptor ||
        !descriptor.enumerable ||
        !("value" in descriptor)
      ) {
        return undefined;
      }
      snapshot.push(descriptor.value);
    }
    return snapshot;
  } catch {
    return undefined;
  }
}

function isObjectRecord(value: unknown): value is object {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function getOwnEnumerableDataProperties(
  value: unknown,
  maxEntries = Number.MAX_SAFE_INTEGER,
  work?: FrontmatterWorkBudget,
): Array<[string, unknown]> | undefined {
  if (!isObjectRecord(value)) return undefined;

  try {
    const keys = Reflect.ownKeys(value);
    if (keys.length > maxEntries) return undefined;
    if (work && !consumeInspectionBudget(work, keys.length)) return undefined;

    const properties: Array<[string, unknown]> = [];
    for (const key of keys) {
      const descriptor = Reflect.getOwnPropertyDescriptor(value, key);
      if (
        typeof key !== "string" || !descriptor?.enumerable ||
        !("value" in descriptor)
      ) {
        continue;
      }
      properties.push([key, descriptor.value]);
    }
    return properties;
  } catch {
    return undefined;
  }
}

function consumeInspectionBudget(
  work: FrontmatterWorkBudget,
  count: number,
): boolean {
  if (
    !Number.isSafeInteger(count) || count < 0 ||
    work.inspections > MAX_FRONTMATTER_INSPECTIONS - count
  ) {
    return false;
  }
  work.inspections += count;
  return true;
}

function getOwnEnumerableDataPropertyMap(
  value: unknown,
): Map<string, unknown> | undefined {
  const properties = getOwnEnumerableDataProperties(value);
  return properties ? new Map(properties) : undefined;
}

function defineEnumerableDataProperty(
  target: object,
  key: string,
  value: unknown,
): void {
  Object.defineProperty(target, key, {
    configurable: true,
    enumerable: true,
    value,
    writable: true,
  });
}
