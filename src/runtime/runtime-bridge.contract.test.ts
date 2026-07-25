import "#veryfront/schemas/_test-setup.ts";
import {
  assert,
  assertEquals,
  assertRejects,
  assertStrictEquals,
} from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { createRuntimeJsonSchema } from "#veryfront/agent/runtime/runtime-tool-builder.ts";
import type { RuntimeGenerateUsage } from "#veryfront/agent/runtime/runtime-tool-types.ts";
import type { ModelRuntime } from "#veryfront/provider/types.ts";
import type { JsonSchema } from "#veryfront/tool/schema";
import { similarity } from "#veryfront/embedding/index.ts";
import { generateText, streamText } from "./runtime-bridge.ts";
import { collectAsync } from "./runtime-bridge.test-helpers.ts";
import { normalizeRuntimeUsage, projectRuntimeStreamUsage } from "./runtime-usage.ts";

type UsagePath = "direct" | "streamed";

type UsageContractCase = {
  name: string;
  usage: unknown;
  expected: RuntimeGenerateUsage | undefined;
};

function readableFrom(parts: readonly unknown[]): ReadableStream<unknown> {
  let index = 0;
  return new ReadableStream({
    pull(controller) {
      if (index >= parts.length) {
        controller.close();
        return;
      }
      controller.enqueue(parts[index++]);
    },
  });
}

function createUsageModel(path: UsagePath, usage: unknown): ModelRuntime {
  const unused = () => Promise.reject(new Error("unused runtime method"));
  if (path === "direct") {
    return {
      provider: "contract",
      modelId: "contract/direct-usage",
      specificationVersion: "v3",
      doGenerate: () =>
        Promise.resolve({
          content: [],
          finishReason: "stop",
          usage,
        }),
      doStream: unused,
    };
  }

  return {
    provider: "contract",
    modelId: "contract/streamed-usage",
    specificationVersion: "v3",
    _generateViaStream: true,
    doGenerate: unused,
    doStream: () =>
      Promise.resolve({
        stream: readableFrom([
          {
            type: "finish",
            finishReason: "stop",
            usage,
          },
        ]),
      }),
  };
}

async function normalizeUsageThrough(
  path: UsagePath,
  usage: unknown,
): Promise<RuntimeGenerateUsage | undefined> {
  const result = await generateText({
    model: createUsageModel(path, usage),
    messages: [{ role: "user", content: "usage contract" }],
  });
  return result.usage;
}

const VALID_TOKEN_USAGE = {
  inputTokens: 4,
  outputTokens: 3,
  totalTokens: 7,
} as const;

const usageContractCases: readonly UsageContractCase[] = [
  {
    name: "drops string token counts instead of trusting a structural cast",
    usage: {
      inputTokens: "4",
      outputTokens: "3",
      totalTokens: "7",
    },
    expected: undefined,
  },
  {
    name: "drops negative token counts",
    usage: {
      inputTokens: -4,
      outputTokens: -3,
      totalTokens: -7,
    },
    expected: undefined,
  },
  {
    name: "drops fractional token counts",
    usage: {
      inputTokens: 4.25,
      outputTokens: 3.5,
      totalTokens: 7.75,
    },
    expected: undefined,
  },
  {
    name: "drops unsafe token counts",
    usage: {
      inputTokens: Number.MAX_SAFE_INTEGER + 1,
      outputTokens: Number.MAX_SAFE_INTEGER + 2,
      totalTokens: Number.MAX_SAFE_INTEGER + 3,
    },
    expected: undefined,
  },
  {
    name: "drops invalid nested token and cache counts without fabricating zero usage",
    usage: {
      inputTokens: {
        total: -1,
        cached: 1.5,
        cacheCreation: Number.MAX_SAFE_INTEGER + 1,
      },
      outputTokens: {
        total: Number.NaN,
        reasoning: Number.POSITIVE_INFINITY,
      },
    },
    expected: undefined,
  },
  {
    name: "drops non-finite and negative costs while retaining valid tokens",
    usage: {
      ...VALID_TOKEN_USAGE,
      costUsd: Number.NaN,
      providerInputCostUsd: Number.POSITIVE_INFINITY,
      providerOutputCostUsd: -0.01,
      providerCostUsd: Number.NEGATIVE_INFINITY,
      veryfrontInputChargeUsd: -0.02,
      veryfrontOutputChargeUsd: Number.NaN,
      veryfrontChargeUsd: Number.POSITIVE_INFINITY,
      veryfrontBilledUsd: -0.03,
      costCredits: -1,
    },
    expected: VALID_TOKEN_USAGE,
  },
  {
    name: "drops invalid billing enums while retaining valid usage",
    usage: {
      ...VALID_TOKEN_USAGE,
      costSource: "provider",
      billingMode: "eventual",
      usageCaptureStatus: "unknown",
    },
    expected: VALID_TOKEN_USAGE,
  },
  {
    name: "raises an underreported total to the valid component sum",
    usage: {
      inputTokens: 4,
      outputTokens: 3,
      totalTokens: 2,
    },
    expected: VALID_TOKEN_USAGE,
  },
  {
    name: "retains a larger valid provider total",
    usage: {
      inputTokens: 4,
      outputTokens: 3,
      totalTokens: 10,
    },
    expected: {
      inputTokens: 4,
      outputTokens: 3,
      totalTokens: 10,
    },
  },
  {
    name: "omits totalTokens when the valid component sum overflows safe integers",
    usage: {
      inputTokens: Number.MAX_SAFE_INTEGER,
      outputTokens: 1,
      totalTokens: Number.MAX_SAFE_INTEGER,
    },
    expected: {
      inputTokens: Number.MAX_SAFE_INTEGER,
      outputTokens: 1,
    },
  },
  {
    name: "maps exact AI SDK provider-v3 cache and reasoning fields",
    usage: {
      inputTokens: {
        total: 11,
        noCache: 6,
        cacheRead: 2,
        cacheWrite: 3,
      },
      outputTokens: {
        total: 7,
        text: 3,
        reasoning: 4,
      },
    },
    expected: {
      inputTokens: 11,
      outputTokens: 7,
      totalTokens: 18,
      cacheCreationInputTokens: 3,
      cacheReadInputTokens: 2,
      cachedInputTokens: 2,
      reasoningTokens: 4,
    },
  },
  {
    name: "maps exact AI SDK v6 token-detail fields before deprecated aliases",
    usage: {
      inputTokens: 11,
      inputTokenDetails: {
        noCacheTokens: 6,
        cacheReadTokens: 2,
        cacheWriteTokens: 3,
      },
      outputTokens: 7,
      outputTokenDetails: {
        textTokens: 3,
        reasoningTokens: 4,
      },
      totalTokens: 18,
      cachedInputTokens: 99,
      reasoningTokens: 99,
    },
    expected: {
      inputTokens: 11,
      outputTokens: 7,
      totalTokens: 18,
      cacheCreationInputTokens: 3,
      cacheReadInputTokens: 2,
      cachedInputTokens: 2,
      reasoningTokens: 4,
    },
  },
  {
    name: "retains legacy nested cache aliases as fallbacks",
    usage: {
      inputTokens: {
        total: 11,
        cached: 2,
        cacheCreation: 3,
      },
      outputTokens: {
        total: 7,
        reasoning: 4,
      },
    },
    expected: {
      inputTokens: 11,
      outputTokens: 7,
      totalTokens: 18,
      cacheCreationInputTokens: 3,
      cacheReadInputTokens: 2,
      cachedInputTokens: 2,
      reasoningTokens: 4,
    },
  },
  {
    name: "preserves valid flat cache, cost, and billing metadata including zero",
    usage: {
      inputTokens: 11,
      outputTokens: 7,
      totalTokens: 20,
      cacheCreationInputTokens: 3,
      cacheReadInputTokens: 2,
      cachedInputTokens: 4,
      reasoningTokens: 2,
      billableInputTokens: 9,
      billableOutputTokens: 6,
      costUsd: 0,
      providerInputCostUsd: 0.01,
      providerOutputCostUsd: 0.02,
      providerCostUsd: 0.03,
      veryfrontInputChargeUsd: 0.04,
      veryfrontOutputChargeUsd: 0.05,
      veryfrontChargeUsd: 0.09,
      veryfrontBilledUsd: 0.09,
      costCredits: 0,
      costSource: "partial",
      billingMode: "deferred",
      usageCaptureStatus: "complete",
    },
    expected: {
      inputTokens: 11,
      outputTokens: 7,
      totalTokens: 20,
      cacheCreationInputTokens: 3,
      cacheReadInputTokens: 2,
      cachedInputTokens: 2,
      reasoningTokens: 2,
      billableInputTokens: 9,
      billableOutputTokens: 6,
      costUsd: 0,
      providerInputCostUsd: 0.01,
      providerOutputCostUsd: 0.02,
      providerCostUsd: 0.03,
      veryfrontInputChargeUsd: 0.04,
      veryfrontOutputChargeUsd: 0.05,
      veryfrontChargeUsd: 0.09,
      veryfrontBilledUsd: 0.09,
      costCredits: 0,
      costSource: "partial",
      billingMode: "deferred",
      usageCaptureStatus: "complete",
    },
  },
  {
    name: "preserves the legacy alias when it is the only valid usage field",
    usage: {
      cachedInputTokens: 7,
    },
    expected: {
      cacheReadInputTokens: 7,
      cachedInputTokens: 7,
    },
  },
  {
    name: "ignores inherited usage fields",
    usage: Object.create({
      inputTokens: 4,
      outputTokens: 3,
      totalTokens: 7,
    }),
    expected: undefined,
  },
];

describe("runtime bridge usage contracts", () => {
  for (const path of ["direct", "streamed"] as const) {
    for (const testCase of usageContractCases) {
      it(`${path}: ${testCase.name}`, async () => {
        assertEquals(
          await normalizeUsageThrough(path, testCase.usage),
          testCase.expected,
        );
      });
    }

    it(`${path}: rejects flat usage accessors without invoking them`, async () => {
      let getterCalls = 0;
      const usage: Record<string, unknown> = {};
      Object.defineProperty(usage, "inputTokens", {
        enumerable: true,
        get() {
          getterCalls++;
          return 4;
        },
      });

      assertEquals(await normalizeUsageThrough(path, usage), undefined);
      assertEquals(getterCalls, 0);
    });

    it(`${path}: rejects nested usage accessors without invoking them`, async () => {
      let getterCalls = 0;
      const inputTokens: Record<string, unknown> = {};
      Object.defineProperty(inputTokens, "total", {
        enumerable: true,
        get() {
          getterCalls++;
          return 4;
        },
      });

      assertEquals(
        await normalizeUsageThrough(path, { inputTokens }),
        undefined,
      );
      assertEquals(getterCalls, 0);
    });

    it(`${path}: drops revoked-proxy usage without aborting generation`, async () => {
      const revoked = Proxy.revocable({}, {});
      revoked.revoke();

      assertEquals(
        await normalizeUsageThrough(path, revoked.proxy),
        undefined,
      );
    });

    it(`${path}: drops malformed usage proxies without consulting get traps`, async () => {
      let getCalls = 0;
      const malformed = new Proxy(
        {},
        {
          get() {
            getCalls++;
            return 4;
          },
          getOwnPropertyDescriptor() {
            throw new TypeError("malformed usage descriptor");
          },
        },
      );

      assertEquals(
        await normalizeUsageThrough(path, malformed),
        undefined,
      );
      assertEquals(getCalls, 0);
    });

    it(`${path}: canonical usage cannot surface polluted usage fields`, async () => {
      for (
        const field of [
          "cacheReadInputTokens",
          "outputTokens",
          "veryfrontBilledUsd",
        ] as const
      ) {
        let getterCalls = 0;
        const originalDescriptor = Object.getOwnPropertyDescriptor(
          Object.prototype,
          field,
        );
        Object.defineProperty(Object.prototype, field, {
          configurable: true,
          get() {
            getterCalls++;
            return 99;
          },
        });

        try {
          const usage = await normalizeUsageThrough(path, { inputTokens: 1 });

          assertEquals(usage, {
            inputTokens: 1,
            totalTokens: 1,
          });
          assertEquals(Object.getPrototypeOf(usage!), null);
          assertEquals(
            (usage as unknown as Record<string, unknown>)[field],
            undefined,
          );
          assertEquals(
            JSON.stringify(usage),
            '{"inputTokens":1,"totalTokens":1}',
          );
        } finally {
          if (originalDescriptor) {
            Object.defineProperty(
              Object.prototype,
              field,
              originalDescriptor,
            );
          } else {
            delete (Object.prototype as Record<string, unknown>)[field];
          }
        }

        assertEquals(getterCalls, 0);
      }
    });
  }

  it("rejects accessor descriptors under prototype pollution without invoking getters", () => {
    let inputGetterCalls = 0;
    let prototypeGetterCalls = 0;
    const inputTokens = Object.defineProperty({}, "total", {
      configurable: true,
      enumerable: true,
      get() {
        inputGetterCalls++;
        return 4;
      },
    });
    const originalValueDescriptor = Object.getOwnPropertyDescriptor(
      Object.prototype,
      "value",
    );

    Object.defineProperty(Object.prototype, "value", {
      configurable: true,
      get() {
        prototypeGetterCalls++;
        return 4;
      },
    });
    try {
      assertEquals(normalizeRuntimeUsage({ inputTokens }), undefined);
    } finally {
      if (originalValueDescriptor) {
        Object.defineProperty(
          Object.prototype,
          "value",
          originalValueDescriptor,
        );
      } else {
        delete (Object.prototype as { value?: unknown }).value;
      }
    }

    assertEquals(inputGetterCalls, 0);
    assertEquals(prototypeGetterCalls, 0);
  });

  it("projects into a canonical record without consulting polluted usage fields", () => {
    for (
      const field of [
        "cacheReadInputTokens",
        "outputTokens",
        "veryfrontBilledUsd",
      ] as const
    ) {
      let getterCalls = 0;
      const originalDescriptor = Object.getOwnPropertyDescriptor(
        Object.prototype,
        field,
      );
      Object.defineProperty(Object.prototype, field, {
        configurable: true,
        get() {
          getterCalls++;
          return 99;
        },
      });

      try {
        const projected = projectRuntimeStreamUsage({
          inputTokens: 1,
          totalTokens: 1,
        });

        assertEquals(projected, { inputTokens: 1 });
        assertEquals(Object.getPrototypeOf(projected), null);
        assertEquals(
          (projected as unknown as Record<string, unknown>)[field],
          undefined,
        );
        assertEquals(JSON.stringify(projected), '{"inputTokens":1}');
      } finally {
        if (originalDescriptor) {
          Object.defineProperty(
            Object.prototype,
            field,
            originalDescriptor,
          );
        } else {
          delete (Object.prototype as Record<string, unknown>)[field];
        }
      }

      assertEquals(getterCalls, 0);
    }
  });
});

describe("runtime stream terminal contracts", () => {
  function truncatedModel(generateViaStream: boolean): ModelRuntime {
    return {
      provider: "contract",
      modelId: "contract/truncated-stream",
      specificationVersion: "v3",
      ...(generateViaStream ? { _generateViaStream: true as const } : {}),
      doGenerate: () => Promise.reject(new Error("unused doGenerate")),
      doStream: () =>
        Promise.resolve({
          stream: readableFrom([
            { type: "text-delta", text: "partial" },
          ]),
        }),
    };
  }

  it("rejects a live stream that ends without finish or error", async () => {
    const result = streamText({
      model: truncatedModel(false),
      messages: [{ role: "user", content: "terminal contract" }],
    });

    await assertRejects(
      () => collectAsync(result.fullStream),
      TypeError,
      "Runtime stream ended without a terminal event",
    );
  });

  it("rejects stream-backed generation that ends without finish or error", async () => {
    await assertRejects(
      () =>
        Promise.resolve(
          generateText({
            model: truncatedModel(true),
            messages: [{ role: "user", content: "terminal contract" }],
          }),
        ),
      TypeError,
      "Runtime stream ended without a terminal event",
    );
  });
});

describe("public cosine similarity contracts", () => {
  const ordinaryCases = [
    {
      name: "identical vectors",
      left: [1, 2, 3],
      right: [1, 2, 3],
      expected: 1,
    },
    {
      name: "orthogonal vectors",
      left: [1, 0],
      right: [0, 1],
      expected: 0,
    },
    {
      name: "opposite vectors",
      left: [1, 0],
      right: [-1, 0],
      expected: -1,
    },
    {
      name: "a zero vector",
      left: [0, 0],
      right: [1, 0],
      expected: 0,
    },
    {
      name: "empty vectors retain the current zero characterization",
      left: [],
      right: [],
      expected: 0,
    },
    {
      name: "dimension mismatch retains the current zero characterization",
      left: [1],
      right: [1, 0],
      expected: 0,
    },
  ] as const;

  for (const testCase of ordinaryCases) {
    it(testCase.name, () => {
      assertEquals(
        similarity([...testCase.left], [...testCase.right]),
        testCase.expected,
      );
    });
  }

  for (
    const testCase of [
      {
        name: "huge finite identical vectors remain stable",
        vector: [Number.MAX_VALUE, Number.MAX_VALUE / 2],
      },
      {
        name: "tiny finite identical vectors remain stable",
        vector: [Number.MIN_VALUE],
      },
    ] as const
  ) {
    it(testCase.name, () => {
      const score = similarity([...testCase.vector], [...testCase.vector]);
      assert(
        Number.isFinite(score) && Math.abs(score - 1) <= Number.EPSILON * 8,
        `Expected a finite similarity near 1, received ${score}`,
      );
    });
  }
});

describe("runtime bridge outbound option contract", () => {
  it("forwards every provider-facing option and preserves falsey values", async () => {
    let captured: Record<string, unknown> | undefined;
    const headers = new Headers([["x-contract-empty", ""]]);
    const providerOptions = {
      contract: {
        enabled: false,
        count: 0,
        label: "",
      },
    };
    const reasoning = { enabled: false, budgetTokens: 0 };
    const stopSequences: string[] = [];
    const abortController = new AbortController();
    const canonicalInputSchema: JsonSchema = {
      type: "object",
      properties: {
        value: { type: "number" },
      },
      required: ["value"],
      additionalProperties: false,
    };
    const modelInputSchema: JsonSchema = {
      type: "object",
      properties: {
        value: { type: "number" },
      },
      additionalProperties: true,
    };
    const runtimeSchema = createRuntimeJsonSchema(
      canonicalInputSchema,
      modelInputSchema,
    );
    const repairToolCall = () => null;
    const model: ModelRuntime = {
      provider: "contract",
      modelId: "contract/outbound-options",
      specificationVersion: "v3",
      doGenerate: () => Promise.reject(new Error("unused doGenerate")),
      doStream: (options) => {
        if (!options || typeof options !== "object" || Array.isArray(options)) {
          throw new TypeError("Expected provider options to be an object");
        }
        captured = options as unknown as Record<string, unknown>;
        return Promise.resolve({
          stream: readableFrom([
            {
              type: "finish",
              finishReason: "stop",
              usage: VALID_TOKEN_USAGE,
            },
          ]),
        });
      },
    };

    const result = streamText({
      model,
      system: "System contract",
      messages: [{ role: "user", content: "Outbound contract" }],
      tools: {
        calculate: {
          type: "function",
          description: "",
          inputSchema: runtimeSchema,
        },
      },
      experimental_repairToolCall: repairToolCall,
      maxOutputTokens: 0,
      temperature: 0,
      topP: 0,
      topK: 0,
      stopSequences,
      toolChoice: "none",
      seed: 0,
      presencePenalty: 0,
      frequencyPenalty: 0,
      headers,
      providerOptions,
      reasoning,
      includeRawChunks: false,
      abortSignal: abortController.signal,
    });
    await collectAsync(result.fullStream);

    if (!captured) {
      throw new Error("The runtime did not receive outbound options");
    }

    const {
      abortSignal: capturedAbortSignal,
      headers: capturedHeaders,
      providerOptions: capturedProviderOptions,
      reasoning: capturedReasoning,
      stopSequences: capturedStopSequences,
      ...capturedValues
    } = captured;
    assert(capturedAbortSignal instanceof AbortSignal);
    assertEquals(capturedAbortSignal.aborted, false);
    assertStrictEquals(capturedHeaders, headers);
    assertStrictEquals(capturedProviderOptions, providerOptions);
    assertStrictEquals(capturedReasoning, reasoning);
    assertStrictEquals(capturedStopSequences, stopSequences);
    assertEquals(capturedValues, {
      prompt: [
        { role: "system", content: "System contract" },
        {
          role: "user",
          content: [{ type: "text", text: "Outbound contract" }],
        },
      ],
      maxOutputTokens: 0,
      temperature: 0,
      topP: 0,
      topK: 0,
      tools: [{
        type: "function",
        name: "calculate",
        description: "",
        inputSchema: modelInputSchema,
      }],
      toolChoice: "none",
      seed: 0,
      presencePenalty: 0,
      frequencyPenalty: 0,
      includeRawChunks: false,
    });
  });

  it("forwards includeRawChunks and exposes owned raw events only through fullStream", async () => {
    let capturedIncludeRawChunks: unknown;
    const rawValue = {
      provider: "contract",
      chunk: { value: 1 },
    };
    const model: ModelRuntime = {
      provider: "contract",
      modelId: "contract/raw-chunks",
      specificationVersion: "v3",
      doGenerate: () => Promise.reject(new Error("unused doGenerate")),
      doStream: (options) => {
        if (!options || typeof options !== "object" || Array.isArray(options)) {
          throw new TypeError("Expected provider options to be an object");
        }
        capturedIncludeRawChunks = (options as Record<string, unknown>).includeRawChunks;
        return Promise.resolve({
          stream: readableFrom([
            { type: "raw", rawValue },
            { type: "text-delta", delta: "visible" },
            {
              type: "finish",
              finishReason: "stop",
              usage: VALID_TOKEN_USAGE,
            },
          ]),
        });
      },
    };

    const result = streamText({
      model,
      messages: [{ role: "user", content: "raw contract" }],
      includeRawChunks: true,
    });
    const [fullParts, textParts] = await Promise.all([
      collectAsync(result.fullStream),
      collectAsync(result.textStream),
    ]);

    assertEquals(capturedIncludeRawChunks, true);
    assertEquals(fullParts.length, 3);
    assertEquals(fullParts[1], { type: "text-delta", text: "visible" });
    assertEquals(fullParts[2], {
      type: "finish",
      finishReason: "stop",
      totalUsage: {
        inputTokens: 4,
        outputTokens: 3,
      },
    });
    assertEquals(textParts, ["visible"]);
    const rawPart = fullParts[0] as {
      type: "raw";
      rawValue: Record<string, unknown>;
    };
    assertEquals(rawPart.type, "raw");
    assertEquals(JSON.parse(JSON.stringify(rawPart.rawValue)), {
      provider: "contract",
      chunk: { value: 1 },
    });
    assert(rawPart.rawValue !== rawValue);
    rawValue.chunk.value = 2;
    assertEquals(JSON.parse(JSON.stringify(rawPart.rawValue)), {
      provider: "contract",
      chunk: { value: 1 },
    });
  });
});
