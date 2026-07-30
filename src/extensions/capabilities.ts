/**
 * Capability audit logging and Deno permission mapping.
 *
 * @module extensions/capabilities
 */

import type { Capability, ExtensionLogger } from "./types.ts";
import { stringifyAuditValue } from "./safe-value.ts";
import {
  containsUnicodeControlOrLineSeparator,
  isWellFormedUnicode,
  MAX_CAPABILITY_AUDIT_UTF16_CODE_UNITS,
  MAX_CAPABILITY_AUDIT_UTF8_BYTES,
  MAX_CAPABILITY_CONTAINER_ENTRIES,
  MAX_CAPABILITY_KEY_CHARACTERS,
  MAX_CAPABILITY_METADATA_UTF16_CODE_UNITS,
  MAX_CAPABILITY_METADATA_UTF8_BYTES,
  MAX_CAPABILITY_NESTING_DEPTH,
  MAX_CAPABILITY_STRING_CHARACTERS,
  MAX_CAPABILITY_TYPE_CHARACTERS,
  MAX_CAPABILITY_VALUE_NODES,
  MAX_DENO_PERMISSION_FLAGS_UTF16_CODE_UNITS,
  MAX_DENO_PERMISSION_FLAGS_UTF8_BYTES,
  MAX_EXTENSION_CAPABILITIES,
  snapshotDenseMetadataArray,
  utf8ByteLength,
} from "./metadata-policy.ts";

/**
 * Format capabilities as human-readable strings for logging.
 *
 * The input is descriptor-snapshotted before formatting so accessors, proxies,
 * or later mutation cannot turn startup audit logging into a second execution
 * of untrusted extension metadata.
 */
export function formatCapabilities(capabilities: Capability[]): string[] {
  const snapshot = snapshotRuntimeCapabilities(capabilities);
  const lines: string[] = [];
  let utf8Bytes = 0;
  let utf16CodeUnits = 0;
  for (let index = 0; index < snapshot.length; index++) {
    const cap = snapshot[index]!;
    snapshotCapability(cap, index);
    const type = cap.type;
    const extras = Object.keys(cap).filter((key) => key !== "type");
    const line = extras.length === 0
      ? JSON.stringify(type)
      : `${JSON.stringify(type)} (${
        extras.map((key) => `${JSON.stringify(key)}: ${stringifyAuditValue(cap[key])}`).join(", ")
      })`;
    utf8Bytes += utf8ByteLength(line);
    utf16CodeUnits += line.length;
    if (index > 0) {
      utf8Bytes++;
      utf16CodeUnits++;
    }
    if (
      utf8Bytes > MAX_CAPABILITY_AUDIT_UTF8_BYTES ||
      utf16CodeUnits > MAX_CAPABILITY_AUDIT_UTF16_CODE_UNITS
    ) {
      throw new TypeError(
        `formatted capability audit exceeds ${MAX_CAPABILITY_AUDIT_UTF8_BYTES} UTF-8 bytes or ${MAX_CAPABILITY_AUDIT_UTF16_CODE_UNITS} UTF-16 code units`,
      );
    }
    lines.push(line);
  }
  return lines;
}

const MAX_PERMISSION_SCOPE_ENTRIES = 4096;

const FS_READ_FIELDS = new Set(["type", "paths"]);
const FS_WRITE_FIELDS = new Set(["type", "paths"]);
const NET_OUTBOUND_FIELDS = new Set(["type", "hosts"]);
const NET_LISTEN_FIELDS = new Set(["type", "host", "ports"]);
const ENV_READ_FIELDS = new Set(["type", "keys"]);
const PROCESS_SPAWN_FIELDS = new Set(["type", "commands"]);
const NATIVE_FFI_FIELDS = new Set(["type"]);
const SANDBOX_EXECUTE_FIELDS = new Set(["type", "tools"]);

const DNS_LABEL_PATTERN = /^[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?$/;
const DECIMAL_PATTERN = /^\d+$/;
const PORT_PATTERN = /^(?:[1-9]\d{0,4})$/;
const BRACKETED_IPV6_PATTERN = /^\[[0-9A-Fa-f:.]+\]$/;

function containsPermissionSeparatorOrControl(value: string): boolean {
  return value.includes(",") || containsUnicodeControlOrLineSeparator(value);
}

function knownCapabilityFields(type: string): ReadonlySet<string> | undefined {
  switch (type) {
    case "fs:read":
      return FS_READ_FIELDS;
    case "fs:write":
      return FS_WRITE_FIELDS;
    case "net:outbound":
      return NET_OUTBOUND_FIELDS;
    case "net:listen":
      return NET_LISTEN_FIELDS;
    case "env:read":
      return ENV_READ_FIELDS;
    case "process:spawn":
      return PROCESS_SPAWN_FIELDS;
    case "native:ffi":
      return NATIVE_FFI_FIELDS;
    case "sandbox:execute":
      return SANDBOX_EXECUTE_FIELDS;
    default:
      return undefined;
  }
}

function stringScopeField(type: string): string | undefined {
  switch (type) {
    case "fs:read":
    case "fs:write":
      return "paths";
    case "net:outbound":
      return "hosts";
    case "env:read":
      return "keys";
    case "process:spawn":
      return "commands";
    case "sandbox:execute":
      return "tools";
    default:
      return undefined;
  }
}

interface PermissionIntent {
  flag: string;
  /** `undefined` deliberately means an unscoped permission. */
  scopes?: readonly string[];
}

interface CapabilitySnapshot {
  type: string;
  permission?: PermissionIntent;
}

interface CapabilitySnapshotBudget {
  nodes: number;
  entries: number;
  utf8Bytes: number;
  utf16CodeUnits: number;
}

function assertDenoPermissionSerializationBudget(
  permissions: ReadonlyMap<
    string,
    { readonly unscoped: boolean; readonly scopes: readonly string[] }
  >,
): void {
  let utf8Bytes = 0;
  let utf16CodeUnits = 0;
  let firstFlag = true;

  const add = (value: string): void => {
    utf8Bytes += utf8ByteLength(value);
    utf16CodeUnits += value.length;
    if (
      utf8Bytes > MAX_DENO_PERMISSION_FLAGS_UTF8_BYTES ||
      utf16CodeUnits > MAX_DENO_PERMISSION_FLAGS_UTF16_CODE_UNITS
    ) {
      throw new TypeError(
        `serialized Deno permission flags exceed the cross-platform budget of ${MAX_DENO_PERMISSION_FLAGS_UTF8_BYTES} UTF-8 bytes or ${MAX_DENO_PERMISSION_FLAGS_UTF16_CODE_UNITS} UTF-16 code units`,
      );
    }
  };

  for (const [flag, aggregate] of permissions) {
    if (!firstFlag) add(" ");
    firstFlag = false;
    add(flag);
    if (aggregate.unscoped) continue;
    add("=");
    for (let index = 0; index < aggregate.scopes.length; index++) {
      if (index > 0) add(",");
      add(aggregate.scopes[index]!);
    }
  }
}

function snapshotCapabilityJsonValue(
  value: unknown,
  label: string,
  depth: number,
  budget: CapabilitySnapshotBudget,
  seen: Set<object>,
): unknown {
  budget.nodes++;
  if (budget.nodes > MAX_CAPABILITY_VALUE_NODES) {
    throw new TypeError(
      `capabilities exceed ${MAX_CAPABILITY_VALUE_NODES} aggregate value nodes`,
    );
  }
  if (depth > MAX_CAPABILITY_NESTING_DEPTH) {
    throw new TypeError(
      `${label} exceeds maximum nesting depth ${MAX_CAPABILITY_NESTING_DEPTH}`,
    );
  }
  if (value === null || typeof value === "boolean") return value;
  if (typeof value === "string") {
    if (!isWellFormedUnicode(value)) {
      throw new TypeError(`${label} must contain well-formed Unicode`);
    }
    if (containsUnicodeControlOrLineSeparator(value)) {
      throw new TypeError(
        `${label} must not contain Unicode control characters or line separators`,
      );
    }
    if (value.length > MAX_CAPABILITY_STRING_CHARACTERS) {
      throw new TypeError(
        `${label} must not exceed ${MAX_CAPABILITY_STRING_CHARACTERS} characters`,
      );
    }
    budget.utf8Bytes += utf8ByteLength(value);
    budget.utf16CodeUnits += value.length;
    if (
      budget.utf8Bytes > MAX_CAPABILITY_METADATA_UTF8_BYTES ||
      budget.utf16CodeUnits > MAX_CAPABILITY_METADATA_UTF16_CODE_UNITS
    ) {
      throw new TypeError(
        `capabilities exceed ${MAX_CAPABILITY_METADATA_UTF8_BYTES} aggregate UTF-8 bytes or ${MAX_CAPABILITY_METADATA_UTF16_CODE_UNITS} UTF-16 code units`,
      );
    }
    return value;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new TypeError(`${label} must be a finite number`);
    }
    return value;
  }
  if (!value || typeof value !== "object") {
    throw new TypeError(`${label} must contain only JSON-safe values`);
  }
  if (seen.has(value)) {
    throw new TypeError(`${label} must be an unshared acyclic JSON tree`);
  }
  seen.add(value);

  if (Array.isArray(value)) {
    const entries = snapshotDenseMetadataArray(
      value,
      label,
      0,
      MAX_CAPABILITY_CONTAINER_ENTRIES,
    );
    budget.entries += entries.length;
    if (budget.entries > MAX_CAPABILITY_CONTAINER_ENTRIES) {
      throw new TypeError(
        `capabilities exceed ${MAX_CAPABILITY_CONTAINER_ENTRIES} aggregate properties and items`,
      );
    }
    return Object.freeze(entries.map((entry, index) =>
      snapshotCapabilityJsonValue(
        entry,
        `${label}[${index}]`,
        depth + 1,
        budget,
        seen,
      )
    ));
  }

  let prototype: object | null;
  let keys: PropertyKey[];
  try {
    prototype = Object.getPrototypeOf(value);
    keys = Reflect.ownKeys(value);
  } catch (cause) {
    throw new TypeError(`${label} could not be inspected`, { cause });
  }
  if (prototype !== Object.prototype && prototype !== null) {
    throw new TypeError(`${label} must be a plain object`);
  }
  budget.entries += keys.length;
  if (budget.entries > MAX_CAPABILITY_CONTAINER_ENTRIES) {
    throw new TypeError(
      `capabilities exceed ${MAX_CAPABILITY_CONTAINER_ENTRIES} aggregate properties and items`,
    );
  }

  const snapshot: Record<string, unknown> = Object.create(null);
  for (const key of keys) {
    if (typeof key !== "string") {
      throw new TypeError(`${label} must not contain symbol properties`);
    }
    if (key === "__proto__") {
      throw new TypeError(`${label} must not declare __proto__`);
    }
    if (!isWellFormedUnicode(key)) {
      throw new TypeError(`${label} contains a key without well-formed Unicode`);
    }
    if (containsUnicodeControlOrLineSeparator(key)) {
      throw new TypeError(
        `${label} contains a key with Unicode control characters or line separators`,
      );
    }
    if (key.length > MAX_CAPABILITY_KEY_CHARACTERS) {
      throw new TypeError(
        `${label} contains a key longer than ${MAX_CAPABILITY_KEY_CHARACTERS} characters`,
      );
    }
    budget.utf8Bytes += utf8ByteLength(key);
    budget.utf16CodeUnits += key.length;
    if (
      budget.utf8Bytes > MAX_CAPABILITY_METADATA_UTF8_BYTES ||
      budget.utf16CodeUnits > MAX_CAPABILITY_METADATA_UTF16_CODE_UNITS
    ) {
      throw new TypeError(
        `capabilities exceed ${MAX_CAPABILITY_METADATA_UTF8_BYTES} aggregate UTF-8 bytes or ${MAX_CAPABILITY_METADATA_UTF16_CODE_UNITS} UTF-16 code units`,
      );
    }
    let descriptor: PropertyDescriptor | undefined;
    try {
      descriptor = Object.getOwnPropertyDescriptor(value, key);
    } catch (cause) {
      throw new TypeError(`${label}.${key} could not be inspected`, { cause });
    }
    if (!descriptor?.enumerable || !("value" in descriptor)) {
      throw new TypeError(
        `${label}.${key} must be an enumerable own data property`,
      );
    }
    snapshot[key] = snapshotCapabilityJsonValue(
      descriptor.value,
      `${label}.${key}`,
      depth + 1,
      budget,
      seen,
    );
  }
  return Object.freeze(snapshot);
}

/**
 * Descriptor-snapshot and validate one extension's capability metadata before
 * either admission or permission serialization.
 *
 * @internal
 */
export function snapshotRuntimeCapabilities(value: unknown): readonly Capability[] {
  const entries = snapshotDenseMetadataArray(
    value,
    "capabilities",
    0,
    MAX_EXTENSION_CAPABILITIES,
  );
  const budget: CapabilitySnapshotBudget = {
    nodes: 0,
    entries: 0,
    utf8Bytes: 0,
    utf16CodeUnits: 0,
  };
  const snapshots: Capability[] = [];
  for (let index = 0; index < entries.length; index++) {
    const entry = entries[index];
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      throw new TypeError(`capabilities[${index}] must be an object`);
    }
    snapshots.push(
      snapshotCapabilityJsonValue(
        entry,
        `capabilities[${index}]`,
        0,
        budget,
        new Set(),
      ) as Capability,
    );
  }
  return Object.freeze(snapshots);
}

function assertCanonicalPermissionScope(
  value: unknown,
  label: string,
): asserts value is string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new TypeError(`${label} must be a non-empty string`);
  }
  if (value.trim() !== value) {
    throw new TypeError(`${label} must not have surrounding whitespace`);
  }
  if (!isWellFormedUnicode(value)) {
    throw new TypeError(`${label} must contain well-formed Unicode`);
  }
  if (value.length > MAX_CAPABILITY_STRING_CHARACTERS) {
    throw new TypeError(
      `${label} must not exceed ${MAX_CAPABILITY_STRING_CHARACTERS} characters`,
    );
  }
  if (containsPermissionSeparatorOrControl(value)) {
    throw new TypeError(
      `${label} must not contain commas or control characters, including Unicode C1 controls or line separators`,
    );
  }
}

function snapshotStringScopes(
  fields: Readonly<Record<string, unknown>>,
  index: number,
  key: string,
): readonly string[] | undefined {
  if (!Object.hasOwn(fields, key)) return undefined;
  const values = snapshotDenseMetadataArray(
    fields[key],
    `capabilities[${index}].${key}`,
    1,
    MAX_PERMISSION_SCOPE_ENTRIES,
  );
  const scopes: string[] = [];
  for (let scopeIndex = 0; scopeIndex < values.length; scopeIndex++) {
    const scope = values[scopeIndex];
    assertCanonicalPermissionScope(
      scope,
      `capabilities[${index}].${key}[${scopeIndex}]`,
    );
    scopes.push(scope);
  }
  return Object.freeze(scopes);
}

function normalizeListenPort(value: unknown, label: string): string {
  if (
    typeof value === "number" &&
    Number.isInteger(value) &&
    value >= 1 &&
    value <= 65_535
  ) {
    return String(value);
  }
  if (
    typeof value === "string" &&
    PORT_PATTERN.test(value) &&
    Number(value) <= 65_535
  ) {
    return value;
  }
  throw new TypeError(`${label} must be an integer from 1 through 65535`);
}

function assertDnsOrIpv4Host(value: string, label: string): void {
  if (value.length > 253) {
    throw new TypeError(`${label} must not exceed 253 characters`);
  }
  const wildcard = value.startsWith("*.");
  const host = wildcard ? value.slice(2) : value;
  const labels = host.split(".");
  if (labels.some((part) => part.length === 0 || part.length > 63)) {
    throw new TypeError(`${label} must be an ASCII DNS name or IPv4 address`);
  }

  const allNumeric = labels.every((part) => DECIMAL_PATTERN.test(part));
  if (allNumeric) {
    if (
      wildcard || labels.length !== 4 ||
      labels.some((part) => (part.length > 1 && part.startsWith("0")) || Number(part) > 255)
    ) {
      throw new TypeError(`${label} must be a canonical IPv4 address`);
    }
    return;
  }
  if (labels.some((part) => !DNS_LABEL_PATTERN.test(part))) {
    throw new TypeError(`${label} must be an ASCII DNS name or IPv4 address`);
  }
}

function assertBracketedIpv6Host(value: string, label: string): void {
  if (!BRACKETED_IPV6_PATTERN.test(value)) {
    throw new TypeError(`${label} must be a bracketed IPv6 address`);
  }
  try {
    new URL(`http://${value}/`);
  } catch (cause) {
    throw new TypeError(`${label} must be a valid bracketed IPv6 address`, {
      cause,
    });
  }
}

function normalizeNetworkHost(
  value: string,
  label: string,
  allowPort: boolean,
): string {
  if (value.startsWith("[")) {
    const closingBracket = value.indexOf("]");
    const host = closingBracket < 0 ? value : value.slice(0, closingBracket + 1);
    const suffix = closingBracket < 0 ? "" : value.slice(closingBracket + 1);
    assertBracketedIpv6Host(host, label);
    if (suffix.length === 0) return host;
    if (!allowPort || !suffix.startsWith(":")) {
      throw new TypeError(`${label} must not contain an embedded port`);
    }
    const port = normalizeListenPort(suffix.slice(1), `${label} port`);
    return `${host}:${port}`;
  }

  const colonIndex = value.lastIndexOf(":");
  const hasPort = colonIndex >= 0;
  if (hasPort && !allowPort) {
    throw new TypeError(`${label} must not contain an embedded port`);
  }
  const host = hasPort ? value.slice(0, colonIndex) : value;
  assertDnsOrIpv4Host(host, label);
  if (!hasPort) return host;
  const port = normalizeListenPort(value.slice(colonIndex + 1), `${label} port`);
  return `${host}:${port}`;
}

function snapshotListenScopes(
  fields: Readonly<Record<string, unknown>>,
  index: number,
): readonly string[] | undefined {
  const hasPorts = Object.hasOwn(fields, "ports");
  const hasHost = Object.hasOwn(fields, "host");
  if (!hasPorts) {
    if (hasHost) {
      throw new TypeError(
        `capabilities[${index}].host requires a non-empty ports array`,
      );
    }
    return undefined;
  }
  const ports = snapshotDenseMetadataArray(
    fields.ports,
    `capabilities[${index}].ports`,
    1,
    MAX_PERMISSION_SCOPE_ENTRIES,
  );
  const host = hasHost ? fields.host : "localhost";
  assertCanonicalPermissionScope(host, `capabilities[${index}].host`);
  const normalizedHost = normalizeNetworkHost(
    host,
    `capabilities[${index}].host`,
    false,
  );
  return Object.freeze(
    ports.map((port, portIndex) =>
      `${normalizedHost}:${normalizeListenPort(port, `capabilities[${index}].ports[${portIndex}]`)}`
    ),
  );
}

function inspectKnownCapability(
  capability: Capability,
  index: number,
  type: string,
  typeDescriptor: PropertyDescriptor,
  allowedFields: ReadonlySet<string>,
): Readonly<Record<string, unknown>> {
  let prototype: object | null;
  let keys: PropertyKey[];
  try {
    prototype = Object.getPrototypeOf(capability);
    keys = Reflect.ownKeys(capability);
  } catch (cause) {
    throw new TypeError(`capabilities[${index}] could not be inspected`, {
      cause,
    });
  }
  if (prototype !== Object.prototype && prototype !== null) {
    throw new TypeError(`capabilities[${index}] must be a plain object`);
  }
  if (keys.length > allowedFields.size) {
    throw new TypeError(`capabilities[${index}] contains unexpected fields`);
  }

  const fields: Record<string, unknown> = Object.create(null);
  for (const key of keys) {
    if (typeof key !== "string" || !allowedFields.has(key)) {
      throw new TypeError(
        `capabilities[${index}] contains unexpected field ${String(key)}`,
      );
    }
    let descriptor: PropertyDescriptor | undefined;
    try {
      descriptor = key === "type"
        ? typeDescriptor
        : Object.getOwnPropertyDescriptor(capability, key);
    } catch (cause) {
      throw new TypeError(`capabilities[${index}].${key} could not be inspected`, {
        cause,
      });
    }
    if (!descriptor?.enumerable || !("value" in descriptor)) {
      throw new TypeError(
        `capabilities[${index}].${key} must be an enumerable own data property`,
      );
    }
    fields[key] = descriptor.value;
  }
  if (fields.type !== type) {
    throw new TypeError(`capabilities[${index}].type changed during inspection`);
  }
  return Object.freeze(fields);
}

function snapshotCapability(capability: Capability, index: number): CapabilitySnapshot {
  if (!capability || typeof capability !== "object" || Array.isArray(capability)) {
    throw new TypeError(`capabilities[${index}] must be an object`);
  }
  let typeDescriptor: PropertyDescriptor | undefined;
  try {
    typeDescriptor = Object.getOwnPropertyDescriptor(capability, "type");
  } catch (cause) {
    throw new TypeError(`capabilities[${index}].type could not be inspected`, {
      cause,
    });
  }
  if (!typeDescriptor?.enumerable || !("value" in typeDescriptor)) {
    throw new TypeError(
      `capabilities[${index}].type must be an enumerable own data property`,
    );
  }
  const type = typeDescriptor.value;
  if (
    typeof type !== "string" || type.trim().length === 0 ||
    type.trim() !== type
  ) {
    throw new TypeError(
      `capabilities[${index}].type must be a non-empty string without surrounding whitespace`,
    );
  }
  if (!isWellFormedUnicode(type)) {
    throw new TypeError(`capabilities[${index}].type must contain well-formed Unicode`);
  }
  if (containsUnicodeControlOrLineSeparator(type)) {
    throw new TypeError(
      `capabilities[${index}].type must not contain Unicode control characters or line separators`,
    );
  }
  if (type.length > MAX_CAPABILITY_TYPE_CHARACTERS) {
    throw new TypeError(
      `capabilities[${index}].type must not exceed ${MAX_CAPABILITY_TYPE_CHARACTERS} characters`,
    );
  }

  const allowedFields = knownCapabilityFields(type);
  if (!allowedFields) return { type };
  const fields = inspectKnownCapability(
    capability,
    index,
    type,
    typeDescriptor,
    allowedFields,
  );

  if (type === "net:listen") {
    return {
      type,
      permission: { flag: "--allow-net", scopes: snapshotListenScopes(fields, index) },
    };
  }

  const scopeKey = stringScopeField(type);
  const rawScopes = scopeKey ? snapshotStringScopes(fields, index, scopeKey) : undefined;
  let scopes = rawScopes;
  if (type === "env:read" && scopes) {
    for (let scopeIndex = 0; scopeIndex < scopes.length; scopeIndex++) {
      if (scopes[scopeIndex]!.includes("=")) {
        throw new TypeError(
          `capabilities[${index}].keys[${scopeIndex}] must not contain =`,
        );
      }
    }
  }
  if (type === "net:outbound" && scopes) {
    if (scopes.includes("*")) {
      if (scopes.length !== 1) {
        throw new TypeError(
          `capabilities[${index}].hosts must contain only "*" when requesting unrestricted network access`,
        );
      }
      scopes = undefined;
    } else {
      scopes = Object.freeze(scopes.map((scope, scopeIndex) =>
        normalizeNetworkHost(
          scope,
          `capabilities[${index}].hosts[${scopeIndex}]`,
          true,
        )
      ));
    }
  }

  switch (type) {
    case "fs:read":
      return { type, permission: { flag: "--allow-read", scopes } };
    case "fs:write":
      return { type, permission: { flag: "--allow-write", scopes } };
    case "net:outbound":
      return { type, permission: { flag: "--allow-net", scopes } };
    case "env:read":
      return { type, permission: { flag: "--allow-env", scopes } };
    case "process:spawn":
      return { type, permission: { flag: "--allow-run", scopes } };
    case "native:ffi":
      return { type, permission: { flag: "--allow-ffi" } };
    case "sandbox:execute":
      return { type };
    default:
      return { type };
  }
}

/**
 * Validate the known capability grammar used by both extension admission and
 * Deno permission mapping. Unknown capability types remain extensible.
 *
 * @internal
 */
export function assertKnownCapabilitySchema(
  capability: Capability,
  index: number,
  type: string,
): void {
  const snapshot = snapshotCapability(capability, index);
  if (snapshot.type !== type) {
    throw new TypeError(`capabilities[${index}].type changed during validation`);
  }
}

/**
 * Map capabilities to Deno CLI permission flags.
 *
 * Skips capabilities without a Deno permission mapping. Recognized capability
 * types are validated at runtime and throw `TypeError` rather than emitting an
 * invalid or unexpectedly broad permission flag.
 */
export function mapToDenoPermissions(capabilities: Capability[]): string[] {
  const capabilitySnapshot = snapshotRuntimeCapabilities(capabilities);
  const permissions = new Map<
    string,
    { unscoped: boolean; scopes: string[]; seenScopes: Set<string> }
  >();
  let scopeEntries = 0;

  for (let index = 0; index < capabilitySnapshot.length; index++) {
    const snapshot = snapshotCapability(capabilitySnapshot[index] as Capability, index);
    const permission = snapshot.permission;
    if (!permission) continue;
    let aggregate = permissions.get(permission.flag);
    if (!aggregate) {
      aggregate = { unscoped: false, scopes: [], seenScopes: new Set() };
      permissions.set(permission.flag, aggregate);
    }
    if (permission.scopes === undefined) {
      aggregate.unscoped = true;
      aggregate.scopes.length = 0;
      aggregate.seenScopes.clear();
      continue;
    }
    scopeEntries += permission.scopes.length;
    if (scopeEntries > MAX_PERMISSION_SCOPE_ENTRIES) {
      throw new TypeError(
        `capabilities exceed ${MAX_PERMISSION_SCOPE_ENTRIES} aggregate permission scopes`,
      );
    }
    if (aggregate.unscoped) continue;
    for (const scope of permission.scopes) {
      if (!aggregate.seenScopes.has(scope)) {
        aggregate.seenScopes.add(scope);
        aggregate.scopes.push(scope);
      }
    }
  }

  assertDenoPermissionSerializationBudget(permissions);
  return [...permissions].map(([flag, aggregate]) =>
    aggregate.unscoped ? flag : `${flag}=${aggregate.scopes.join(",")}`
  );
}

/**
 * Log capabilities for a named extension at startup.
 */
export function auditCapabilities(
  extensionName: string,
  capabilities: Capability[],
  logger: ExtensionLogger,
): void {
  const lines = formatCapabilities(capabilities);
  if (lines.length === 0) return;
  logger.debug(`Extension "${extensionName}" declares capabilities:`, ...lines);
}
