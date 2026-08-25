/**
 * Lifecycle-owned authorization boundary for React Server Actions.
 *
 * Core never supplies an allow-all implementation. Applications that expose
 * Server Actions must compose one provider through the extension contract
 * registry for the active server generation.
 *
 * @module extensions/auth/rsc-action-authorization-provider
 */

import { isProxyWithoutHooks } from "#veryfront/platform/compat/error-introspection.ts";
import { SERVER_FUNCTION_DEFAULT_TIMEOUT_MS } from "#veryfront/utils/constants/index.ts";

const apply = Reflect.apply;
const arrayIsArray = Array.isArray;
const freeze = Object.freeze;
const getOwnPropertyDescriptors = Object.getOwnPropertyDescriptors;
const getPrototypeOf = Object.getPrototypeOf;
const hasOwnProperty = Object.prototype.hasOwnProperty;
const objectPrototype = Object.prototype;
const ownKeys = Reflect.ownKeys;
const NativeTypeError = TypeError;

function hasOwn(value: PropertyDescriptor, key: PropertyKey): boolean {
  return apply(hasOwnProperty, value, [key]) as boolean;
}

/** Generation-owned contract name registered by an application-selected authorization extension. */
export const RscActionAuthorizationProviderName = "RscActionAuthorizationProvider" as const;

/** Default deadline for one asynchronous authorization decision: 30 seconds. */
export const RSC_ACTION_AUTHORIZATION_TIMEOUT_MS = SERVER_FUNCTION_DEFAULT_TIMEOUT_MS;

/** Cooperative-cancellation grace: 1,000 ms before a non-settling generation is quarantined. */
export const RSC_ACTION_AUTHORIZATION_TERMINATION_GRACE_MS = 1_000;

/** Maximum top-level arguments in one Server Action request: 50. */
export const RSC_ACTION_MAX_TOP_LEVEL_ARGUMENTS = 50;

/** Maximum nested container depth in the detached authorization argument graph: 64. */
export const RSC_ACTION_AUTHORIZATION_MAX_ARGUMENT_DEPTH = 64;

/** Maximum values in the complete detached authorization argument graph: 50,000. */
export const RSC_ACTION_AUTHORIZATION_MAX_ARGUMENT_NODES = 50_000;

/** Maximum aggregate array elements and record properties in the argument graph: 100,000. */
export const RSC_ACTION_AUTHORIZATION_MAX_ARGUMENT_PROPERTIES = 100_000;

/** Maximum length of any one dense argument array: 50,000. */
export const RSC_ACTION_AUTHORIZATION_MAX_ARGUMENT_ARRAY_LENGTH = 50_000;

/** JSON-compatible, data-only value domain; numbers are always finite. */
export type RscActionAuthorizationValue =
  | string
  | number
  | boolean
  | null
  | Readonly<RscActionAuthorizationArray>
  | Readonly<RscActionAuthorizationRecord>;

/** Immutable dense data-only array with stable index and iteration semantics. */
export interface RscActionAuthorizationArray extends Iterable<RscActionAuthorizationValue> {
  readonly length: number;
  readonly [index: number]: RscActionAuthorizationValue;
}

/** Immutable null-prototype data-only record; absent properties resolve to `undefined`. */
export interface RscActionAuthorizationRecord {
  readonly [key: string]: RscActionAuthorizationValue | undefined;
}

/** Detached immutable action metadata and bounded JSON-compatible arguments. */
export interface RscActionAuthorizationContext {
  readonly id: string;
  readonly args: Readonly<RscActionAuthorizationArray>;
  readonly projectId?: string;
  readonly projectSlug?: string;
  readonly contentSourceId?: string;
  readonly releaseId?: string;
  readonly branch?: string | null;
  readonly isLocalProject?: boolean;
  readonly mode?: "development" | "production";
}

/** Immutable null-prototype lowercase header snapshot; it contains no request body. */
export interface RscActionAuthorizationHeaders {
  /** Absent lowercase names resolve to `undefined`. */
  readonly [lowercaseName: string]: string | undefined;
}

/** Immutable, bodyless request metadata detached from the mutable request object. */
export interface RscActionAuthorizationRequest {
  readonly url: string;
  readonly method: string;
  /** Lowercase header names mapped to their normalized combined values. */
  readonly headers: Readonly<RscActionAuthorizationHeaders>;
  /**
   * Core-owned cancellation capability. It is aborted when the client
   * disconnects, the authorization deadline expires, or the provider's
   * extension generation begins retirement.
   */
  readonly signal: AbortSignal;
}

/**
 * Decide one Server Action invocation. `true` invokes the action and `false`
 * returns 403. Throwing, rejecting, timing out, or returning a non-boolean
 * fails closed with 503; the action is never loaded before authorization.
 */
export type RscActionAuthorize = (
  request: Readonly<RscActionAuthorizationRequest>,
  context: Readonly<RscActionAuthorizationContext>,
) => boolean | Promise<boolean>;

/**
 * Required generation-owned Server Action authorization contract. An absent,
 * malformed, retiring, failed, or non-cooperative provider returns 503 with
 * `Cache-Control: no-store`; core has no allow-all fallback.
 */
export interface RscActionAuthorizationProvider {
  /**
   * Return `true` only when this request may invoke the selected action.
   * The function must not depend on a receiver. Throwing or returning any
   * value other than a boolean fails closed at the request boundary.
   */
  readonly authorize: RscActionAuthorize;
}

function invalidProvider(detail: string, cause?: unknown): TypeError {
  return cause === undefined
    ? new NativeTypeError(`RSC action authorization provider ${detail}`)
    : new NativeTypeError(`RSC action authorization provider ${detail}`, { cause });
}

/**
 * Capture an exact `{ authorize }` extension registration without invoking
 * accessors or retaining mutable provider metadata.
 */
export function snapshotRscActionAuthorizationProvider(
  value: unknown,
): Readonly<RscActionAuthorizationProvider> {
  if (typeof value !== "object" || value === null || arrayIsArray(value)) {
    throw invalidProvider("must be a plain object");
  }
  if (isProxyWithoutHooks(value)) {
    throw invalidProvider("must not be a Proxy");
  }

  let prototype: object | null;
  let descriptors: Record<PropertyKey, PropertyDescriptor>;
  try {
    prototype = getPrototypeOf(value);
    descriptors = getOwnPropertyDescriptors(value);
  } catch (cause) {
    throw invalidProvider("could not be inspected safely", cause);
  }

  const keys = ownKeys(descriptors);
  if (
    (prototype !== objectPrototype && prototype !== null) ||
    keys.length !== 1 || keys[0] !== "authorize"
  ) {
    throw invalidProvider("must contain exactly one enumerable authorize data property");
  }

  const descriptor = descriptors.authorize;
  if (
    !descriptor?.enumerable || !hasOwn(descriptor, "value") ||
    typeof descriptor.value !== "function" ||
    isProxyWithoutHooks(descriptor.value)
  ) {
    throw invalidProvider("authorize data property must be a non-Proxy function");
  }
  const authorize = descriptor.value as RscActionAuthorize;

  return freeze({
    authorize(
      request: Readonly<RscActionAuthorizationRequest>,
      context: Readonly<RscActionAuthorizationContext>,
    ): boolean | Promise<boolean> {
      return apply(authorize, undefined, [request, context]) as
        | boolean
        | Promise<boolean>;
    },
  });
}

/** Create immutable provider registration metadata from a standalone authorizer. */
export function createRscActionAuthorizationProvider(
  authorize: RscActionAuthorize,
): Readonly<RscActionAuthorizationProvider> {
  return snapshotRscActionAuthorizationProvider({ authorize });
}
