import { dirname, isAbsolute, join, relative, SEPARATOR } from "#std/path";

export const MAX_EXTENSION_MANIFEST_BYTES = 256 * 1024;
export const MAX_EXTENSION_DIRECTORY_ENTRIES = 1024;
export const MAX_EXTENSION_MANIFEST_WORKSPACE_BYTES = 16 * 1024 * 1024;
export const MAX_EXTENSION_MANIFEST_WORKSPACE_FILES = 1024;
const MAX_EXTENSION_IMPORT_MAPPINGS = 1024;
const MAX_EXTENSION_IMPORT_SPECIFIER_CHARACTERS = 2048;
const FORBIDDEN_LOCAL_MODULE_PATH_SYNTAX = /[%\\?#]/u;
const FORBIDDEN_IMPORT_MAP_KEY_SYNTAX = /[%\\]/u;

function compareDeterministically(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function containsControlCharacter(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code <= 0x1f || code === 0x7f) return true;
  }
  return false;
}

/**
 * Local module paths are interpreted as URLs by Deno. Keep the static audit's
 * filesystem resolution equivalent by rejecting URL-sensitive syntax.
 */
export function hasForbiddenLocalModulePathSyntax(value: string): boolean {
  return FORBIDDEN_LOCAL_MODULE_PATH_SYNTAX.test(value) ||
    containsControlCharacter(value);
}

/** Canonical repository identity; filesystem paths remain host-native. */
export function canonicalExtensionManifestPath(value: string): string {
  return value.replaceAll("\\", "/");
}

export type ExtensionManifestReadErrorCode =
  | "invalid-manifest-path"
  | "manifest-invalid-json"
  | "manifest-invalid-entry"
  | "manifest-invalid-import-map"
  | "manifest-invalid-type"
  | "manifest-invalid-utf8"
  | "manifest-not-found"
  | "manifest-not-regular"
  | "manifest-read-failed"
  | "manifest-symlink"
  | "manifest-too-large"
  | "manifest-workspace-limit";

export interface ExtensionManifestWorkspaceBudget {
  manifestFiles: number;
  manifestBytes: number;
}

export function createExtensionManifestWorkspaceBudget(): ExtensionManifestWorkspaceBudget {
  return { manifestFiles: 0, manifestBytes: 0 };
}

export class ExtensionManifestReadError extends Error {
  readonly code: ExtensionManifestReadErrorCode;
  readonly manifestPath: string;

  constructor(
    code: ExtensionManifestReadErrorCode,
    manifestPath: string,
    detail: string,
  ) {
    super(`[${code}] ${manifestPath}: ${detail}`);
    this.name = "ExtensionManifestReadError";
    this.code = code;
    this.manifestPath = manifestPath;
  }
}

export interface ExtensionManifestDiscoveryIssue {
  manifestPath: string;
  detail: string;
}

export interface ExtensionManifestDiscoveryResult {
  manifestPaths: string[];
  issues: ExtensionManifestDiscoveryIssue[];
}

/** Discover every ext-* manifest without following directory symlinks. */
export async function discoverExtensionManifestPaths(
  workspaceRoot: string,
): Promise<ExtensionManifestDiscoveryResult> {
  const manifestPaths: string[] = [];
  const issues: ExtensionManifestDiscoveryIssue[] = [];
  let canonicalRoot: string;
  try {
    canonicalRoot = await Deno.realPath(workspaceRoot);
  } catch {
    return {
      manifestPaths,
      issues: [{
        manifestPath: "extensions",
        detail:
          "[extension-discovery-failed] workspace root could not be resolved",
      }],
    };
  }

  const extensionsPath = join(canonicalRoot, "extensions");
  let directoryInfo: Deno.FileInfo;
  try {
    directoryInfo = await Deno.lstat(extensionsPath);
  } catch {
    return {
      manifestPaths,
      issues: [{
        manifestPath: "extensions",
        detail:
          "[extension-discovery-failed] extensions directory could not be inspected",
      }],
    };
  }
  if (directoryInfo.isSymlink || !directoryInfo.isDirectory) {
    return {
      manifestPaths,
      issues: [{
        manifestPath: "extensions",
        detail: directoryInfo.isSymlink
          ? "[extension-directory-symlink] extensions directory must not be a symlink"
          : "[extension-directory-not-directory] extensions path must be a directory",
      }],
    };
  }

  let entryCount = 0;
  try {
    for await (const entry of Deno.readDir(extensionsPath)) {
      entryCount += 1;
      if (entryCount > MAX_EXTENSION_DIRECTORY_ENTRIES) {
        issues.push({
          manifestPath: "extensions",
          detail:
            `[extension-entry-limit] extensions directory exceeds ${MAX_EXTENSION_DIRECTORY_ENTRIES} entries`,
        });
        break;
      }
      if (!entry.name.startsWith("ext-")) continue;
      const manifestPath = `extensions/${entry.name}/deno.json`;
      if (entry.isSymlink) {
        issues.push({
          manifestPath,
          detail:
            "[extension-entry-symlink] extension entry must not be a symlink",
        });
      } else if (!entry.isDirectory) {
        issues.push({
          manifestPath,
          detail:
            "[extension-entry-not-directory] extension entry must be a directory",
        });
      } else {
        manifestPaths.push(manifestPath);
      }
    }
  } catch {
    issues.push({
      manifestPath: "extensions",
      detail:
        "[extension-discovery-failed] extensions directory could not be read",
    });
  }

  return {
    manifestPaths: manifestPaths.sort(compareDeterministically),
    issues: issues.sort((left, right) =>
      compareDeterministically(
        `${left.manifestPath}\u0000${left.detail}`,
        `${right.manifestPath}\u0000${right.detail}`,
      )
    ),
  };
}

/** Resolve the package root export using the two Deno workspace forms we support. */
export function resolveExtensionManifestEntry(
  manifestPath: string,
  manifest: Readonly<Record<string, unknown>>,
): string {
  const exportsValue = manifest.exports;
  const entry = typeof exportsValue === "string"
    ? exportsValue
    : exportsValue !== null && typeof exportsValue === "object" &&
        !Array.isArray(exportsValue) &&
        Object.hasOwn(exportsValue, ".")
    ? (exportsValue as Record<string, unknown>)["."]
    : undefined;
  if (
    typeof entry !== "string" || entry.length === 0 || entry.length > 2048 ||
    !entry.startsWith("./") || hasForbiddenLocalModulePathSyntax(entry)
  ) {
    throw new ExtensionManifestReadError(
      "manifest-invalid-entry",
      manifestPath,
      'exports must have a URL-safe local string at the package root "."',
    );
  }
  const manifestDirectory = dirname(manifestPath);
  const resolved = join(manifestDirectory, entry);
  if (
    isAbsolute(resolved) || resolved === ".." ||
    resolved.startsWith(`..${SEPARATOR}`) ||
    relative(manifestDirectory, resolved).startsWith(`..${SEPARATOR}`)
  ) {
    throw new ExtensionManifestReadError(
      "manifest-invalid-entry",
      manifestPath,
      "root export escapes the extension directory",
    );
  }
  return resolved;
}

/** Scoped import-map overrides are intentionally outside the audit grammar. */
export function assertSupportedExtensionImportMap(
  manifestPath: string,
  manifest: Readonly<Record<string, unknown>>,
): void {
  if (manifest.importMap !== undefined) {
    throw new ExtensionManifestReadError(
      "manifest-invalid-import-map",
      manifestPath,
      "external importMap files are not supported by the static audit",
    );
  }
  const scopes = manifest.scopes;
  if (
    !(
      scopes === undefined ||
      (scopes !== null && typeof scopes === "object" &&
        !Array.isArray(scopes) &&
        Object.keys(scopes).length === 0)
    )
  ) {
    throw new ExtensionManifestReadError(
      "manifest-invalid-import-map",
      manifestPath,
      "non-empty or malformed scopes are not supported by the static audit",
    );
  }
  const imports = manifest.imports;
  if (imports === undefined) return;
  if (
    imports === null || typeof imports !== "object" || Array.isArray(imports)
  ) {
    throw new ExtensionManifestReadError(
      "manifest-invalid-import-map",
      manifestPath,
      "imports must be an object",
    );
  }
  const mappings = Object.entries(imports);
  if (mappings.length > MAX_EXTENSION_IMPORT_MAPPINGS) {
    throw new ExtensionManifestReadError(
      "manifest-invalid-import-map",
      manifestPath,
      `imports exceeds ${MAX_EXTENSION_IMPORT_MAPPINGS} mappings`,
    );
  }
  for (const [key, value] of mappings) {
    if (
      key.length === 0 ||
      key.length > MAX_EXTENSION_IMPORT_SPECIFIER_CHARACTERS ||
      key.startsWith("./") || key.startsWith("../") || key.startsWith("/") ||
      /^[A-Za-z][A-Za-z0-9+.-]*:/.test(key) ||
      FORBIDDEN_IMPORT_MAP_KEY_SYNTAX.test(key) ||
      containsControlCharacter(key)
    ) {
      throw new ExtensionManifestReadError(
        "manifest-invalid-import-map",
        manifestPath,
        `unsupported import-map key: ${key || "<empty>"}`,
      );
    }
    if (
      typeof value !== "string" || value.length === 0 ||
      value.length > MAX_EXTENSION_IMPORT_SPECIFIER_CHARACTERS ||
      (key.endsWith("/") && !value.endsWith("/")) ||
      ((value.startsWith("./") || value.startsWith("../")) &&
        hasForbiddenLocalModulePathSyntax(value))
    ) {
      throw new ExtensionManifestReadError(
        "manifest-invalid-import-map",
        manifestPath,
        `invalid import-map target for ${key}`,
      );
    }
  }
}

function isContainedPath(root: string, candidate: string): boolean {
  const pathFromRoot = relative(root, candidate);
  return pathFromRoot === "" ||
    (!isAbsolute(pathFromRoot) && pathFromRoot !== ".." &&
      !pathFromRoot.startsWith(`..${SEPARATOR}`));
}

/** Read one extension manifest without following symlinks or unbounded input. */
export async function readExtensionManifest(
  workspaceRoot: string,
  manifestPath: string,
  workspaceBudget?: ExtensionManifestWorkspaceBudget,
): Promise<Record<string, unknown>> {
  if (isAbsolute(manifestPath) || manifestPath.length === 0) {
    throw new ExtensionManifestReadError(
      "invalid-manifest-path",
      manifestPath || "<empty>",
      "path must be workspace-relative",
    );
  }
  if (
    workspaceBudget &&
    (!Number.isSafeInteger(workspaceBudget.manifestFiles) ||
      workspaceBudget.manifestFiles < 0 ||
      !Number.isSafeInteger(workspaceBudget.manifestBytes) ||
      workspaceBudget.manifestBytes < 0)
  ) {
    throw new ExtensionManifestReadError(
      "manifest-workspace-limit",
      manifestPath,
      "workspace manifest budget has invalid counters",
    );
  }
  let canonicalRoot: string;
  try {
    canonicalRoot = await Deno.realPath(workspaceRoot);
  } catch {
    throw new ExtensionManifestReadError(
      "manifest-read-failed",
      manifestPath,
      "workspace root could not be resolved",
    );
  }
  const candidate = join(canonicalRoot, manifestPath);
  if (!isContainedPath(canonicalRoot, candidate)) {
    throw new ExtensionManifestReadError(
      "invalid-manifest-path",
      manifestPath,
      "path escapes the workspace",
    );
  }

  let info: Deno.FileInfo;
  try {
    info = await Deno.lstat(candidate);
  } catch (error) {
    throw new ExtensionManifestReadError(
      error instanceof Deno.errors.NotFound
        ? "manifest-not-found"
        : "manifest-read-failed",
      manifestPath,
      error instanceof Deno.errors.NotFound
        ? "file does not exist"
        : "file could not be inspected",
    );
  }
  if (info.isSymlink) {
    throw new ExtensionManifestReadError(
      "manifest-symlink",
      manifestPath,
      "symlinks are not allowed",
    );
  }
  if (!info.isFile || !Number.isSafeInteger(info.size) || info.size < 0) {
    throw new ExtensionManifestReadError(
      "manifest-not-regular",
      manifestPath,
      "path is not a regular bounded file",
    );
  }
  let canonicalCandidate: string;
  try {
    canonicalCandidate = await Deno.realPath(candidate);
  } catch {
    throw new ExtensionManifestReadError(
      "manifest-read-failed",
      manifestPath,
      "file could not be resolved",
    );
  }
  if (!isContainedPath(canonicalRoot, canonicalCandidate)) {
    throw new ExtensionManifestReadError(
      "invalid-manifest-path",
      manifestPath,
      "resolved path escapes the workspace",
    );
  }
  if (info.size > MAX_EXTENSION_MANIFEST_BYTES) {
    throw new ExtensionManifestReadError(
      "manifest-too-large",
      manifestPath,
      `file exceeds ${MAX_EXTENSION_MANIFEST_BYTES} bytes`,
    );
  }
  if (
    workspaceBudget &&
    workspaceBudget.manifestFiles >= MAX_EXTENSION_MANIFEST_WORKSPACE_FILES
  ) {
    throw new ExtensionManifestReadError(
      "manifest-workspace-limit",
      manifestPath,
      `workspace exceeds ${MAX_EXTENSION_MANIFEST_WORKSPACE_FILES} manifests`,
    );
  }
  if (workspaceBudget) workspaceBudget.manifestFiles += 1;

  let bytes: Uint8Array;
  try {
    bytes = await Deno.readFile(canonicalCandidate);
  } catch {
    throw new ExtensionManifestReadError(
      "manifest-read-failed",
      manifestPath,
      "file could not be read",
    );
  }
  if (bytes.length > MAX_EXTENSION_MANIFEST_BYTES) {
    throw new ExtensionManifestReadError(
      "manifest-too-large",
      manifestPath,
      `file exceeds ${MAX_EXTENSION_MANIFEST_BYTES} bytes`,
    );
  }
  if (workspaceBudget) {
    workspaceBudget.manifestBytes += bytes.length;
    if (
      workspaceBudget.manifestBytes > MAX_EXTENSION_MANIFEST_WORKSPACE_BYTES
    ) {
      throw new ExtensionManifestReadError(
        "manifest-workspace-limit",
        manifestPath,
        `workspace exceeds ${MAX_EXTENSION_MANIFEST_WORKSPACE_BYTES} manifest bytes`,
      );
    }
  }

  let source: string;
  try {
    source = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new ExtensionManifestReadError(
      "manifest-invalid-utf8",
      manifestPath,
      "file is not valid UTF-8",
    );
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(source);
  } catch {
    throw new ExtensionManifestReadError(
      "manifest-invalid-json",
      manifestPath,
      "file is not valid JSON",
    );
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new ExtensionManifestReadError(
      "manifest-invalid-type",
      manifestPath,
      "top-level value must be an object",
    );
  }
  return parsed as Record<string, unknown>;
}
