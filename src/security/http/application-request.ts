/**
 * Headers used only between trusted Veryfront infrastructure components.
 *
 * These values must remain available to the host request pipeline, but they are
 * never part of the application-facing HTTP contract. In particular, `x-token`
 * may contain a service, static platform, or preview-user credential injected by
 * the proxy for project filesystem access.
 */
const apply = Reflect.apply;
const arrayIsArray = Array.isArray;
const NativeNumber = Number;
const NativeSet = Set;
const NativeHeaders = Headers;
const NativeRequest = Request;
const getOwnPropertyDescriptor = Object.getOwnPropertyDescriptor;
const getOwnPropertyDescriptors = Object.getOwnPropertyDescriptors;
const getOwnPropertySymbols = Object.getOwnPropertySymbols;
const arrayJoin = Array.prototype.join;
const arrayPush = Array.prototype.push;
const headersAppend = NativeHeaders.prototype.append;
const headersForEach = NativeHeaders.prototype.forEach;
const headersGet = NativeHeaders.prototype.get;
const numberIsSafeInteger = NativeNumber.isSafeInteger;
const objectKeys = Object.keys;
const regexpTest = RegExp.prototype.test;
const requestClone = NativeRequest.prototype.clone;
const setAdd = NativeSet.prototype.add;
const setHas = NativeSet.prototype.has;
const requestHeadersGetter = getOwnPropertyDescriptor(
  NativeRequest.prototype,
  "headers",
)?.get;
const stringToLowerCase = String.prototype.toLowerCase;
const stringStartsWith = String.prototype.startsWith;
const stringSplit = String.prototype.split;
const stringTrim = String.prototype.trim;
const stringCharCodeAt = String.prototype.charCodeAt;
const HEADER_NAME_PATTERN = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/;
const MAX_DYNAMIC_DENY_HEADERS = 32;
const MAX_DYNAMIC_DENY_HEADER_NAME_LENGTH = 128;
const DEFAULT_APPLICATION_PREFLIGHT_HEADER_NAMES = ["Content-Type", "Authorization"] as const;

if (typeof requestHeadersGetter !== "function") {
  throw new TypeError("Request.prototype.headers getter is unavailable");
}

function setContains<T>(set: ReadonlySet<T>, value: T): boolean {
  return apply(setHas, set, [value]) as boolean;
}

function setInsert<T>(set: Set<T>, value: T): void {
  apply(setAdd, set, [value]);
}

export function isInfrastructureOnlyRequestHeader(name: string): boolean {
  const normalized = apply(stringToLowerCase, name, []) as string;
  if (apply(stringStartsWith, normalized, ["x-veryfront-"]) as boolean) {
    return true;
  }
  if (
    apply(stringStartsWith, normalized, ["x-forwarded-"]) as boolean ||
    apply(stringStartsWith, normalized, ["x-project-"]) as boolean ||
    apply(stringStartsWith, normalized, ["x-branch-"]) as boolean
  ) {
    return true;
  }
  switch (normalized) {
    case "cf-connecting-ip":
    case "fastly-client-ip":
    case "forwarded":
    case "proxy-authorization":
    case "true-client-ip":
    case "x-authoritative":
    case "x-content-source-id":
    case "x-environment":
    case "x-environment-id":
    case "x-real-ip":
    case "x-release-id":
    case "x-token":
      return true;
    default:
      return false;
  }
}

/** Keep infrastructure-only request headers out of browser preflight policy. */
export function getApplicationPreflightHeaders(
  request: Request,
  options: Pick<ApplicationRequestHeaderOptions, "denyHeaders"> = {},
): string {
  const dynamicDenyHeaders = normalizeDynamicDenyHeaders(options.denyHeaders);
  if (dynamicDenyHeaders === null) return "";

  try {
    const headers = apply(requestHeadersGetter!, request, []) as Headers;
    const requested = apply(headersGet, headers, ["access-control-request-headers"]);
    if (typeof requested !== "string" || requested.length === 0) {
      return defaultApplicationPreflightHeaders(dynamicDenyHeaders);
    }

    const names = apply(stringSplit, requested, [","]) as string[];
    const allowed: string[] = [];
    for (let index = 0; index < names.length; index++) {
      const name = apply(stringTrim, names[index], []) as string;
      const normalizedName = apply(stringToLowerCase, name, []) as string;
      if (
        name.length > 0 &&
        !isInfrastructureOnlyRequestHeader(name) &&
        !setContains(dynamicDenyHeaders, normalizedName)
      ) {
        apply(arrayPush, allowed, [name]);
      }
    }
    return allowed.length > 0
      ? apply(arrayJoin, allowed, [","]) as string
      : defaultApplicationPreflightHeaders(dynamicDenyHeaders);
  } catch {
    return defaultApplicationPreflightHeaders(dynamicDenyHeaders);
  }
}

function defaultApplicationPreflightHeaders(denyHeaders: ReadonlySet<string>): string {
  const allowed: string[] = [];
  for (const name of DEFAULT_APPLICATION_PREFLIGHT_HEADER_NAMES) {
    if (
      !isInfrastructureOnlyRequestHeader(name) &&
      !setContains(denyHeaders, apply(stringToLowerCase, name, []) as string)
    ) {
      apply(arrayPush, allowed, [name]);
    }
  }
  return apply(arrayJoin, allowed, [","]) as string;
}

export interface ApplicationRequestHeaderOptions {
  readonly denyHeaders?: readonly string[];
}

function normalizeDynamicDenyHeaders(
  names: readonly string[] | undefined,
): ReadonlySet<string> | null {
  try {
    if (names === undefined) return new NativeSet<string>();
    if (!arrayIsArray(names) || getOwnPropertySymbols(names).length > 0) return null;

    const descriptors = getOwnPropertyDescriptors(names);
    const lengthDescriptor = getOwnPropertyDescriptor(names, "length");
    if (
      !lengthDescriptor ||
      !("value" in lengthDescriptor) ||
      typeof lengthDescriptor.value !== "number" ||
      !numberIsSafeInteger(lengthDescriptor.value) ||
      lengthDescriptor.value > MAX_DYNAMIC_DENY_HEADERS
    ) {
      return null;
    }

    const denylist = new NativeSet<string>();
    for (let index = 0; index < lengthDescriptor.value; index += 1) {
      const descriptor = descriptors[index];
      if (!descriptor || !("value" in descriptor) || typeof descriptor.value !== "string") {
        return null;
      }
      const name = descriptor.value;
      if (
        name.length === 0 ||
        name.length > MAX_DYNAMIC_DENY_HEADER_NAME_LENGTH ||
        !(apply(regexpTest, HEADER_NAME_PATTERN, [name]) as boolean)
      ) {
        return null;
      }
      setInsert(denylist, apply(stringToLowerCase, name, []) as string);
    }

    const keys = objectKeys(descriptors);
    for (let index = 0; index < keys.length; index += 1) {
      const key = keys[index]!;
      if (key === "length" || isArrayIndexKey(key)) continue;
      return null;
    }
    return denylist;
  } catch {
    return null;
  }
}

function isArrayIndexKey(value: string): boolean {
  if (value === "0") return true;
  if (value.length === 0 || value[0] === "0") return false;
  for (let index = 0; index < value.length; index += 1) {
    const code = apply(stringCharCodeAt, value, [index]) as number;
    if (code < 48 || code > 57) return false;
  }
  const numeric = apply(NativeNumber, undefined, [value]) as number;
  return numberIsSafeInteger(numeric) && numeric >= 0 && numeric < 2 ** 32 - 1;
}

/** Copy only application-owned headers across the project-code boundary. */
export function createApplicationRequestHeaders(
  headers: Headers,
  options: ApplicationRequestHeaderOptions = {},
): Headers {
  const dynamicDenyHeaders = normalizeDynamicDenyHeaders(options.denyHeaders);
  const applicationHeaders = new NativeHeaders();
  if (dynamicDenyHeaders === null) return applicationHeaders;

  apply(headersForEach, headers, [
    (value: string, name: string) => {
      const normalized = apply(stringToLowerCase, name, []) as string;
      if (
        !setContains(dynamicDenyHeaders, normalized) && !isInfrastructureOnlyRequestHeader(name)
      ) {
        apply(headersAppend, applicationHeaders, [name, value]);
      }
    },
  ]);
  return applicationHeaders;
}

/**
 * Detach a Request before exposing it to project-controlled code.
 *
 * Cloning first preserves the host-owned request body for later framework
 * processing while giving project code an independent header list.
 */
export function createApplicationRequest(
  request: Request,
  options: ApplicationRequestHeaderOptions = {},
): Request {
  const cloned = apply(requestClone, request, []) as Request;
  const headers = apply(requestHeadersGetter!, cloned, []) as Headers;
  return new NativeRequest(cloned, {
    headers: createApplicationRequestHeaders(headers, options),
  });
}
