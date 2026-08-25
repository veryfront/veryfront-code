/**
 * Headers used only between trusted Veryfront infrastructure components.
 *
 * These values must remain available to the host request pipeline, but they are
 * never part of the application-facing HTTP contract. In particular, `x-token`
 * may contain a service, static platform, or preview-user credential injected by
 * the proxy for project filesystem access.
 */
const apply = Reflect.apply;
const NativeHeaders = Headers;
const NativeRequest = Request;
const getOwnPropertyDescriptor = Object.getOwnPropertyDescriptor;
const headersAppend = NativeHeaders.prototype.append;
const headersForEach = NativeHeaders.prototype.forEach;
const requestClone = NativeRequest.prototype.clone;
const requestHeadersGetter = getOwnPropertyDescriptor(
  NativeRequest.prototype,
  "headers",
)?.get;
const stringToLowerCase = String.prototype.toLowerCase;
const stringStartsWith = String.prototype.startsWith;
const HEADER_NAME_PATTERN = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/;
const MAX_DYNAMIC_DENY_HEADERS = 32;
const MAX_DYNAMIC_DENY_HEADER_NAME_LENGTH = 128;

if (typeof requestHeadersGetter !== "function") {
  throw new TypeError("Request.prototype.headers getter is unavailable");
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

export interface ApplicationRequestHeaderOptions {
  readonly denyHeaders?: readonly string[];
}

function normalizeDynamicDenyHeaders(
  names: readonly string[] | undefined,
): ReadonlySet<string> | null {
  if (names === undefined) return new Set<string>();
  if (!Array.isArray(names) || names.length > MAX_DYNAMIC_DENY_HEADERS) return null;

  const denylist = new Set<string>();
  for (let index = 0; index < names.length; index += 1) {
    const name = names[index];
    if (
      typeof name !== "string" ||
      name.length === 0 ||
      name.length > MAX_DYNAMIC_DENY_HEADER_NAME_LENGTH ||
      !HEADER_NAME_PATTERN.test(name)
    ) {
      return null;
    }
    denylist.add(apply(stringToLowerCase, name, []) as string);
  }
  return denylist;
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
      if (!dynamicDenyHeaders.has(normalized) && !isInfrastructureOnlyRequestHeader(name)) {
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
