// These tests mutate the host process environment and the shared outbound
// fetch transport, so they belong in the semantic integration suite rather
// than a hermetic unit module.
import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertRejects } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { withEnv } from "#veryfront/testing";
import {
  __runWithOutboundFetchTransportForTests,
  HOST_ALLOWED_INTERNAL_PROVIDER_ORIGINS_ENV,
  OutboundRequestBlockedError,
} from "#veryfront/security/http/outbound-fetch.ts";
import {
  createVeryfrontCloudFetch,
  requireVeryfrontCloudBootstrap,
} from "#veryfront/provider/veryfront-cloud/shared.ts";
import { runWithVeryfrontCloudContext } from "#veryfront/provider/veryfront-cloud/context.ts";

// Fictional placeholder standing in for a real internal-cluster Service DNS
// name -- the ".svc.cluster.local" suffix is what's under test, not any
// specific service or namespace.
const INTERNAL_API_BASE_URL =
  "http://some-service.some-namespace.svc.cluster.local/ai/gateway/openai/v1";

describe("provider/veryfront-cloud internal-provider-origin allowlist boundary", () => {
  it("trusts an internal cluster hostname at the bootstrap-validation layer once host-allowed", async () => {
    await withEnv(
      {
        [HOST_ALLOWED_INTERNAL_PROVIDER_ORIGINS_ENV]:
          "http://some-service.some-namespace.svc.cluster.local",
      },
      async () => {
        const bootstrap = runWithVeryfrontCloudContext(
          { apiBaseUrl: INTERNAL_API_BASE_URL, apiToken: "vf_scoped_token" },
          () => requireVeryfrontCloudBootstrap("vf_scoped_token"),
        );
        assertEquals(bootstrap.apiBaseUrl, INTERNAL_API_BASE_URL);
      },
    );
  });

  it(
    "reaches an internal cluster origin resolving to a private address once host-allowed",
    async () => {
      const privateAddress = "10.42.0.5";
      let capturedRequest: Request | undefined;
      const wrappedFetch = createVeryfrontCloudFetch("vf_test_provider", INTERNAL_API_BASE_URL);

      await withEnv(
        {
          [HOST_ALLOWED_INTERNAL_PROVIDER_ORIGINS_ENV]:
            "http://some-service.some-namespace.svc.cluster.local",
        },
        () =>
          __runWithOutboundFetchTransportForTests(
            {
              fetch: (input, init) => {
                capturedRequest = new Request(input, init);
                return Promise.resolve(new Response(null, { status: 204 }));
              },
              pinnedFetch: (url, _addresses, init) => {
                capturedRequest = new Request(url, init);
                return Promise.resolve(new Response(null, { status: 204 }));
              },
              resolveHost: () => Promise.resolve([privateAddress]),
            },
            () => wrappedFetch(`${INTERNAL_API_BASE_URL}/chat/completions`),
          ),
      );

      assertEquals(capturedRequest?.url, `${INTERNAL_API_BASE_URL}/chat/completions`);
    },
  );

  it(
    "still blocks a private-address origin the host has not added to the internal provider allowlist",
    async () => {
      const privateAddress = "10.42.0.5";
      const wrappedFetch = createVeryfrontCloudFetch("vf_test_provider", INTERNAL_API_BASE_URL);

      await withEnv(
        { [HOST_ALLOWED_INTERNAL_PROVIDER_ORIGINS_ENV]: "" },
        () =>
          assertRejects(
            () =>
              __runWithOutboundFetchTransportForTests(
                {
                  fetch: () => Promise.resolve(new Response(null, { status: 204 })),
                  pinnedFetch: () => Promise.resolve(new Response(null, { status: 204 })),
                  resolveHost: () => Promise.resolve([privateAddress]),
                },
                () => wrappedFetch(`${INTERNAL_API_BASE_URL}/chat/completions`),
              ),
            OutboundRequestBlockedError,
          ),
      );
    },
  );
});
