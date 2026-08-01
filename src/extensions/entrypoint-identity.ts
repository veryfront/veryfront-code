/**
 * Internal helpers for selecting and binding extension entrypoints.
 *
 * Package manifests are untrusted input. Selection reads only own data
 * properties, never invokes accessors, and accepts only deterministic local
 * filesystem targets. Binding then replaces the discovered lexical path with
 * a canonical absolute regular-file path inside the canonical owning
 * directory.
 *
 * @module extensions/entrypoint-identity
 */

import { realPath, stat } from "#veryfront/compat/fs.ts";
import { isAbsolute, normalize, relative, resolve } from "#veryfront/compat/path";

const DEFAULT_PACKAGE_ENTRYPOINT = "./index.js";
const PREFERRED_EXPORT_CONDITIONS = ["deno", "import", "default"] as const;
const MAX_CONDITIONAL_EXPORT_DEPTH = 16;
const URL_SCHEME = /^[A-Za-z][A-Za-z0-9+.-]*:/;

const arrayIsArray = Array.isArray;
const getOwnPropertyDescriptor = Object.getOwnPropertyDescriptor;
const reflectOwnKeys = Reflect.ownKeys;

interface DataProperty {
  present: boolean;
  value?: unknown;
}

interface EntrypointFileInfo {
  isFile: boolean;
  isDirectory: boolean;
}

interface EntrypointFileOperations {
  realPath(path: string): Promise<string>;
  stat(path: string): Promise<EntrypointFileInfo>;
}

const nativeFileOperations: EntrypointFileOperations = {
  realPath,
  stat,
};

function invalid(message: string): never {
  throw new Error(`Invalid extension entrypoint: ${message}`);
}

function isRecord(value: unknown): value is object {
  try {
    return typeof value === "object" && value !== null && !arrayIsArray(value);
  } catch {
    return false;
  }
}

/**
 * Read an own data property without evaluating an accessor or consulting the
 * prototype chain. Package data is expected to come from JSON.parse; rejecting
 * accessors here keeps the boundary safe if a caller supplies another object.
 */
function readDataProperty(
  object: object,
  property: string,
  context: string,
): DataProperty {
  let descriptor: PropertyDescriptor | undefined;
  try {
    descriptor = getOwnPropertyDescriptor(object, property);
  } catch {
    return invalid(`${context}.${property} could not be inspected safely`);
  }

  if (!descriptor) return { present: false };
  if (!("value" in descriptor)) {
    return invalid(`${context}.${property} must be an own data property`);
  }
  return { present: true, value: descriptor.value };
}

/** Return every own string-keyed data property without reading its value. */
function dataPropertyMap(object: object, context: string): Map<string, unknown> {
  let keys: readonly PropertyKey[];
  try {
    keys = reflectOwnKeys(object);
  } catch {
    return invalid(`${context} could not be inspected safely`);
  }

  const properties = new Map<string, unknown>();
  for (const key of keys) {
    if (typeof key !== "string") {
      return invalid(`${context} must contain only string-keyed data`);
    }
    const property = readDataProperty(object, key, context);
    if (!property.present) {
      return invalid(`${context}.${key} disappeared while it was inspected`);
    }
    properties.set(key, property.value);
  }
  return properties;
}

function validateLexicalPackageName(packageName: string): void {
  if (
    packageName.length === 0 || packageName.trim() !== packageName ||
    packageName.includes("\0") || packageName.includes("\\") ||
    packageName === "." || packageName === ".."
  ) {
    return invalid("the discovered package name is not a valid lexical npm package name");
  }

  if (packageName.startsWith("@")) {
    const parts = packageName.split("/");
    if (
      parts.length !== 2 || parts[0]?.length === 1 || !parts[1] ||
      parts[1] === "." || parts[1] === ".."
    ) {
      return invalid("the discovered scoped package name is malformed");
    }
    return;
  }

  if (packageName.includes("/") || packageName.startsWith("@")) {
    return invalid("the discovered package name is malformed");
  }
}

function validateLocalTarget(
  value: unknown,
  context: string,
  requireDotSlash: boolean,
): string {
  if (typeof value !== "string" || value.length === 0) {
    return invalid(`${context} must be a non-empty string`);
  }
  if (value.trim() !== value || value.includes("\0")) {
    return invalid(`${context} contains invalid characters`);
  }
  if (value.includes("\\")) {
    return invalid(`${context} must use portable forward-slash separators`);
  }
  if (isAbsolute(value) || URL_SCHEME.test(value)) {
    return invalid(`${context} must be a relative local filesystem target`);
  }
  if (value.startsWith("#")) {
    return invalid(`${context} must not be an import-map alias`);
  }
  if (requireDotSlash && !value.startsWith("./")) {
    return invalid(`${context} must start with './'`);
  }
  if (value.includes("*")) {
    return invalid(`${context} must not be a pattern target`);
  }

  const segments = value.split("/");
  if (segments.includes("..")) {
    return invalid(`${context} must not traverse outside the package`);
  }

  const localPath = value.startsWith("./") ? value.slice(2) : value;
  if (localPath.length === 0 || localPath === "." || localPath.endsWith("/")) {
    return invalid(`${context} must identify a file path`);
  }
  return value;
}

function selectConditionalTarget(
  value: unknown,
  context: string,
  seen: WeakSet<object>,
  depth: number,
): string {
  if (typeof value === "string") {
    return validateLocalTarget(value, context, true);
  }
  if (arrayIsArray(value)) {
    return invalid(`${context} must not use an ambiguous export array`);
  }
  if (!isRecord(value)) {
    return invalid(`${context} must be a string or conditional export object`);
  }
  if (depth > MAX_CONDITIONAL_EXPORT_DEPTH) {
    return invalid(`${context} exceeds the supported conditional export depth`);
  }
  if (seen.has(value)) {
    return invalid(`${context} contains a conditional export cycle`);
  }

  seen.add(value);
  try {
    const properties = dataPropertyMap(value, context);
    const keys = [...properties.keys()];
    const subpathKeys = keys.filter((key) => key.startsWith("."));
    if (subpathKeys.length > 0) {
      return invalid(`${context} must not contain a nested subpath export map`);
    }

    for (const condition of PREFERRED_EXPORT_CONDITIONS) {
      if (!properties.has(condition)) continue;
      return selectConditionalTarget(
        properties.get(condition),
        `${context}.${condition}`,
        seen,
        depth + 1,
      );
    }
    return invalid(
      `${context} has no supported deno, import, or default condition`,
    );
  } finally {
    seen.delete(value);
  }
}

function selectExportsTarget(value: unknown): string {
  if (typeof value === "string") {
    return validateLocalTarget(value, "package.json.exports", true);
  }
  if (arrayIsArray(value)) {
    return invalid("package.json.exports must not use an ambiguous export array");
  }
  if (!isRecord(value)) {
    return invalid("package.json.exports must define a supported root export");
  }

  const properties = dataPropertyMap(value, "package.json.exports");
  const keys = [...properties.keys()];
  const subpathKeys = keys.filter((key) => key.startsWith("."));
  const conditionKeys = keys.filter((key) => !key.startsWith("."));

  if (subpathKeys.length > 0 && conditionKeys.length > 0) {
    return invalid("package.json.exports mixes root conditions with subpath exports");
  }
  if (subpathKeys.length > 0) {
    if (!properties.has(".")) {
      return invalid("package.json.exports has no explicit root export");
    }
    return selectConditionalTarget(
      properties.get("."),
      "package.json.exports['.']",
      new WeakSet(),
      0,
    );
  }

  return selectConditionalTarget(
    value,
    "package.json.exports",
    new WeakSet(),
    0,
  );
}

/**
 * Select the deterministic local import entrypoint from a parsed package.json.
 *
 * The manifest name must exactly match the package name discovered from the
 * lexical node_modules location. `exports` takes precedence over `module`,
 * then `main`; packages with none of those fields use `./index.js`.
 */
export function selectPackageImportEntrypoint(
  discoveredPackageName: string,
  packageManifest: unknown,
): string {
  validateLexicalPackageName(discoveredPackageName);
  if (!isRecord(packageManifest)) {
    return invalid("package.json must be an object");
  }

  const manifestName = readDataProperty(packageManifest, "name", "package.json");
  if (!manifestName.present || typeof manifestName.value !== "string") {
    return invalid("package.json.name must be an own string data property");
  }
  if (manifestName.value !== discoveredPackageName) {
    return invalid(
      `package.json.name does not match discovered package '${discoveredPackageName}'`,
    );
  }

  const exportsProperty = readDataProperty(packageManifest, "exports", "package.json");
  if (exportsProperty.present) {
    return selectExportsTarget(exportsProperty.value);
  }

  for (const field of ["module", "main"] as const) {
    const property = readDataProperty(packageManifest, field, "package.json");
    if (!property.present) continue;
    return validateLocalTarget(property.value, `package.json.${field}`, false);
  }

  return DEFAULT_PACKAGE_ENTRYPOINT;
}

function isContained(baseDirectory: string, target: string): boolean {
  const relativeTarget = relative(baseDirectory, target);
  return relativeTarget === "." ||
    (!isAbsolute(relativeTarget) && relativeTarget !== ".." &&
      !relativeTarget.startsWith("../"));
}

function canonicalAbsolute(path: string, context: string): string {
  const canonical = normalize(path);
  if (!isAbsolute(canonical)) {
    return invalid(`${context} did not resolve to an absolute path`);
  }
  return canonical;
}

/**
 * Bind a selected project or package entrypoint to its physical identity.
 *
 * Contained symlinks are accepted, but the returned value is their canonical
 * target. Direct or intermediate symlinks that escape the owning directory are
 * rejected. Returning the canonical absolute path makes later changes to the
 * discovered symlink or import-map aliases irrelevant to this captured value.
 *
 * The optional operations argument is an internal test seam; production callers
 * use the runtime-neutral compat filesystem functions.
 */
export async function canonicalizeExtensionEntrypoint(
  owningDirectory: string,
  selectedEntrypoint: string,
  operations: EntrypointFileOperations = nativeFileOperations,
): Promise<string> {
  if (owningDirectory.length === 0 || owningDirectory.includes("\0")) {
    return invalid("the owning directory is empty or invalid");
  }
  if (selectedEntrypoint.length === 0 || selectedEntrypoint.includes("\0")) {
    return invalid("the selected entrypoint is empty or invalid");
  }

  const lexicalOwner = normalize(resolve(owningDirectory));
  const targetIsAbsolute = isAbsolute(selectedEntrypoint);
  if (!targetIsAbsolute && URL_SCHEME.test(selectedEntrypoint)) {
    return invalid("the selected entrypoint must not be a URL");
  }
  const lexicalTarget = normalize(
    targetIsAbsolute ? selectedEntrypoint : resolve(lexicalOwner, selectedEntrypoint),
  );

  if (!isContained(lexicalOwner, lexicalTarget)) {
    return invalid("the selected entrypoint is lexically outside its owning directory");
  }

  const canonicalOwner = canonicalAbsolute(
    await operations.realPath(lexicalOwner),
    "the owning directory",
  );
  const ownerInfo = await operations.stat(canonicalOwner);
  if (!ownerInfo.isDirectory || ownerInfo.isFile) {
    return invalid("the owning path is not a directory");
  }

  const canonicalTarget = canonicalAbsolute(
    await operations.realPath(lexicalTarget),
    "the selected entrypoint",
  );
  if (!isContained(canonicalOwner, canonicalTarget)) {
    return invalid("the selected entrypoint is physically outside its owning directory");
  }

  const targetInfo = await operations.stat(canonicalTarget);
  if (!targetInfo.isFile || targetInfo.isDirectory) {
    return invalid("the selected entrypoint is not a regular file");
  }
  return canonicalTarget;
}
