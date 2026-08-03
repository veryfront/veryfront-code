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

/** Copy only application-owned headers across the project-code boundary. */
export function createApplicationRequestHeaders(headers: Headers): Headers {
  const applicationHeaders = new NativeHeaders();
  apply(headersForEach, headers, [
    (value: string, name: string) => {
      if (!isInfrastructureOnlyRequestHeader(name)) {
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
export function createApplicationRequest(request: Request): Request {
  const cloned = apply(requestClone, request, []) as Request;
  const headers = apply(requestHeadersGetter!, cloned, []) as Headers;
  return new NativeRequest(cloned, {
    headers: createApplicationRequestHeaders(headers),
  });
}
