import "#veryfront/schemas/_test-setup.ts";
import { assert, assertEquals, assertThrows } from "#veryfront/testing/assert.ts";
import { afterEach, describe, it } from "#veryfront/testing/bdd.ts";
import { fromError } from "#veryfront/errors";
import { clearModelProviders, registerModelProvider } from "#veryfront/provider";
import type { ModelRuntime } from "#veryfront/provider";
import { resolveModelWithCredential } from "#veryfront/provider/model-registry.ts";
import type { ResolvedModelTransport } from "../types.ts";
import {
  requestsCredential,
  routeModelBeforeHook,
  settleCredentialModel,
} from "./model-transport-credential.ts";
import { isImplicitAgentModel } from "./model-resolution.ts";

const SECRET = "sk-agent-policies";
const DIRECT = "openai/gpt-5.4";
const HOSTED = "veryfront-cloud/openai/gpt-5.4";

function customRuntime(modelId: string): ModelRuntime {
  return {
    provider: "custom",
    modelId,
    doGenerate: () => Promise.resolve({}),
    doStream: () => Promise.resolve({ stream: new ReadableStream<unknown>() }),
  };
}

function settle(
  transport: ResolvedModelTransport | undefined,
  overrides: Partial<Parameters<typeof settleCredentialModel>[0]> = {},
): string {
  return settleCredentialModel({
    agentId: "policies",
    transport,
    routed: { modelString: HOSTED },
    implicitModel: false,
    directModel: () => DIRECT,
    ...overrides,
  });
}

function configErrorOf(fn: () => unknown): Error {
  const error = assertThrows(fn);
  assert(error instanceof Error);
  assertEquals(fromError(error)?.type, "config");
  assertEquals(error.message.includes(SECRET), false);
  return error;
}

describe("model transport hook credential", () => {
  afterEach(() => clearModelProviders());

  it("treats a returned credential property as a request, whatever its value", () => {
    assertEquals(requestsCredential({ credential: SECRET }), true);
    assertEquals(requestsCredential({ credential: undefined }), true);
    assertEquals(requestsCredential({ headers: { "x-a": "1" } }), false);
    assertEquals(requestsCredential(undefined), false);
    assertEquals(requestsCredential(null), false);
  });

  it("tells the hook the routed model when routing succeeds", () => {
    const routed = routeModelBeforeHook({
      route: () => HOSTED,
      directModel: () => DIRECT,
      hasHook: true,
    });
    assertEquals(routed, { modelString: HOSTED });
  });

  it("holds a routing refusal for the hook when the model names a direct provider", () => {
    const refusal = new Error("retired");
    const routed = routeModelBeforeHook({
      route: () => {
        throw refusal;
      },
      directModel: () => DIRECT,
      hasHook: true,
    });
    assertEquals(routed, { modelString: DIRECT, refusal });
  });

  it("keeps a routing refusal without a hook or without a direct provider", () => {
    const refuse = () => {
      throw new Error("retired");
    };
    assertThrows(
      () => routeModelBeforeHook({ route: refuse, directModel: () => DIRECT, hasHook: false }),
      Error,
      "retired",
    );
    assertThrows(
      () => routeModelBeforeHook({ route: refuse, directModel: () => undefined, hasHook: true }),
      Error,
      "retired",
    );
  });

  it("keeps the routed model when the hook returns no credential", () => {
    assertEquals(settle(undefined), HOSTED);
    assertEquals(settle({ headers: { "x-a": "1" } }), HOSTED);
  });

  it("rethrows a held refusal when the hook returns no credential", () => {
    const refusal = new Error("retired");
    assertThrows(
      () => settle({ headers: {} }, { routed: { modelString: DIRECT, refusal } }),
      Error,
      "retired",
    );
  });

  it("sends a credentialed call to the direct provider, past a held refusal", () => {
    assertEquals(settle({ credential: SECRET }), DIRECT);
    assertEquals(
      settle({ credential: SECRET }, {
        routed: { modelString: DIRECT, refusal: new Error("retired") },
      }),
      DIRECT,
    );
  });

  it("keeps the routed model when the agent's model names no direct provider", () => {
    assertEquals(
      settle({ credential: SECRET }, {
        routed: { modelString: "local/qwen" },
        directModel: () => undefined,
      }),
      "local/qwen",
    );
  });

  it("rejects a credential alongside a hook-supplied model runtime", () => {
    configErrorOf(() => settle({ credential: SECRET, model: customRuntime("m") }));
  });

  it("rejects a credential for an omitted or auto model", () => {
    assertEquals(isImplicitAgentModel(undefined), true);
    assertEquals(isImplicitAgentModel(""), true);
    assertEquals(isImplicitAgentModel("auto"), true);
    assertEquals(isImplicitAgentModel(DIRECT), false);
    const error = configErrorOf(() =>
      settle({ credential: SECRET }, { routed: { modelString: DIRECT }, implicitModel: true })
    );
    assert(error.message.includes("explicit"));
  });

  for (
    const model of [
      "openai/gpt-5.4",
      "anthropic/claude-haiku-4-5",
      "google/gemini-2.5-flash",
      "mistral/mistral-small-latest",
    ]
  ) {
    it(`builds a ${model.split("/")[0]} runtime from the credential alone`, () => {
      const runtime = resolveModelWithCredential(model, SECRET);
      assertEquals(typeof runtime.doGenerate, "function");
      assertEquals(Deno.inspect(runtime, { depth: 8 }).includes(SECRET), false);
    });
  }

  for (
    const [label, credential] of [
      ["undefined", undefined],
      ["empty", ""],
      ["padded", ` ${SECRET} `],
      ["non-ASCII", "sk-agent-é"],
      ["oversized", `sk-${"a".repeat(9000)}`],
      ["non-string", 42],
    ] as const
  ) {
    it(`rejects a ${label} credential without naming it`, () => {
      configErrorOf(() => resolveModelWithCredential(DIRECT, credential));
    });
  }

  it("rejects a credential for providers that cannot take one", () => {
    configErrorOf(() => resolveModelWithCredential("local/qwen3.5-0.8b", SECRET));
    configErrorOf(() => resolveModelWithCredential(HOSTED, SECRET));
    registerModelProvider("gateway", (id) => customRuntime(id));
    configErrorOf(() => resolveModelWithCredential("gateway/model-a", SECRET));
    registerModelProvider("openai", (id) => customRuntime(id));
    configErrorOf(() => resolveModelWithCredential(DIRECT, SECRET));
  });
});
