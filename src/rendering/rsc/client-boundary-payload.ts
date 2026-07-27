import type { RSCChildrenPayload, RSCNode } from "./types.ts";

const PAYLOAD_VERSION = 1 as const;
const MAX_PAYLOAD_UTF8_BYTES = 1024 * 1024;
const MAX_PAYLOAD_DEPTH = 64;
const MAX_PAYLOAD_NODES = 10_000;
const MAX_PAYLOAD_VALUES = 100_000;
const MAX_OBJECT_PROPERTIES = 1_024;
const MAX_COMPONENT_ID_LENGTH = 4_096;
const HTML_TAG_PATTERN = /^[A-Za-z][A-Za-z0-9:_-]*$/;

const NODE_FIELDS = {
  client: new Set(["type", "component", "props", "children"]),
  fragment: new Set(["type", "children"]),
  html: new Set(["type", "html", "text"]),
  server: new Set(["type", "component", "props", "children"]),
} satisfies Record<RSCNode["type"], ReadonlySet<string>>;

type SnapshotState = {
  ancestors: WeakSet<object>;
  installSerializationGuards: boolean;
  nodes: number;
  values: number;
};

export interface ClientBoundaryElementRuntime {
  Fragment: unknown;
  createElement(
    type: unknown,
    props: Record<string, unknown>,
    ...children: unknown[]
  ): unknown;
}

export type ClientBoundaryComponentResolver = (componentId: string) => Promise<unknown>;

export function encodeClientBoundaryChildren(nodes: RSCNode[]): string {
  const snapshot = snapshotNodes(nodes, true);
  const payload: RSCChildrenPayload = { version: PAYLOAD_VERSION, nodes: snapshot };
  installSerializationGuard(payload);
  assertJsonByteSize(payload);
  const serialized = JSON.stringify(payload);
  assertUtf8Size(serialized);
  return serialized;
}

export function parseClientBoundaryChildren(serialized: string | undefined): RSCNode[] {
  if (!serialized) return [];

  try {
    return decodeClientBoundaryChildren(serialized);
  } catch {
    return [];
  }
}

/** Strict decoder for hydration boundaries that must not drop malformed children. */
export function decodeClientBoundaryChildren(serialized: string): RSCNode[] {
  assertUtf8Size(serialized);
  const payload = JSON.parse(serialized) as unknown;
  const fields = inspectRecord(payload, "RSC child payload");
  assertExactFields(fields, new Set(["version", "nodes"]), "RSC child payload");
  if (readRequired(fields, "version", "RSC child payload") !== PAYLOAD_VERSION) {
    throw new TypeError("Unsupported RSC child payload version");
  }
  return snapshotNodes(
    readRequired(fields, "nodes", "RSC child payload"),
    false,
  );
}

export async function materializeClientBoundaryChildren(
  nodes: RSCNode[],
  runtime: ClientBoundaryElementRuntime,
  resolveClientComponent: ClientBoundaryComponentResolver,
): Promise<unknown[]> {
  if (typeof runtime?.createElement !== "function") {
    throw new TypeError("RSC client boundary runtime must provide createElement");
  }
  if (typeof resolveClientComponent !== "function") {
    throw new TypeError("RSC client boundary resolver must be a function");
  }

  const snapshot = snapshotNodes(nodes, false);
  return await materializeNodes(snapshot, runtime, resolveClientComponent);
}

async function materializeNodes(
  nodes: RSCNode[],
  runtime: ClientBoundaryElementRuntime,
  resolveClientComponent: ClientBoundaryComponentResolver,
): Promise<unknown[]> {
  const materialized: unknown[] = [];
  for (const node of nodes) {
    materialized.push(
      await materializeNode(node, runtime, resolveClientComponent),
    );
  }
  return materialized;
}

async function materializeNode(
  node: RSCNode,
  runtime: ClientBoundaryElementRuntime,
  resolveClientComponent: ClientBoundaryComponentResolver,
): Promise<unknown> {
  if (node.type === "html") return node.text ?? node.html ?? "";

  const children = await materializeNodes(
    node.children ?? [],
    runtime,
    resolveClientComponent,
  );

  if (node.type === "fragment" || (node.type === "server" && !node.component)) {
    return runtime.createElement(runtime.Fragment, {}, ...children);
  }

  if (node.type === "server") {
    return runtime.createElement(node.component, node.props ?? {}, ...children);
  }

  const Component = await resolveClientComponent(node.component!);
  if (!Component) {
    throw new TypeError("RSC client boundary component could not be resolved");
  }
  return runtime.createElement(Component, node.props ?? {}, ...children);
}

function snapshotNodes(
  value: unknown,
  installSerializationGuards: boolean,
): RSCNode[] {
  const state: SnapshotState = {
    ancestors: new WeakSet(),
    installSerializationGuards,
    nodes: 0,
    values: 0,
  };
  return snapshotNodeArray(value, 0, state);
}

function snapshotNodeArray(
  value: unknown,
  depth: number,
  state: SnapshotState,
): RSCNode[] {
  const values = inspectDenseArray(value, "RSC child nodes");
  if (values.length > MAX_PAYLOAD_NODES - state.nodes) {
    throw new RangeError(
      `RSC child payload node limit of ${MAX_PAYLOAD_NODES} was exceeded`,
    );
  }

  const snapshot = new Array<RSCNode>(values.length);
  for (let index = 0; index < values.length; index += 1) {
    snapshot[index] = snapshotNode(values[index], depth, state);
  }
  if (state.installSerializationGuards) installSerializationGuard(snapshot);
  return snapshot;
}

function snapshotNode(
  value: unknown,
  depth: number,
  state: SnapshotState,
): RSCNode {
  if (depth > MAX_PAYLOAD_DEPTH) {
    throw new RangeError(
      `RSC child payload depth limit of ${MAX_PAYLOAD_DEPTH} was exceeded`,
    );
  }
  if (state.nodes >= MAX_PAYLOAD_NODES) {
    throw new RangeError(
      `RSC child payload node limit of ${MAX_PAYLOAD_NODES} was exceeded`,
    );
  }
  state.nodes += 1;

  const fields = inspectRecord(value, "RSC child node");
  const type = readRequired(fields, "type", "RSC child node");
  if (
    type !== "client" &&
    type !== "fragment" &&
    type !== "html" &&
    type !== "server"
  ) {
    throw new TypeError("RSC child node has an unsupported type");
  }
  assertExactFields(fields, NODE_FIELDS[type], `${type} RSC child node`);

  switch (type) {
    case "html":
      return snapshotHtmlNode(fields, state);
    case "fragment":
      return snapshotFragmentNode(fields, depth, state);
    case "client":
      return snapshotClientNode(fields, depth, state);
    case "server":
      return snapshotServerNode(fields, depth, state);
  }
}

function snapshotHtmlNode(
  fields: ReadonlyMap<string, unknown>,
  state: SnapshotState,
): RSCNode {
  const html = readOptionalString(fields, "html", "HTML RSC child node");
  const text = readOptionalString(fields, "text", "HTML RSC child node");
  if (html === undefined && text === undefined) {
    throw new TypeError("HTML RSC child node must provide html or text");
  }

  const snapshot: RSCNode = { type: "html" };
  if (html !== undefined) snapshot.html = html;
  if (text !== undefined) snapshot.text = text;
  if (state.installSerializationGuards) installSerializationGuard(snapshot);
  return snapshot;
}

function snapshotFragmentNode(
  fields: ReadonlyMap<string, unknown>,
  depth: number,
  state: SnapshotState,
): RSCNode {
  const snapshot: RSCNode = { type: "fragment" };
  const children = fields.get("children");
  if (children !== undefined) {
    snapshot.children = snapshotNodeArray(children, depth + 1, state);
  }
  if (state.installSerializationGuards) installSerializationGuard(snapshot);
  return snapshot;
}

function snapshotClientNode(
  fields: ReadonlyMap<string, unknown>,
  depth: number,
  state: SnapshotState,
): RSCNode {
  const component = readComponentIdentifier(
    readRequired(fields, "component", "client RSC child node"),
  );
  const snapshot: RSCNode = { type: "client", component };
  snapshotOptionalPropsAndChildren(snapshot, fields, depth, state);
  if (state.installSerializationGuards) installSerializationGuard(snapshot);
  return snapshot;
}

function snapshotServerNode(
  fields: ReadonlyMap<string, unknown>,
  depth: number,
  state: SnapshotState,
): RSCNode {
  const componentValue = fields.get("component");
  const snapshot: RSCNode = { type: "server" };
  if (componentValue !== undefined) {
    if (
      typeof componentValue !== "string" ||
      componentValue.length > MAX_COMPONENT_ID_LENGTH ||
      !HTML_TAG_PATTERN.test(componentValue)
    ) {
      throw new TypeError("Server RSC child node has an invalid HTML component");
    }
    snapshot.component = componentValue;
  } else if (fields.has("props")) {
    throw new TypeError("Server RSC fragment nodes cannot define props");
  }

  snapshotOptionalPropsAndChildren(snapshot, fields, depth, state);
  if (state.installSerializationGuards) installSerializationGuard(snapshot);
  return snapshot;
}

function snapshotOptionalPropsAndChildren(
  snapshot: RSCNode,
  fields: ReadonlyMap<string, unknown>,
  depth: number,
  state: SnapshotState,
): void {
  const props = fields.get("props");
  if (props !== undefined) {
    const propsSnapshot = snapshotJsonValue(props, 0, state);
    if (!isRecord(propsSnapshot)) {
      throw new TypeError("RSC child node props must be a plain object");
    }
    snapshot.props = propsSnapshot;
  }

  const children = fields.get("children");
  if (children !== undefined) {
    snapshot.children = snapshotNodeArray(children, depth + 1, state);
  }
}

function snapshotJsonValue(
  value: unknown,
  depth: number,
  state: SnapshotState,
): unknown {
  if (depth > MAX_PAYLOAD_DEPTH) {
    throw new RangeError(
      `RSC child payload prop depth limit of ${MAX_PAYLOAD_DEPTH} was exceeded`,
    );
  }
  if (state.values >= MAX_PAYLOAD_VALUES) {
    throw new RangeError(
      `RSC child payload value limit of ${MAX_PAYLOAD_VALUES} was exceeded`,
    );
  }
  state.values += 1;

  if (value === null || typeof value === "string" || typeof value === "boolean") {
    return value;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new TypeError("RSC child payload props must contain finite numbers");
    }
    return Object.is(value, -0) ? 0 : value;
  }
  if (typeof value !== "object") {
    throw new TypeError("RSC child payload props must be JSON-serializable");
  }
  if (state.ancestors.has(value)) {
    throw new TypeError("RSC child payload props cannot contain cycles");
  }

  state.ancestors.add(value);
  try {
    if (isArray(value)) {
      const values = inspectDenseArray(value, "RSC child payload prop array");
      const snapshot = new Array<unknown>(values.length);
      for (let index = 0; index < values.length; index += 1) {
        snapshot[index] = snapshotJsonValue(values[index], depth + 1, state);
      }
      if (state.installSerializationGuards) installSerializationGuard(snapshot);
      return snapshot;
    }

    const fields = inspectRecord(value, "RSC child payload props");
    const snapshot: Record<string, unknown> = {};
    for (const [key, entry] of fields) {
      if (entry === undefined) continue;
      defineDataProperty(
        snapshot,
        key,
        snapshotJsonValue(entry, depth + 1, state),
      );
    }
    if (state.installSerializationGuards) installSerializationGuard(snapshot);
    return snapshot;
  } finally {
    state.ancestors.delete(value);
  }
}

function inspectRecord(
  value: unknown,
  label: string,
): ReadonlyMap<string, unknown> {
  if (!isRecord(value)) {
    throw new TypeError(`${label} must be a plain object`);
  }

  const fields = new Map<string, unknown>();
  for (const key of inspectOwnKeys(value)) {
    const descriptor = inspectDescriptor(value, key);
    if (!descriptor.enumerable) continue;
    if (typeof key !== "string") {
      throw new TypeError(`${label} must use string property names`);
    }
    if (!Object.hasOwn(descriptor, "value")) {
      throw new TypeError(`${label} must use data properties`);
    }
    fields.set(key, descriptor.value);
    if (fields.size > MAX_OBJECT_PROPERTIES) {
      throw new RangeError(
        `${label} property limit of ${MAX_OBJECT_PROPERTIES} was exceeded`,
      );
    }
  }
  return fields;
}

function inspectDenseArray(value: unknown, label: string): unknown[] {
  if (!isArray(value) || inspectPrototype(value) !== Array.prototype) {
    throw new TypeError(`${label} must be a plain array`);
  }

  const lengthDescriptor = inspectDescriptor(value, "length");
  if (
    !Object.hasOwn(lengthDescriptor, "value") ||
    !Number.isSafeInteger(lengthDescriptor.value) ||
    lengthDescriptor.value < 0
  ) {
    throw new TypeError(`${label} must have a valid length`);
  }
  const length = lengthDescriptor.value as number;
  if (length > MAX_PAYLOAD_VALUES) {
    throw new RangeError(
      `RSC child payload value limit of ${MAX_PAYLOAD_VALUES} was exceeded`,
    );
  }

  const values = new Array<unknown>(length);
  let enumerableEntries = 0;
  for (const key of inspectOwnKeys(value)) {
    if (key === "length") continue;
    const descriptor = inspectDescriptor(value, key);
    if (!descriptor.enumerable) continue;
    if (
      typeof key !== "string" ||
      !Object.hasOwn(descriptor, "value")
    ) {
      throw new TypeError(`${label} must use dense data properties`);
    }

    const index = Number(key);
    if (
      !Number.isSafeInteger(index) ||
      index < 0 ||
      index >= length ||
      String(index) !== key
    ) {
      throw new TypeError(`${label} must not contain named properties`);
    }
    values[index] = descriptor.value;
    enumerableEntries += 1;
  }
  if (enumerableEntries !== length) {
    throw new TypeError(`${label} must not contain holes`);
  }
  return values;
}

function inspectOwnKeys(value: object): (string | symbol)[] {
  try {
    return Reflect.ownKeys(value);
  } catch {
    throw new TypeError("RSC child payload properties could not be inspected");
  }
}

function inspectDescriptor(
  value: object,
  key: string | symbol,
): PropertyDescriptor {
  try {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor) {
      throw new TypeError("RSC child payload property descriptor is missing");
    }
    return descriptor;
  } catch (error) {
    if (error instanceof TypeError) throw error;
    throw new TypeError("RSC child payload property could not be inspected");
  }
}

function inspectPrototype(value: object): object | null {
  try {
    return Object.getPrototypeOf(value);
  } catch {
    throw new TypeError("RSC child payload prototype could not be inspected");
  }
}

function isArray(value: unknown): value is unknown[] {
  try {
    return Array.isArray(value);
  } catch {
    throw new TypeError("RSC child payload value could not be inspected");
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || isArray(value)) return false;
  const prototype = inspectPrototype(value);
  return prototype === Object.prototype || prototype === null;
}

function assertExactFields(
  fields: ReadonlyMap<string, unknown>,
  allowed: ReadonlySet<string>,
  label: string,
): void {
  for (const field of fields.keys()) {
    if (!allowed.has(field)) {
      throw new TypeError(`${label} contains unsupported field "${field}"`);
    }
  }
}

function readRequired(
  fields: ReadonlyMap<string, unknown>,
  key: string,
  label: string,
): unknown {
  if (!fields.has(key) || fields.get(key) === undefined) {
    throw new TypeError(`${label} must provide ${key}`);
  }
  return fields.get(key);
}

function readOptionalString(
  fields: ReadonlyMap<string, unknown>,
  key: string,
  label: string,
): string | undefined {
  const value = fields.get(key);
  if (value === undefined) return undefined;
  if (typeof value !== "string") {
    throw new TypeError(`${label} ${key} must be a string`);
  }
  return value;
}

function readComponentIdentifier(value: unknown): string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > MAX_COMPONENT_ID_LENGTH ||
    hasControlCharacters(value)
  ) {
    throw new TypeError("Client RSC child node has an invalid component identifier");
  }
  return value;
}

function hasControlCharacters(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const codeUnit = value.charCodeAt(index);
    if (codeUnit <= 0x1f || codeUnit === 0x7f) return true;
  }
  return false;
}

function defineDataProperty(
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

function installSerializationGuard(target: object): void {
  if (Object.hasOwn(target, "toJSON")) return;
  Object.defineProperty(target, "toJSON", {
    configurable: false,
    enumerable: false,
    value: undefined,
    writable: false,
  });
}

function assertJsonByteSize(value: unknown): void {
  const state = { bytes: 0 };
  measureJsonValue(value, state);
}

function measureJsonValue(
  value: unknown,
  state: { bytes: number },
): void {
  if (value === null) {
    addMeasuredBytes(state, 4);
    return;
  }

  switch (typeof value) {
    case "boolean":
      addMeasuredBytes(state, value ? 4 : 5);
      return;
    case "number":
      addMeasuredBytes(state, String(value).length);
      return;
    case "string":
      addMeasuredJsonString(state, value);
      return;
    case "object":
      break;
    default:
      throw new TypeError("RSC child payload snapshot is not JSON-serializable");
  }

  if (Array.isArray(value)) {
    addMeasuredBytes(state, 1);
    for (let index = 0; index < value.length; index += 1) {
      if (index > 0) addMeasuredBytes(state, 1);
      measureJsonValue(value[index], state);
    }
    addMeasuredBytes(state, 1);
    return;
  }

  const entries = Object.entries(value as Record<string, unknown>);
  addMeasuredBytes(state, 1);
  for (let index = 0; index < entries.length; index += 1) {
    if (index > 0) addMeasuredBytes(state, 1);
    addMeasuredJsonString(state, entries[index]![0]);
    addMeasuredBytes(state, 1);
    measureJsonValue(entries[index]![1], state);
  }
  addMeasuredBytes(state, 1);
}

function addMeasuredJsonString(
  state: { bytes: number },
  value: string,
): void {
  addMeasuredBytes(state, 2);
  for (let index = 0; index < value.length; index += 1) {
    const codeUnit = value.charCodeAt(index);
    if (codeUnit === 0x22 || codeUnit === 0x5c) {
      addMeasuredBytes(state, 2);
    } else if (codeUnit <= 0x1f) {
      addMeasuredBytes(
        state,
        codeUnit === 0x08 ||
          codeUnit === 0x09 ||
          codeUnit === 0x0a ||
          codeUnit === 0x0c ||
          codeUnit === 0x0d
          ? 2
          : 6,
      );
    } else if (codeUnit <= 0x7f) {
      addMeasuredBytes(state, 1);
    } else if (codeUnit <= 0x7ff) {
      addMeasuredBytes(state, 2);
    } else if (codeUnit >= 0xd800 && codeUnit <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        addMeasuredBytes(state, 4);
        index += 1;
      } else {
        addMeasuredBytes(state, 6);
      }
    } else if (codeUnit >= 0xdc00 && codeUnit <= 0xdfff) {
      addMeasuredBytes(state, 6);
    } else {
      addMeasuredBytes(state, 3);
    }
  }
}

function addMeasuredBytes(state: { bytes: number }, bytes: number): void {
  if (bytes > MAX_PAYLOAD_UTF8_BYTES - state.bytes) {
    throw new RangeError(
      `RSC child payload byte limit of ${MAX_PAYLOAD_UTF8_BYTES} was exceeded`,
    );
  }
  state.bytes += bytes;
}

function assertUtf8Size(value: string): void {
  if (value.length > MAX_PAYLOAD_UTF8_BYTES) {
    throw new RangeError(
      `RSC child payload byte limit of ${MAX_PAYLOAD_UTF8_BYTES} was exceeded`,
    );
  }

  let bytes = 0;
  for (let index = 0; index < value.length; index += 1) {
    const codeUnit = value.charCodeAt(index);
    if (codeUnit <= 0x7f) {
      bytes += 1;
    } else if (codeUnit <= 0x7ff) {
      bytes += 2;
    } else if (codeUnit >= 0xd800 && codeUnit <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        bytes += 4;
        index += 1;
      } else {
        bytes += 3;
      }
    } else {
      bytes += 3;
    }

    if (bytes > MAX_PAYLOAD_UTF8_BYTES) {
      throw new RangeError(
        `RSC child payload byte limit of ${MAX_PAYLOAD_UTF8_BYTES} was exceeded`,
      );
    }
  }
}
