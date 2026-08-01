/**
 * Contract interface for class-candidate CSS processing engines.
 *
 * Implementations are supplied by explicit extensions such as
 * `@veryfront/ext-css-tailwind`.
 *
 * The contract exposes a provider-neutral compile surface: a stateful
 * compiler is constructed once per stylesheet and emits CSS output for the
 * set of class-name candidates discovered at render time. Core scans the
 * rendered HTML for candidates and calls `CSSCompiler.build(candidates)`
 * on each request; the compiler accumulates state across calls, so exact
 * candidate-snapshot isolation is the caller's responsibility (see
 * `css-compiler-cache.ts`).
 *
 * @module extensions/css/css-processor
 */

import { isProxy as isProxyWithoutHooks } from "node:util/types";
import {
  applyExtensionMethod,
  findExtensionPropertyDescriptor,
  freezeExtensionContract,
  getExtensionOwnPropertyDescriptor,
  isDataPropertyDescriptor,
  isExtensionArray,
  isStableExtensionCacheIdentity,
} from "../property-inspection.ts";

/** Registry name used for the CSS compiler extension contract. */
export const CSSProcessorName = "CSSProcessor" as const;
export const MAX_CSS_PROCESSOR_IDENTITY_CHARACTERS = 512;
export const MAX_CSS_PROCESSOR_DEFAULT_STYLESHEET_CHARACTERS = 1024 * 1024;

const stringIndexOf = String.prototype.indexOf;

/** Stateful compiler returned by {@link CSSProcessor.compile}. */
export interface CSSCompiler {
  /**
   * Emit CSS for the supplied list of class-name candidates. Stateful — the
   * compiler accumulates candidates across calls for the lifetime of the
   * underlying compile session.
   */
  build(candidates: string[]): string;
}

/**
 * CSSProcessor contract interface.
 *
 * Implementations wire a class-candidate CSS compiler so
 * core's styles-builder can emit per-request CSS without importing the
 * underlying engine directly.
 */
export interface CSSProcessor {
  /** Stable identity for every processor/compiler input that can change emitted CSS. */
  readonly cacheIdentity: string;
  /** Provider-owned stylesheet used when an application does not supply one. */
  readonly defaultStylesheet: string;
  /**
   * Compile a stylesheet. Implementations own all vendor imports, base
   * stylesheets, module resolution, and plugin loading behind this operation.
   */
  compile(stylesheet: string): Promise<CSSCompiler>;
}

function assertContractObject(value: unknown, label: string): asserts value is object {
  if (
    typeof value !== "object" ||
    value === null ||
    isExtensionArray(value) ||
    isProxyWithoutHooks(value)
  ) {
    throw new TypeError(`${label} must be a non-Proxy object`);
  }
}

function readCSSCompiler(value: unknown): {
  implementation: object;
  build: CSSCompiler["build"];
} {
  assertContractObject(value, "CSSCompiler");

  let buildDescriptor: PropertyDescriptor | undefined;
  try {
    buildDescriptor = findExtensionPropertyDescriptor(value, "build");
  } catch (cause) {
    throw new TypeError("CSSCompiler properties could not be inspected", { cause });
  }
  if (!isDataPropertyDescriptor(buildDescriptor) || typeof buildDescriptor.value !== "function") {
    throw new TypeError("CSSCompiler build must be a data-property function");
  }
  return {
    implementation: value,
    build: buildDescriptor.value as CSSCompiler["build"],
  };
}

/** Capture a compiler method once so accessors and later mutation cannot redirect a build. */
export function captureCSSCompiler(value: unknown): CSSCompiler {
  const captured = readCSSCompiler(value);
  return freezeExtensionContract({
    build(candidates: string[]): string {
      const css = applyExtensionMethod(captured.build, captured.implementation, [candidates]);
      if (typeof css !== "string") {
        throw new TypeError("CSSCompiler build must return CSS as a string");
      }
      return css;
    },
  });
}

function readCSSProcessor(value: unknown): {
  implementation: object;
  cacheIdentity: string;
  defaultStylesheet: string;
  compile: CSSProcessor["compile"];
} {
  assertContractObject(value, "CSSProcessor");

  let identityDescriptor: PropertyDescriptor | undefined;
  let defaultStylesheetDescriptor: PropertyDescriptor | undefined;
  let compileDescriptor: PropertyDescriptor | undefined;
  try {
    identityDescriptor = getExtensionOwnPropertyDescriptor(value, "cacheIdentity");
    defaultStylesheetDescriptor = getExtensionOwnPropertyDescriptor(value, "defaultStylesheet");
    compileDescriptor = findExtensionPropertyDescriptor(value, "compile");
  } catch (cause) {
    throw new TypeError("CSSProcessor properties could not be inspected", { cause });
  }

  if (!isDataPropertyDescriptor(identityDescriptor)) {
    throw new TypeError("CSSProcessor cacheIdentity must be an own data property");
  }
  if (!isDataPropertyDescriptor(defaultStylesheetDescriptor)) {
    throw new TypeError("CSSProcessor defaultStylesheet must be an own data property");
  }
  if (
    !isDataPropertyDescriptor(compileDescriptor) || typeof compileDescriptor.value !== "function"
  ) {
    throw new TypeError("CSSProcessor compile must be a data-property function");
  }
  if (
    !isStableExtensionCacheIdentity(
      identityDescriptor.value,
      MAX_CSS_PROCESSOR_IDENTITY_CHARACTERS,
    )
  ) {
    throw new TypeError("CSSProcessor must declare a bounded stable cacheIdentity");
  }
  if (
    typeof defaultStylesheetDescriptor.value !== "string" ||
    defaultStylesheetDescriptor.value.length > MAX_CSS_PROCESSOR_DEFAULT_STYLESHEET_CHARACTERS ||
    applyExtensionMethod(stringIndexOf, defaultStylesheetDescriptor.value, ["\0"]) !== -1
  ) {
    throw new TypeError("CSSProcessor must declare a bounded defaultStylesheet");
  }

  return {
    implementation: value,
    cacheIdentity: identityDescriptor.value,
    defaultStylesheet: defaultStylesheetDescriptor.value,
    compile: compileDescriptor.value as CSSProcessor["compile"],
  };
}

/** Validate an implementation received through the dynamic extension registry. */
export function assertCSSProcessor(value: unknown): asserts value is CSSProcessor {
  readCSSProcessor(value);
}

/**
 * Capture the complete processor surface once. A registry or implementation
 * mutation can therefore affect only a subsequently acquired operation.
 */
export function captureCSSProcessor(value: unknown): CSSProcessor {
  const captured = readCSSProcessor(value);
  return freezeExtensionContract({
    cacheIdentity: captured.cacheIdentity,
    defaultStylesheet: captured.defaultStylesheet,
    async compile(stylesheet: string): Promise<CSSCompiler> {
      const compiler = await applyExtensionMethod(
        captured.compile,
        captured.implementation,
        [stylesheet],
      );
      return captureCSSCompiler(compiler);
    },
  });
}
