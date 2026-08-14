/**
 * Opaque pre-activation state for deferred built-in extensions.
 *
 * Public extension APIs continue to accept `ResolvedExtension`. A branded
 * resolved value lets the internal loader defer materializing first-party
 * implementations until after merge priority and disable filtering, without
 * exposing a second extension-authoring contract.
 */

import type {
  Capability,
  Extension,
  ExtensionLogger,
  ExtensionSource,
  ResolvedExtension,
} from "./types.ts";
import { assertCanonicalNonEmptyString } from "./runtime-validation.ts";

const DEFERRED_EXTENSION_STATE = Symbol("veryfront.deferred-extension-state");
const DEFERRED_EXTENSION_VERSION = "0.0.0-deferred";

export interface DeferredExtensionState {
  readonly expectedName: string;
  readonly load: (
    logger: ExtensionLogger,
  ) => Promise<Extension | undefined>;
}

type DeferredResolvedExtension = ResolvedExtension & {
  readonly [DEFERRED_EXTENSION_STATE]: DeferredExtensionState;
};

export function createDeferredResolvedExtension(input: {
  readonly name: string;
  readonly source: ExtensionSource;
  readonly origin: string;
  readonly load: DeferredExtensionState["load"];
}): ResolvedExtension {
  assertCanonicalNonEmptyString(input.name, "Deferred extension name");
  assertCanonicalNonEmptyString(input.origin, "Deferred extension origin");
  if (typeof input.load !== "function") {
    throw new TypeError("Deferred extension loader must be a function");
  }

  const capabilities: Capability[] = [];
  Object.freeze(capabilities);
  const placeholder: Extension = {
    name: input.name,
    version: DEFERRED_EXTENSION_VERSION,
    capabilities,
  };
  Object.freeze(placeholder);

  const state: DeferredExtensionState = Object.freeze({
    expectedName: input.name,
    load: input.load,
  });
  const candidate: DeferredResolvedExtension = {
    extension: placeholder,
    source: input.source,
    origin: input.origin,
    [DEFERRED_EXTENSION_STATE]: state,
  };
  return Object.freeze(candidate);
}

export function getDeferredExtensionState(
  candidate: ResolvedExtension,
): DeferredExtensionState | undefined {
  return (candidate as DeferredResolvedExtension)[DEFERRED_EXTENSION_STATE];
}
