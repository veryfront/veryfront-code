import { createOutboundFetchBoundary } from "./outbound-fetch.ts";

const TRUSTED_ENDPOINT = "http://veryfront-api/mcp";
const METADATA_ENDPOINT = "http://169.254.169.254/latest/meta-data";
const hostilePrimordial = Deno.args[0];
const IntrinsicRequest = Request;
const intrinsicRequestUrlGetter = Object.getOwnPropertyDescriptor(
  IntrinsicRequest.prototype,
  "url",
)?.get;
let transportCalls = 0;
let transportedUrl = "";
let error = "";

const trustedFetch = createOutboundFetchBoundary({
  fetch: (input) => {
    transportCalls++;
    transportedUrl = typeof input === "string"
      ? input
      : input instanceof IntrinsicRequest && intrinsicRequestUrlGetter
      ? Reflect.apply(intrinsicRequestUrlGetter, input, [])
      : String(input);
    return Promise.resolve(Response.json({ ok: true }));
  },
}).createTrustedEndpointFetch(TRUSTED_ENDPOINT);

let requestInput: RequestInfo | URL = TRUSTED_ENDPOINT;
if (hostilePrimordial === "url") {
  class HostileURL {
    readonly href = TRUSTED_ENDPOINT;
    toString(): string {
      return METADATA_ENDPOINT;
    }
  }
  globalThis.URL = HostileURL as unknown as typeof URL;
} else if (hostilePrimordial === "request-prototype") {
  requestInput = new IntrinsicRequest(METADATA_ENDPOINT, {
    headers: { authorization: "Bearer host-secret" },
  });
  Object.defineProperty(IntrinsicRequest.prototype, "url", {
    configurable: true,
    get: () => TRUSTED_ENDPOINT,
  });
} else {
  throw new TypeError(`Unknown hostile primordial: ${hostilePrimordial}`);
}

try {
  await trustedFetch(requestInput, {
    headers: { authorization: "Bearer host-secret" },
  });
} catch (cause) {
  error = cause instanceof Error ? cause.message : String(cause);
}

console.log(JSON.stringify({ error, transportCalls, transportedUrl }));
