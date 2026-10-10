import { assertEquals, assertRejects, assertThrows } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { withEnv } from "#veryfront/testing";
import {
  clearEnvFileValueSource,
  markEnvFileValue,
} from "#veryfront/platform/compat/process/env.ts";
import {
  isHostHttpApiOrigin,
  requireHostPrivateApiHttps,
} from "#veryfront/config/host-api-base.ts";
import {
  __runWithOutboundFetchTransportForTests,
  guardedOutboundFetch,
} from "#veryfront/security/http/outbound-fetch.ts";
import { dispatchIntegrationApiRequest } from "#veryfront/integrations/integration-transport.ts";
import { fetchSandboxUrl } from "#veryfront/sandbox/config.ts";
import { createRunScopedProviderReplayCheckpointPersister } from "#veryfront/internal-agents/provider-replay-checkpoint-persister.ts";
import { createVeryfrontApiTransport } from "#veryfront/platform/adapters/veryfront-api-transport.ts";

const origin = "http://127.0.0.1:4000";

function configured(apiUrl: string | undefined, fn: () => void) {
  return withEnv(
    { VERYFRONT_API_URL: apiUrl ?? "", VERYFRONT_API_BASE_URL: "" },
    async () => fn(),
  );
}

describe("host credential API transport", () => {
  const apiRequests = {
    integration: (url: string) =>
      dispatchIntegrationApiRequest({
        requestUrl: url,
        token: "<TOKEN>",
        signal: new AbortController().signal,
      }),
    sandbox: (url: string) =>
      fetchSandboxUrl(url, { headers: { authorization: "Bearer <TOKEN>" } }),
    tokenStorage: (url: string) =>
      createVeryfrontApiTransport<Response>({
        baseUrl: url,
        getToken: () => "<TOKEN>",
        retry: { maxRetries: 0, initialDelay: 1, maxDelay: 1 },
        outboundPolicy: {},
        onResponse: async (response) => response,
      }).request(url),
  };

  for (const [name, request] of Object.entries(apiRequests)) {
    it(`allows ${name} API requests to host-configured private DNS only`, async () => {
      const service = "http://api.svc.example:4000";
      const calls: string[] = [];
      const fetchImpl: typeof fetch = (input, init) => {
        const received = new Request(input, init);
        calls.push(received.url);
        assertEquals(received.headers.get("authorization"), "Bearer <TOKEN>");
        return Promise.resolve(Response.json({ ok: true }));
      };
      await withEnv({
        VERYFRONT_API_URL: service,
        VERYFRONT_API_BASE_URL: "",
        VERYFRONT_HOST_ALLOW_INTERNAL_EGRESS: "",
        VERYFRONT_HOST_ALLOWED_INTERNAL_PROVIDER_ORIGINS: "",
      }, () =>
        __runWithOutboundFetchTransportForTests({
          fetch: fetchImpl,
          pinnedFetch: (url, _addresses, init) => fetchImpl(url, init),
          resolveHost: () => Promise.resolve(["10.0.0.8"]),
        }, async () => {
          assertEquals(await (await request(`${service}/api/test`)).json(), { ok: true });
          await assertRejects(() => request("http://other.svc.example:4000/api/test"));
          await assertRejects(() => request("http://api.svc.example:4001/api/test"));
          await assertRejects(() => guardedOutboundFetch(`${service}/api/test`));
          assertEquals(calls, [`${service}/api/test`]);
        }));
    });

    it(`rejects ${name} API redirects without forwarding credentials`, async () => {
      const service = "http://api.svc.example:4000";
      const calls: string[] = [];
      const fetchImpl: typeof fetch = (input) => {
        calls.push(String(input));
        return Promise.resolve(
          new Response(null, {
            status: 302,
            headers: { location: "http://other.svc.example:4000/collect" },
          }),
        );
      };
      await withEnv({
        VERYFRONT_API_URL: service,
        VERYFRONT_API_BASE_URL: "",
        VERYFRONT_HOST_ALLOW_INTERNAL_EGRESS: "",
      }, () =>
        __runWithOutboundFetchTransportForTests({
          fetch: fetchImpl,
          pinnedFetch: (url, _addresses, init) => fetchImpl(url, init),
          resolveHost: () => Promise.resolve(["10.0.0.8"]),
        }, async () => {
          await assertRejects(() => request(`${service}/api/redirect`));
          assertEquals(calls, [`${service}/api/redirect`]);
        }));
    });
  }

  it("persists replay checkpoints to the approved private API and rejects redirects", async () => {
    const service = "http://api.svc.example:4000";
    const calls: string[] = [];
    let redirect = false;
    const fetchImpl: typeof fetch = (input, init) => {
      const request = new Request(input, init);
      calls.push(request.url);
      assertEquals(request.headers.get("authorization"), "Bearer <TOKEN>");
      return Promise.resolve(
        redirect
          ? new Response(null, {
            status: 307,
            headers: { location: "http://other.svc.example/collect" },
          })
          : Response.json({ latestEventId: 1, appendedCount: 1 }),
      );
    };
    await withEnv({
      VERYFRONT_API_URL: service,
      VERYFRONT_API_BASE_URL: "",
      VERYFRONT_HOST_ALLOW_INTERNAL_EGRESS: "",
    }, () =>
      __runWithOutboundFetchTransportForTests({
        fetch: fetchImpl,
        pinnedFetch: (url, _addresses, init) => fetchImpl(url, init),
        resolveHost: () => Promise.resolve(["10.0.0.8"]),
      }, async () => {
        const persist = createRunScopedProviderReplayCheckpointPersister({
          apiUrl: service,
          runId: "run_checkpoint",
          runEventAppendToken: "<TOKEN>",
        })!;
        const checkpoint = {
          version: 1 as const,
          messageId: "10000000-1000-4000-8000-100000000001",
          provider: "anthropic" as const,
          providerBlocks: [],
          providerBlockPositions: [],
          providerMessageBlockCounts: [],
          totalPartCount: 0,
        };
        await persist(checkpoint);
        redirect = true;
        await assertRejects(() => persist(checkpoint));
        assertEquals(calls, [
          `${service}/runs/run_checkpoint/events`,
          `${service}/runs/run_checkpoint/events`,
        ]);
      }));
  });

  it("accepts either host-configured API origin", async () => {
    await withEnv({ VERYFRONT_API_URL: "", VERYFRONT_API_BASE_URL: `${origin}/api` }, async () => {
      assertEquals(requireHostPrivateApiHttps(origin), origin);
    });
    await withEnv(
      { VERYFRONT_API_URL: "https://api.example", VERYFRONT_API_BASE_URL: origin },
      async () => {
        assertEquals(requireHostPrivateApiHttps(origin), origin);
      },
    );
    await withEnv(
      {
        VERYFRONT_API_URL: "https://api.example",
        VERYFRONT_API_BASE_URL: "http://user:pass@127.0.0.1:4000",
      },
      async () => assertThrows(() => requireHostPrivateApiHttps(origin), TypeError),
    );
  });

  it("accepts an operator-approved HTTP service origin", async () => {
    for (const value of ["http://api.svc.example:4000", "http://192.168.1.1:4000"]) {
      await configured(value, () => assertEquals(requireHostPrivateApiHttps(value), value));
    }
  });

  it("accepts the explicitly configured numeric loopback API origin", async () => {
    await configured(
      origin,
      () => assertEquals(requireHostPrivateApiHttps(`${origin}/api`), `${origin}/api`),
    );
  });

  it("requires HTTPS by default", async () => {
    await configured(undefined, () => {
      assertThrows(() => requireHostPrivateApiHttps(origin), TypeError);
      assertEquals(
        requireHostPrivateApiHttps("https://api.example/api"),
        "https://api.example/api",
      );
    });
  });

  it("does not authorize another port or hostname", async () => {
    await configured(origin, () => {
      for (
        const value of [
          "http://127.0.0.1:4001",
          "http://localhost:4000",
          "http://192.168.1.1:4000",
          "http://api.example:4000",
          `blob:${origin}/id`,
          "not-a-url",
          "http://[",
          "/api",
        ]
      ) {
        assertThrows(() => requireHostPrivateApiHttps(value), TypeError);
      }
    });
  });

  it("rejects malformed host API values", async () => {
    for (
      const value of [
        "true",
        "ftp://127.0.0.1:4000",
        "http://user:pass@127.0.0.1:4000",
        "http://:pass@127.0.0.1:4000",
        `${origin}?x=1`,
        `${origin}#x`,
      ]
    ) {
      await configured(
        value,
        () => assertThrows(() => requireHostPrivateApiHttps(origin), TypeError),
      );
    }
  });

  it("does not redirect a configured API credential to another origin", async () => {
    await configured(
      "https://api.example",
      () => assertThrows(() => requireHostPrivateApiHttps(origin), TypeError),
    );
  });

  it("rejects an API origin supplied by a project env file", async () => {
    await configured(origin, () => {
      markEnvFileValue("VERYFRONT_API_URL");
      try {
        assertThrows(() => requireHostPrivateApiHttps(origin), TypeError);
      } finally {
        clearEnvFileValueSource("VERYFRONT_API_URL");
      }
    });
  });
  it("supports the explicitly configured IPv6 loopback origin", async () => {
    const value = "http://[::1]:4000";
    await configured(value, () => assertEquals(requireHostPrivateApiHttps(value), value));
  });

  it("rejects embedded credentials on an otherwise approved origin", async () => {
    await configured(
      origin,
      () => {
        for (const credentials of ["user:pass", ":pass"]) {
          assertThrows(
            () => requireHostPrivateApiHttps(`http://${credentials}@127.0.0.1:4000/api`),
            TypeError,
          );
        }
      },
    );
  });

  it("does not invoke project-replaced URL getters or the global constructor", async () => {
    await configured(origin, () => {
      const original = Object.getOwnPropertyDescriptor(URL.prototype, "origin")!;
      const originalUrl = globalThis.URL;
      let calls = 0;
      Object.defineProperty(URL.prototype, "origin", {
        configurable: true,
        get() {
          calls++;
          return origin;
        },
      });
      Object.defineProperty(globalThis, "URL", {
        configurable: true,
        value: class {
          constructor() {
            calls++;
          }
        },
      });
      try {
        assertEquals(requireHostPrivateApiHttps(`${origin}/api`), `${origin}/api`);
        assertThrows(() => requireHostPrivateApiHttps("http://attacker.example"), TypeError);
        assertEquals(calls, 0);
      } finally {
        Object.defineProperty(globalThis, "URL", {
          configurable: true,
          writable: true,
          value: originalUrl,
        });
        Object.defineProperty(originalUrl.prototype, "origin", original);
      }
    });
  });

  it("does not invoke project-replaced array iterators when checking API origins", async () => {
    await configured(origin, () => {
      const original = Array.prototype[Symbol.iterator];
      let calls = 0;
      let accepted = false;
      let rejected = false;
      Array.prototype[Symbol.iterator] = function () {
        calls++;
        throw new Error("Project iterator must not run");
      };
      try {
        accepted = isHostHttpApiOrigin(origin);
        rejected = !isHostHttpApiOrigin("http://attacker.example");
      } finally {
        Array.prototype[Symbol.iterator] = original;
      }
      assertEquals([accepted, rejected, calls], [true, true, 0]);
    });
  });
});
