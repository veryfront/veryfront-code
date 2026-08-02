import { assertEquals, assertStrictEquals, assertThrows } from "#veryfront/testing/assert.ts";
import {
  MAX_RUNTIME_DIRECT_TEXT_BYTES,
  parseRuntimeDirectContent,
  parseRuntimeDirectGenerateResult,
} from "./runtime-direct-content.ts";
import { MAX_RUNTIME_STREAM_IDENTIFIER_LENGTH } from "./runtime-stream-part.ts";

Deno.test("runtime direct content parser canonicalizes known parts and ignores unknown parts", () => {
  const input = { query: "safe" };
  assertEquals(
    parseRuntimeDirectContent([
      { type: "provider-metadata", opaque: true },
      { type: "text", text: "answer", extra: "drop" },
      {
        type: "tool-call",
        toolCallId: "call-1",
        toolName: "search",
        input,
        providerExecuted: true,
        dynamic: false,
        extra: "drop",
      },
    ]),
    [
      { type: "text", text: "answer" },
      {
        type: "tool-call",
        toolCallId: "call-1",
        toolName: "search",
        input,
        providerExecuted: true,
      },
    ],
  );
});

Deno.test("runtime direct content parser rejects malformed containers and known parts", () => {
  for (
    const content of [
      null,
      "text",
      {},
      [null],
      [{ type: "text", text: 1 }],
      [{ type: "tool-call", toolCallId: "call-1", toolName: "search" }],
      [{ type: "tool-result", toolCallId: "call-1", toolName: "search" }],
      [{
        type: "tool-call",
        toolCallId: "x".repeat(MAX_RUNTIME_STREAM_IDENTIFIER_LENGTH + 1),
        toolName: "search",
        input: {},
      }],
    ]
  ) {
    assertThrows(
      () => parseRuntimeDirectContent(content),
      TypeError,
      "Invalid runtime generate content:",
    );
  }
});

Deno.test("runtime direct parser never invokes provider-controlled accessors", () => {
  let accessorInvoked = false;
  const accessorPart = { type: "text" } as Record<string, unknown>;
  Object.defineProperty(accessorPart, "text", {
    enumerable: true,
    get() {
      accessorInvoked = true;
      return "unsafe";
    },
  });

  assertThrows(
    () => parseRuntimeDirectContent([accessorPart]),
    TypeError,
    "text must be a data property",
  );

  const accessorResult: Record<string, unknown> = {};
  Object.defineProperty(accessorResult, "content", {
    enumerable: true,
    get() {
      accessorInvoked = true;
      return [];
    },
  });
  assertThrows(
    () => parseRuntimeDirectGenerateResult(accessorResult),
    TypeError,
    "content must be a data property",
  );
  assertEquals(accessorInvoked, false);
});

Deno.test("runtime direct parser rejects accessors despite inherited descriptor value pollution", () => {
  const prior = Object.getOwnPropertyDescriptor(Object.prototype, "value");
  let getterCalls = 0;
  const part: Record<string, unknown> = { type: "text" };
  Object.defineProperty(part, "text", {
    get() {
      getterCalls++;
      return "unsafe";
    },
  });
  try {
    Object.defineProperty(Object.prototype, "value", {
      configurable: true,
      value: "polluted",
    });
    assertThrows(
      () => parseRuntimeDirectContent([part]),
      TypeError,
      "text must be a data property",
    );
    assertEquals(getterCalls, 0);
  } finally {
    if (prior) {
      Object.defineProperty(Object.prototype, "value", prior);
    } else {
      delete (Object.prototype as { value?: unknown }).value;
    }
  }
});

Deno.test("runtime direct parser bounds revoked-proxy inspection failures", () => {
  const content = Proxy.revocable([], {});
  content.revoke();
  const contentError = assertThrows(
    () => parseRuntimeDirectContent(content.proxy),
    TypeError,
    "Invalid runtime generate content:",
  );
  assertEquals(contentError.message.includes("revoked"), false);

  const result = Proxy.revocable({}, {});
  result.revoke();
  const resultError = assertThrows(
    () => parseRuntimeDirectGenerateResult(result.proxy),
    TypeError,
    "Invalid runtime generate content:",
  );
  assertEquals(resultError.message.includes("revoked"), false);
});

Deno.test("runtime direct parser rejects huge sparse content before inspecting indices", () => {
  let numericDescriptorCalls = 0;
  let getCalls = 0;
  const sparse = new Array(4_294_967_295);
  const input = new Proxy(sparse, {
    get(target, key, receiver) {
      getCalls++;
      return Reflect.get(target, key, receiver);
    },
    getOwnPropertyDescriptor(target, key) {
      if (typeof key === "string" && /^\d+$/.test(key)) {
        numericDescriptorCalls++;
      }
      return Reflect.getOwnPropertyDescriptor(target, key);
    },
  });

  assertThrows(
    () => parseRuntimeDirectContent(input),
    TypeError,
    "content array length must be between",
  );
  assertEquals(numericDescriptorCalls, 0);
  assertEquals(getCalls, 0);
});

Deno.test("runtime direct parser bounds repeated shared text before concatenation", () => {
  const sharedChunk = "x".repeat(MAX_RUNTIME_DIRECT_TEXT_BYTES / 8);
  const content = Array.from({ length: 9 }, () => ({
    type: "text",
    text: sharedChunk,
  }));

  assertThrows(
    () => parseRuntimeDirectContent(content),
    TypeError,
    "text content must not exceed",
  );
});

Deno.test("runtime direct parser snapshots descriptors without consulting get traps", () => {
  let getTrapCount = 0;
  const content = new Proxy([{
    type: "text",
    text: "safe",
  }], {
    get(target, property, receiver) {
      getTrapCount++;
      return Reflect.get(target, property, receiver);
    },
  });
  const providerMetadata = { provider: "safe" };
  const result = new Proxy({
    content,
    finishReason: "stop",
    usage: { inputTokens: 1 },
    providerMetadata,
  }, {
    get(target, property, receiver) {
      getTrapCount++;
      return Reflect.get(target, property, receiver);
    },
  });

  const parsed = parseRuntimeDirectGenerateResult(result);
  assertEquals(parsed, {
    content: [{ type: "text", text: "safe" }],
    finishReason: "stop",
    usage: { inputTokens: 1 },
    providerMetadata: { provider: "safe" },
  });
  assertStrictEquals(parsed.providerMetadata, providerMetadata);
  assertEquals(getTrapCount, 0);
});
