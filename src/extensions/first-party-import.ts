/**
 * Resolve first-party extension implementations without making the root npm
 * package statically depend on every extension dependency.
 *
 * Source and compiled-binary builds can load the workspace extension sources.
 * npm builds should load the separate @veryfront/ext-* packages installed by
 * the consuming service or app.
 */

const SOURCE_EXTENSION_ROOT = "../../extensions";

const FIRST_PARTY_ENTRY_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*(?:\/[A-Za-z0-9][A-Za-z0-9._-]*)*$/;
const FIRST_PARTY_SOURCE_DIRECTORY_PATTERN = /^ext-[a-z0-9]+(?:-[a-z0-9]+)*$/;
const FIRST_PARTY_PACKAGE_PATTERN = /^@veryfront\/ext-[a-z0-9]+(?:-[a-z0-9]+)*$/;
const FIRST_PARTY_PACKAGE_SPECIFIER_PATTERN =
  /^@veryfront\/ext-[a-z0-9]+(?:-[a-z0-9]+)*(?:\/[A-Za-z0-9][A-Za-z0-9._-]*(?:\/[A-Za-z0-9][A-Za-z0-9._-]*)*)?$/;
const SAFE_RELATIVE_PATH_FRAGMENT_PATTERN =
  /^[A-Za-z0-9_-][A-Za-z0-9._-]*(?:\/[A-Za-z0-9_-][A-Za-z0-9._-]*)+$/;

/** Optional non-root entry point for a first-party extension import. */
export interface FirstPartyExtensionImportOptions {
  /**
   * Workspace source entry below the extension's `src/` directory, without
   * an extension. Supply it together with `packageSubpath`; both values must
   * name the same relative entry. When both are omitted, the workspace
   * `index` entry and npm package root are used.
   */
  readonly sourceEntry?: string;
  /**
   * Published npm package subpath, without a leading `./` or `/`.
   * Supply it together with `sourceEntry` using the same value. When both are
   * omitted, the package root is used.
   */
  readonly packageSubpath?: string;
}

type CapturedFirstPartyExtensionImportOptions = Readonly<{
  hasSourceEntry: boolean;
  hasPackageSubpath: boolean;
  sourceEntry: unknown;
  packageSubpath: unknown;
}>;

export function firstPartyExtensionSourceSpecifiers(
  sourceDirectory: string,
  sourceEntry = "index",
): string[] {
  assertValidSourceDirectory(sourceDirectory);
  assertValidEntry("source entry", sourceEntry);
  const sourceRoot = `${SOURCE_EXTENSION_ROOT}/${sourceDirectory}/src/${sourceEntry}`;
  return [`${sourceRoot}.ts`, `${sourceRoot}.js`];
}

export async function importFirstPartyExtensionModule<TModule>(
  sourceDirectory: string,
  packageName: string,
  options: FirstPartyExtensionImportOptions = {},
): Promise<TModule> {
  assertValidSourceDirectory(sourceDirectory);
  assertValidPackageName(packageName);
  if (packageName !== `@veryfront/${sourceDirectory}`) {
    throw new TypeError(
      "First-party extension source directory and package name must identify the same extension",
    );
  }
  const capturedOptions = captureImportOptions(options);
  if (
    capturedOptions.hasSourceEntry !== capturedOptions.hasPackageSubpath ||
    (capturedOptions.hasSourceEntry &&
      capturedOptions.sourceEntry !== capturedOptions.packageSubpath)
  ) {
    throw new TypeError(
      "First-party extension source entry and package subpath must be supplied together and match",
    );
  }
  const sourceEntry = capturedOptions.hasSourceEntry ? capturedOptions.sourceEntry : "index";
  const packageSubpath = capturedOptions.hasPackageSubpath
    ? capturedOptions.packageSubpath
    : undefined;
  assertValidEntry("source entry", sourceEntry);
  if (packageSubpath !== undefined) {
    assertValidEntry("package subpath", packageSubpath);
  }

  const packageSpecifier = packageSubpath === undefined
    ? packageName
    : `${packageName}/${packageSubpath}`;
  let sourceError: unknown;

  for (
    const sourceSpecifier of firstPartyExtensionSourceSpecifiers(
      sourceDirectory,
      sourceEntry,
    )
  ) {
    try {
      return await import(sourceSpecifier) as TModule;
    } catch (error) {
      const expectedSourceSpecifier = new URL(
        sourceSpecifier,
        import.meta.url,
      ).href;
      if (!isMissingFirstPartyExtensionModule(error, [expectedSourceSpecifier])) {
        throw error;
      }
      sourceError ??= error;
    }
  }

  try {
    return await import(packageSpecifier) as TModule;
  } catch (error) {
    const expectedPackageSpecifiers = packageSubpath === undefined
      ? [packageName]
      : [packageSpecifier, packageName];
    if (!isMissingFirstPartyExtensionModule(error, expectedPackageSpecifiers)) {
      throw error;
    }
    throw withMissingExtensionInstallHint(
      error,
      sourceDirectory,
      packageName,
      packageSpecifier,
      sourceError,
    );
  }
}

function captureImportOptions(
  options: unknown,
): CapturedFirstPartyExtensionImportOptions {
  if (typeof options !== "object" || options === null || Array.isArray(options)) {
    return throwInvalidImportOptions();
  }

  let prototype: object | null;
  let keys: PropertyKey[];
  try {
    prototype = Object.getPrototypeOf(options);
    keys = Reflect.ownKeys(options);
  } catch {
    return throwInvalidImportOptions();
  }
  if (prototype !== Object.prototype && prototype !== null) {
    return throwInvalidImportOptions();
  }

  let sourceEntryDescriptor: PropertyDescriptor | undefined;
  let packageSubpathDescriptor: PropertyDescriptor | undefined;
  try {
    for (const key of keys) {
      if (key !== "sourceEntry" && key !== "packageSubpath") {
        return throwInvalidImportOptions();
      }
      const descriptor = Object.getOwnPropertyDescriptor(options, key);
      if (
        descriptor === undefined ||
        descriptor.enumerable !== true ||
        !Object.prototype.hasOwnProperty.call(descriptor, "value")
      ) {
        return throwInvalidImportOptions();
      }
      if (key === "sourceEntry") {
        sourceEntryDescriptor = descriptor;
      } else {
        packageSubpathDescriptor = descriptor;
      }
    }
  } catch {
    return throwInvalidImportOptions();
  }

  return Object.freeze({
    hasSourceEntry: sourceEntryDescriptor?.value !== undefined,
    hasPackageSubpath: packageSubpathDescriptor?.value !== undefined,
    sourceEntry: sourceEntryDescriptor?.value,
    packageSubpath: packageSubpathDescriptor?.value,
  });
}

function throwInvalidImportOptions(): never {
  throw new TypeError("Invalid first-party extension import options");
}

function assertValidSourceDirectory(sourceDirectory: unknown): asserts sourceDirectory is string {
  if (
    typeof sourceDirectory !== "string" ||
    !FIRST_PARTY_SOURCE_DIRECTORY_PATTERN.test(sourceDirectory)
  ) {
    throw new TypeError(
      "Invalid first-party extension source directory",
    );
  }
}

function assertValidPackageName(packageName: unknown): asserts packageName is string {
  if (
    typeof packageName !== "string" ||
    !FIRST_PARTY_PACKAGE_PATTERN.test(packageName)
  ) {
    throw new TypeError(
      "Invalid first-party extension package name",
    );
  }
}

function assertValidEntry(label: string, entry: unknown): asserts entry is string {
  if (typeof entry !== "string" || !FIRST_PARTY_ENTRY_PATTERN.test(entry)) {
    throw new TypeError(`Invalid first-party extension ${label}`);
  }
}

// Stable runtime error codes for unresolvable modules (preferred over message
// text, which runtimes reword between releases).
const MISSING_MODULE_ERROR_CODES = new Set([
  "ERR_MODULE_NOT_FOUND", // Node ESM
  "MODULE_NOT_FOUND", // Node CJS interop
  "ERR_PACKAGE_PATH_NOT_EXPORTED", // Node package exports
]);

/**
 * Classify a dynamic-import failure as "the extension module itself is not
 * installed" as opposed to a real load failure inside an installed extension.
 *
 * Checks the stable `error.code` first and falls back to message patterns,
 * walking the `cause` chain so wrapped errors classify like their root cause.
 *
 * When `expectedSpecifierFragments` is provided, package specifiers and
 * absolute/file paths match exactly. Safe relative multi-segment path
 * fragments match only as complete path suffixes, with an optional emitted
 * `.ts` or `.js` extension. Every recognized missing-module error in the
 * cause chain must agree. This keeps a broken transitive dependency (e.g.
 * `Cannot find package 'jose'` thrown while loading an installed
 * @veryfront/ext-auth-jwt) from being misread as "extension not installed".
 */
export function isMissingFirstPartyExtensionModule(
  error: unknown,
  expectedSpecifierFragments?: string[],
): boolean {
  const chain = errorChain(error);
  const missing = chain.filter(isMissingModuleError);
  if (missing.length === 0) return false;
  if (!expectedSpecifierFragments || expectedSpecifierFragments.length === 0) {
    return true;
  }

  let matched = false;
  for (const entry of missing) {
    const message = errorMessage(entry);
    const missingSpecifier = message === undefined ? undefined : reportedMissingSpecifier(message);
    if (missingSpecifier === undefined) return false;
    if (
      !expectedSpecifierFragments.some((expected) =>
        matchesExpectedSpecifier(missingSpecifier, expected)
      )
    ) {
      return false;
    }
    matched = true;
  }
  return matched;
}

function reportedMissingSpecifier(message: string): string | undefined {
  for (
    const prefix of [
      "[ERR_PACKAGE_PATH_NOT_EXPORTED] ",
      "[ERR_MODULE_NOT_FOUND] ",
    ]
  ) {
    if (message.startsWith(prefix)) {
      message = message.slice(prefix.length);
      break;
    }
  }

  const unknownExport = message.match(
    /^Unknown export\s+["'](\.\/[^"']+)["']\s+for\s+["']([^"']+)["']$/,
  ) ?? message.match(
    /^Unknown export\s+["'](\.\/[^"']+)["']\s+for\s+["']([^"']+)["']\.\n {2}Package exports:(?:\n \* [^\r\n]+)+(?:\n {4}at [^\r\n]+\n?)?$/,
  );
  if (unknownExport) {
    return `${unknownExport[2]}/${unknownExport[1]!.slice(2)}`;
  }

  const packageSubpath = message.match(
    /^Package subpath\s+["'](\.\/[^"']+)["']\s+is not defined by\s+["']exports["']\s+in\s+(?:["']([^"']+[/\\]package\.json)["']|(.+?[/\\]package\.json))(?:\s+imported from\s+.+)?$/,
  );
  if (packageSubpath) {
    const packageName = packageNameFromManifestPath(
      packageSubpath[2] ?? packageSubpath[3]!,
    );
    if (packageName) return `${packageName}/${packageSubpath[1]!.slice(2)}`;
  }

  for (
    const pattern of [
      /^Cannot find module\s+["']([^"']+)["']\nRequire stack:(?:\n- [^\r\n]+)+$/,
      /^(?:Cannot find package|Cannot find module|Module not found)\s+["']([^"']+)["'](?:(?:\s+imported from\s+.+)|\.)?$/,
      /^Import\s+["']([^"']+)["']\s+not a dependency and not in import map(?:\s+from\s+.+)?$/,
      /^Unable to resolve\s+["']([^"']+)["'](?:\s+from\s+.+)?$/,
    ]
  ) {
    const match = message.match(pattern);
    if (match) return match[1];
  }
  return undefined;
}

function packageNameFromManifestPath(path: string): string | undefined {
  const normalized = path.replaceAll("\\", "/");
  const marker = "/node_modules/";
  const markerIndex = normalized.lastIndexOf(marker);
  if (markerIndex < 0) return undefined;
  const segments = normalized.slice(markerIndex + marker.length).split("/");
  if (segments[0]?.startsWith("@")) {
    return segments[0] && segments[1] ? `${segments[0]}/${segments[1]}` : undefined;
  }
  return segments[0] || undefined;
}

function matchesExpectedSpecifier(
  reportedSpecifier: string,
  expectedSpecifier: unknown,
): boolean {
  if (typeof expectedSpecifier !== "string") return false;

  const expectedFilePath = canonicalFilePath(expectedSpecifier);
  const reportedFilePath = canonicalFilePath(reportedSpecifier);
  if (expectedFilePath !== undefined) {
    return reportedFilePath === expectedFilePath;
  }

  if (FIRST_PARTY_PACKAGE_SPECIFIER_PATTERN.test(expectedSpecifier)) {
    return FIRST_PARTY_PACKAGE_SPECIFIER_PATTERN.test(reportedSpecifier) &&
      reportedSpecifier === expectedSpecifier;
  }

  const relativeFragment = expectedSpecifier.replaceAll("\\", "/");
  if (!SAFE_RELATIVE_PATH_FRAGMENT_PATTERN.test(relativeFragment)) return false;
  const normalizedReportedSpecifier = reportedSpecifier.replaceAll("\\", "/");
  if (
    reportedFilePath === undefined &&
    !normalizedReportedSpecifier.startsWith("./") &&
    !normalizedReportedSpecifier.startsWith("../")
  ) {
    return false;
  }
  const reportedPath = reportedFilePath ?? normalizedReportedSpecifier;
  const suffixes = relativeFragment.endsWith(".ts") ||
      relativeFragment.endsWith(".js")
    ? [relativeFragment]
    : [
      relativeFragment,
      `${relativeFragment}.ts`,
      `${relativeFragment}.js`,
    ];
  for (
    const suffix of suffixes
  ) {
    if (reportedPath === suffix || reportedPath.endsWith(`/${suffix}`)) {
      return true;
    }
  }
  return false;
}

function canonicalFilePath(specifier: string): string | undefined {
  if (/^file:/i.test(specifier)) {
    try {
      const url = new URL(specifier);
      if (
        url.protocol !== "file:" ||
        url.username !== "" ||
        url.password !== "" ||
        url.port !== "" ||
        url.search !== "" ||
        url.hash !== "" ||
        /%2f|%5c/i.test(url.pathname)
      ) {
        return undefined;
      }
      const host = url.hostname === "localhost" ? "" : url.hostname;
      let path = decodeURIComponent(url.pathname).replaceAll("\\", "/");
      if (/^\/[A-Za-z]:\//.test(path)) path = path.slice(1);
      return host ? `//${host.toLowerCase()}${path}` : normalizeAbsoluteFilePath(path);
    } catch {
      return undefined;
    }
  }

  const normalized = specifier.replaceAll("\\", "/");
  if (
    !normalized.startsWith("/") &&
    !normalized.startsWith("//") &&
    !/^[A-Za-z]:\//.test(normalized)
  ) {
    return undefined;
  }
  return normalizeAbsoluteFilePath(normalized);
}

function normalizeAbsoluteFilePath(path: string): string {
  if (/^[A-Za-z]:\//.test(path)) {
    return `${path[0]!.toLowerCase()}${path.slice(1)}`;
  }
  const uncPath = path.match(/^\/\/([^/]+)(\/.*)$/);
  return uncPath ? `//${uncPath[1]!.toLowerCase()}${uncPath[2]}` : path;
}

function isMissingModuleError(error: unknown): boolean {
  let code: unknown;
  try {
    code = (error as { code?: unknown } | null)?.code;
  } catch {
    return false;
  }
  const message = errorMessage(error);
  if (message === undefined) return false;
  if (typeof code === "string" && MISSING_MODULE_ERROR_CODES.has(code)) return true;

  return reportedMissingSpecifier(message) !== undefined;
}

function errorChain(error: unknown): unknown[] {
  const chain: unknown[] = [];
  let current: unknown = error;
  while (current !== undefined && current !== null && chain.length < 8) {
    if (chain.includes(current)) break;
    chain.push(current);
    try {
      current = current instanceof Error ? current.cause : undefined;
    } catch {
      break;
    }
  }
  return chain;
}

function errorMessage(error: unknown): string | undefined {
  try {
    if (error instanceof Error) {
      return typeof error.message === "string" ? error.message : undefined;
    }
    return typeof error === "string" ? error : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Both the workspace source and the npm package are missing. Surface the
 * package-resolution error (its message names the installable @veryfront/ext-*
 * package) instead of the internal workspace source path, and append an
 * explicit install hint for npm consumers.
 */
function withMissingExtensionInstallHint(
  error: unknown,
  sourceDirectory: string,
  packageName: string,
  packageSpecifier: string,
  sourceError: unknown,
): unknown {
  const message = errorMessage(error);
  if (message === undefined) return error;
  const hint = packageSpecifier === packageName
    ? ` First-party extension "${sourceDirectory}" is not installed; install ${packageName} alongside veryfront to enable it.`
    : ` First-party extension entry "${packageSpecifier}" is unavailable; install or update ${packageName} alongside veryfront to enable it.`;
  const cause = sourceError !== undefined && sourceError !== error
    ? new AggregateError([error, sourceError], message)
    : error;
  return new Error(`${message}${hint}`, { cause });
}
