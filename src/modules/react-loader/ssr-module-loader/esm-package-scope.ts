import { join } from "#veryfront/compat/path/index.ts";
import { ESM_CACHE_INIT_FAILED, VeryfrontError } from "#veryfront/errors";
import {
  type FileSystem,
  isAlreadyExistsError,
  isNotFoundError,
} from "#veryfront/platform/compat/fs.ts";
import { isFileSnapshotChangedError } from "#veryfront/platform/adapters/file-snapshot-error.ts";

// Capture every ambient intrinsic used while revalidating the shared cache.
// Trusted project modules execute in this realm and must not be able to poison
// a later tenant's package-scope verification.
const IntrinsicTextDecoder = TextDecoder;
const IntrinsicJSON = JSON;
const IntrinsicObject = Object;
const ArrayIsArray = Array.isArray;
const JSONParse = JSON.parse;
const ObjectHasOwn = Object.hasOwn;
const ObjectKeys = Object.keys;
const ReflectApply = Reflect.apply;
const TextDecoderPrototypeDecode = TextDecoder.prototype.decode;

const PACKAGE_SCOPE_CONTENT = `${JSON.stringify({ private: true, type: "module" }, null, 2)}\n`;
const PACKAGE_SCOPE_BYTES = new TextEncoder().encode(PACKAGE_SCOPE_CONTENT);
const MAX_PACKAGE_SCOPE_BYTES = 1_024;
const CONCURRENT_CREATE_ATTEMPTS = 20;
const CONCURRENT_CREATE_RETRY_MS = 25;

function packageScopeError(cause?: unknown): Error {
  return ESM_CACHE_INIT_FAILED.create({
    detail: "Veryfront cannot initialize its generated ESM cache",
    cause,
  });
}

function isPackageScopeError(error: unknown): boolean {
  return error instanceof VeryfrontError && error.slug === ESM_CACHE_INIT_FAILED.slug;
}

function isPackageScopePrefix(bytes: Uint8Array): boolean {
  if (bytes.byteLength >= PACKAGE_SCOPE_BYTES.byteLength) return false;
  for (let index = 0; index < bytes.byteLength; index++) {
    if (bytes[index] !== PACKAGE_SCOPE_BYTES[index]) return false;
  }
  return true;
}

function isModulePackageScope(value: unknown): boolean {
  if (typeof value !== "object" || value === null || ArrayIsArray(value)) {
    return false;
  }

  const record = value as Record<string, unknown>;
  return ReflectApply(ObjectKeys, IntrinsicObject, [record]).length === 2 &&
    ReflectApply(ObjectHasOwn, IntrinsicObject, [record, "private"]) &&
    ReflectApply(ObjectHasOwn, IntrinsicObject, [record, "type"]) &&
    record.private === true && record.type === "module";
}

async function ensurePlainCacheDirectoryInner(
  fs: FileSystem,
  path: string,
): Promise<void> {
  const lstat = fs.lstat;
  if (!lstat) throw packageScopeError();

  let stat: Awaited<ReturnType<typeof lstat>>;
  try {
    stat = await (ReflectApply(lstat, fs, [path]) as ReturnType<typeof lstat>);
  } catch (error) {
    if (!isNotFoundError(error)) throw error;
    try {
      await fs.mkdir(path);
    } catch (mkdirError) {
      if (!isAlreadyExistsError(mkdirError)) throw mkdirError;
    }
    stat = await (ReflectApply(lstat, fs, [path]) as ReturnType<typeof lstat>);
  }

  if (!stat.isDirectory || stat.isSymlink) throw packageScopeError();
}

export async function ensurePlainCacheDirectory(
  fs: FileSystem,
  path: string,
): Promise<void> {
  try {
    await ensurePlainCacheDirectoryInner(fs, path);
  } catch (error) {
    if (isPackageScopeError(error)) throw error;
    throw packageScopeError(error);
  }
}

async function packageScopeStatus(
  fs: FileSystem,
  manifestPath: string,
  tmpDir: string,
): Promise<"valid" | "retry" | "conflict"> {
  const lstat = fs.lstat;
  if (!lstat) throw packageScopeError();
  const stat = await (ReflectApply(lstat, fs, [manifestPath]) as ReturnType<typeof lstat>);
  if (!stat.isFile || stat.isSymlink || stat.size > MAX_PACKAGE_SCOPE_BYTES) {
    throw packageScopeError();
  }

  const readSnapshot = fs.readFileSnapshotWithinLimit;
  let bytes: Uint8Array | undefined;
  let stableSnapshot = false;
  if (readSnapshot) {
    try {
      bytes = await (ReflectApply(readSnapshot, fs, [
        manifestPath,
        tmpDir,
        MAX_PACKAGE_SCOPE_BYTES,
      ]) as ReturnType<typeof readSnapshot>);
      stableSnapshot = true;
    } catch (error) {
      if (!(error instanceof DOMException) || error.name !== "NotSupportedError") throw error;
    }
  } else if (fs.readFileBytesWithinLimit) {
    bytes = await fs.readFileBytesWithinLimit(
      manifestPath,
      MAX_PACKAGE_SCOPE_BYTES,
    );
  }
  if (!bytes && fs.readFileBytesWithinLimit) {
    bytes = await fs.readFileBytesWithinLimit(manifestPath, MAX_PACKAGE_SCOPE_BYTES);
  }
  if (!bytes) throw packageScopeError();
  if (bytes.byteLength > MAX_PACKAGE_SCOPE_BYTES) throw packageScopeError();

  try {
    const decoded = ReflectApply(TextDecoderPrototypeDecode, new IntrinsicTextDecoder(), [bytes]);
    if (isModulePackageScope(ReflectApply(JSONParse, IntrinsicJSON, [decoded]))) return "valid";
  } catch {
    // An exclusive creator can expose an empty or partial file until its small
    // write finishes. Only a prefix of the one payload Veryfront writes is
    // retryable; a complete different manifest is a stable conflict.
  }
  return isPackageScopePrefix(bytes) ||
      (!stableSnapshot && stat.size < PACKAGE_SCOPE_BYTES.byteLength)
    ? "retry"
    : "conflict";
}

async function ensurePackageScopeManifestInner(
  fs: FileSystem,
  manifestPath: string,
  tmpDir: string,
): Promise<void> {
  const createExclusive = fs.createFileBytesExclusive;
  if (!createExclusive) throw packageScopeError();

  try {
    await (ReflectApply(createExclusive, fs, [
      manifestPath,
      PACKAGE_SCOPE_BYTES,
    ]) as ReturnType<typeof createExclusive>);
    return;
  } catch (error) {
    if (!isAlreadyExistsError(error)) throw error;
  }

  for (let attempt = 0; attempt < CONCURRENT_CREATE_ATTEMPTS; attempt++) {
    try {
      const status = await packageScopeStatus(fs, manifestPath, tmpDir);
      if (status === "valid") return;
      if (status === "conflict") throw packageScopeError();
    } catch (error) {
      if (!isFileSnapshotChangedError(error)) throw error;
    }
    await new Promise<void>((resolve) => setTimeout(resolve, CONCURRENT_CREATE_RETRY_MS));
  }

  throw packageScopeError();
}

async function ensurePackageScopeManifest(
  fs: FileSystem,
  manifestPath: string,
  tmpDir: string,
): Promise<void> {
  try {
    await ensurePackageScopeManifestInner(fs, manifestPath, tmpDir);
  } catch (error) {
    if (isPackageScopeError(error)) throw error;
    throw packageScopeError(error);
  }
}

/**
 * Declare the mirrored npm ESM tree as a package scope before Node imports it.
 *
 * The packed runtime mirrors `veryfront/esm/*.js` into the per-project cache.
 * Node 22.3 does not infer ESM syntax for those generated JavaScript files, so
 * the mirror needs the same `type: module` boundary as the published package.
 * Project transforms use `.mjs`, leaving the cache root available for project
 * paths such as a relative `package.json` import.
 */
export async function ensureCachedVeryfrontEsmPackageScope(
  fs: FileSystem,
  tmpDir: string,
): Promise<void> {
  const nodeModulesDir = join(tmpDir, "node_modules");
  const veryfrontDir = join(nodeModulesDir, "veryfront");
  const scopeDir = join(veryfrontDir, "esm");
  const frameworkManifestPath = join(scopeDir, "package.json");

  // The configured cache is a same-trust boundary: it must not be writable by
  // hostile concurrent actors. Create and inspect one component at a time so
  // a pre-existing symlink cannot redirect generated code outside that cache.
  for (const directory of [tmpDir, nodeModulesDir, veryfrontDir, scopeDir]) {
    await ensurePlainCacheDirectory(fs, directory);
  }

  await ensurePackageScopeManifest(fs, frameworkManifestPath, tmpDir);
}
