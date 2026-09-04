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
  isHostAllowedInternalProviderOrigin,
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

  it(
    "is not fooled by a poisoned Set.prototype.has into treating every origin as host-allowed",
    async () => {
      const privateAddress = "10.42.0.5";
      const wrappedFetch = createVeryfrontCloudFetch("vf_test_provider", INTERNAL_API_BASE_URL);
      const originalSetHas = Set.prototype.has;
      // deno-lint-ignore no-explicit-any
      (Set.prototype as any).has = () => true;
      try {
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
      } finally {
        Set.prototype.has = originalSetHas;
      }
    },
  );

  it(
    "is not aborted by a poisoned Array iterator when parsing a nonempty allowlist",
    async () => {
      // Exercises isHostAllowedInternalProviderOrigin directly rather than through
      // the full createVeryfrontCloudFetch/Request pipeline: Deno's own Headers
      // iteration is itself backed by Array.prototype[Symbol.iterator], so poisoning
      // it around a real fetch call would also break unrelated, out-of-scope Request
      // construction -- this isolates the allowlist-parsing fix under test here.
      await withEnv(
        {
          [HOST_ALLOWED_INTERNAL_PROVIDER_ORIGINS_ENV]:
            "http://some-service.some-namespace.svc.cluster.local",
        },
        // deno-lint-ignore require-await
        async () => {
          const originalIterator = Array.prototype[Symbol.iterator];
          // deno-lint-ignore no-explicit-any
          (Array.prototype as any)[Symbol.iterator] = () => {
            throw new Error("poisoned iterator reached");
          };
          try {
            assertEquals(
              isHostAllowedInternalProviderOrigin(
                new URL("http://some-service.some-namespace.svc.cluster.local/ai/gateway"),
              ),
              true,
            );
          } finally {
            Array.prototype[Symbol.iterator] = originalIterator;
          }
        },
      );
    },
  );

  it(
    "is not aborted by a poisoned URL.prototype.toString when resolving the request against the origin-bound base",
    async () => {
      const privateAddress = "10.42.0.5";
      let capturedRequest: Request | undefined;
      const wrappedFetch = createVeryfrontCloudFetch("vf_test_provider", INTERNAL_API_BASE_URL);
      const originalToString = URL.prototype.toString;
      URL.prototype.toString = function () {
        throw new Error("poisoned URL.toString reached");
      };
      try {
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
                // Reads `.href` rather than passing `url` itself to `new Request`, which
                // would coerce it through the very `.toString()` this test poisons --
                // that coercion happens in the (untouched) worker-egress-guard/pinned-fetch
                // plumbing, not in the outbound-fetch.ts code path under test here.
                pinnedFetch: (url, _addresses, init) => {
                  capturedRequest = new Request(url.href, init);
                  return Promise.resolve(new Response(null, { status: 204 }));
                },
                resolveHost: () => Promise.resolve([privateAddress]),
              },
              () => wrappedFetch(`${INTERNAL_API_BASE_URL}/chat/completions`),
            ),
        );
      } finally {
        URL.prototype.toString = originalToString;
      }

      assertEquals(capturedRequest?.url, `${INTERNAL_API_BASE_URL}/chat/completions`);
    },
  );

  it(
    "is not fooled by a poisoned Array.prototype.push into dropping allowlist entries",
    async () => {
      const originalPush = Array.prototype.push;
      // deno-lint-ignore no-explicit-any
      (Array.prototype as any).push = function () {
        return 0;
      };
      try {
        await withEnv(
          {
            [HOST_ALLOWED_INTERNAL_PROVIDER_ORIGINS_ENV]:
              "http://some-service.some-namespace.svc.cluster.local",
          },
          // deno-lint-ignore require-await
          async () => {
            assertEquals(
              isHostAllowedInternalProviderOrigin(
                new URL("http://some-service.some-namespace.svc.cluster.local/ai/gateway"),
              ),
              true,
            );
          },
        );
      } finally {
        Array.prototype.push = originalPush;
      }
    },
  );

  it(
    "is not fooled by an inherited Array.prototype index setter into swallowing a parsed entry",
    async () => {
      const originalDescriptor = Object.getOwnPropertyDescriptor(Array.prototype, "0");
      let setterCalledWith: unknown;
      Object.defineProperty(Array.prototype, "0", {
        configurable: true,
        set(value) {
          setterCalledWith = value;
        },
        get() {
          return undefined;
        },
      });
      try {
        await withEnv(
          {
            [HOST_ALLOWED_INTERNAL_PROVIDER_ORIGINS_ENV]:
              "http://some-service.some-namespace.svc.cluster.local",
          },
          // deno-lint-ignore require-await
          async () => {
            assertEquals(setterCalledWith, undefined);
            assertEquals(
              isHostAllowedInternalProviderOrigin(
                new URL("http://some-service.some-namespace.svc.cluster.local/ai/gateway"),
              ),
              true,
            );
          },
        );
      } finally {
        if (originalDescriptor) {
          Object.defineProperty(Array.prototype, "0", originalDescriptor);
        } else {
          delete (Array.prototype as Record<PropertyKey, unknown>)["0"];
        }
      }
    },
  );
});
