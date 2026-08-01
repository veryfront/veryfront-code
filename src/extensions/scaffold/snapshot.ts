/**
 * Bounded snapshots for the scaffold-provider trust boundary.
 *
 * Validation reads provider-owned objects through property descriptors. It
 * never invokes accessors, rejects shapes that cannot be inspected, copies all
 * accepted data, sorts unordered collections lexically, and freezes the
 * resulting graph. JavaScript cannot identify a transparent Proxy, but proxy
 * traps that fail or expose an invalid shape are rejected without fallback.
 *
 * @module extensions/scaffold/snapshot
 */

import type {
  ScaffoldCatalog,
  ScaffoldCatalogEntry,
  ScaffoldEnvironmentVariable,
  ScaffoldFile,
  ScaffoldPackageContribution,
  ScaffoldPackageRecord,
  ScaffoldPlan,
  ScaffoldProvider,
  ScaffoldRequest,
  ScaffoldRuntime,
} from "./scaffold-provider.ts";
import { SCAFFOLD_PROVIDER_API_VERSION } from "./scaffold-provider.ts";

const IntrinsicArray = Array;
const IntrinsicSet = Set;
const ArrayIsArray = Array.isArray;
const ArrayPrototype = Array.prototype;
const ArrayPrototypeSort = Array.prototype.sort;
const ObjectCreate = Object.create;
const ObjectDefineProperty = Object.defineProperty;
const ObjectFreeze = Object.freeze;
const ObjectGetOwnPropertyDescriptor = Object.getOwnPropertyDescriptor;
const ObjectGetPrototypeOf = Object.getPrototypeOf;
const ObjectPrototype = Object.prototype;
const ObjectPrototypeHasOwnProperty = Object.prototype.hasOwnProperty;
const NumberIsSafeInteger = Number.isSafeInteger;
const ReflectApply = Reflect.apply;
const ReflectOwnKeys = Reflect.ownKeys;
const RegExpPrototypeTest = RegExp.prototype.test;
const SetPrototypeAdd = Set.prototype.add;
const SetPrototypeHas = Set.prototype.has;
const StringPrototypeCharCodeAt = String.prototype.charCodeAt;
const StringPrototypeIncludes = String.prototype.includes;
const StringPrototypeNormalize = String.prototype.normalize;
const StringPrototypeSlice = String.prototype.slice;
const StringPrototypeSplit = String.prototype.split;
const StringPrototypeStartsWith = String.prototype.startsWith;
const StringPrototypeToLowerCase = String.prototype.toLowerCase;
const StringPrototypeTrim = String.prototype.trim;
const TextEncoderPrototypeEncode = TextEncoder.prototype.encode;
const textEncoder = new TextEncoder();

/** Maximum number of files in a provider plan. */
export const SCAFFOLD_MAX_FILES = 10_000;
/** Maximum UTF-8 size of one generated file. */
export const SCAFFOLD_MAX_FILE_BYTES = 4 * 1024 * 1024;
/** Maximum combined UTF-8 size of all generated files. */
export const SCAFFOLD_MAX_TOTAL_FILE_BYTES = 64 * 1024 * 1024;
/** Maximum combined dependency and development-dependency records. */
export const SCAFFOLD_MAX_PACKAGE_RECORDS = 1_000;
/** Maximum entries in each provider catalog category. */
export const SCAFFOLD_MAX_CATALOG_ENTRIES = 1_000;
/** Maximum feature or integration IDs in one request. */
export const SCAFFOLD_MAX_SELECTION_IDS = 1_000;
/** Maximum environment declarations in a provider plan. */
export const SCAFFOLD_MAX_ENVIRONMENT_VARIABLES = 1_000;
/** Maximum notices in a provider plan. */
export const SCAFFOLD_MAX_NOTICES = 1_000;
/** Maximum code-unit length of paths and identifiers. */
export const SCAFFOLD_MAX_ID_LENGTH = 1_024;
/** Maximum UTF-8 size of one label, description, notice, or package range. */
export const SCAFFOLD_MAX_TEXT_BYTES = 16 * 1024;

/** Stable machine-readable reasons for rejecting a scaffold boundary value. */
export type ScaffoldSnapshotErrorCode =
  | "accessor-property"
  | "duplicate-value"
  | "inspection-failed"
  | "invalid-array-shape"
  | "invalid-environment-name"
  | "invalid-id"
  | "invalid-package-name"
  | "invalid-package-range"
  | "invalid-path"
  | "invalid-prototype"
  | "invalid-runtime"
  | "max-entries-exceeded"
  | "max-file-bytes-exceeded"
  | "max-files-exceeded"
  | "max-id-length-exceeded"
  | "max-text-bytes-exceeded"
  | "max-total-file-bytes-exceeded"
  | "missing-property"
  | "non-enumerable-property"
  | "reserved-path"
  | "symbol-key"
  | "undeclared-trusted-build-package"
  | "unexpected-property"
  | "unsupported-type";

/** Error raised when extension-owned scaffold data is not safe to consume. */
export class ScaffoldSnapshotError extends TypeError {
  readonly code: ScaffoldSnapshotErrorCode;
  readonly path: string;

  constructor(code: ScaffoldSnapshotErrorCode, path: string, reason: string) {
    super(`Invalid scaffold value at ${path}: ${reason}`);
    this.name = "ScaffoldSnapshotError";
    this.code = code;
    this.path = path;
  }
}

type InspectedRecord = Record<string, unknown>;

const PORTABLE_ID_PATTERN = /^[A-Za-z0-9](?:[A-Za-z0-9._-]*[A-Za-z0-9])?$/;
const ENVIRONMENT_NAME_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;
const PACKAGE_PART_PATTERN = /^[a-z0-9](?:[a-z0-9._~-]*[a-z0-9])?$/;
const DRIVE_PATH_PATTERN = /^[A-Za-z]:/;

function reject(
  code: ScaffoldSnapshotErrorCode,
  path: string,
  reason: string,
): never {
  throw new ScaffoldSnapshotError(code, path, reason);
}

function defineDataProperty(
  target: object,
  key: PropertyKey,
  value: unknown,
  enumerable = true,
  writable = false,
  configurable = false,
): void {
  const descriptor = ObjectCreate(null) as PropertyDescriptor;
  descriptor.value = value;
  descriptor.enumerable = enumerable;
  descriptor.writable = writable;
  descriptor.configurable = configurable;
  ObjectDefineProperty(target, key, descriptor);
}

function hasOwnValue(descriptor: PropertyDescriptor): boolean {
  return ReflectApply(
    ObjectPrototypeHasOwnProperty,
    descriptor,
    ["value"],
  ) as boolean;
}

function inspectPrototype(value: object, path: string): object | null {
  try {
    return ObjectGetPrototypeOf(value);
  } catch {
    return reject("inspection-failed", path, "prototype inspection failed");
  }
}

function inspectOwnKeys(value: object, path: string): PropertyKey[] {
  try {
    return ReflectOwnKeys(value);
  } catch {
    return reject("inspection-failed", path, "property-key inspection failed");
  }
}

function inspectDescriptor(
  value: object,
  key: PropertyKey,
  path: string,
): PropertyDescriptor {
  let descriptor: PropertyDescriptor | undefined;
  try {
    descriptor = ObjectGetOwnPropertyDescriptor(value, key);
  } catch {
    return reject("inspection-failed", path, "property descriptor inspection failed");
  }
  if (descriptor === undefined) {
    return reject("inspection-failed", path, "property changed during inspection");
  }
  return descriptor;
}

function descriptorValue(descriptor: PropertyDescriptor, path: string): unknown {
  if (!hasOwnValue(descriptor)) {
    return reject("accessor-property", path, "accessor properties are not allowed");
  }
  if (!descriptor.enumerable) {
    return reject(
      "non-enumerable-property",
      path,
      "non-enumerable properties are not allowed",
    );
  }
  return descriptor.value;
}

function childPath(path: string, key: string): string {
  return `${path}.${key}`;
}

function arrayPath(path: string, index: number): string {
  return `${path}[${index}]`;
}

function isListed(key: string, keys: readonly string[]): boolean {
  for (let index = 0; index < keys.length; index += 1) {
    if (keys[index] === key) return true;
  }
  return false;
}

function inspectRecord(
  value: unknown,
  path: string,
  requiredKeys: readonly string[],
  optionalKeys: readonly string[] = [],
): InspectedRecord {
  if (value === null || typeof value !== "object") {
    return reject("unsupported-type", path, "expected a plain record");
  }
  const prototype = inspectPrototype(value, path);
  if (prototype !== ObjectPrototype && prototype !== null) {
    return reject(
      "invalid-prototype",
      path,
      "only plain or null-prototype records are allowed",
    );
  }

  const ownKeys = inspectOwnKeys(value, path);
  const inspected = ObjectCreate(null) as InspectedRecord;
  for (let index = 0; index < ownKeys.length; index += 1) {
    const key = ownKeys[index];
    if (typeof key !== "string") {
      return reject("symbol-key", path, "symbol properties are not allowed");
    }
    const propertyPath = childPath(path, key);
    if (!isListed(key, requiredKeys) && !isListed(key, optionalKeys)) {
      return reject("unexpected-property", propertyPath, "property is not part of the contract");
    }
    const descriptor = inspectDescriptor(value, key, propertyPath);
    defineDataProperty(inspected, key, descriptorValue(descriptor, propertyPath));
  }

  for (let index = 0; index < requiredKeys.length; index += 1) {
    const key = requiredKeys[index]!;
    if (!hasOwnValueAt(inspected, key)) {
      return reject("missing-property", childPath(path, key), "required property is missing");
    }
  }
  return inspected;
}

function hasOwnValueAt(value: object, key: PropertyKey): boolean {
  return ReflectApply(ObjectPrototypeHasOwnProperty, value, [key]) as boolean;
}

function inspectArray(
  value: unknown,
  path: string,
  maxLength: number,
  maxLengthCode: "max-entries-exceeded" | "max-files-exceeded" = "max-entries-exceeded",
): readonly unknown[] {
  let isArray: boolean;
  try {
    isArray = ArrayIsArray(value);
  } catch {
    return reject("inspection-failed", path, "array inspection failed");
  }
  if (!isArray) {
    return reject("unsupported-type", path, "expected an array");
  }
  const array = value as unknown[];
  if (inspectPrototype(array, path) !== ArrayPrototype) {
    return reject("invalid-prototype", path, "array subclasses are not allowed");
  }

  const lengthDescriptor = inspectDescriptor(array, "length", path);
  if (!hasOwnValue(lengthDescriptor)) {
    return reject("invalid-array-shape", path, "array length is invalid");
  }
  const length = lengthDescriptor.value;
  if (!NumberIsSafeInteger(length) || (length as number) < 0) {
    return reject("invalid-array-shape", path, "array length is invalid");
  }
  if ((length as number) > maxLength) {
    return reject(
      maxLengthCode,
      path,
      `entry count exceeds ${maxLength}`,
    );
  }

  const ownKeys = inspectOwnKeys(array, path);
  if (ownKeys.length !== (length as number) + 1) {
    return reject(
      "invalid-array-shape",
      path,
      "arrays must be dense and cannot have extra own properties",
    );
  }
  for (let index = 0; index < ownKeys.length; index += 1) {
    if (typeof ownKeys[index] === "symbol") {
      return reject("symbol-key", path, "symbol properties are not allowed");
    }
  }

  const output = new IntrinsicArray<unknown>(length as number);
  for (let index = 0; index < (length as number); index += 1) {
    const itemPath = arrayPath(path, index);
    const descriptor = inspectDescriptor(array, `${index}`, itemPath);
    defineDataProperty(output, index, descriptorValue(descriptor, itemPath), true, true, true);
  }
  return output;
}

function trim(value: string): string {
  return ReflectApply(StringPrototypeTrim, value, []) as string;
}

function lower(value: string): string {
  return ReflectApply(StringPrototypeToLowerCase, value, []) as string;
}

function includes(value: string, search: string): boolean {
  return ReflectApply(StringPrototypeIncludes, value, [search]) as boolean;
}

function normalize(value: string): string {
  return ReflectApply(StringPrototypeNormalize, value, ["NFC"]) as string;
}

function slice(value: string, start: number): string {
  return ReflectApply(StringPrototypeSlice, value, [start]) as string;
}

function split(value: string, separator: string, limit?: number): string[] {
  return ReflectApply(
    StringPrototypeSplit,
    value,
    limit === undefined ? [separator] : [separator, limit],
  ) as string[];
}

function startsWith(value: string, search: string): boolean {
  return ReflectApply(StringPrototypeStartsWith, value, [search]) as boolean;
}

function charCodeAt(value: string, index: number): number {
  return ReflectApply(StringPrototypeCharCodeAt, value, [index]) as number;
}

function matches(pattern: RegExp, value: string): boolean {
  return ReflectApply(RegExpPrototypeTest, pattern, [value]) as boolean;
}

function utf8ByteLength(value: string): number {
  return ReflectApply(TextEncoderPrototypeEncode, textEncoder, [value]).byteLength;
}

function assertNoControlCharacters(value: string, path: string): void {
  for (let index = 0; index < value.length; index += 1) {
    const code = charCodeAt(value, index);
    if (code <= 31 || code === 127) {
      reject("unsupported-type", path, "control characters are not allowed");
    }
  }
}

function snapshotCanonicalString(
  value: unknown,
  path: string,
  maxLength = SCAFFOLD_MAX_ID_LENGTH,
): string {
  if (typeof value !== "string" || value.length === 0 || trim(value) !== value) {
    return reject("unsupported-type", path, "expected a non-empty canonical string");
  }
  if (value.length > maxLength) {
    return reject(
      "max-id-length-exceeded",
      path,
      `string length exceeds ${maxLength}`,
    );
  }
  assertNoControlCharacters(value, path);
  return value;
}

function snapshotBoundedText(value: unknown, path: string): string {
  if (typeof value !== "string" || value.length === 0 || trim(value) !== value) {
    return reject(
      "unsupported-type",
      path,
      "expected a non-empty canonical string",
    );
  }
  if (value.length > SCAFFOLD_MAX_TEXT_BYTES) {
    return reject(
      "max-text-bytes-exceeded",
      path,
      `UTF-8 size exceeds ${SCAFFOLD_MAX_TEXT_BYTES} bytes`,
    );
  }
  const bytes = utf8ByteLength(value);
  if (bytes > SCAFFOLD_MAX_TEXT_BYTES) {
    return reject(
      "max-text-bytes-exceeded",
      path,
      `UTF-8 size exceeds ${SCAFFOLD_MAX_TEXT_BYTES} bytes`,
    );
  }
  assertNoControlCharacters(value, path);
  return value;
}

function snapshotPortableId(value: unknown, path: string): string {
  const id = snapshotCanonicalString(value, path);
  if (!matches(PORTABLE_ID_PATTERN, id) || id === "." || id === "..") {
    return reject("invalid-id", path, "expected a portable identifier");
  }
  return id;
}

function snapshotPackageName(value: unknown, path: string): string {
  const name = snapshotCanonicalString(value, path);
  const parts = name[0] === "@" ? split(slice(name, 1), "/") : split(name, "/");
  const valid = name[0] === "@"
    ? parts.length === 2 && parts[0] !== "" && parts[1] !== ""
    : parts.length === 1;
  if (!valid) {
    return reject("invalid-package-name", path, "expected a portable package name");
  }
  for (let index = 0; index < parts.length; index += 1) {
    if (!matches(PACKAGE_PART_PATTERN, parts[index]!)) {
      return reject("invalid-package-name", path, "expected a portable package name");
    }
  }
  return name;
}

function snapshotPackageRange(value: unknown, path: string): string {
  if (typeof value === "string" && value.length > SCAFFOLD_MAX_ID_LENGTH) {
    return reject(
      "invalid-package-range",
      path,
      `package range length exceeds ${SCAFFOLD_MAX_ID_LENGTH}`,
    );
  }
  const range = snapshotBoundedText(value, path);
  return range;
}

function compareStrings(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function sortStrings(values: string[]): string[] {
  ReflectApply(ArrayPrototypeSort, values, [compareStrings]);
  return values;
}

function sortById<T extends { readonly id: string }>(values: T[]): T[] {
  ReflectApply(ArrayPrototypeSort, values, [
    (left: T, right: T) => compareStrings(left.id, right.id),
  ]);
  return values;
}

function sortByName<T extends { readonly name: string }>(values: T[]): T[] {
  ReflectApply(ArrayPrototypeSort, values, [
    (left: T, right: T) => compareStrings(left.name, right.name),
  ]);
  return values;
}

function freezeArray<T>(values: T[]): readonly T[] {
  return ObjectFreeze(values);
}

function snapshotUniqueIds(
  value: unknown,
  path: string,
  maxLength: number,
): readonly string[] {
  const input = inspectArray(value, path, maxLength);
  const seen = new IntrinsicSet<string>();
  const output = new IntrinsicArray<string>(input.length);
  for (let index = 0; index < input.length; index += 1) {
    const itemPath = arrayPath(path, index);
    const id = snapshotPortableId(input[index], itemPath);
    if (ReflectApply(SetPrototypeHas, seen, [id]) as boolean) {
      return reject("duplicate-value", itemPath, `duplicate identifier "${id}"`);
    }
    ReflectApply(SetPrototypeAdd, seen, [id]);
    defineDataProperty(output, index, id, true, true, true);
  }
  return freezeArray(sortStrings(output));
}

/** Create an immutable, canonical request before it crosses into an extension. */
export function snapshotScaffoldRequest(value: unknown): ScaffoldRequest {
  const input = inspectRecord(value, "$request", [
    "frameworkVersion",
    "projectName",
    "runtime",
    "templateId",
    "featureIds",
    "integrationIds",
  ]);
  const runtime = input.runtime;
  if (runtime !== "bun" && runtime !== "deno" && runtime !== "node") {
    return reject("invalid-runtime", "$request.runtime", "expected bun, deno, or node");
  }

  const output = ObjectCreate(null) as unknown as ScaffoldRequest;
  defineDataProperty(
    output,
    "frameworkVersion",
    snapshotCanonicalString(input.frameworkVersion, "$request.frameworkVersion"),
  );
  defineDataProperty(
    output,
    "projectName",
    snapshotCanonicalString(input.projectName, "$request.projectName"),
  );
  defineDataProperty(output, "runtime", runtime satisfies ScaffoldRuntime);
  defineDataProperty(
    output,
    "templateId",
    snapshotPortableId(input.templateId, "$request.templateId"),
  );
  defineDataProperty(
    output,
    "featureIds",
    snapshotUniqueIds(
      input.featureIds,
      "$request.featureIds",
      SCAFFOLD_MAX_SELECTION_IDS,
    ),
  );
  defineDataProperty(
    output,
    "integrationIds",
    snapshotUniqueIds(
      input.integrationIds,
      "$request.integrationIds",
      SCAFFOLD_MAX_SELECTION_IDS,
    ),
  );
  return ObjectFreeze(output);
}

function snapshotCatalogEntry(value: unknown, path: string): ScaffoldCatalogEntry {
  const input = inspectRecord(value, path, ["id", "label"], ["description"]);
  const output = ObjectCreate(null) as unknown as ScaffoldCatalogEntry;
  defineDataProperty(output, "id", snapshotPortableId(input.id, childPath(path, "id")));
  defineDataProperty(
    output,
    "label",
    snapshotBoundedText(input.label, childPath(path, "label")),
  );
  if (hasOwnValueAt(input, "description")) {
    defineDataProperty(
      output,
      "description",
      snapshotBoundedText(input.description, childPath(path, "description")),
    );
  }
  return ObjectFreeze(output);
}

function snapshotCatalogEntries(value: unknown, path: string): readonly ScaffoldCatalogEntry[] {
  const input = inspectArray(value, path, SCAFFOLD_MAX_CATALOG_ENTRIES);
  const seen = new IntrinsicSet<string>();
  const output = new IntrinsicArray<ScaffoldCatalogEntry>(input.length);
  for (let index = 0; index < input.length; index += 1) {
    const itemPath = arrayPath(path, index);
    const entry = snapshotCatalogEntry(input[index], itemPath);
    if (ReflectApply(SetPrototypeHas, seen, [entry.id]) as boolean) {
      return reject("duplicate-value", itemPath, `duplicate catalog identifier "${entry.id}"`);
    }
    ReflectApply(SetPrototypeAdd, seen, [entry.id]);
    defineDataProperty(output, index, entry, true, true, true);
  }
  return freezeArray(sortById(output));
}

/** Snapshot and canonicalize a provider-owned catalog. */
export function snapshotScaffoldCatalog(value: unknown): ScaffoldCatalog {
  const input = inspectRecord(value, "$catalog", [
    "templates",
    "features",
    "integrations",
  ]);
  const output = ObjectCreate(null) as unknown as ScaffoldCatalog;
  defineDataProperty(
    output,
    "templates",
    snapshotCatalogEntries(input.templates, "$catalog.templates"),
  );
  defineDataProperty(
    output,
    "features",
    snapshotCatalogEntries(input.features, "$catalog.features"),
  );
  defineDataProperty(
    output,
    "integrations",
    snapshotCatalogEntries(input.integrations, "$catalog.integrations"),
  );
  return ObjectFreeze(output);
}

function snapshotScaffoldPath(value: unknown, path: string): string {
  const candidate = snapshotCanonicalString(value, path);
  if (
    candidate[0] === "/" ||
    matches(DRIVE_PATH_PATTERN, candidate) ||
    includes(candidate, "\\") ||
    includes(candidate, ":") ||
    normalize(candidate) !== candidate
  ) {
    return reject("invalid-path", path, "path must be a portable project-relative path");
  }

  const segments = split(candidate, "/");
  for (let index = 0; index < segments.length; index += 1) {
    const segment = segments[index]!;
    if (segment === "" || segment === "." || segment === "..") {
      return reject(
        "invalid-path",
        path,
        "path must not contain empty, current-directory, or parent-directory segments",
      );
    }
  }

  const canonical = lower(candidate);
  const root = split(canonical, "/", 1)[0]!;
  if (
    root === "package.json" ||
    root === "deno.json" ||
    root === ".gitignore" ||
    root === ".env" ||
    startsWith(root, ".env.") ||
    canonical === ".veryfront/project.json"
  ) {
    return reject("reserved-path", path, "path is owned by core project composition");
  }
  return candidate;
}

function snapshotFile(value: unknown, path: string): { file: ScaffoldFile; bytes: number } {
  const input = inspectRecord(value, path, ["path", "content"]);
  const filePath = snapshotScaffoldPath(input.path, childPath(path, "path"));
  if (typeof input.content !== "string") {
    return reject("unsupported-type", childPath(path, "content"), "expected a string");
  }
  if (input.content.length > SCAFFOLD_MAX_FILE_BYTES) {
    return reject(
      "max-file-bytes-exceeded",
      childPath(path, "content"),
      `UTF-8 size exceeds ${SCAFFOLD_MAX_FILE_BYTES} bytes`,
    );
  }
  const bytes = utf8ByteLength(input.content);
  if (bytes > SCAFFOLD_MAX_FILE_BYTES) {
    return reject(
      "max-file-bytes-exceeded",
      childPath(path, "content"),
      `UTF-8 size exceeds ${SCAFFOLD_MAX_FILE_BYTES} bytes`,
    );
  }
  const output = ObjectCreate(null) as unknown as ScaffoldFile;
  defineDataProperty(output, "path", filePath);
  defineDataProperty(output, "content", input.content);
  return { file: ObjectFreeze(output), bytes };
}

function snapshotFiles(value: unknown): readonly ScaffoldFile[] {
  const input = inspectArray(
    value,
    "$plan.files",
    SCAFFOLD_MAX_FILES,
    "max-files-exceeded",
  );
  const exactPaths = new IntrinsicSet<string>();
  const portablePaths = new IntrinsicSet<string>();
  const output = new IntrinsicArray<ScaffoldFile>(input.length);
  let totalBytes = 0;
  for (let index = 0; index < input.length; index += 1) {
    const itemPath = arrayPath("$plan.files", index);
    const { file, bytes } = snapshotFile(input[index], itemPath);
    const portablePath = lower(file.path);
    if (
      ReflectApply(SetPrototypeHas, exactPaths, [file.path]) as boolean ||
      ReflectApply(SetPrototypeHas, portablePaths, [portablePath]) as boolean
    ) {
      return reject("duplicate-value", childPath(itemPath, "path"), "duplicate file path");
    }
    ReflectApply(SetPrototypeAdd, exactPaths, [file.path]);
    ReflectApply(SetPrototypeAdd, portablePaths, [portablePath]);
    if (bytes > SCAFFOLD_MAX_TOTAL_FILE_BYTES - totalBytes) {
      return reject(
        "max-total-file-bytes-exceeded",
        "$plan.files",
        `combined UTF-8 size exceeds ${SCAFFOLD_MAX_TOTAL_FILE_BYTES} bytes`,
      );
    }
    totalBytes += bytes;
    defineDataProperty(output, index, file, true, true, true);
  }
  ReflectApply(ArrayPrototypeSort, output, [
    (left: ScaffoldFile, right: ScaffoldFile) => compareStrings(left.path, right.path),
  ]);
  return freezeArray(output);
}

function snapshotPackageRecord(value: unknown, path: string): ScaffoldPackageRecord {
  const input = inspectRecord(value, path, ["name", "range"]);
  const output = ObjectCreate(null) as unknown as ScaffoldPackageRecord;
  defineDataProperty(
    output,
    "name",
    snapshotPackageName(input.name, childPath(path, "name")),
  );
  defineDataProperty(
    output,
    "range",
    snapshotPackageRange(input.range, childPath(path, "range")),
  );
  return ObjectFreeze(output);
}

function snapshotPackageRecords(
  value: unknown,
  path: string,
  seen: Set<string>,
): readonly ScaffoldPackageRecord[] {
  const input = inspectArray(value, path, SCAFFOLD_MAX_PACKAGE_RECORDS);
  const output = new IntrinsicArray<ScaffoldPackageRecord>(input.length);
  for (let index = 0; index < input.length; index += 1) {
    const itemPath = arrayPath(path, index);
    const record = snapshotPackageRecord(input[index], itemPath);
    if (ReflectApply(SetPrototypeHas, seen, [record.name]) as boolean) {
      return reject("duplicate-value", childPath(itemPath, "name"), "duplicate package name");
    }
    ReflectApply(SetPrototypeAdd, seen, [record.name]);
    defineDataProperty(output, index, record, true, true, true);
  }
  return freezeArray(sortByName(output));
}

function snapshotPackageNames(
  value: unknown,
  path: string,
  declared?: Set<string>,
): readonly string[] {
  const input = inspectArray(value, path, SCAFFOLD_MAX_PACKAGE_RECORDS);
  const seen = new IntrinsicSet<string>();
  const output = new IntrinsicArray<string>(input.length);
  for (let index = 0; index < input.length; index += 1) {
    const itemPath = arrayPath(path, index);
    const name = snapshotPackageName(input[index], itemPath);
    if (ReflectApply(SetPrototypeHas, seen, [name]) as boolean) {
      return reject("duplicate-value", itemPath, "duplicate package name");
    }
    if (
      declared !== undefined &&
      !(ReflectApply(SetPrototypeHas, declared, [name]) as boolean)
    ) {
      return reject(
        "undeclared-trusted-build-package",
        itemPath,
        "trusted build package must be declared as a dependency or development dependency",
      );
    }
    ReflectApply(SetPrototypeAdd, seen, [name]);
    defineDataProperty(output, index, name, true, true, true);
  }
  return freezeArray(sortStrings(output));
}

function snapshotPackageContribution(value: unknown): ScaffoldPackageContribution {
  const input = inspectRecord(value, "$plan.package", [
    "dependencies",
    "devDependencies",
    "firstPartyExtensions",
    "trustedBuildPackages",
  ]);
  const declared = new IntrinsicSet<string>();
  const dependencies = snapshotPackageRecords(
    input.dependencies,
    "$plan.package.dependencies",
    declared,
  );
  const devDependencies = snapshotPackageRecords(
    input.devDependencies,
    "$plan.package.devDependencies",
    declared,
  );
  if (dependencies.length + devDependencies.length > SCAFFOLD_MAX_PACKAGE_RECORDS) {
    return reject(
      "max-entries-exceeded",
      "$plan.package",
      `dependency record count exceeds ${SCAFFOLD_MAX_PACKAGE_RECORDS}`,
    );
  }
  const firstPartyExtensions = snapshotPackageNames(
    input.firstPartyExtensions,
    "$plan.package.firstPartyExtensions",
  );
  const trustedBuildPackages = snapshotPackageNames(
    input.trustedBuildPackages,
    "$plan.package.trustedBuildPackages",
    declared,
  );

  const output = ObjectCreate(null) as unknown as ScaffoldPackageContribution;
  defineDataProperty(output, "dependencies", dependencies);
  defineDataProperty(output, "devDependencies", devDependencies);
  defineDataProperty(output, "firstPartyExtensions", firstPartyExtensions);
  defineDataProperty(output, "trustedBuildPackages", trustedBuildPackages);
  return ObjectFreeze(output);
}

function snapshotEnvironment(value: unknown): readonly ScaffoldEnvironmentVariable[] {
  const input = inspectArray(
    value,
    "$plan.environment",
    SCAFFOLD_MAX_ENVIRONMENT_VARIABLES,
  );
  const seen = new IntrinsicSet<string>();
  const output = new IntrinsicArray<ScaffoldEnvironmentVariable>(input.length);
  for (let index = 0; index < input.length; index += 1) {
    const itemPath = arrayPath("$plan.environment", index);
    const record = inspectRecord(input[index], itemPath, ["name", "required"], [
      "description",
    ]);
    const name = snapshotCanonicalString(record.name, childPath(itemPath, "name"));
    if (!matches(ENVIRONMENT_NAME_PATTERN, name)) {
      return reject(
        "invalid-environment-name",
        childPath(itemPath, "name"),
        "expected a portable environment-variable name",
      );
    }
    const portableName = lower(name);
    if (ReflectApply(SetPrototypeHas, seen, [portableName]) as boolean) {
      return reject(
        "duplicate-value",
        childPath(itemPath, "name"),
        "duplicate environment-variable name",
      );
    }
    ReflectApply(SetPrototypeAdd, seen, [portableName]);
    if (typeof record.required !== "boolean") {
      return reject("unsupported-type", childPath(itemPath, "required"), "expected a boolean");
    }
    const variable = ObjectCreate(null) as unknown as ScaffoldEnvironmentVariable;
    defineDataProperty(variable, "name", name);
    defineDataProperty(variable, "required", record.required);
    if (hasOwnValueAt(record, "description")) {
      defineDataProperty(
        variable,
        "description",
        snapshotBoundedText(record.description, childPath(itemPath, "description")),
      );
    }
    defineDataProperty(output, index, ObjectFreeze(variable), true, true, true);
  }
  return freezeArray(sortByName(output));
}

function snapshotNotices(value: unknown): readonly string[] {
  const input = inspectArray(value, "$plan.notices", SCAFFOLD_MAX_NOTICES);
  const seen = new IntrinsicSet<string>();
  const output = new IntrinsicArray<string>(input.length);
  for (let index = 0; index < input.length; index += 1) {
    const itemPath = arrayPath("$plan.notices", index);
    const notice = snapshotBoundedText(input[index], itemPath);
    if (ReflectApply(SetPrototypeHas, seen, [notice]) as boolean) {
      return reject("duplicate-value", itemPath, "duplicate notice");
    }
    ReflectApply(SetPrototypeAdd, seen, [notice]);
    defineDataProperty(output, index, notice, true, true, true);
  }
  return freezeArray(sortStrings(output));
}

/** Snapshot and canonicalize a complete provider-owned scaffold plan. */
export function snapshotScaffoldPlan(value: unknown): ScaffoldPlan {
  const input = inspectRecord(value, "$plan", [
    "files",
    "package",
    "environment",
    "notices",
  ]);
  const output = ObjectCreate(null) as unknown as ScaffoldPlan;
  defineDataProperty(output, "files", snapshotFiles(input.files));
  defineDataProperty(output, "package", snapshotPackageContribution(input.package));
  defineDataProperty(output, "environment", snapshotEnvironment(input.environment));
  defineDataProperty(output, "notices", snapshotNotices(input.notices));
  return ObjectFreeze(output);
}

function snapshotProviderMethod(
  value: unknown,
  path: string,
): (...args: unknown[]) => unknown {
  if (typeof value !== "function") {
    return reject("unsupported-type", path, "expected a function");
  }
  return value as (...args: unknown[]) => unknown;
}

/**
 * Capture a dynamic provider once and enforce snapshots on every call.
 *
 * The returned facade has no mutable provider-owned data. Its methods retain
 * the original receiver for implementations that use `this`, but request and
 * result values always cross the boundary as bounded frozen snapshots.
 */
export function captureScaffoldProvider(value: unknown): ScaffoldProvider {
  const input = inspectRecord(value, "$provider", [
    "id",
    "apiVersion",
    "getCatalog",
    "createPlan",
  ]);
  const id = snapshotPortableId(input.id, "$provider.id");
  if (input.apiVersion !== SCAFFOLD_PROVIDER_API_VERSION) {
    return reject(
      "unsupported-type",
      "$provider.apiVersion",
      `expected API version ${SCAFFOLD_PROVIDER_API_VERSION}`,
    );
  }
  const getCatalog = snapshotProviderMethod(input.getCatalog, "$provider.getCatalog");
  const createPlan = snapshotProviderMethod(input.createPlan, "$provider.createPlan");
  const receiver = value as object;

  const output = ObjectCreate(null) as unknown as ScaffoldProvider;
  defineDataProperty(output, "id", id);
  defineDataProperty(output, "apiVersion", SCAFFOLD_PROVIDER_API_VERSION);
  defineDataProperty(output, "getCatalog", async () => {
    const result = await ReflectApply(getCatalog, receiver, []);
    return snapshotScaffoldCatalog(result);
  });
  defineDataProperty(output, "createPlan", async (request: ScaffoldRequest) => {
    const safeRequest = snapshotScaffoldRequest(request);
    const result = await ReflectApply(createPlan, receiver, [safeRequest]);
    return snapshotScaffoldPlan(result);
  });
  return ObjectFreeze(output);
}
