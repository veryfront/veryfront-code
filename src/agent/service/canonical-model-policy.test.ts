import { runWithVeryfrontCloudContextAsync } from "#veryfront/provider/veryfront-cloud/context.ts";
import { readVeryfrontCloudModelFacts } from "#veryfront/provider/veryfront-cloud/model-catalog.ts";
import { veryfrontCloudCatalogScopeKey } from "#veryfront/provider/veryfront-cloud/catalog-client.ts";
import "#veryfront/schemas/_test-setup.ts";
import {
  assertEquals,
  assertExists,
  assertRejects,
  assertThrows,
} from "#veryfront/testing/assert.ts";
import { __runWithOutboundFetchTransportForTests } from "#veryfront/security/http/outbound-fetch.ts";
import { __resetVeryfrontCloudCatalogForTests } from "#veryfront/provider/veryfront-cloud/catalog-client.ts";
import { invocation, options, signedRequest } from "./broker-ingress.test-helpers.ts";
import { parseBrokerRuntimeAgentIngress } from "./broker-ingress.ts";
import { prepareCanonicalBrokerModel } from "./canonical-model-policy.ts";

const limits = { maxCalls: 10, maxConcurrentCalls: 2, maxOutputTokens: 4096, maxSteps: 20 };
const model = {
  id: "claude-sonnet-test",
  modelId: "anthropic/claude-sonnet-test",
  provider: "anthropic",
  aliases: ["sonnet-test"],
  surface: "anthropic",
  supportedProviderTools: ["web_search"],
  capabilities: { limit: { output: 2048 } },
};
async function ingress(token = "consumer-inference", selected = "sonnet-test") {
  const signed = await signedRequest(invocation({
    agentConfig: {
      id: "builder",
      name: "Builder",
      description: "Test",
      instructions: "Review",
      model: selected,
      providerTools: ["web_search", "web_fetch"],
      maxSteps: 5,
    },
    credentials: {
      authToken: "api-auth-token",
      sourceAuthToken: "source-read-token",
      inferenceAuthToken: token,
    },
  }));
  return await parseBrokerRuntimeAgentIngress(signed.request, options(signed.publicKeyPem));
}
async function withCatalog<T>(
  work: (requests: Request[]) => Promise<T>,
  rows: unknown[] | ((request: Request) => unknown[]) = [model],
) {
  __resetVeryfrontCloudCatalogForTests();
  const requests: Request[] = [];
  const stub = (value: string | URL | Request, init?: RequestInit) => {
    requests.push(new Request(value, init));
    if (!requests[requests.length - 1]!.url.endsWith("/ai/models")) {
      return Promise.resolve(
        Response.json({
          id: "message-test",
          type: "message",
          role: "assistant",
          model: "claude-sonnet-test",
          content: [{ type: "text", text: "ok" }],
          stop_reason: "end_turn",
          usage: { input_tokens: 1, output_tokens: 1 },
        }),
      );
    }
    return Promise.resolve(
      Response.json({
        models: typeof rows === "function" ? rows(requests[requests.length - 1]!) : rows,
      }),
    );
  };
  try {
    return await __runWithOutboundFetchTransportForTests(
      {
        fetch: stub,
        pinnedFetch: (url, _addresses, init) => stub(url, init),
        resolveHost: () => Promise.resolve(["93.184.216.34"]),
      },
      () => work(requests),
      { allowedResolvedAddresses: ["93.184.216.34"] },
    );
  } finally {
    __resetVeryfrontCloudCatalogForTests();
  }
}
Deno.test("canonical model preparation uses only consuming inference scope and served native tools", async () => {
  const input = await ingress();
  await withCatalog(async (requests) => {
    const policy = await prepareCanonicalBrokerModel({
      ingress: input,
      apiBaseUrl: "https://93.184.216.34/api",
      signal: new AbortController().signal,
      limits,
    });
    assertEquals(requests.length, 1);
    assertEquals(requests[0]!.headers.get("authorization"), "Bearer consumer-inference");
    assertEquals(policy.modelId, "veryfront-cloud/anthropic/claude-sonnet-test");
    assertEquals(policy.model.grant.models.get(policy.modelId)?.maxOutputTokens, 2048);
    assertEquals(policy.maxOutputTokens, undefined);
    assertEquals(policy.maxSteps, 5);
    assertEquals(policy.providerToolNames, ["web_search"]);
    assertEquals(policy.model.grant.models.size, 1);
    assertEquals(policy.model.resolver("veryfront-cloud/openai/foreign"), undefined);
    assertEquals(JSON.stringify(policy).includes("consumer-inference"), false);
    assertExists(policy.model.resolver(policy.modelId));
    policy.cleanup();
    assertThrows(() => policy.model.resolver(policy.modelId), TypeError);
  });
});
Deno.test("canonical model preparation refuses missing inference authority before transport", async () => {
  const input = await ingress();
  await withCatalog(async (requests) => {
    await assertRejects(() =>
      prepareCanonicalBrokerModel({
        ingress: {
          ...input,
          privateAuthority: { ...input.privateAuthority, inferenceAuthToken: undefined },
        },
        apiBaseUrl: "https://93.184.216.34/api",
        signal: new AbortController().signal,
        limits,
      })
    );
    assertEquals(requests.length, 0);
  });
});
Deno.test("canonical model preparation refuses unlisted and ambiguous model identities", async () => {
  const input = await ingress("consumer-inference", "not-shared");
  await withCatalog(async () => {
    await assertRejects(() =>
      prepareCanonicalBrokerModel({
        ingress: input,
        apiBaseUrl: "https://93.184.216.34/api",
        signal: new AbortController().signal,
        limits,
      })
    );
  });
  const ambiguous = await ingress();
  await withCatalog(async () => {
    await assertRejects(() =>
      prepareCanonicalBrokerModel({
        ingress: ambiguous,
        apiBaseUrl: "https://93.184.216.34/api",
        signal: new AbortController().signal,
        limits,
      })
    );
  }, [model, { ...model, id: "other", modelId: "anthropic/other" }]);
});
Deno.test("canonical model authority retires with cancellation and accepts no implicit quota", async () => {
  const input = await ingress();
  await withCatalog(async (requests) => {
    await assertRejects(
      () =>
        prepareCanonicalBrokerModel({
          ingress: input,
          apiBaseUrl: "https://93.184.216.34/api",
          signal: new AbortController().signal,
          limits: { ...limits, maxCalls: 0 },
        }),
      TypeError,
    );
    assertEquals(requests.length, 0);
    const controller = new AbortController();
    const policy = await prepareCanonicalBrokerModel({
      ingress: input,
      apiBaseUrl: "https://93.184.216.34/api",
      signal: controller.signal,
      limits,
    });
    controller.abort();
    assertThrows(() => policy.model.resolver(policy.modelId));
    policy.cleanup();
  });
});

Deno.test("canonical model catalogs remain isolated between consuming credentials", async () => {
  const first = await ingress("consumer-one");
  const second = await ingress("consumer-two");
  await withCatalog(async (requests) => {
    const policy = await prepareCanonicalBrokerModel({
      ingress: first,
      apiBaseUrl: "https://93.184.216.34/api",
      signal: new AbortController().signal,
      limits,
    });
    policy.cleanup();
    await assertRejects(() =>
      prepareCanonicalBrokerModel({
        ingress: second,
        apiBaseUrl: "https://93.184.216.34/api",
        signal: new AbortController().signal,
        limits,
      })
    );
    assertEquals(requests.map((request) => request.headers.get("authorization")), [
      "Bearer consumer-one",
      "Bearer consumer-two",
    ]);
  }, (request) => request.headers.get("authorization") === "Bearer consumer-one" ? [model] : []);
});

Deno.test("canonical output overrides do not consume the model reasoning allowance twice", async () => {
  const base = await ingress();
  const input = {
    ...base,
    executor: {
      ...base.executor,
      input: {
        ...base.executor.input,
        forwardedProps: { runtimeOverrides: { maxOutputTokens: 512 } },
      },
    },
  };
  await withCatalog(async () => {
    const policy = await prepareCanonicalBrokerModel({
      ingress: input,
      apiBaseUrl: "https://93.184.216.34/api",
      signal: new AbortController().signal,
      limits,
    });
    assertEquals(policy.maxOutputTokens, 512);
    assertEquals(policy.model.grant.models.get(policy.modelId)?.maxOutputTokens, 2048);
    policy.cleanup();
  });
});

Deno.test("canonical inference retains consuming scope despite a different ambient project", async () => {
  const input = await ingress();
  await withCatalog(async (requests) => {
    const policy = await prepareCanonicalBrokerModel({
      ingress: input,
      apiBaseUrl: "https://93.184.216.34/api",
      signal: new AbortController().signal,
      limits,
    });
    try {
      await runWithVeryfrontCloudContextAsync({
        apiBaseUrl: "https://ambient.invalid",
        apiToken: "ambient-token",
        projectSlug: "ambient-other",
      }, async () => {
        const runtime = policy.model.resolver(policy.modelId);
        assertExists(runtime);
        assertEquals(
          readVeryfrontCloudModelFacts(runtime)?.catalogScopeKey,
          veryfrontCloudCatalogScopeKey({
            apiBaseUrl: "https://93.184.216.34/api",
            apiToken: "consumer-inference",
            projectSlug: input.executor.run.project.projectSlug,
          }),
        );
        await runtime.doGenerate({
          prompt: [{ role: "user", content: [{ type: "text", text: "hi" }] }],
        });
      });
      assertEquals(requests.some((request) => !request.url.endsWith("/ai/models")), true);
      assertEquals(
        requests.every((request) =>
          request.headers.get("x-veryfront-project-slug") === input.executor.run.project.projectSlug
        ),
        true,
      );
      assertEquals(
        requests.every((request) =>
          request.headers.get("authorization") === "Bearer consumer-inference"
        ),
        true,
      );
    } finally {
      policy.cleanup();
    }
  });
});
