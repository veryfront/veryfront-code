import type * as React from "react";

const getOwnPropertyDescriptor = Object.getOwnPropertyDescriptor;
const getOwnPropertyNames = Object.getOwnPropertyNames;
const reflectApply = Reflect.apply;
const symbolKeyFor = Symbol.keyFor;

const MAX_DIAGNOSTIC_KEYS = 15;
const MAX_DIAGNOSTIC_KEY_CHARS = 128;
const MAX_SAMPLE_CHARS = 500;
const MAX_SAMPLE_DEPTH = 4;
const MAX_SAMPLE_NODES = 64;
const MAX_SAMPLE_PROPERTIES = 24;
const MAX_SAMPLE_STRING_CHARS = 160;

const REACT_ELEMENT_MARKERS = new Set<symbol>([
  Symbol.for("react.element"),
  Symbol.for("react.transitional.element"),
]);
const LEGACY_REACT_ELEMENT_MARKER = 0xeac7;

export type OwnPropertySnapshot =
  | { readonly kind: "data"; readonly value: unknown; readonly enumerable: boolean }
  | { readonly kind: "accessor"; readonly enumerable: boolean }
  | { readonly kind: "missing" }
  | { readonly kind: "unreadable" };

/**
 * Snapshot an own property without invoking accessors or ordinary property
 * coercion. A Proxy can still observe the descriptor operation itself; a
 * throwing or revoked Proxy is reported as unreadable.
 */
export function snapshotOwnProperty(
  value: unknown,
  key: PropertyKey,
): OwnPropertySnapshot {
  if (
    (typeof value !== "object" || value === null) &&
    typeof value !== "function"
  ) {
    return { kind: "missing" };
  }

  try {
    const descriptor = reflectApply(getOwnPropertyDescriptor, undefined, [
      value,
      key,
    ]) as PropertyDescriptor | undefined;
    if (!descriptor) return { kind: "missing" };
    if (!Object.hasOwn(descriptor, "value")) {
      return {
        kind: "accessor",
        enumerable: descriptor.enumerable === true,
      };
    }
    return {
      kind: "data",
      value: descriptor.value,
      enumerable: descriptor.enumerable === true,
    };
  } catch {
    return { kind: "unreadable" };
  }
}

/**
 * Return own string-key names without reading their values. `null` means the
 * object could not be inspected (for example, a revoked Proxy).
 */
export function getOwnStringKeys(value: unknown): string[] | null {
  if (
    (typeof value !== "object" || value === null) &&
    typeof value !== "function"
  ) {
    return [];
  }

  try {
    return reflectApply(getOwnPropertyNames, undefined, [value]) as string[];
  } catch {
    return null;
  }
}

export function isValidPrimitive(value: unknown): boolean {
  return (
    value === null ||
    value === undefined ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  );
}

export function hasReactSymbol(obj: Record<string, unknown>): boolean {
  const marker = snapshotOwnProperty(obj, "$$typeof");
  return marker.kind === "data" &&
    (typeof marker.value === "symbol" || typeof marker.value === "number");
}

function isReactElementMarker(value: unknown): boolean {
  return value === LEGACY_REACT_ELEMENT_MARKER ||
    (typeof value === "symbol" && REACT_ELEMENT_MARKERS.has(value));
}

function hasElementShape(value: object): boolean {
  const type = snapshotOwnProperty(value, "type");
  const props = snapshotOwnProperty(value, "props");
  const key = snapshotOwnProperty(value, "key");

  if (
    type.kind !== "data" ||
    props.kind !== "data" ||
    key.kind !== "data"
  ) {
    return false;
  }
  if (props.value === null || typeof props.value !== "object") return false;
  return key.value === null || typeof key.value === "string";
}

export function isReactElement(value: unknown): boolean {
  return looksLikeReactElement(value);
}

export function looksLikeReactElement(value: unknown): boolean {
  if (value == null || typeof value !== "object") return false;

  const marker = snapshotOwnProperty(value, "$$typeof");
  return marker.kind === "data" &&
    isReactElementMarker(marker.value) &&
    hasElementShape(value);
}

function getSymbolName(value: symbol): string {
  try {
    return reflectApply(symbolKeyFor, Symbol, [value]) as string | undefined ??
      value.description ??
      "symbol";
  } catch {
    return "symbol";
  }
}

function getFunctionName(value: object): string | undefined {
  const name = snapshotOwnProperty(value, "name");
  return name.kind === "data" && typeof name.value === "string" &&
      name.value.length > 0
    ? name.value
    : undefined;
}

function getFunctionDisplayName(value: object): string | undefined {
  const displayName = snapshotOwnProperty(value, "displayName");
  return displayName.kind === "data" &&
      typeof displayName.value === "string" &&
      displayName.value.length > 0
    ? displayName.value
    : undefined;
}

export function describeElementType(value: unknown): string {
  if (typeof value === "string") return value;
  if (typeof value === "function") {
    return getFunctionName(value) ?? getFunctionDisplayName(value) ?? "<Anonymous>";
  }
  if (typeof value === "symbol") return getSymbolName(value);
  if (value === null) return "null";
  if (value === undefined) return "<Unknown>";
  if (
    typeof value === "number" ||
    typeof value === "boolean" ||
    typeof value === "bigint"
  ) {
    return `${value}`;
  }
  if (typeof value === "object") {
    const displayName = snapshotOwnProperty(value, "displayName");
    if (
      displayName.kind === "data" &&
      typeof displayName.value === "string" &&
      displayName.value.length > 0
    ) {
      return displayName.value;
    }
    const marker = snapshotOwnProperty(value, "$$typeof");
    if (marker.kind === "data" && typeof marker.value === "symbol") {
      return getSymbolName(marker.value);
    }
    return "<Object>";
  }
  return "<Unknown>";
}

export function getElementTypeName(element: React.ReactElement): string {
  const type = snapshotOwnProperty(element, "type");
  return type.kind === "data" ? describeElementType(type.value) : "<Unknown>";
}

function truncateKey(key: string): string {
  return key.length <= MAX_DIAGNOSTIC_KEY_CHARS
    ? key
    : `${key.slice(0, MAX_DIAGNOSTIC_KEY_CHARS - 1)}…`;
}

export function getObjectKeys(obj: unknown): string[] {
  const keys = getOwnStringKeys(obj);
  if (keys === null) return [];

  const enumerable: string[] = [];
  for (const key of keys) {
    const property = snapshotOwnProperty(obj, key);
    if (
      (property.kind === "data" || property.kind === "accessor") &&
      property.enumerable
    ) {
      enumerable.push(truncateKey(key));
      if (enumerable.length === MAX_DIAGNOSTIC_KEYS) break;
    }
  }
  return enumerable;
}

interface SampleState {
  readonly ancestors: Set<object>;
  nodes: number;
}

function truncateSampleString(value: string): string {
  return value.length <= MAX_SAMPLE_STRING_CHARS
    ? value
    : `${value.slice(0, MAX_SAMPLE_STRING_CHARS - 1)}…`;
}

function samplePrimitive(value: unknown): unknown {
  if (typeof value === "string") return truncateSampleString(value);
  if (
    value === null ||
    typeof value === "boolean" ||
    typeof value === "number"
  ) {
    return value;
  }
  if (typeof value === "undefined") return "[Undefined]";
  if (typeof value === "bigint") return `[BigInt ${value}]`;
  if (typeof value === "symbol") return `[Symbol ${getSymbolName(value)}]`;
  if (typeof value === "function") {
    return `[Function ${getFunctionName(value) ?? "anonymous"}]`;
  }
  return "[Unsupported value]";
}

function snapshotArrayForSample(
  value: unknown[],
  state: SampleState,
  depth: number,
): unknown[] | string {
  const length = snapshotOwnProperty(value, "length");
  if (
    length.kind !== "data" ||
    typeof length.value !== "number" ||
    !Number.isSafeInteger(length.value) ||
    length.value < 0
  ) {
    return "[Unreadable array]";
  }

  const count = Math.min(length.value, MAX_SAMPLE_PROPERTIES);
  const result: unknown[] = [];
  for (let index = 0; index < count; index++) {
    const property = snapshotOwnProperty(value, String(index));
    if (property.kind === "data") {
      result.push(snapshotForSample(property.value, state, depth + 1));
    } else if (property.kind === "accessor") {
      result.push("[Accessor]");
    } else if (property.kind === "missing") {
      result.push("[Empty]");
    } else {
      result.push("[Unreadable]");
    }
  }
  if (length.value > count) {
    result.push(`[${length.value - count} more items]`);
  }
  return result;
}

function snapshotRecordForSample(
  value: object,
  state: SampleState,
  depth: number,
): Record<string, unknown> | string {
  const keys = getOwnStringKeys(value);
  if (keys === null) return "[Unreadable object]";

  const result = Object.create(null) as Record<string, unknown>;
  let included = 0;
  for (const key of keys) {
    const property = snapshotOwnProperty(value, key);
    if (
      property.kind !== "unreadable" &&
      property.kind !== "missing" &&
      !property.enumerable
    ) {
      continue;
    }
    if (included === MAX_SAMPLE_PROPERTIES) {
      result["…"] = `[${keys.length - included} more properties]`;
      break;
    }

    const safeKey = truncateKey(key);
    if (property.kind === "data") {
      result[safeKey] = snapshotForSample(property.value, state, depth + 1);
    } else if (property.kind === "accessor") {
      result[safeKey] = "[Accessor]";
    } else {
      result[safeKey] = "[Unreadable]";
    }
    included++;
  }
  return result;
}

function snapshotForSample(
  value: unknown,
  state: SampleState,
  depth: number,
): unknown {
  if (
    value === null ||
    (typeof value !== "object" && typeof value !== "function")
  ) {
    return samplePrimitive(value);
  }
  if (typeof value === "function") return samplePrimitive(value);
  if (state.ancestors.has(value)) return "[Circular]";
  if (depth >= MAX_SAMPLE_DEPTH) return "[Max depth]";
  if (state.nodes >= MAX_SAMPLE_NODES) return "[Node limit]";

  state.nodes++;
  state.ancestors.add(value);
  try {
    return Array.isArray(value)
      ? snapshotArrayForSample(value, state, depth)
      : snapshotRecordForSample(value, state, depth);
  } finally {
    state.ancestors.delete(value);
  }
}

export function getObjectSample(obj: unknown): string {
  if (obj === undefined) return "[Unable to stringify]";

  try {
    const snapshot = snapshotForSample(obj, {
      ancestors: new Set(),
      nodes: 0,
    }, 0);
    const serialized = JSON.stringify(snapshot, null, 2);
    return typeof serialized === "string"
      ? serialized.slice(0, MAX_SAMPLE_CHARS)
      : "[Unable to stringify]";
  } catch {
    return "[Unable to stringify]";
  }
}

export function getElementDebugInfo(child: unknown): {
  type: string;
  hasSymbol: boolean;
  symbolValue?: symbol | number;
  typeValue?: unknown;
} {
  if (child == null || typeof child !== "object") {
    return {
      type: "undefined",
      hasSymbol: false,
      symbolValue: undefined,
      typeValue: undefined,
    };
  }

  const marker = snapshotOwnProperty(child, "$$typeof");
  const type = snapshotOwnProperty(child, "type");
  const markerValue = marker.kind === "data" &&
      (typeof marker.value === "symbol" || typeof marker.value === "number")
    ? marker.value
    : undefined;
  const typeValue = type.kind === "data" ? type.value : undefined;

  return {
    type: describeElementType(typeValue),
    hasSymbol: marker.kind !== "missing" && marker.kind !== "unreadable",
    symbolValue: markerValue,
    typeValue,
  };
}
