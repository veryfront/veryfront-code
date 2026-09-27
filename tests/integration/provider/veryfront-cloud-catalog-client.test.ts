import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { afterEach, describe, it } from "#veryfront/testing/bdd.ts";
import { withMockFetch } from "#veryfront/testing/mock-fetch.ts";
import {
  __resetVeryfrontCloudCatalogForTests,
  __setVeryfrontCloudCatalogClockForTests,
  loadVeryfrontCloudCatalog,
  parseVeryfrontCloudCatalog,
  peekVeryfrontCloudCatalog,
  VERYFRONT_CLOUD_CATALOG_RETRY_MS,
  VERYFRONT_CLOUD_CATALOG_TTL_MS,
} from "#veryfront/provider/veryfront-cloud/catalog-client.ts";
import { servedCatalogPayload } from "#veryfront/provider/veryfront-cloud/catalog-client.test-helpers.ts";

const API_BASE_URL = "https://api.veryfront.com";
const LOAD = { apiBaseUrl: API_BASE_URL, apiToken: "vf_catalog_test", projectSlug: "catalog-test" };

function catalogPayload(defaultModelId: string): Record<string, unknown> {
  return { ...servedCatalogPayload(), defaultModelId };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

/** A fetch stub that answers every request from `respond` and records each one. */
function recordingFetch(respond: () => Response | Promise<Response>): {
  fetch: typeof fetch;
  requests: Request[];
} {
  const requests: Request[] = [];
  return {
    requests,
    fetch: ((input: URL | Request | string, init?: RequestInit) => {
      requests.push(new Request(input, init));
      return Promise.resolve(respond());
    }) as typeof fetch,
  };
}

/** Let a background refresh finish: it settles within one macrotask on a stub fetch. */
function settleBackgroundRefresh(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function useClock(start = 1_000_000): { advance(ms: number): void } {
  let current = start;
  __setVeryfrontCloudCatalogClockForTests(() => current);
  return {
    advance(ms: number) {
      current += ms;
    },
  };
}

describe("provider/veryfront-cloud/catalog-client", () => {
  afterEach(__resetVeryfrontCloudCatalogForTests);

  describe("parseVeryfrontCloudCatalog", () => {
    it("reads the served model facts and the default model", () => {
      const catalog = parseVeryfrontCloudCatalog(servedCatalogPayload());
      const sonnet = catalog?.models.find((model) => model.id === "claude-sonnet-4-6");
      const gpt = catalog?.models.find((model) => model.id === "gpt-5.5");
      const mistral = catalog?.models.find((model) => model.id === "mistral-small-2503");

      assertEquals(catalog?.defaultModelId, "mistral/mistral-small-2503");
      assertEquals(sonnet?.surface, "anthropic");
      assertEquals(sonnet?.operations, ["messages"]);
      assertEquals(sonnet?.reasoningBudgetTokens, 2048);
      assertEquals(sonnet?.aliases.includes("sonnet"), true);
      assertEquals(gpt?.transport, "chat-completions");
      assertEquals(gpt?.chatCompletionsReasoningWithFunctionTools, false);
      assertEquals(mistral?.chatCompletionsConsecutiveSystemMessages, true);
    });

    it("reads a field an older API does not serve as absent", () => {
      const catalog = parseVeryfrontCloudCatalog({
        models: [{
          id: "gpt-x",
          modelId: "openai/gpt-x",
          provider: "openai",
          surface: "openai",
          capabilities: { thinking: true },
        }],
      });

      assertEquals(catalog?.defaultModelId, undefined);
      assertEquals(catalog?.models.length, 1);
      assertEquals(catalog?.models[0]?.operations, undefined);
      assertEquals(catalog?.models[0]?.reasoningBudgetTokens, undefined);
      assertEquals(catalog?.models[0]?.chatCompletionsConsecutiveSystemMessages, undefined);
      assertEquals(catalog?.models[0]?.aliases, []);
    });

    it("skips malformed rows and ignores invalid field values", () => {
      const catalog = parseVeryfrontCloudCatalog({
        models: [
          null,
          { id: "no-model-id", provider: "openai" },
          {
            id: "gpt-y",
            modelId: "openai/gpt-y",
            provider: "openai",
            operations: ["responses", 7],
            capabilities: { reasoning_budget_tokens: 1.5, transport: 3 },
          },
        ],
      });

      assertEquals(catalog?.models.map((model) => model.id), ["gpt-y"]);
      assertEquals(catalog?.models[0]?.operations, ["responses"]);
      assertEquals(catalog?.models[0]?.reasoningBudgetTokens, undefined);
      assertEquals(catalog?.models[0]?.transport, undefined);
    });

    it("returns undefined for a payload without a model list", () => {
      assertEquals(parseVeryfrontCloudCatalog({ error: "nope" }), undefined);
      assertEquals(parseVeryfrontCloudCatalog("[]"), undefined);
    });
  });

  describe("loadVeryfrontCloudCatalog", () => {
    it("is cold until the first load, then serves the loaded catalog synchronously", async () => {
      const stub = recordingFetch(() => jsonResponse(servedCatalogPayload()));
      assertEquals(peekVeryfrontCloudCatalog(), undefined);

      const loaded = await withMockFetch(stub.fetch, () => loadVeryfrontCloudCatalog(LOAD));

      assertEquals(loaded?.defaultModelId, "mistral/mistral-small-2503");
      assertEquals(peekVeryfrontCloudCatalog(), loaded);
      assertEquals(stub.requests.length, 1);
      const [request] = stub.requests;
      assertEquals(request?.method, "GET");
      assertEquals(request?.url, `${API_BASE_URL}/ai/models`);
      assertEquals(request?.headers.get("authorization"), "Bearer vf_catalog_test");
      assertEquals(request?.headers.get("x-veryfront-project-slug"), "catalog-test");
    });

    it("shares one request between concurrent loads for the same key", async () => {
      const stub = recordingFetch(() => jsonResponse(servedCatalogPayload()));

      const [first, second] = await withMockFetch(
        stub.fetch,
        () => Promise.all([loadVeryfrontCloudCatalog(LOAD), loadVeryfrontCloudCatalog(LOAD)]),
      );

      assertEquals(stub.requests.length, 1);
      assertEquals(first, second);
    });

    it("keeps a separate entry per project", async () => {
      const stub = recordingFetch(() => jsonResponse(servedCatalogPayload()));

      await withMockFetch(stub.fetch, async () => {
        await loadVeryfrontCloudCatalog(LOAD);
        await loadVeryfrontCloudCatalog({ ...LOAD, projectSlug: "other-project" });
        await loadVeryfrontCloudCatalog(LOAD);
      });

      assertEquals(
        stub.requests.map((request) => request.headers.get("x-veryfront-project-slug")),
        ["catalog-test", "other-project"],
      );
    });

    it("serves a fresh entry from cache and refreshes a stale one in the background", async () => {
      const clock = useClock();
      let defaultModelId = "mistral/mistral-small-2503";
      const stub = recordingFetch(() => jsonResponse(catalogPayload(defaultModelId)));

      await withMockFetch(stub.fetch, async () => {
        await loadVeryfrontCloudCatalog(LOAD);
        clock.advance(VERYFRONT_CLOUD_CATALOG_TTL_MS - 1);
        await loadVeryfrontCloudCatalog(LOAD);
        assertEquals(stub.requests.length, 1);

        defaultModelId = "anthropic/claude-sonnet-4-6";
        clock.advance(1);
        // Stale: the stale entry answers at once while one refresh runs.
        const stale = await loadVeryfrontCloudCatalog(LOAD);
        assertEquals(stale?.defaultModelId, "mistral/mistral-small-2503");

        await settleBackgroundRefresh();
        assertEquals(stub.requests.length, 2);
        const refreshed = await loadVeryfrontCloudCatalog(LOAD);
        assertEquals(refreshed?.defaultModelId, "anthropic/claude-sonnet-4-6");
        assertEquals(peekVeryfrontCloudCatalog()?.defaultModelId, "anthropic/claude-sonnet-4-6");
        assertEquals(stub.requests.length, 2);
      });
    });

    it("resolves to undefined when the catalog cannot be loaded, and retries later", async () => {
      const clock = useClock();
      let status = 503;
      const stub = recordingFetch(() =>
        status === 200 ? jsonResponse(servedCatalogPayload()) : jsonResponse({}, status)
      );

      await withMockFetch(stub.fetch, async () => {
        assertEquals(await loadVeryfrontCloudCatalog(LOAD), undefined);
        assertEquals(peekVeryfrontCloudCatalog(), undefined);

        status = 200;
        clock.advance(VERYFRONT_CLOUD_CATALOG_RETRY_MS - 1);
        assertEquals(await loadVeryfrontCloudCatalog(LOAD), undefined);
        assertEquals(stub.requests.length, 1);

        clock.advance(1);
        assertEquals(
          (await loadVeryfrontCloudCatalog(LOAD))?.defaultModelId,
          "mistral/mistral-small-2503",
        );
        assertEquals(stub.requests.length, 2);
      });
    });

    it("treats a body without a model list as a failed load", async () => {
      const stub = recordingFetch(() => jsonResponse({ unexpected: true }));

      const loaded = await withMockFetch(stub.fetch, () => loadVeryfrontCloudCatalog(LOAD));

      assertEquals(loaded, undefined);
      assertEquals(peekVeryfrontCloudCatalog(), undefined);
    });

    it("keeps the stale catalog when a refresh fails", async () => {
      const clock = useClock();
      let fail = false;
      const stub = recordingFetch(() => {
        if (fail) return Promise.reject(new TypeError("network down"));
        return jsonResponse(servedCatalogPayload());
      });

      await withMockFetch(stub.fetch, async () => {
        const loaded = await loadVeryfrontCloudCatalog(LOAD);
        fail = true;
        clock.advance(VERYFRONT_CLOUD_CATALOG_TTL_MS);
        await loadVeryfrontCloudCatalog(LOAD);
        await settleBackgroundRefresh();
        const afterFailure = await loadVeryfrontCloudCatalog(LOAD);

        assertEquals(stub.requests.length, 2);
        assertEquals(afterFailure, loaded);
        assertEquals(peekVeryfrontCloudCatalog(), loaded);
      });
    });
  });
});
