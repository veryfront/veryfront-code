import "#veryfront/schemas/_test-setup.ts";
import { assert, assertEquals, assertRejects } from "#veryfront/testing/assert.ts";
import { afterEach, describe, it } from "#veryfront/testing/bdd.ts";
import { installMockFetch, restoreMockFetch } from "#veryfront/testing/mock-fetch.ts";
import { deleteEnv, setEnv } from "#veryfront/compat/process.ts";
import { fromError } from "#veryfront/errors";
import { clearModelProviders, registerModelProvider } from "#veryfront/provider";
import type { ModelRuntime } from "#veryfront/provider";
import type { AgentConfig, ResolvedModelTransport } from "../../../../../../src/agent/types.ts";
import { resolveAgentModelTransport } from "../../../../../../src/agent/runtime/model-transport.ts";

const ENV_KEYS = [
  "OPENAI_API_KEY",
  "OPENAI_BASE_URL",
  "ANTHROPIC_API_KEY",
  "GOOGLE_API_KEY",
  "GOOGLE_GENERATIVE_AI_API_KEY",
  "MISTRAL_API_KEY",
  "VERYFRONT_API_TOKEN",
  "VERYFRONT_API_TOKEN_FILE",
  "VERYFRONT_PROJECT_SLUG",
] as const;

const PROCESS_KEY = "sk-process-key";
const MODEL = "openai/gpt-5.4-nano";

function customRuntime(modelId: string): ModelRuntime {
  return {
    provider: "custom",
    modelId,
    async doGenerate() {
      return {};
    },
    async doStream() {
      return { stream: new ReadableStream<unknown>() };
    },
  };
}

function agentConfig(
  model: string,
  transport?: ResolvedModelTransport,
): AgentConfig {
  return {
    model,
    system: "You are a helpful assistant.",
    ...(transport ? { resolveModelTransport: () => transport } : {}),
  };
}

function resolveFor(agentId: string, config: AgentConfig) {
  return resolveAgentModelTransport({
    agentId,
    config,
    context: undefined,
    mode: "generate",
    modelOverride: undefined,
  });
}

interface CapturedRequest {
  url: string;
  authorization: string;
  headers: Headers;
}

/** Capture the `authorization` header of every provider request. */
function captureAuthorization(status = 200): string[] {
  const seen: string[] = [];
  captureRequests(status, (request) => seen.push(request.authorization));
  return seen;
}

/** Capture every outgoing request and answer it as the OpenAI Responses API. */
function captureRequests(
  status = 200,
  onRequest?: (request: CapturedRequest) => void,
): CapturedRequest[] {
  const seen: CapturedRequest[] = [];
  installMockFetch(
    (async (input: URL | Request | string, init?: RequestInit) => {
      const request = new Request(input, init);
      const captured = {
        url: request.url,
        authorization: request.headers.get("authorization") ?? "",
        headers: request.headers,
      };
      seen.push(captured);
      onRequest?.(captured);
      if (status !== 200) {
        return new Response(
          JSON.stringify({ error: { message: "Incorrect API key provided" } }),
          { status, headers: { "content-type": "application/json" } },
        );
      }
      return new Response(
        JSON.stringify({
          id: "resp_1",
          object: "response",
          status: "completed",
          output: [{
            id: "msg_1",
            type: "message",
            role: "assistant",
            status: "completed",
            content: [{ type: "output_text", text: "ok" }],
          }],
          usage: { input_tokens: 4, output_tokens: 2, total_tokens: 6 },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }) as typeof fetch,
  );
  return seen;
}

async function callModel(agentId: string, config: AgentConfig): Promise<void> {
  const transport = await resolveFor(agentId, config);
  await transport.languageModel.doGenerate({
    prompt: [{ role: "user", content: [{ type: "text", text: "hi" }] }],
    headers: transport.headers,
  });
}

describe("resolveAgentModelTransport hook credential", () => {
  afterEach(() => {
    restoreMockFetch();
    for (const key of ENV_KEYS) {
      try {
        deleteEnv(key);
      } catch {
        // expected: env may already be unset
      }
    }
    clearModelProviders();
  });

  it("lets two agents on one built-in provider send different bearer credentials", async () => {
    setEnv("OPENAI_API_KEY", PROCESS_KEY);
    const seen = captureAuthorization();

    await callModel("policies", agentConfig(MODEL, { credential: "sk-agent-policies" }));
    await callModel("billing", agentConfig(MODEL, { credential: "sk-agent-billing" }));

    assertEquals(seen, ["Bearer sk-agent-policies", "Bearer sk-agent-billing"]);
  });

  it("uses the hook credential for that call only", async () => {
    setEnv("OPENAI_API_KEY", PROCESS_KEY);
    const seen = captureAuthorization();

    await callModel("policies", agentConfig(MODEL, { credential: "sk-agent-policies" }));
    await callModel("plain", agentConfig(MODEL));
    await callModel("hook-without-credential", agentConfig(MODEL, { headers: { "x-a": "1" } }));

    assertEquals(seen, [
      "Bearer sk-agent-policies",
      `Bearer ${PROCESS_KEY}`,
      `Bearer ${PROCESS_KEY}`,
    ]);
  });

  it("keeps the credential authoritative over a hook authorization header", async () => {
    setEnv("OPENAI_API_KEY", PROCESS_KEY);
    const seen = captureAuthorization();

    await callModel(
      "policies",
      agentConfig(MODEL, {
        credential: "sk-agent-policies",
        headers: { authorization: "Bearer sk-from-header" },
      }),
    );

    assertEquals(seen, ["Bearer sk-agent-policies"]);
  });

  it("does not expose the credential on the resolved transport or in provider errors", async () => {
    setEnv("OPENAI_API_KEY", PROCESS_KEY);
    const secret = "sk-agent-do-not-leak";
    const seen = captureAuthorization(401);

    const transport = await resolveFor("policies", agentConfig(MODEL, { credential: secret }));
    assertEquals("credential" in transport, false);
    assertEquals(Deno.inspect(transport, { depth: 8 }).includes(secret), false);
    assertEquals(JSON.stringify(transport).includes(secret), false);

    const error = await assertRejects(async () => {
      await transport.languageModel.doGenerate({
        prompt: [{ role: "user", content: [{ type: "text", text: "hi" }] }],
      });
    });
    assertEquals(seen, [`Bearer ${secret}`]);
    assertEquals(Deno.inspect(error, { depth: 8 }).includes(secret), false);
  });

  for (
    const [label, credential] of [
      ["empty", ""],
      ["padded", " sk-agent-padded "],
      ["non-ASCII", "sk-agent-é"],
      ["oversized", `sk-${"a".repeat(9000)}`],
      ["non-string", 42 as unknown as string],
    ] as const
  ) {
    it(`rejects a ${label} credential with a typed error that omits the value`, async () => {
      setEnv("OPENAI_API_KEY", PROCESS_KEY);
      const seen = captureAuthorization();

      const error = await assertRejects(() =>
        resolveFor("policies", agentConfig(MODEL, { credential }))
      );

      assertEquals(fromError(error)?.type, "config");
      assert(error instanceof Error);
      if (typeof credential === "string" && credential.trim().length > 0) {
        assertEquals(error.message.includes(credential.trim()), false);
      }
      assertEquals(seen, []);
    });
  }

  it("rejects a returned credential property whose value is undefined", async () => {
    setEnv("OPENAI_API_KEY", PROCESS_KEY);
    const seen = captureAuthorization();

    const error = await assertRejects(() =>
      resolveFor("policies", agentConfig(MODEL, { credential: undefined }))
    );

    assertEquals(fromError(error)?.type, "config");
    assertEquals(seen, []);
  });

  it("authenticates with the hook credential alone when no provider key is set", async () => {
    const seen = captureAuthorization();

    await callModel("policies", agentConfig(MODEL, { credential: "sk-agent-policies" }));

    assertEquals(seen, ["Bearer sk-agent-policies"]);
  });

  // Without a provider key, Veryfront Cloud rewrites the first model and
  // refuses the second as retired. A hook credential calls the provider either way.
  for (const model of ["openai/gpt-5.4", MODEL]) {
    it(`calls the provider directly when Veryfront Cloud would take keyless ${model}`, async () => {
      setEnv("VERYFRONT_API_TOKEN", "vf_test_credential");
      setEnv("VERYFRONT_PROJECT_SLUG", "credential-project");
      const requests = captureRequests();

      const transport = await resolveFor(
        "policies",
        agentConfig(model, { credential: "sk-agent-policies" }),
      );
      assertEquals(transport.resolvedModelString, model);
      await transport.languageModel.doGenerate({
        prompt: [{ role: "user", content: [{ type: "text", text: "hi" }] }],
        headers: transport.headers,
      });

      const providerCalls = requests.filter((request) => request.url.includes("/responses"));
      assertEquals(providerCalls.map((request) => request.authorization), [
        "Bearer sk-agent-policies",
      ]);
      assertEquals(new URL(providerCalls[0]!.url).host, "api.openai.com");
    });
  }

  it("keeps Veryfront Cloud routing when the hook returns no credential", async () => {
    setEnv("VERYFRONT_API_TOKEN", "vf_test_credential");
    setEnv("VERYFRONT_PROJECT_SLUG", "credential-project");
    captureRequests();

    const transport = await resolveFor(
      "policies",
      agentConfig("openai/gpt-5.4", { headers: { "x-a": "1" } }),
    );

    assertEquals(transport.resolvedModelString, "veryfront-cloud/openai/gpt-5.4");
  });

  it("keeps the Veryfront Cloud refusal when the hook returns no credential", async () => {
    setEnv("VERYFRONT_API_TOKEN", "vf_test_credential");
    setEnv("VERYFRONT_PROJECT_SLUG", "credential-project");
    captureRequests();

    const error = await assertRejects(() =>
      resolveFor("policies", agentConfig(MODEL, { headers: { "x-a": "1" } }))
    );

    assert(error instanceof Error);
    assert(error.message.includes("no longer available through Veryfront Cloud"));
  });

  it("still rejects a credential for an omitted model that Veryfront Cloud serves", async () => {
    setEnv("VERYFRONT_API_TOKEN", "vf_test_credential");
    setEnv("VERYFRONT_PROJECT_SLUG", "credential-project");
    captureRequests();

    const error = await assertRejects(() =>
      resolveFor("policies", {
        system: "You are a helpful assistant.",
        resolveModelTransport: () => ({ credential: "sk-agent-policies" }),
      })
    );

    assertEquals(fromError(error)?.type, "config");
  });

  for (
    const [model, envKey, header, expected] of [
      ["anthropic/claude-haiku-4-5", "ANTHROPIC_API_KEY", "x-api-key", "sk-agent-policies"],
      ["google/gemini-2.5-flash", "GOOGLE_API_KEY", "x-goog-api-key", "sk-agent-policies"],
      [
        "mistral/mistral-small-latest",
        "MISTRAL_API_KEY",
        "authorization",
        "Bearer sk-agent-policies",
      ],
    ] as const
  ) {
    it(`sends the hook credential to ${model.split("/")[0]} instead of the environment key`, async () => {
      setEnv(envKey, PROCESS_KEY);
      const requests = captureRequests();

      const transport = await resolveFor(
        "policies",
        agentConfig(model, {
          credential: "sk-agent-policies",
          headers: { [header]: "sk-from-header" },
        }),
      );
      // The mock answers in another provider's shape; only the request matters.
      await transport.languageModel.doGenerate({
        prompt: [{ role: "user", content: [{ type: "text", text: "hi" }] }],
        headers: transport.headers,
      }).catch(() => {});

      assertEquals(requests.length, 1);
      assertEquals(requests[0]!.headers.get(header), expected);
      const sent = `${requests[0]!.url} ${JSON.stringify([...requests[0]!.headers])}`;
      assertEquals(sent.includes(PROCESS_KEY), false);
      assertEquals(sent.includes("sk-from-header"), false);
    });
  }

  it("rejects a credential alongside a hook-supplied model runtime", async () => {
    setEnv("OPENAI_API_KEY", PROCESS_KEY);

    const error = await assertRejects(() =>
      resolveFor(
        "policies",
        agentConfig(MODEL, { credential: "sk-agent-policies", model: customRuntime(MODEL) }),
      )
    );

    assertEquals(fromError(error)?.type, "config");
  });

  it("rejects a credential for a provider the application registered itself", async () => {
    registerModelProvider("gateway", (id) => customRuntime(id));

    const error = await assertRejects(() =>
      resolveFor("policies", agentConfig("gateway/model-a", { credential: "sk-agent-policies" }))
    );

    assertEquals(fromError(error)?.type, "config");
    assert(error instanceof Error);
    assertEquals(error.message.includes("sk-agent-policies"), false);
  });

  it("rejects a credential for an application override of a built-in provider", async () => {
    setEnv("OPENAI_API_KEY", PROCESS_KEY);
    registerModelProvider("openai", (id) => customRuntime(id));

    const error = await assertRejects(() =>
      resolveFor("policies", agentConfig(MODEL, { credential: "sk-agent-policies" }))
    );

    assertEquals(fromError(error)?.type, "config");
  });

  it("rejects a credential for a provider that takes none", async () => {
    const error = await assertRejects(() =>
      resolveFor(
        "policies",
        agentConfig("local/qwen3.5-0.8b", { credential: "sk-agent-policies" }),
      )
    );

    assertEquals(fromError(error)?.type, "config");
  });
});
