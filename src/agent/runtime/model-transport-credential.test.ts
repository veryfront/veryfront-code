import "#veryfront/schemas/_test-setup.ts";
import { assert, assertEquals, assertRejects } from "#veryfront/testing/assert.ts";
import { afterEach, describe, it } from "#veryfront/testing/bdd.ts";
import { installMockFetch, restoreMockFetch } from "#veryfront/testing/mock-fetch.ts";
import { deleteEnv, setEnv } from "#veryfront/compat/process.ts";
import { fromError } from "#veryfront/errors";
import { clearModelProviders, registerModelProvider } from "#veryfront/provider";
import type { ModelRuntime } from "#veryfront/provider";
import type { AgentConfig, ResolvedModelTransport } from "../types.ts";
import { resolveAgentModelTransport } from "./model-transport.ts";

const ENV_KEYS = [
  "OPENAI_API_KEY",
  "OPENAI_BASE_URL",
  "ANTHROPIC_API_KEY",
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

/** Capture the `authorization` header of every provider request. */
function captureAuthorization(status = 200): string[] {
  const seen: string[] = [];
  installMockFetch(
    (async (input: URL | Request | string, init?: RequestInit) => {
      const request = new Request(input, init);
      seen.push(request.headers.get("authorization") ?? "");
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
