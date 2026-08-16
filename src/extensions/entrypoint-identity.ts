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

import { realPath } from "#veryfront/compat/fs.ts";
import { dirname, isAbsolute, normalize, relative, resolve } from "#veryfront/compat/path";
import { getDenoRuntime, isBun, isNode } from "#veryfront/platform/compat/runtime.ts";
import { quoteDiagnosticString } from "./diagnostic-string.ts";

const DEFAULT_PACKAGE_ENTRYPOINT = "./index.js";
const PREFERRED_EXPORT_CONDITIONS = ["deno", "import", "default"] as const;
const MAX_CONDITIONAL_EXPORT_DEPTH = 16;
const URL_SCHEME = /^[A-Za-z][A-Za-z0-9+.-]*:/;

const arrayIsArray = Array.isArray;
const getOwnPropertyDescriptor = Object.getOwnPropertyDescriptor;
const numberIsSafeInteger = Number.isSafeInteger;
const objectFreeze = Object.freeze;
const reflectOwnKeys = Reflect.ownKeys;

interface DataProperty {
  present: boolean;
  value?: unknown;
}

export interface EntrypointFileInfo {
  isFile: boolean;
  isDirectory: boolean;
  dev: number | bigint | null;
  ino: number | bigint | null;
}

export interface EntrypointFileOperations {
  realPath(path: string): Promise<string>;
  stat(path: string): Promise<EntrypointFileInfo>;
}

interface NodeBigIntFileInfo {
  isFile(): boolean;
  isDirectory(): boolean;
  readonly dev: bigint;
  readonly ino: bigint;
}

async function statWithIdentity(path: string): Promise<EntrypointFileInfo> {
  const deno = getDenoRuntime();
  if (deno) {
    const info = await deno.stat(path);
    return {
      isFile: info.isFile,
      isDirectory: info.isDirectory,
      dev: info.dev,
      ino: info.ino,
    };
  }

  if (isNode || isBun) {
    const fs = await import("node:fs/promises");
    const info: NodeBigIntFileInfo = await fs.stat(path, { bigint: true });
    return {
      isFile: info.isFile(),
      isDirectory: info.isDirectory(),
      dev: info.dev,
      ino: info.ino,
    };
  }

  return invalid(
    "the current runtime exposes no stable filesystem identity",
    "identity-unavailable",
  );
}

const nativeFileOperations: EntrypointFileOperations = {
  realPath,
  stat: statWithIdentity,
};

export interface ExtensionFileIdentity {
  readonly dev: number | bigint;
  readonly ino: number | bigint;
}

/** Canonical directory identity captured before any activation manifest read. */
export interface CapturedExtensionOwner {
  readonly lexicalPath: string;
  readonly canonicalPath: string;
  readonly identity: ExtensionFileIdentity;
  readonly parent?: CapturedExtensionOwner;
}

/** Internal security descriptor carried from discovery to dynamic import. */
export interface BoundExtensionEntrypoint {
  readonly path: string;
  readonly owner: CapturedExtensionOwner;
  readonly targetIdentity: ExtensionFileIdentity;
}

export interface CaptureExtensionOwnerOptions {
  readonly parent?: CapturedExtensionOwner;
  /** @internal Deterministic filesystem seam for race tests. */
  readonly operations?: EntrypointFileOperations;
}

export type ExtensionEntrypointIdentityFailure =
  | "unsafe-entrypoint"
  | "identity-unavailable";

export class ExtensionEntrypointIdentityError extends Error {
  readonly reason: ExtensionEntrypointIdentityFailure;

  constructor(message: string, reason: ExtensionEntrypointIdentityFailure) {
    super(`Invalid extension entrypoint: ${message}`);
    this.name = "ExtensionEntrypointIdentityError";
    this.reason = reason;
  }
}

function invalid(
  message: string,
  reason: ExtensionEntrypointIdentityFailure = "unsafe-entrypoint",
): never {
  throw new ExtensionEntrypointIdentityError(message, reason);
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
      `package.json.name does not match discovered package ${
        quoteDiagnosticString(discoveredPackageName)
      }`,
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

function stableIdentity(
  info: EntrypointFileInfo,
  context: string,
): ExtensionFileIdentity {
  const validPart = (value: number | bigint | null): value is number | bigint =>
    (typeof value === "bigint" && value >= 0n) ||
    (typeof value === "number" && value >= 0 && numberIsSafeInteger(value));
  if (!validPart(info.dev) || !validPart(info.ino)) {
    return invalid(`${context} has no stable filesystem identity`, "identity-unavailable");
  }
  return objectFreeze({ dev: info.dev, ino: info.ino });
}

function sameIdentity(
  expected: ExtensionFileIdentity,
  actual: ExtensionFileIdentity,
): boolean {
  return expected.dev === actual.dev && expected.ino === actual.ino;
}

async function revalidateCapturedOwner(
  owner: CapturedExtensionOwner,
  operations: EntrypointFileOperations,
): Promise<void> {
  if (owner.parent?.parent) {
    return invalid("the owning directory has an invalid captured parent chain");
  }
  if (owner.parent) {
    await revalidateCapturedOwner(owner.parent, operations);
    if (dirname(owner.canonicalPath) !== owner.parent.canonicalPath) {
      return invalid("the owning directory is no longer a direct child of its captured parent");
    }
  }

  const currentCanonical = canonicalAbsolute(
    await operations.realPath(owner.lexicalPath),
    "the current owning directory",
  );
  if (currentCanonical !== owner.canonicalPath) {
    return invalid("the owning directory mapping changed after discovery");
  }

  const currentInfo = await operations.stat(owner.canonicalPath);
  if (!currentInfo.isDirectory || currentInfo.isFile) {
    return invalid("the owning path is no longer a directory");
  }
  if (!sameIdentity(owner.identity, stableIdentity(currentInfo, "the owning directory"))) {
    return invalid("the owning directory identity changed after discovery");
  }
}

/**
 * Capture one canonical directory before reading any manifest beneath it.
 *
 * A project extension can name a captured parent, which requires the physical
 * owner to remain a direct child of the canonical `extensions/` directory.
 * Package owners omit the parent because pnpm legitimately places their
 * physical directories outside the lexical `node_modules/` tree.
 *
 * Runtimes that do not expose stable device and inode values cannot satisfy
 * this security boundary. Capture fails deterministically instead of silently
 * degrading to path-only checks.
 */
export async function captureExtensionOwner(
  owningDirectory: string,
  options: CaptureExtensionOwnerOptions = {},
): Promise<CapturedExtensionOwner> {
  if (owningDirectory.length === 0 || owningDirectory.includes("\0")) {
    return invalid("the owning directory is empty or invalid");
  }
  const operations = options.operations ?? nativeFileOperations;
  const lexicalPath = normalize(resolve(owningDirectory));
  const canonicalPath = canonicalAbsolute(
    await operations.realPath(lexicalPath),
    "the owning directory",
  );
  const info = await operations.stat(canonicalPath);
  if (!info.isDirectory || info.isFile) {
    return invalid("the owning path is not a directory");
  }
  if (options.parent && dirname(canonicalPath) !== options.parent.canonicalPath) {
    return invalid("the owning directory must be a direct child of its captured parent");
  }
  if (options.parent?.parent) {
    return invalid("the owning directory parent must be a captured root");
  }

  const owner = objectFreeze({
    lexicalPath,
    canonicalPath,
    identity: stableIdentity(info, "the owning directory"),
    ...(options.parent ? { parent: options.parent } : {}),
  });
  await revalidateCapturedOwner(owner, operations);
  return owner;
}

/** Bind a selected relative entrypoint to a captured owner and file identity. */
export async function bindExtensionEntrypoint(
  owner: CapturedExtensionOwner,
  selectedEntrypoint: string,
  operations: EntrypointFileOperations = nativeFileOperations,
): Promise<BoundExtensionEntrypoint> {
  if (selectedEntrypoint.length === 0 || selectedEntrypoint.includes("\0")) {
    return invalid("the selected entrypoint is empty or invalid");
  }

  const targetIsAbsolute = isAbsolute(selectedEntrypoint);
  if (!targetIsAbsolute && URL_SCHEME.test(selectedEntrypoint)) {
    return invalid("the selected entrypoint must not be a URL");
  }
  const lexicalTarget = normalize(
    targetIsAbsolute ? selectedEntrypoint : resolve(owner.lexicalPath, selectedEntrypoint),
  );
  if (!isContained(owner.lexicalPath, lexicalTarget)) {
    return invalid("the selected entrypoint is lexically outside its owning directory");
  }

  const relativeTarget = relative(owner.lexicalPath, lexicalTarget);
  const physicalCandidate = normalize(resolve(owner.canonicalPath, relativeTarget));
  const canonicalTarget = canonicalAbsolute(
    await operations.realPath(physicalCandidate),
    "the selected entrypoint",
  );
  if (!isContained(owner.canonicalPath, canonicalTarget)) {
    return invalid("the selected entrypoint is physically outside its owning directory");
  }

  const targetInfo = await operations.stat(canonicalTarget);
  if (!targetInfo.isFile || targetInfo.isDirectory) {
    return invalid("the selected entrypoint is not a regular file");
  }
  const targetIdentity = stableIdentity(targetInfo, "the selected entrypoint");

  // Manifest parsing and target selection happen before this point. Recheck
  // the lexical owner mapping and both identities after selection so a pnpm
  // symlink retarget or project-directory replacement fails closed.
  await revalidateCapturedOwner(owner, operations);
  const finalTarget = canonicalAbsolute(
    await operations.realPath(physicalCandidate),
    "the current selected entrypoint",
  );
  if (finalTarget !== canonicalTarget) {
    return invalid("the selected entrypoint mapping changed during discovery");
  }
  const finalTargetInfo = await operations.stat(canonicalTarget);
  if (!finalTargetInfo.isFile || finalTargetInfo.isDirectory) {
    return invalid("the selected entrypoint is no longer a regular file");
  }
  if (
    !sameIdentity(
      targetIdentity,
      stableIdentity(finalTargetInfo, "the selected entrypoint"),
    )
  ) {
    return invalid("the selected entrypoint identity changed during discovery");
  }

  return objectFreeze({ path: canonicalTarget, owner, targetIdentity });
}

/**
 * Revalidate a discovery binding immediately before native ESM import.
 *
 * Native path-based ESM cannot make the final stat and module open atomic.
 * This closes deterministic swaps before import; the remaining stat-to-open
 * scheduling window is an explicit runtime limitation.
 */
export async function revalidateBoundExtensionEntrypoint(
  binding: BoundExtensionEntrypoint,
  operations: EntrypointFileOperations = nativeFileOperations,
): Promise<void> {
  await revalidateCapturedOwner(binding.owner, operations);
  if (!isContained(binding.owner.canonicalPath, binding.path)) {
    return invalid("the bound target is outside its captured owner");
  }
  const currentTarget = canonicalAbsolute(
    await operations.realPath(binding.path),
    "the current bound target",
  );
  if (currentTarget !== binding.path) {
    return invalid("the bound target mapping changed after discovery");
  }
  const targetInfo = await operations.stat(binding.path);
  if (!targetInfo.isFile || targetInfo.isDirectory) {
    return invalid("the bound target is no longer a regular file");
  }
  if (
    !sameIdentity(
      binding.targetIdentity,
      stableIdentity(targetInfo, "the bound target"),
    )
  ) {
    return invalid("the bound target identity changed after discovery");
  }
  await revalidateCapturedOwner(binding.owner, operations);
}

/**
 * Bind a selected project or package entrypoint to its physical identity.
 *
 * Contained symlinks are accepted, but the returned value is their canonical
 * target. Direct or intermediate symlinks that escape the owning directory are
 * rejected. This compatibility wrapper does not retain the identity binding;
 * production discovery carries `BoundExtensionEntrypoint` through to import.
 *
 * The optional operations argument is an internal test seam; production callers
 * use the runtime-neutral compat filesystem functions.
 */
export async function canonicalizeExtensionEntrypoint(
  owningDirectory: string,
  selectedEntrypoint: string,
  operations: EntrypointFileOperations = nativeFileOperations,
): Promise<string> {
  const owner = await captureExtensionOwner(owningDirectory, { operations });
  return (await bindExtensionEntrypoint(owner, selectedEntrypoint, operations)).path;
}
