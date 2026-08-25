/**
 * Default-arm proxy-topology admission for privileged local controls.
 *
 * These cases cannot live beside the unit under test. `isTrustedLocalControlRequest`
 * resolves its default `proxyTopologyTrusted` through `isProxyTopologyTrusted()`
 * (src/security/http/local-control-request.ts), which reads the process
 * environment variable `VERYFRONT_TRUST_FORWARDED_HEADERS` with no injectable
 * seam. Pinning that arm therefore requires mutating real process env, a host
 * effect the colocated unit suite is not allowed to perform. Every arm that
 * accepts an explicit `proxyTopologyTrusted` option stays hermetic in
 * src/security/http/local-control-request.test.ts.
 *
 * @module tests/integration/security/local-control-request-proxy-topology
 */

import { assertEquals } from "#veryfront/testing/assert";
import { describe, it } from "#veryfront/testing/bdd";
import { deleteEnv, getEnv, setEnv } from "#veryfront/platform/compat/process.ts";
import { recordRequestPeerFromTransport } from "#veryfront/platform/adapters/runtime/shared/request-peer.ts";
import { isTrustedLocalControlRequest } from "#veryfront/security/http/local-control-request.ts";

const TRUST_FORWARDED_HEADERS_ENV = "VERYFRONT_TRUST_FORWARDED_HEADERS";

function loopbackRequest(): Request {
  const request = new Request("http://localhost/_dev", {
    headers: { host: "localhost" },
  });
  recordRequestPeerFromTransport(request, {
    runtime: "node",
    transport: "tcp",
    hostname: "127.0.0.1",
  });
  return request;
}

function withProxyTopologyEnv<T>(value: string | undefined, fn: () => T): T {
  const original = getEnv(TRUST_FORWARDED_HEADERS_ENV);
  if (value === undefined) deleteEnv(TRUST_FORWARDED_HEADERS_ENV);
  else setEnv(TRUST_FORWARDED_HEADERS_ENV, value);
  try {
    return fn();
  } finally {
    if (original === undefined) deleteEnv(TRUST_FORWARDED_HEADERS_ENV);
    else setEnv(TRUST_FORWARDED_HEADERS_ENV, original);
  }
}

describe("local control request default proxy topology arm", () => {
  it("consults the process proxy topology when the caller states no preference", () => {
    withProxyTopologyEnv(undefined, () => {
      assertEquals(
        isTrustedLocalControlRequest(loopbackRequest()),
        true,
        "an untrusted proxy topology must admit a transport-authenticated loopback peer by default",
      );
    });

    withProxyTopologyEnv("1", () => {
      assertEquals(
        isTrustedLocalControlRequest(loopbackRequest()),
        false,
        "with a trusted proxy topology configured, the default arm must deny local-control admission because a proxied peer can look like loopback",
      );
    });
  });
});
