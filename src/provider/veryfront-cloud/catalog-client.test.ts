import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { isDeno } from "#veryfront/platform/compat/runtime.ts";
import { afterEach, beforeEach, describe, it } from "#veryfront/testing/bdd.ts";
import { __runWithOutboundFetchTransportForTests } from "#veryfront/security/http/outbound-fetch.ts";
import {
  HEADER_METHODS,
  installCredentialProbes,
} from "#veryfront/security/http/credential-probes.test-helpers.ts";
import { SERVED_MODEL_ROWS } from "./catalog-client.test-helpers.ts";
import {
  __resetVeryfrontCloudCatalogForTests,
  loadVeryfrontCloudCatalog,
} from "./catalog-client.ts";

const BEARER_TOKEN = "vf_catalog_bearer_8b42";
const API_BASE_URL = "https://93.184.216.34/api";

// A documentation address the stub transport answers for; nothing is dialled.
const STUB_ADDRESS = "93.184.216.34";

/** Run `fn` with the host outbound transport answered by `stub`, in process. */
function withStubTransport<T>(
  stub: (input: URL | Request | string, init?: RequestInit) => Promise<Response>,
  fn: () => Promise<T>,
): Promise<T> {
  return __runWithOutboundFetchTransportForTests(
    {
      fetch: stub,
      pinnedFetch: (url, _addresses, init) => stub(url, init),
      resolveHost: () => Promise.resolve([STUB_ADDRESS]),
    },
    fn,
    { allowedResolvedAddresses: [STUB_ADDRESS] },
  );
}

// Probe tests pin what Deno 2.7.7's own Request and fetch call through the
// live prototypes; Node's undici and Bun take different internal paths.
const DENO_INTERNALS = { ignore: !isDeno };

describe("provider/veryfront-cloud/catalog-client", () => {
  beforeEach(__resetVeryfrontCloudCatalogForTests);
  afterEach(__resetVeryfrontCloudCatalogForTests);

  it(
    "loads the catalog without a patched intrinsic seeing the bearer",
    DENO_INTERNALS,
    async () => {
      // The mock stands in for native fetch, so it reads with the originals.
      const headersGet = Headers.prototype.get;
      let sent: { authorization: string | null; method: string; url: string } | undefined;
      // Everything but Headers has/append, which native fetch calls with the
      // headers as `this`; replacing those makes the load refuse (next test).
      const probes = installCredentialProbes({
        headerMethods: HEADER_METHODS.filter((name) => name !== "has" && name !== "append"),
      });
      let catalog;
      try {
        catalog = await withStubTransport(
          (input: URL | Request | string, init?: RequestInit) => {
            const request = new Request(input, init);
            sent = {
              authorization: Reflect.apply(headersGet, request.headers, ["authorization"]),
              method: request.method,
              url: request.url,
            };
            return Promise.resolve(Response.json({ models: SERVED_MODEL_ROWS }));
          },
          () => loadVeryfrontCloudCatalog({ apiBaseUrl: API_BASE_URL, apiToken: BEARER_TOKEN }),
        );
      } finally {
        probes.restore();
      }

      assertEquals(probes.saw(BEARER_TOKEN), false);
      assertEquals(sent, {
        authorization: `Bearer ${BEARER_TOKEN}`,
        method: "GET",
        url: `${API_BASE_URL}/ai/models`,
      });
      assertEquals((catalog?.models.length ?? 0) > 0, true);
    },
  );

  it("refuses the load once Headers has or append was replaced", DENO_INTERNALS, async () => {
    let transportCalls = 0;
    const probes = installCredentialProbes();
    let catalog;
    try {
      catalog = await withStubTransport(
        () => {
          transportCalls++;
          return Promise.resolve(Response.json({ models: SERVED_MODEL_ROWS }));
        },
        () => loadVeryfrontCloudCatalog({ apiBaseUrl: API_BASE_URL, apiToken: BEARER_TOKEN }),
      );
    } finally {
      probes.restore();
    }

    // A failed load resolves without a catalog rather than rejecting.
    assertEquals(catalog, undefined);
    assertEquals(transportCalls, 0);
    assertEquals(probes.saw(BEARER_TOKEN), false);
  });
});
