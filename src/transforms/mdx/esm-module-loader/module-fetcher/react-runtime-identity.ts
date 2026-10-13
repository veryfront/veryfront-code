import { captureSSRReactRuntimeIdentity } from "#veryfront/transforms/esm/http-cache-helpers.ts";
import { REACT_DEFAULT_VERSION } from "#veryfront/utils/constants/cdn.ts";
import type { ModuleFetcherContext } from "../types.ts";

/** Capture one effective version/scope pair for a top-level fetch graph. */
export function getModuleFetcherReactRuntimeIdentity(
  context: ModuleFetcherContext,
  capture: typeof captureSSRReactRuntimeIdentity = captureSSRReactRuntimeIdentity,
): { reactVersion: string; scope: Promise<string> } {
  if (context.reactRuntimeIdentity) return context.reactRuntimeIdentity;
  const installed = capture();
  const reactVersion = context.reactVersion ?? installed.reactVersion ?? REACT_DEFAULT_VERSION;
  const identity = { reactVersion, scope: installed.scope };
  context.reactVersion = reactVersion;
  context.reactRuntimeScope = identity.scope;
  context.reactRuntimeIdentity = identity;
  return identity;
}
