import {
  assert,
  assertEquals,
  assertStrictEquals,
  assertThrows,
} from "#veryfront/testing/assert.ts";
import {
  MAX_RUNTIME_RAW_CHUNK_BYTES,
  MAX_RUNTIME_RAW_CHUNK_DEPTH,
  MAX_RUNTIME_RAW_CHUNK_NODES,
  MAX_RUNTIME_STREAM_IDENTIFIER_LENGTH,
  normalizeRuntimeFinishReason,
  parseRuntimeStreamPart,
} from "./runtime-stream-part.ts";

function assertBoundedTypeError(run: () => unknown): TypeError {
  const error = assertThrows(
    run,
    TypeError,
    "Invalid runtime stream part:",
  );
  assert(error instanceof TypeError);
  assert(
    error.message.length <= 160,
    `Expected a bounded validation message, received ${error.message.length} characters`,
  );
  return error;
}

function assertInvalid(value: unknown): TypeError {
  return assertBoundedTypeError(() => parseRuntimeStreamPart(value));
}

Deno.test("runtime stream parser canonicalizes text deltas with legacy delta precedence", () => {
  assertEquals(
    parseRuntimeStreamPart({
      type: "text-delta",
      text: "canonical",
      delta: "provider",
      secret: "drop",
    }),
    { type: "text-delta", text: "provider" },
  );
  assertEquals(
    parseRuntimeStreamPart({
      type: "text-delta",
      delta: "provider",
      secret: "drop",
    }),
    { type: "text-delta", text: "provider" },
  );
  assertInvalid({ type: "text-delta", text: 1 });
});

Deno.test("runtime stream parser validates local stream lifecycle events", () => {
  const timestamp = new Date("2026-07-25T12:00:00.000Z");
  assertEquals(
    parseRuntimeStreamPart({
      type: "stream-start",
      warnings: [],
      secret: "drop",
    }),
    { type: "stream-start", warnings: [] },
  );
  assertEquals(
    parseRuntimeStreamPart({
      type: "response-metadata",
      id: "response-1",
      timestamp,
      modelId: "local/test-model",
      secret: "drop",
    }),
    {
      type: "response-metadata",
      id: "response-1",
      timestamp,
      modelId: "local/test-model",
    },
  );
  assertEquals(
    parseRuntimeStreamPart({ type: "text-start", id: "text-1", secret: "drop" }),
    { type: "text-start", id: "text-1" },
  );
  assertEquals(
    parseRuntimeStreamPart({ type: "text-end", id: "text-1", secret: "drop" }),
    { type: "text-end", id: "text-1" },
  );

  assertInvalid({ type: "stream-start", warnings: {} });
  assertInvalid({ type: "response-metadata", timestamp: "now" });
  assertInvalid({ type: "response-metadata", timestamp: new Date(Number.NaN) });
  assertInvalid({ type: "text-start", id: "" });
  assertInvalid({ type: "text-end", id: 1 });
});

Deno.test("runtime stream parser validates reasoning events", () => {
  assertEquals(
    parseRuntimeStreamPart({ type: "reasoning-start", id: "reasoning-1", extra: true }),
    { type: "reasoning-start", id: "reasoning-1" },
  );
  assertEquals(
    parseRuntimeStreamPart({
      type: "reasoning-delta",
      id: "reasoning-1",
      delta: "",
      extra: true,
    }),
    { type: "reasoning-delta", id: "reasoning-1", delta: "" },
  );
  assertEquals(
    parseRuntimeStreamPart({
      type: "reasoning-end",
      id: "reasoning-1",
      signature: "",
      redactedData: "opaque",
      extra: true,
    }),
    {
      type: "reasoning-end",
      id: "reasoning-1",
      signature: "",
      redactedData: "opaque",
    },
  );
  assertEquals(
    parseRuntimeStreamPart({
      type: "reasoning-end",
      id: "reasoning-2",
    }),
    {
      type: "reasoning-end",
      id: "reasoning-2",
    },
  );

  assertInvalid({ type: "reasoning-start", id: "" });
  assertInvalid({
    type: "reasoning-start",
    id: "x".repeat(MAX_RUNTIME_STREAM_IDENTIFIER_LENGTH + 1),
  });
  assertInvalid({ type: "reasoning-delta", id: "reasoning-1", delta: 1 });
  assertInvalid({ type: "reasoning-end", id: "reasoning-1", signature: false });
});

Deno.test("runtime stream parser preserves only type and data for data events", () => {
  const data = { nested: true };
  const parsed = parseRuntimeStreamPart({
    type: "data-contract",
    data,
    secret: "drop",
  });
  assertEquals(parsed, { type: "data-contract", data });
  if (parsed.type !== "data-contract") throw new Error("Expected data-contract");
  assertStrictEquals(parsed.data, data);
  assertInvalid({ type: "data-contract" });
  const boundaryType = `data-${
    "x".repeat(MAX_RUNTIME_STREAM_IDENTIFIER_LENGTH - "data-".length)
  }` as const;
  assertEquals(
    parseRuntimeStreamPart({ type: boundaryType, data: null }),
    { type: boundaryType, data: null },
  );
  assertInvalid({
    type: `data-${"x".repeat(MAX_RUNTIME_STREAM_IDENTIFIER_LENGTH)}`,
    data: null,
  });
});

Deno.test("runtime stream parser owns and bounds raw provider chunks", () => {
  const source = {
    nested: {
      values: [1, true, null, "safe"],
    },
  };
  const parsed = parseRuntimeStreamPart({
    type: "raw",
    rawValue: source,
    secret: "drop",
  });
  assertEquals(parsed, {
    type: "raw",
    rawValue: {
      nested: {
        values: [1, true, null, "safe"],
      },
    },
  });
  if (parsed.type !== "raw") throw new Error("Expected raw");
  assert(parsed.rawValue !== source);
  assert(Object.isFrozen(parsed.rawValue));
  source.nested.values[0] = 99;
  assertEquals(parsed.rawValue, {
    nested: {
      values: [1, true, null, "safe"],
    },
  });

  const exactBytes = "x".repeat(MAX_RUNTIME_RAW_CHUNK_BYTES - 2);
  assertEquals(
    parseRuntimeStreamPart({ type: "raw", rawValue: exactBytes }),
    { type: "raw", rawValue: exactBytes },
  );
  assertInvalid({
    type: "raw",
    rawValue: `${exactBytes}x`,
  });

  let exactDepth: unknown = null;
  for (let depth = 0; depth < MAX_RUNTIME_RAW_CHUNK_DEPTH; depth += 1) {
    exactDepth = { nested: exactDepth };
  }
  assertEquals(
    parseRuntimeStreamPart({ type: "raw", rawValue: exactDepth }),
    { type: "raw", rawValue: exactDepth },
  );
  assertInvalid({
    type: "raw",
    rawValue: { nested: exactDepth },
  });

  const exactNodes = Array.from(
    { length: MAX_RUNTIME_RAW_CHUNK_NODES - 1 },
    () => null,
  );
  assertEquals(
    parseRuntimeStreamPart({ type: "raw", rawValue: exactNodes }),
    { type: "raw", rawValue: exactNodes },
  );
  assertInvalid({
    type: "raw",
    rawValue: [...exactNodes, null],
  });
});

Deno.test("runtime stream parser rejects raw accessors and serialization hooks uninvoked", () => {
  let getterCalls = 0;
  let serializationCalls = 0;
  const accessor: Record<string, unknown> = {};
  Object.defineProperty(accessor, "secret", {
    enumerable: true,
    get() {
      getterCalls += 1;
      return "unsafe";
    },
  });
  assertInvalid({ type: "raw", rawValue: accessor });

  const customSerialization = {
    safe: true,
    toJSON() {
      serializationCalls += 1;
      return { leaked: true };
    },
  };
  assertInvalid({ type: "raw", rawValue: customSerialization });
  assertEquals(getterCalls, 0);
  assertEquals(serializationCalls, 0);

  let getCalls = 0;
  const proxy = new Proxy(
    { stable: true },
    {
      get(target, key, receiver) {
        getCalls += 1;
        return Reflect.get(target, key, receiver);
      },
    },
  );
  assertEquals(
    parseRuntimeStreamPart({ type: "raw", rawValue: proxy }),
    { type: "raw", rawValue: { stable: true } },
  );
  assertEquals(getCalls, 0);

  assertInvalid({ type: "raw" });
  assertInvalid({ type: "raw", rawValue: undefined });
  assertInvalid({ type: "raw", rawValue: Number.NaN });
  assertInvalid({ type: "raw", rawValue: new Date() });
  const cycle: Record<string, unknown> = {};
  cycle.self = cycle;
  assertInvalid({ type: "raw", rawValue: cycle });
});

Deno.test("runtime stream parser sanitizes tool input lifecycle events", () => {
  assertEquals(
    parseRuntimeStreamPart({
      type: "tool-input-start",
      id: "call-1",
      toolName: "lookup",
      providerExecuted: true,
      dynamic: false,
      supportsDeferredResults: true,
      secret: "drop",
    }),
    {
      type: "tool-input-start",
      id: "call-1",
      toolName: "lookup",
      providerExecuted: true,
      supportsDeferredResults: true,
    },
  );
  assertEquals(
    parseRuntimeStreamPart({
      type: "tool-input-delta",
      id: "call-1",
      delta: "",
      secret: "drop",
    }),
    { type: "tool-input-delta", id: "call-1", delta: "" },
  );
  assertEquals(
    parseRuntimeStreamPart({ type: "tool-input-end", id: "call-1", secret: "drop" }),
    { type: "tool-input-end", id: "call-1" },
  );
  assertEquals(
    parseRuntimeStreamPart({
      type: "tool-input-available",
      toolCallId: "call-1",
      id: "provider-call-1",
      toolName: "lookup",
      input: undefined,
      providerExecuted: true,
      dynamic: false,
      secret: "drop",
    }),
    {
      type: "tool-input-available",
      toolCallId: "call-1",
      id: "provider-call-1",
      toolName: "lookup",
      input: undefined,
      providerExecuted: true,
    },
  );

  assertInvalid({
    type: "tool-input-start",
    id: "call-1",
    toolName: "lookup",
    providerExecuted: "yes",
  });
  assertInvalid({
    type: "tool-input-start",
    id: "call-1",
    toolName: "",
  });
  assertInvalid({
    type: "tool-input-delta",
    id: "x".repeat(MAX_RUNTIME_STREAM_IDENTIFIER_LENGTH + 1),
    delta: "value",
  });
  assertInvalid({
    type: "tool-input-available",
    toolName: "lookup",
    input: {},
  });
  assertInvalid({
    type: "tool-input-available",
    id: "call-1",
    toolName: "lookup",
  });
  assertEquals(
    parseRuntimeStreamPart({
      type: "tool-input-available",
      id: "call-2",
      toolName: "lookup",
      input: {},
    }),
    {
      type: "tool-input-available",
      id: "call-2",
      toolName: "lookup",
      input: {},
    },
  );
});

Deno.test("runtime stream parser sanitizes tool calls, results, and errors", () => {
  const input = { query: "safe" };
  assertEquals(
    parseRuntimeStreamPart({
      type: "tool-call",
      toolCallId: "call-1",
      toolName: "lookup",
      input,
      providerExecuted: true,
      dynamic: false,
      secret: "drop",
    }),
    {
      type: "tool-call",
      toolCallId: "call-1",
      toolName: "lookup",
      input,
      providerExecuted: true,
    },
  );

  const output = { answer: 42 };
  const resultError = new Error("provider result");
  const result = parseRuntimeStreamPart({
    type: "tool-result",
    toolCallId: "call-1",
    toolName: "lookup",
    output,
    result: null,
    error: resultError,
    input,
    providerExecuted: true,
    dynamic: false,
    supportsDeferredResults: true,
    preliminary: true,
    isError: false,
    secret: "drop",
  });
  assertEquals(result, {
    type: "tool-result",
    toolCallId: "call-1",
    toolName: "lookup",
    output,
    result: null,
    error: resultError,
    input,
    providerExecuted: true,
    supportsDeferredResults: true,
    preliminary: true,
  });
  if (result.type !== "tool-result") throw new Error("Expected tool-result");
  assertStrictEquals(result.output, output);
  assertStrictEquals(result.error, resultError);
  assertStrictEquals(result.input, input);

  const toolError = new Error("provider failed");
  const parsedError = parseRuntimeStreamPart({
    type: "tool-error",
    toolCallId: "call-1",
    toolName: "lookup",
    error: toolError,
    input,
    providerExecuted: true,
    preliminary: false,
    secret: "drop",
  });
  assertEquals(parsedError, {
    type: "tool-error",
    toolCallId: "call-1",
    toolName: "lookup",
    error: toolError,
    input,
    providerExecuted: true,
  });
  if (parsedError.type !== "tool-error") throw new Error("Expected tool-error");
  assertStrictEquals(parsedError.error, toolError);

  assertInvalid({
    type: "tool-call",
    toolCallId: "call-1",
    toolName: "lookup",
  });
  assertInvalid({
    type: "tool-call",
    toolCallId: "call-1",
    input: {},
  });
  assertInvalid({
    type: "tool-result",
    toolCallId: "",
    toolName: "lookup",
  });
  assertInvalid({
    type: "tool-error",
    toolCallId: "call-1",
    toolName: "lookup",
    isError: 1,
  });
});

Deno.test("runtime stream parser normalizes finish events with injectable usage", () => {
  const providerMetadata = { provider: "contract" };
  const normalizedUsage = {
    inputTokens: 2,
    outputTokens: 3,
    totalTokens: 5,
  };
  const rawUsage = { promptTokens: 2, completionTokens: 3 };
  let receivedUsage: unknown;
  const parsed = parseRuntimeStreamPart(
    {
      type: "finish",
      finishReason: { unified: "stop", raw: "end_turn" },
      providerMetadata,
      usage: rawUsage,
      secret: "drop",
    },
    {
      normalizeUsage(value) {
        receivedUsage = value;
        return normalizedUsage;
      },
    },
  );
  assertEquals(parsed, {
    type: "finish",
    finishReason: "stop",
    providerMetadata,
    totalUsage: normalizedUsage,
  });
  assertStrictEquals(receivedUsage, rawUsage);
  if (parsed.type !== "finish") throw new Error("Expected finish");
  assertStrictEquals(parsed.providerMetadata, providerMetadata);
  assertStrictEquals(parsed.totalUsage, normalizedUsage);

  assertEquals(
    parseRuntimeStreamPart({ type: "finish" }),
    { type: "finish", finishReason: null },
  );
  assertEquals(
    parseRuntimeStreamPart({
      type: "finish",
      finishReason: null,
      totalUsage: null,
    }),
    { type: "finish", finishReason: null, totalUsage: null },
  );
  assertEquals(normalizeRuntimeFinishReason("length"), "length");
  assertEquals(normalizeRuntimeFinishReason({ unified: null }), null);
  assertEquals(
    normalizeRuntimeFinishReason(
      "x".repeat(MAX_RUNTIME_STREAM_IDENTIFIER_LENGTH),
    ),
    "x".repeat(MAX_RUNTIME_STREAM_IDENTIFIER_LENGTH),
  );

  let fallbackUsage: unknown;
  assertEquals(
    parseRuntimeStreamPart(
      {
        type: "finish",
        finishReason: "stop",
        usage: null,
        totalUsage: rawUsage,
      },
      {
        normalizeUsage(value) {
          fallbackUsage = value;
          return normalizedUsage;
        },
      },
    ),
    {
      type: "finish",
      finishReason: "stop",
      totalUsage: normalizedUsage,
    },
  );
  assertStrictEquals(fallbackUsage, rawUsage);

  assertInvalid({
    type: "finish",
    finishReason: 1,
  });
  assertInvalid({
    type: "finish",
    finishReason: { unified: 1 },
  });
  assertInvalid({
    type: "finish",
    finishReason: "stop",
    providerMetadata: [],
  });
  assertInvalid({
    type: "finish",
    finishReason: "stop",
    usage: rawUsage,
  });
  assertInvalid({
    type: "finish",
    finishReason: "x".repeat(MAX_RUNTIME_STREAM_IDENTIFIER_LENGTH + 1),
  });
});

Deno.test("runtime stream parser prefers cumulative finish usage and safely falls back", () => {
  const rawTotalUsage = { source: "total" };
  const rawUsage = { source: "incremental" };
  const normalizedTotalUsage = {
    inputTokens: 7,
    outputTokens: 5,
    totalTokens: 12,
  };
  const normalizedUsage = {
    inputTokens: 2,
    outputTokens: 1,
    totalTokens: 3,
  };
  const normalizedCandidates: unknown[] = [];

  assertEquals(
    parseRuntimeStreamPart(
      {
        type: "finish",
        finishReason: "stop",
        usage: rawUsage,
        totalUsage: rawTotalUsage,
      },
      {
        normalizeUsage(value) {
          normalizedCandidates.push(value);
          return value === rawTotalUsage ? normalizedTotalUsage : normalizedUsage;
        },
      },
    ),
    {
      type: "finish",
      finishReason: "stop",
      totalUsage: normalizedTotalUsage,
    },
  );
  assertEquals(normalizedCandidates, [rawTotalUsage]);

  const invalidTotalUsage = { source: "invalid-total" };
  const fallbackCandidates: unknown[] = [];
  assertEquals(
    parseRuntimeStreamPart(
      {
        type: "finish",
        finishReason: "stop",
        usage: rawUsage,
        totalUsage: invalidTotalUsage,
      },
      {
        normalizeUsage(value) {
          fallbackCandidates.push(value);
          return value === invalidTotalUsage ? undefined : normalizedUsage;
        },
      },
    ),
    {
      type: "finish",
      finishReason: "stop",
      totalUsage: normalizedUsage,
    },
  );
  assertEquals(fallbackCandidates, [invalidTotalUsage, rawUsage]);

  let usageGetterCalls = 0;
  const finishWithHostileFallback: Record<string, unknown> = {
    type: "finish",
    finishReason: "stop",
    totalUsage: rawTotalUsage,
  };
  Object.defineProperty(finishWithHostileFallback, "usage", {
    enumerable: true,
    get() {
      usageGetterCalls += 1;
      throw new Error("lower-priority usage must not be evaluated");
    },
  });
  assertEquals(
    parseRuntimeStreamPart(finishWithHostileFallback, {
      normalizeUsage: () => normalizedTotalUsage,
    }),
    {
      type: "finish",
      finishReason: "stop",
      totalUsage: normalizedTotalUsage,
    },
  );
  assertEquals(usageGetterCalls, 0);
});

Deno.test("runtime stream parser fails closed on broken usage normalizers", () => {
  const finish = {
    type: "finish",
    finishReason: "stop",
    usage: { inputTokens: 1 },
  };

  assertInvalid({
    ...finish,
  });
  assertBoundedTypeError(() =>
    parseRuntimeStreamPart(finish, {
      normalizeUsage() {
        throw new Error("provider detail must not escape");
      },
    })
  );
  assertBoundedTypeError(() =>
    parseRuntimeStreamPart(finish, {
      normalizeUsage: () => 1 as never,
    })
  );
  assertEquals(
    parseRuntimeStreamPart(finish, {
      normalizeUsage: () => undefined,
    }),
    { type: "finish", finishReason: "stop" },
  );
  assertEquals(
    parseRuntimeStreamPart(finish, {
      normalizeUsage: () => null,
    }),
    { type: "finish", finishReason: "stop", totalUsage: null },
  );
});

Deno.test("runtime stream parser preserves error causes and strips extras", () => {
  const cause = new Error("stream failed");
  const parsed = parseRuntimeStreamPart({
    type: "error",
    error: cause,
    secret: "drop",
  });
  assertEquals(parsed, { type: "error", error: cause });
  if (parsed.type !== "error") throw new Error("Expected error");
  assertStrictEquals(parsed.error, cause);
  assertInvalid({ type: "error" });
});

Deno.test("runtime stream parser rejects unsupported and unsafe top-level values", () => {
  for (
    const value of [
      undefined,
      null,
      false,
      1,
      "text",
      [],
      {},
      { type: 1 },
      { type: "unknown-event" },
    ]
  ) {
    assertInvalid(value);
  }

  const secret = "s".repeat(10_000);
  const error = assertInvalid({ type: secret });
  assert(!error.message.includes(secret));

  const revoked = Proxy.revocable({}, {});
  revoked.revoke();
  assertInvalid(revoked.proxy);
});

Deno.test("runtime stream parser never invokes untrusted accessors", () => {
  let getterCalls = 0;
  const accessorPart: Record<string, unknown> = { type: "text-delta" };
  Object.defineProperty(accessorPart, "text", {
    enumerable: true,
    get() {
      getterCalls += 1;
      return "unsafe";
    },
  });

  assertInvalid(accessorPart);
  assertEquals(getterCalls, 0);

  const validPart: Record<string, unknown> = {
    type: "text-delta",
    delta: "safe",
  };
  Object.defineProperty(validPart, "secret", {
    enumerable: true,
    get() {
      getterCalls += 1;
      throw new Error("unknown fields must not be inspected");
    },
  });
  assertEquals(
    parseRuntimeStreamPart(validPart),
    { type: "text-delta", text: "safe" },
  );
  assertEquals(getterCalls, 0);
});

Deno.test("runtime stream parser rejects accessors despite inherited descriptor value pollution", () => {
  const prior = Object.getOwnPropertyDescriptor(Object.prototype, "value");
  let getterCalls = 0;
  const part: Record<string, unknown> = { type: "text-delta" };
  Object.defineProperty(part, "delta", {
    get() {
      getterCalls += 1;
      return "unsafe";
    },
  });
  try {
    Object.defineProperty(Object.prototype, "value", {
      configurable: true,
      value: "polluted",
    });

    assertInvalid(part);
    assertEquals(getterCalls, 0);
  } finally {
    if (prior) {
      Object.defineProperty(Object.prototype, "value", prior);
    } else {
      delete (Object.prototype as { value?: unknown }).value;
    }
  }
});

Deno.test("runtime stream parser snapshots proxy data descriptors without invoking get traps", () => {
  let getCalls = 0;
  const proxy = new Proxy(
    { type: "text-delta", delta: "stable" },
    {
      get(target, key, receiver) {
        getCalls += 1;
        if (key === "delta") return 42;
        return Reflect.get(target, key, receiver);
      },
    },
  );

  assertEquals(
    parseRuntimeStreamPart(proxy),
    { type: "text-delta", text: "stable" },
  );
  assertEquals(getCalls, 0);
});

Deno.test("runtime finish-reason normalization fails closed on unsafe values", () => {
  assertBoundedTypeError(() =>
    normalizeRuntimeFinishReason(
      "x".repeat(MAX_RUNTIME_STREAM_IDENTIFIER_LENGTH + 1),
    )
  );

  let getterCalls = 0;
  const reason: Record<string, unknown> = {};
  Object.defineProperty(reason, "unified", {
    enumerable: true,
    get() {
      getterCalls += 1;
      return "stop";
    },
  });
  assertBoundedTypeError(() => normalizeRuntimeFinishReason(reason));
  assertEquals(getterCalls, 0);

  const revoked = Proxy.revocable({}, {});
  revoked.revoke();
  assertBoundedTypeError(() => normalizeRuntimeFinishReason(revoked.proxy));
});
