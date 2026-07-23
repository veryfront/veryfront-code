/**
 * Resolve first-party extension implementations without making the root npm
 * package statically depend on every extension dependency.
 *
 * Source and compiled-binary builds can load the workspace extension sources.
 * npm builds should load the separate @veryfront/ext-* packages installed by
 * the consuming service or app.
 */

import { isVeryfrontErrorWithSlug, MISSING_EXTENSION_ERROR } from "./errors.ts";
import {
  hasAsciiWhitespaceOrControlCharacters,
  hasControlCharacters,
  MAX_EXTENSION_NAME_LENGTH,
} from "./identifiers.ts";

const SOURCE_EXTENSION_ROOT = "../../extensions";
const MAX_EXPECTED_SPECIFIER_FRAGMENTS = 128;
const MAX_EXPECTED_SPECIFIER_LENGTH = 4_096;
const MAX_MODULE_ERROR_MESSAGE_LENGTH = 8_192;

export function firstPartyExtensionSourceSpecifiers(sourceDirectory: string): string[] {
  assertFirstPartySourceDirectory(sourceDirectory);
  const sourceRoot = `${SOURCE_EXTENSION_ROOT}/${sourceDirectory}/src/index`;
  return [`${sourceRoot}.ts`, `${sourceRoot}.js`];
}

export async function importFirstPartyExtensionModule<TModule>(
  sourceDirectory: string,
  packageName: string,
): Promise<TModule> {
  assertFirstPartySpecifierInputs(sourceDirectory, packageName);
  const sourceFragment = `extensions/${sourceDirectory}/src/index`;

  for (const sourceSpecifier of firstPartyExtensionSourceSpecifiers(sourceDirectory)) {
    try {
      return await import(sourceSpecifier) as TModule;
    } catch (error) {
      if (!isMissingFirstPartyExtensionModule(error, [sourceFragment])) {
        throw error;
      }
    }
  }

  try {
    return await import(packageName) as TModule;
  } catch (error) {
    if (!isMissingFirstPartyExtensionModule(error, [packageName])) {
      throw error;
    }
    throw MISSING_EXTENSION_ERROR.create({
      message:
        `First-party extension is not installed. Install ${packageName} alongside Veryfront to enable it.`,
    });
  }
}

// Stable runtime error codes for unresolvable modules (preferred over message
// text, which runtimes reword between releases).
const MISSING_MODULE_ERROR_CODES = new Set([
  "ERR_MODULE_NOT_FOUND", // Node ESM
  "MODULE_NOT_FOUND", // Node CJS interop
]);

// Message fallback for runtimes that do not attach a code (Deno module
// resolution, deno compile's embedded-module errors, import-map misses).
const MISSING_MODULE_MESSAGE_PATTERNS = [
  "Cannot find package",
  "Cannot find module",
  "ERR_MODULE_NOT_FOUND",
  "Module not found",
  "not a dependency and not in import map",
] as const;

/**
 * Classify a dynamic-import failure as "the extension module itself is not
 * installed" as opposed to a real load failure inside an installed extension.
 *
 * Checks the stable `error.code` first and falls back to message patterns,
 * walking the `cause` chain so wrapped errors classify like their root cause.
 *
 * When `expectedSpecifierFragments` is provided, the specifier the runtime
 * quotes as missing must reference one of the fragments. This keeps a broken
 * transitive dependency (e.g. `Cannot find package 'jose'` thrown while
 * loading an installed @veryfront/ext-auth-jwt) from being misread as
 * "extension not installed" and silently skipped.
 */
export function isMissingFirstPartyExtensionModule(
  error: unknown,
  expectedSpecifierFragments?: string[],
): boolean {
  if (isVeryfrontErrorWithSlug(error, "missing-extension")) return true;
  const chain = errorChain(error);
  const missing = chain.filter(isMissingModuleError);
  if (missing.length === 0) return false;
  if (expectedSpecifierFragments === undefined) return true;
  const expectedFragments = snapshotExpectedSpecifierFragments(expectedSpecifierFragments);
  if (expectedFragments === undefined) return false;
  if (expectedFragments.length === 0) return true;

  for (const entry of missing) {
    const missingSpecifier = errorMessage(entry).match(/["']([^"']+)["']/)?.[1];
    if (!missingSpecifier) continue;
    if (
      expectedFragments.some((fragment) =>
        matchesExpectedSpecifier(
          missingSpecifier,
          fragment,
        )
      )
    ) {
      return true;
    }
  }
  return false;
}

function snapshotExpectedSpecifierFragments(value: unknown): string[] | undefined {
  try {
    if (!Array.isArray(value)) {
      return undefined;
    }
    const length = Reflect.get(value, "length");
    if (
      typeof length !== "number" || !Number.isSafeInteger(length) || length < 0 ||
      length > MAX_EXPECTED_SPECIFIER_FRAGMENTS
    ) return undefined;
    const result: string[] = [];
    for (let index = 0; index < length; index++) {
      const fragment = Reflect.get(value, index);
      if (
        typeof fragment !== "string" || fragment.length === 0 ||
        fragment.length > MAX_EXPECTED_SPECIFIER_LENGTH ||
        hasControlCharacters(fragment)
      ) {
        return undefined;
      }
      result.push(fragment);
    }
    return result;
  } catch {
    return undefined;
  }
}

function matchesExpectedSpecifier(missingSpecifier: string, expectedFragment: string): boolean {
  if (
    typeof expectedFragment !== "string" || expectedFragment.length === 0 ||
    expectedFragment.length > MAX_EXPECTED_SPECIFIER_LENGTH ||
    hasControlCharacters(expectedFragment)
  ) {
    return false;
  }
  const missing = missingSpecifier.replaceAll("\\", "/");
  const expected = expectedFragment.replaceAll("\\", "/");
  if (missing === expected || missing === `npm:${expected}`) return true;

  let offset = missing.indexOf(expected);
  while (offset >= 0) {
    const before = offset === 0 ? "" : missing[offset - 1];
    const after = missing[offset + expected.length] ?? "";
    if (
      (before === "" || before === "/") &&
      (after === "" || after === "/" || after === ".")
    ) {
      return true;
    }
    offset = missing.indexOf(expected, offset + 1);
  }
  return false;
}

function isMissingModuleError(error: unknown): boolean {
  try {
    const code = (error as { code?: unknown } | null)?.code;
    if (typeof code === "string" && MISSING_MODULE_ERROR_CODES.has(code)) return true;

    const message = errorMessage(error);
    return MISSING_MODULE_MESSAGE_PATTERNS.some((pattern) => message.includes(pattern)) ||
      (message.includes("Import '") && message.includes("' failed"));
  } catch {
    return false;
  }
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

function errorMessage(error: unknown): string {
  try {
    const message = error instanceof Error ? error.message : String(error);
    return message.slice(0, MAX_MODULE_ERROR_MESSAGE_LENGTH);
  } catch {
    return "";
  }
}

function assertFirstPartySpecifierInputs(
  sourceDirectory: string,
  packageName: string,
): void {
  assertFirstPartySourceDirectory(sourceDirectory);
  if (
    typeof packageName !== "string" || packageName.length === 0 ||
    packageName.length > MAX_EXTENSION_NAME_LENGTH ||
    hasAsciiWhitespaceOrControlCharacters(packageName) || packageName.includes("\\") ||
    packageName.startsWith(".") || packageName.startsWith("/")
  ) {
    throw new TypeError("First-party extension package name is invalid");
  }
}

function assertFirstPartySourceDirectory(sourceDirectory: string): void {
  if (
    typeof sourceDirectory !== "string" ||
    !/^[a-z0-9][a-z0-9-]{0,127}$/.test(sourceDirectory)
  ) {
    throw new TypeError("First-party extension source directory is invalid");
  }
}
