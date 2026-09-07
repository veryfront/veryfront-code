import "#veryfront/schemas/_test-setup.ts";
import { assert, assertEquals, assertRejects, assertThrows } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { withMockFetch } from "#veryfront/testing/mock-fetch.ts";
import { withEnv } from "#veryfront/testing/deno-compat.ts";
import {
  HOST_ALLOWED_INTERNAL_PROVIDER_ORIGINS_ENV,
  HOST_INTERNAL_EGRESS_OVERRIDE_ENV,
} from "#veryfront/security/http/outbound-fetch.ts";
import { setEnv } from "#veryfront/compat/process.ts";
import { runWithRequestContext } from "#veryfront/platform/adapters/fs/veryfront/request-context.ts";
import {
  getCurrentVeryfrontCloudContext,
  runWithVeryfrontCloudContext,
} from "#veryfront/provider/veryfront-cloud/context.ts";
import { ensureBuiltinLLMProviders } from "#veryfront/extensions/builtin-extensions.ts";
import { revokeModelRuntimeResolver } from "#veryfront/agent/runtime/model-transport.ts";
import { createHostedApplicationModelResolver } from "#veryfront/agent/hosted/application-model-resolver.ts";
import {
  createVeryfrontCloudInferenceModel,
  createVeryfrontCloudModel,
} from "#veryfront/provider/veryfront-cloud/provider.ts";
import { createExecutorChannel } from "#veryfront/agent/executor/channel.ts";
import { createExecutorModelRuntimeResolver } from "#veryfront/agent/hosted/executor-model-bridge.ts";
import { createEphemeralHostedExecutorModelBroker } from "#veryfront/agent/hosted/executor-model-dispatch.ts";
import { runWithMandatoryRunEventSink } from "#veryfront/runtime/run-event-sink-context.ts";

const modelId = "veryfront-cloud/openai/gpt-4o";
const binding = { allocationId: "allocation-test", generation: 1, invocationId: "invocation-test" };
const appToken = "synthetic-application-token";
const prompt = [{ role: "user", content: [{ type: "text", text: "Synthetic prompt" }] }] as const;

function resolverOptions(projectSlug?: string) {
  const lifetime = new AbortController();
  return {
    authToken: appToken,
    apiBaseUrl: "https://example.com",
    allowedModelIds: new Set([modelId]),
    projectSlug,
    scope: {
      binding,
      signal: lifetime.signal,
      assertActive() {
        lifetime.signal.throwIfAborted();
      },
    },
  };
}

function response(stream: boolean): Response {
  return stream
    ? new Response(
      'data: {"choices":[{"delta":{"content":"Synthetic answer"}}]}\n\ndata: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n',
      { headers: { "content-type": "text/event-stream" } },
    )
    : new Response(
      JSON.stringify({
        choices: [{
          message: { role: "assistant", content: "Synthetic answer" },
          finish_reason: "stop",
        }],
        usage: { prompt_tokens: 1, completion_tokens: 1 },
      }),
      { headers: { "content-type": "application/json" } },
    );
}

async function drain(stream: ReadableStream<unknown>) {
  const reader = stream.getReader();
  while (!(await reader.read()).done) { /* Read the first-party stream without network. */ }
  reader.releaseLock();
}

describe("hosted ordinary application model resolver", () => {
  it("rejects untrusted HTTP gateways before creating application model authority", async () => {
    await withEnv({
      [HOST_ALLOWED_INTERNAL_PROVIDER_ORIGINS_ENV]: "",
      [HOST_INTERNAL_EGRESS_OVERRIDE_ENV]: "",
    }, () => {
      for (
        const apiBaseUrl of [
          "http://gateway.example.test",
          "http://gateway.internal.example:4000",
          "http://localhost.example.test:4000",
          "http://0.0.0.0:4000",
        ]
      ) {
        assertThrows(
          () => createHostedApplicationModelResolver({ ...resolverOptions(), apiBaseUrl }),
          TypeError,
          "HTTPS",
        );
      }
      return Promise.resolve();
    });
  });

  it("preserves HTTPS and exact loopback gateways for application models", async () => {
    await withEnv({
      [HOST_ALLOWED_INTERNAL_PROVIDER_ORIGINS_ENV]: "",
      [HOST_INTERNAL_EGRESS_OVERRIDE_ENV]: "",
    }, () => {
      for (
        const apiBaseUrl of [
          "https://gateway.example.test/api",
          "http://localhost:4000/api",
          "http://127.0.0.1:4000/api",
          "http://[::1]:4000/api",
        ]
      ) {
        const resolver = createHostedApplicationModelResolver({ ...resolverOptions(), apiBaseUrl });
        try {
          assert(resolver(modelId));
        } finally {
          revokeModelRuntimeResolver(resolver);
        }
      }
      return Promise.resolve();
    });
  });

  it("requires exact host approval for an internal HTTP gateway origin", async () => {
    await withEnv({
      [HOST_ALLOWED_INTERNAL_PROVIDER_ORIGINS_ENV]: "http://gateway.internal.example:4000",
      [HOST_INTERNAL_EGRESS_OVERRIDE_ENV]: "",
    }, () => {
      const resolver = createHostedApplicationModelResolver({
        ...resolverOptions(),
        apiBaseUrl: "http://gateway.internal.example:4000/api",
      });
      try {
        assert(resolver(modelId));
      } finally {
        revokeModelRuntimeResolver(resolver);
      }
      for (
        const apiBaseUrl of [
          "http://gateway.internal.example:4001/api",
          "http://other.internal.example:4000/api",
          "http://gateway.example.test/api",
        ]
      ) {
        assertThrows(
          () => createHostedApplicationModelResolver({ ...resolverOptions(), apiBaseUrl }),
          TypeError,
          "HTTPS",
        );
      }
      return Promise.resolve();
    });
  });

  it("uses explicit application auth and clears ambient request, host, project, and billing context", async () => {
    setEnv("VERYFRONT_API_TOKEN", "synthetic-host-token");
    setEnv("VERYFRONT_PROJECT_SLUG", "synthetic-host-project");
    const observed: {
      auth: string | null;
      project: string | null;
      billing: string | null;
      url: string;
      scopedToken: string | undefined;
    }[] = [];
    await withMockFetch(async (input, init) => {
      const request = new Request(input, init);
      observed.push({
        auth: request.headers.get("authorization"),
        project: request.headers.get("x-veryfront-project-slug"),
        billing: request.headers.get("x-veryfront-billing-group-id"),
        url: request.url,
        scopedToken: getCurrentVeryfrontCloudContext()?.apiToken,
      });
      const body = await request.json();
      return response(body.stream === true);
    }, async () => {
      await runWithRequestContext({
        projectSlug: "synthetic-filesystem-project",
        token: "synthetic-filesystem-token",
      }, async () => {
        await runWithVeryfrontCloudContext({
          apiBaseUrl: "https://ambient.example.com",
          apiToken: "synthetic-ambient-token",
          projectSlug: "synthetic-ambient-project",
          billingGroupId: "synthetic-ambient-billing",
        }, async () => {
          const resolver = createHostedApplicationModelResolver(resolverOptions());
          const model = resolver(modelId)!;
          assertEquals(resolver(modelId), model);
          await model.doGenerate({ prompt });
          const streamed = await model.doStream({ prompt });
          await drain(streamed.stream);
          assertEquals(getCurrentVeryfrontCloudContext()?.apiToken, "synthetic-ambient-token");
        });
      });
    });
    assertEquals(observed.length, 2);
    for (const request of observed) {
      assertEquals(request.auth, `Bearer ${appToken}`);
      assertEquals(request.project, null);
      assertEquals(request.billing, null);
      assertEquals(request.scopedToken, appToken);
      assert(request.url.startsWith("https://example.com/ai/gateway/openai/"));
    }
  });

  it("keeps forced first-party application requests out of replaceable provider registrations", async () => {
    const registry = ensureBuiltinLLMProviders();
    const original = registry.require("openai");
    let projectCalls = 0;
    registry.unregister("openai");
    registry.register({
      id: "openai",
      createModel() {
        projectCalls++;
        throw new Error("Synthetic project provider must not run");
      },
    });
    try {
      await withMockFetch(async (input, init) => {
        const request = new Request(input, init);
        assertEquals(request.headers.get("authorization"), `Bearer ${appToken}`);
        assertEquals(request.headers.get("x-veryfront-project-slug"), "bound-project");
        assertEquals(request.headers.get("x-veryfront-billing-group-id"), "bound-billing");
        return response(false);
      }, async () => {
        const resolver = createHostedApplicationModelResolver({
          ...resolverOptions("bound-project"),
          billingGroupId: "bound-billing",
        });
        await resolver(modelId)!.doGenerate({ prompt });
      });
      assertEquals(projectCalls, 0);
    } finally {
      registry.unregister("openai");
      registry.register(original);
    }
  });

  it("scopes lazy stream reads and owner-triggered cancellation to application context", async () => {
    const owner = new AbortController();
    const contexts: (string | undefined)[] = [];
    let cancellationContext: string | undefined;
    let reads = 0;
    await withMockFetch(() =>
      Promise.resolve(
        new Response(
          new ReadableStream<Uint8Array>({
            pull(controller) {
              contexts.push(getCurrentVeryfrontCloudContext()?.apiToken);
              if (reads++ === 0) {
                controller.enqueue(
                  new TextEncoder().encode(
                    'data: {"choices":[{"delta":{"content":"Synthetic answer"}}]}\n\n',
                  ),
                );
              }
            },
            cancel() {
              cancellationContext = getCurrentVeryfrontCloudContext()?.apiToken;
            },
          }, { highWaterMark: 0 }),
          { headers: { "content-type": "text/event-stream" } },
        ),
      ), async () => {
      const resolver = createHostedApplicationModelResolver({
        ...resolverOptions(),
        scope: {
          binding,
          signal: owner.signal,
          assertActive() {
            owner.signal.throwIfAborted();
          },
        },
      });
      const model = resolver(modelId)!;
      const { stream } = await model.doStream({ prompt });
      await runWithVeryfrontCloudContext({ apiToken: "synthetic-other-reader" }, async () => {
        const reader = stream.getReader();
        await reader.read();
        let closed = false;
        const closure = reader.closed.catch(() => {
          closed = true;
        });
        owner.abort();
        try {
          await new Promise<void>((resolve) => setTimeout(resolve, 0));
          assertEquals(closed, true);
          await closure;
        } finally {
          await reader.cancel().catch(() => {});
        }
      });
    });
    assert(contexts.length > 0);
    assert(contexts.every((value) => value === appToken));
    assertEquals(cancellationContext, appToken);
  });

  it("keeps application authority in the broker during paired ephemeral generation and streaming", async () => {
    const input = resolverOptions();
    const applicationResolver = createHostedApplicationModelResolver(input);
    let appends = 0;
    let requests = 0;
    const wire: string[] = [];
    const transport = () =>
      new TransformStream<Uint8Array, Uint8Array>({
        transform(bytes, controller) {
          wire.push(new TextDecoder().decode(bytes));
          controller.enqueue(bytes);
        },
      });
    await withMockFetch(async (requestInput, init) => {
      requests++;
      const request = new Request(requestInput, init);
      assertEquals(request.headers.get("authorization"), `Bearer ${appToken}`);
      assert(request.url.startsWith("https://example.com/ai/gateway/openai/"));
      const body = await request.json();
      return response(body.stream === true);
    }, async () => {
      await runWithMandatoryRunEventSink(() => {
        appends++;
      }, async () => {
        const forward = transport();
        const backward = transport();
        const caller = createExecutorChannel({
          binding,
          transport: { readable: backward.readable, writable: forward.writable },
        });
        const broker = createExecutorChannel({
          binding,
          transport: { readable: forward.readable, writable: backward.writable },
          operations: createEphemeralHostedExecutorModelBroker({
            resolveModelRuntime: applicationResolver,
            allowedModelIds: input.allowedModelIds,
            scope: input.scope,
            prepared: { conversationId: null, canonicalRootRun: null },
          }),
        });
        try {
          const resolver = await createExecutorModelRuntimeResolver({
            channel: caller,
            allowedModelIds: input.allowedModelIds,
          });
          const model = resolver(modelId)!;
          await model.doGenerate({ prompt });
          await drain((await model.doStream({ prompt })).stream);
          revokeModelRuntimeResolver(applicationResolver);
          await assertRejects(
            async () => await model.doGenerate({ prompt }),
            Error,
            "operation-failed",
          );
          assertEquals(requests, 2);
          assertEquals(appends, 0);
          assertEquals(wire.join("").includes(appToken), false);
        } finally {
          caller.close();
          await broker.closed;
        }
      });
    });
  });

  it("guards cached first-party metadata reconciliation under the same authority", async () => {
    const googleId = "veryfront-cloud/google/gemini-synthetic";
    const resolver = createHostedApplicationModelResolver({
      ...resolverOptions(),
      allowedModelIds: new Set([googleId]),
    });
    const model = resolver(googleId)!;
    const reconcile = model._reconcileProviderMetadata;
    assert(typeof reconcile === "function");
    assertEquals(await reconcile({ providerMetadata: {}, suppressedToolCalls: [] }), {});
    revokeModelRuntimeResolver(resolver);
    await assertRejects(async () =>
      await reconcile({ providerMetadata: {}, suppressedToolCalls: [] })
    );
  });

  it("preserves ordinary and signed credential selection in the existing factories", async () => {
    const tokens: (string | null)[] = [];
    await withMockFetch(async (input, init) => {
      const request = new Request(input, init);
      tokens.push(request.headers.get("authorization"));
      return response(false);
    }, async () => {
      await runWithVeryfrontCloudContext({
        apiBaseUrl: "https://example.com",
        apiToken: appToken,
        projectSlug: "",
      }, async () => {
        await createVeryfrontCloudModel("openai/gpt-4o").doGenerate({ prompt });
        await createVeryfrontCloudInferenceModel("openai/gpt-4o", "synthetic-inference-authority", {
          apiBaseUrl: "https://example.com",
        }).doGenerate({ prompt });
      });
    });
    assertEquals(tokens, [`Bearer ${appToken}`, "Bearer synthetic-inference-authority"]);
  });

  it("refuses ambient bootstrap fallback in the explicit application factory policy", () => {
    setEnv("VERYFRONT_API_TOKEN", "synthetic-host-token");
    for (
      const context of [
        { apiBaseUrl: "https://example.com", projectSlug: "" },
        { apiToken: appToken, projectSlug: "" },
        { apiBaseUrl: "https://example.com", apiToken: appToken },
      ]
    ) {
      assertThrows(() =>
        runWithVeryfrontCloudContext(context, () =>
          createVeryfrontCloudModel("openai/gpt-4o", {
            credentialSource: "application",
            providerSelection: "first-party",
          }))
      );
    }
  });

  it("revokes cached model methods and rejects missing auth or unknown managed IDs", async () => {
    const options = resolverOptions();
    for (const authToken of [undefined, "", " ", "a".repeat(8193)]) {
      assertThrows(() => createHostedApplicationModelResolver({ ...options, authToken }));
    }
    const resolver = createHostedApplicationModelResolver(options);
    const model = resolver(modelId)!;
    assertThrows(() => resolver("veryfront-cloud/openai/other"));
    assertEquals(resolver("project/custom"), undefined);
    revokeModelRuntimeResolver(resolver);
    await assertRejects(async () => await model.prepare?.());
    await assertRejects(async () => await model.doGenerate({ prompt }));
    await assertRejects(async () => await model.doStream({ prompt }));
    assertThrows(() => resolver(modelId));
  });
});
