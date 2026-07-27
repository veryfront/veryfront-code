import type * as React from "react";
import { createError, toError } from "#veryfront/errors";
import { rendererLogger } from "#veryfront/utils";
import type { InvalidObjectDetails } from "./types.ts";
import {
  describeElementType,
  getElementTypeName,
  getObjectKeys,
  getObjectSample,
  getOwnStringKeys,
  isReactElement,
  isValidPrimitive,
  snapshotOwnProperty,
} from "./primitive-checks.ts";

const logger = rendererLogger.component("deep-inspect");

const MAX_INSPECTION_DEPTH = 64;
const MAX_INSPECTION_NODES = 10_000;
const MAX_PATH_CHARS = 2_048;
const MAX_PATH_SEGMENT_CHARS = 128;

export interface InspectionOptions {
  maxDepth: number;
  debugMode: boolean;
}

interface InspectionState {
  readonly options: InspectionOptions;
  readonly visited: WeakSet<object>;
  nodes: number;
}

export function assertInspectionOptions(
  options: InspectionOptions,
): void {
  if (
    !Number.isSafeInteger(options.maxDepth) ||
    options.maxDepth < 0
  ) {
    throw new RangeError(
      "React element inspection maxDepth must be a non-negative safe integer",
    );
  }
  if (options.maxDepth > MAX_INSPECTION_DEPTH) {
    throw new RangeError(
      `React element inspection maxDepth must be at most ${MAX_INSPECTION_DEPTH}`,
    );
  }
  if (typeof options.debugMode !== "boolean") {
    throw new TypeError("React element inspection debugMode must be a boolean");
  }
}

function validateInspectionArguments(
  path: string,
  depth: number,
  options: InspectionOptions,
): void {
  if (typeof path !== "string") {
    throw new TypeError("React element inspection path must be a string");
  }
  if (!Number.isSafeInteger(depth) || depth < 0) {
    throw new RangeError("React element inspection depth must be a non-negative safe integer");
  }
  assertInspectionOptions(options);
}

function claimInspectionNode(state: InspectionState): void {
  if (state.nodes >= MAX_INSPECTION_NODES) {
    throw new RangeError(
      `React element inspection node limit of ${MAX_INSPECTION_NODES} was exceeded`,
    );
  }
  state.nodes++;
}

function assertInspectionCapacity(
  state: InspectionState,
  additionalNodes: number,
): void {
  if (
    !Number.isSafeInteger(additionalNodes) ||
    additionalNodes < 0 ||
    additionalNodes > MAX_INSPECTION_NODES - state.nodes
  ) {
    throw new RangeError(
      `React element inspection node limit of ${MAX_INSPECTION_NODES} was exceeded`,
    );
  }
}

function boundedPathSegment(value: string): string {
  return value.length <= MAX_PATH_SEGMENT_CHARS
    ? value
    : `${value.slice(0, MAX_PATH_SEGMENT_CHARS - 1)}…`;
}

function appendPath(path: string, suffix: string): string {
  const combined = `${path}${suffix}`;
  return combined.length <= MAX_PATH_CHARS ? combined : `${combined.slice(0, MAX_PATH_CHARS - 1)}…`;
}

function readArrayLength(value: unknown[], path: string): number {
  const length = snapshotOwnProperty(value, "length");
  if (
    length.kind !== "data" ||
    typeof length.value !== "number" ||
    !Number.isSafeInteger(length.value) ||
    length.value < 0
  ) {
    throw new TypeError(`React child array at ${path} has an invalid length`);
  }
  return length.value;
}

function readArrayItem(value: unknown[], index: number, path: string): unknown {
  const property = snapshotOwnProperty(value, String(index));
  if (property.kind === "missing") return undefined;
  if (property.kind !== "data") {
    throw new TypeError(
      `React child array entries at ${path} must use own data properties`,
    );
  }
  return property.value;
}

/** Recursively inspects an element tree for invalid React children. */
export function deepInspectElement(
  element: unknown,
  path: string,
  depth: number,
  options: InspectionOptions,
  visited: WeakSet<object> = new WeakSet(),
): void {
  validateInspectionArguments(path, depth, options);
  inspectElement(element, path.slice(0, MAX_PATH_CHARS), depth, {
    options: Object.freeze({
      maxDepth: options.maxDepth,
      debugMode: options.debugMode,
    }),
    visited,
    nodes: 0,
  });
}

function inspectElement(
  element: unknown,
  path: string,
  depth: number,
  state: InspectionState,
): void {
  if (depth > state.options.maxDepth) {
    if (state.options.debugMode) {
      logger.debug(`[DEEP INSPECT] Max depth reached at ${path}`);
    }
    return;
  }

  claimInspectionNode(state);

  let trackedObject: object | undefined;
  if (element !== null && typeof element === "object") {
    if (state.visited.has(element)) {
      throw new TypeError(`React child structure at ${path} must not be cyclic`);
    }
    state.visited.add(element);
    trackedObject = element;
  }

  try {
    if (isReactElement(element)) {
      inspectReactElement(element as React.ReactElement, path, depth, state);
      return;
    }

    if (isValidPrimitive(element)) {
      if (state.options.debugMode) {
        logger.debug(`✓ Valid primitive at ${path}`, {
          type: typeof element,
          depth,
        });
      }
      return;
    }

    if (Array.isArray(element)) {
      inspectArray(element, path, depth, state);
      return;
    }

    if (element !== null && typeof element === "object") {
      handleInvalidObject(element, path, depth);
    }
  } finally {
    if (trackedObject !== undefined) state.visited.delete(trackedObject);
  }
}

function inspectReactElement(
  element: React.ReactElement,
  path: string,
  depth: number,
  state: InspectionState,
): void {
  if (state.options.debugMode) {
    logger.debug(`✓ Valid React element at ${path}`, {
      type: getElementTypeName(element),
      depth,
    });
  }

  const props = snapshotOwnProperty(element, "props");
  if (
    props.kind !== "data" ||
    props.value === null ||
    typeof props.value !== "object"
  ) {
    throw new TypeError(`React element at ${path} must contain data-record props`);
  }
  inspectElementProps(
    props.value as Record<string, unknown>,
    path,
    depth,
    state,
  );
}

function inspectElementProps(
  props: Record<string, unknown>,
  path: string,
  depth: number,
  state: InspectionState,
): void {
  const keys = getOwnStringKeys(props);
  if (keys === null) {
    throw new TypeError(`React element props at ${path} could not be inspected`);
  }
  assertInspectionCapacity(state, keys.length);

  for (const key of keys) {
    claimInspectionNode(state);
    const property = snapshotOwnProperty(props, key);
    if (property.kind === "missing") {
      throw new TypeError(`React element prop ${key} at ${path} changed during inspection`);
    }
    if (
      property.kind !== "data" &&
      property.kind !== "accessor"
    ) {
      throw new TypeError(`React element prop ${key} at ${path} could not be inspected`);
    }
    if (!property.enumerable) continue;
    if (property.kind !== "data") {
      throw new TypeError(
        `React element props at ${path} must use own data properties`,
      );
    }
    if (key === "__self" || key === "__source") continue;

    const value = property.value;
    if (key === "children") {
      inspectChildren(value, path, depth, state);
      continue;
    }

    const propertyPath = appendPath(
      path,
      `.props.${boundedPathSegment(key)}`,
    );
    if (isReactElement(value)) {
      inspectElement(value, propertyPath, depth + 1, state);
      continue;
    }

    if (Array.isArray(value)) {
      inspectElementArrayProp(value, propertyPath, depth, state);
    }
  }
}

function inspectElementArrayProp(
  value: unknown[],
  path: string,
  depth: number,
  state: InspectionState,
): void {
  const length = readArrayLength(value, path);
  assertInspectionCapacity(state, length);
  for (let index = 0; index < length; index++) {
    claimInspectionNode(state);
    const item = readArrayItem(value, index, path);
    if (isReactElement(item)) {
      inspectElement(
        item,
        appendPath(path, `[${index}]`),
        depth + 1,
        state,
      );
    }
  }
}

function inspectChildren(
  children: unknown,
  path: string,
  depth: number,
  state: InspectionState,
): void {
  if (Array.isArray(children)) {
    inspectArray(children, appendPath(path, ".children"), depth, state);
    return;
  }

  if (children != null) {
    inspectElement(
      children,
      appendPath(path, ".children"),
      depth + 1,
      state,
    );
  }
}

function inspectArray(
  array: unknown[],
  path: string,
  depth: number,
  state: InspectionState,
): void {
  const length = readArrayLength(array, path);
  if (state.options.debugMode) {
    logger.debug(`✓ Array at ${path}`, { length, depth });
  }
  assertInspectionCapacity(state, length);

  for (let index = 0; index < length; index++) {
    const item = readArrayItem(array, index, path);
    inspectElement(
      item,
      appendPath(path, `[${index}]`),
      depth + 1,
      state,
    );
  }
}

function getConstructorName(value: object): string | undefined {
  let prototype: object | null;
  try {
    prototype = Object.getPrototypeOf(value) as object | null;
  } catch {
    return undefined;
  }
  if (prototype === null) return undefined;

  const constructor = snapshotOwnProperty(prototype, "constructor");
  if (constructor.kind !== "data" || typeof constructor.value !== "function") {
    return undefined;
  }
  const name = snapshotOwnProperty(constructor.value, "name");
  return name.kind === "data" &&
      typeof name.value === "string" &&
      name.value.length > 0
    ? name.value
    : undefined;
}

function safeDiagnosticValue(value: unknown): unknown {
  return typeof value === "string" ||
      typeof value === "number" ||
      typeof value === "boolean" ||
      typeof value === "symbol" ||
      value === null ||
      value === undefined
    ? value
    : describeElementType(value);
}

function handleInvalidObject(element: object, path: string, depth: number): never {
  const keys = getObjectKeys(element);
  const marker = snapshotOwnProperty(element, "$$typeof");
  const type = snapshotOwnProperty(element, "type");
  const markerValue = marker.kind === "data" ? safeDiagnosticValue(marker.value) : undefined;
  const typeValue = type.kind === "data" ? safeDiagnosticValue(type.value) : undefined;
  const constructorName = getConstructorName(element);

  const errorDetails: InvalidObjectDetails = {
    path,
    depth,
    keys,
    hasSymbol: marker.kind !== "missing" && marker.kind !== "unreadable",
    symbolValue: markerValue,
    type: typeValue,
    constructor: constructorName,
    sample: getObjectSample(element),
  };

  logger.error(
    `[DEEP INSPECT] ❌ INVALID OBJECT at ${path} - This will cause React Error #31!`,
    errorDetails,
  );

  const typeName = type.kind === "data" ? describeElementType(type.value) : "unknown";
  throw toError(
    createError({
      type: "config",
      message: `Invalid React child found at ${path}! ` +
        `This object cannot be rendered as a React child. ` +
        `Keys: [${keys.join(", ")}]. ` +
        `Type: ${typeName}. ` +
        `Constructor: ${constructorName ?? "unknown"}.`,
    }),
  );
}
