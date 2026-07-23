/**
 * Bundler contract resolution helper.
 *
 * Core code uses this thin wrapper instead of importing `esbuild` directly,
 * so the bundler implementation lives in `@veryfront/ext-bundler-esbuild` (or
 * any other extension that satisfies the contract).
 *
 * @module extensions/bundler/helper
 */

import { resolve as resolveContract } from "../contracts.ts";
import { EXTENSION_VALIDATION_ERROR } from "../errors.ts";
import { NOT_SUPPORTED } from "#veryfront/errors/error-registry/general.ts";
import type {
  BuildContext,
  BundleOptions,
  Bundler,
  BundleResult,
  TransformOptions,
  TransformResult,
} from "./bundler.ts";

interface ResolvedBundler {
  value: Bundler;
  bundle: Bundler["bundle"];
  transform: Bundler["transform"];
  context: Bundler["context"];
  stop: Bundler["stop"];
}

function invalidBundler(): never {
  throw EXTENSION_VALIDATION_ERROR.create({
    message: "Registered Bundler contract is invalid",
  });
}

function resolveBundler(): ResolvedBundler {
  const value = resolveContract<unknown>("Bundler");
  if (value === null || (typeof value !== "object" && typeof value !== "function")) {
    return invalidBundler();
  }

  let bundle: unknown;
  let transformMethod: unknown;
  let contextMethod: unknown;
  let stopMethod: unknown;
  try {
    const candidate = value as Partial<Bundler>;
    bundle = candidate.bundle;
    transformMethod = candidate.transform;
    contextMethod = candidate.context;
    stopMethod = candidate.stop;
  } catch {
    return invalidBundler();
  }

  if (
    typeof bundle !== "function" ||
    typeof transformMethod !== "function" ||
    (contextMethod !== undefined && typeof contextMethod !== "function") ||
    (stopMethod !== undefined && typeof stopMethod !== "function")
  ) {
    return invalidBundler();
  }

  return {
    value: value as Bundler,
    bundle: bundle as Bundler["bundle"],
    transform: transformMethod as Bundler["transform"],
    context: contextMethod as Bundler["context"],
    stop: stopMethod as Bundler["stop"],
  };
}

/** Resolve the registered `Bundler` contract. Throws if no extension provides it. */
export function getBundler(): Bundler {
  return resolveBundler().value;
}

/** Convenience wrapper: `bundler.bundle(opts)`. */
export function build(options: BundleOptions): Promise<BundleResult> {
  const bundler = resolveBundler();
  return Reflect.apply(bundler.bundle, bundler.value, [options]);
}

/**
 * Convenience wrapper that mirrors esbuild's `transform(code, options)`
 * positional signature so call-sites migrating off esbuild keep their shape.
 */
export function transform(
  code: string,
  options: Omit<TransformOptions, "code"> = {},
): Promise<TransformResult> {
  const bundler = resolveBundler();
  return Reflect.apply(bundler.transform, bundler.value, [{ ...options, code }]);
}

/**
 * Stop the bundler. This is optional because extension teardown also calls it. Provided
 * so tests that previously called `esbuild.stop()` keep working.
 */
export async function stop(): Promise<void> {
  const bundler = resolveBundler();
  if (bundler.stop) await Reflect.apply(bundler.stop, bundler.value, []);
}

/** Create an incremental build context (watch/rebuild mode). */
export function context(options: BundleOptions): Promise<BuildContext> {
  const bundler = resolveBundler();
  if (!bundler.context) {
    throw NOT_SUPPORTED.create({
      message: "Registered Bundler does not support incremental builds",
    });
  }
  return Reflect.apply(bundler.context, bundler.value, [options]);
}
