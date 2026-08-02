import { assertEquals, assertThrows } from "#veryfront/testing/assert.ts";
import {
  MAX_RUNTIME_TOOL_INPUT_BYTES,
  runtimeToolInputByteLength,
  snapshotRuntimeToolInput,
} from "./runtime-tool-input-budget.ts";

function jsonByteLength(value: unknown): number {
  return new TextEncoder().encode(JSON.stringify(value)).byteLength;
}

Deno.test("runtime tool input budget measures raw strings without materializing JSON", () => {
  assertEquals(runtimeToolInputByteLength('{"query":"safe"}'), 16);
  assertEquals(runtimeToolInputByteLength("å😀"), 6);
  assertEquals(
    runtimeToolInputByteLength("x".repeat(MAX_RUNTIME_TOOL_INPUT_BYTES + 8)),
    MAX_RUNTIME_TOOL_INPUT_BYTES + 1,
  );
});

Deno.test("runtime tool input snapshot counts trailing lone surrogates exactly", () => {
  const raw = snapshotRuntimeToolInput("\ud800");
  assertEquals(raw, {
    exceedsLimit: false,
    input: "\ud800",
    byteLength: 3,
  });

  const structured = snapshotRuntimeToolInput({ value: "\ud800" });
  assertEquals(structured.exceedsLimit, false);
  if (structured.exceedsLimit) throw new Error("unreachable");
  assertEquals(
    structured.byteLength,
    new TextEncoder().encode(JSON.stringify(structured.input)).byteLength,
  );
});

Deno.test("runtime tool input snapshot rejects a surrogate-heavy value at the exact byte limit", () => {
  const input = Array.from(
    { length: 65_535 },
    () => "12345678\ud800",
  );
  const measured = snapshotRuntimeToolInput(
    input,
    2 * MAX_RUNTIME_TOOL_INPUT_BYTES,
  );
  assertEquals(measured.exceedsLimit, false);
  if (measured.exceedsLimit) throw new Error("unreachable");
  const encodedBytes = new TextEncoder().encode(
    JSON.stringify(measured.input),
  ).byteLength;
  assertEquals(measured.byteLength, encodedBytes);
  assertEquals(encodedBytes > MAX_RUNTIME_TOOL_INPUT_BYTES, true);
  assertEquals(
    snapshotRuntimeToolInput(input).exceedsLimit,
    true,
  );
});

Deno.test("runtime tool input budget measures structured inputs with JSON-shaped bounds", () => {
  const shared = { nested: "å😀", control: "\n" };
  const input = {
    first: shared,
    second: shared,
    array: [true, null, 42],
  };
  assertEquals(runtimeToolInputByteLength(input), jsonByteLength(input));
});

Deno.test("runtime tool input budget fails closed on cycles and accessors", () => {
  const cycle: Record<string, unknown> = {};
  cycle.self = cycle;
  assertEquals(
    runtimeToolInputByteLength(cycle),
    MAX_RUNTIME_TOOL_INPUT_BYTES + 1,
  );

  let accessorInvoked = false;
  const accessorInput: Record<string, unknown> = {};
  Object.defineProperty(accessorInput, "secret", {
    enumerable: true,
    get() {
      accessorInvoked = true;
      return "unsafe";
    },
  });
  assertThrows(
    () => runtimeToolInputByteLength(accessorInput),
    TypeError,
    "inspectable data properties",
  );
  assertEquals(accessorInvoked, false);
});

Deno.test("runtime tool input budget rejects array accessors without changing hole semantics", () => {
  let accessorInvoked = false;
  const accessorInput = new Array(2);
  Object.defineProperty(accessorInput, "0", {
    enumerable: true,
    get() {
      accessorInvoked = true;
      return "unsafe";
    },
  });

  assertThrows(
    () => runtimeToolInputByteLength(accessorInput),
    TypeError,
    "inspectable data properties",
  );
  assertEquals(accessorInvoked, false);

  const sparse = new Array(3);
  sparse[1] = "value";
  assertEquals(runtimeToolInputByteLength(sparse), jsonByteLength(sparse));
});

Deno.test("runtime tool input snapshot owns and freezes plain structured data", () => {
  const input = { query: "safe", nested: ["value"] };
  const snapshot = snapshotRuntimeToolInput(input);
  assertEquals(snapshot.exceedsLimit, false);
  if (snapshot.exceedsLimit) throw new Error("unreachable");
  assertEquals(snapshot.input, input);
  assertEquals(snapshot.input === input, false);
  assertEquals(Object.getPrototypeOf(snapshot.input), null);
  assertEquals(Object.isFrozen(snapshot.input), true);
  assertEquals(
    Object.isFrozen((snapshot.input as { nested: unknown[] }).nested),
    true,
  );
});

Deno.test("runtime tool input snapshot rejects hooks and non-JSON own properties uninvoked", () => {
  let hookCalls = 0;
  const cases: unknown[] = [
    {
      query: "safe",
      toJSON() {
        hookCalls++;
        return {};
      },
    },
    {
      query: "safe",
      toString() {
        hookCalls++;
        return "unsafe";
      },
    },
    {
      query: "safe",
      [Symbol.toPrimitive]() {
        hookCalls++;
        return "unsafe";
      },
    },
    { query: "safe", unsupported: undefined },
    { query: "safe", unsupported: () => hookCalls++ },
    { query: "safe", unsupported: 1n },
    { query: "safe", unsupported: Number.NaN },
    new (class ToolInput {
      query = "safe";
    })(),
  ];
  const accessorInput = { query: "safe" };
  Object.defineProperty(accessorInput, "hidden", {
    get() {
      hookCalls++;
      return "unsafe";
    },
  });
  cases.push(accessorInput);

  for (const input of cases) {
    assertThrows(
      () => snapshotRuntimeToolInput(input),
      TypeError,
      "Runtime tool input",
    );
  }
  assertEquals(hookCalls, 0);
});

Deno.test("runtime tool input budget rejects huge sparse arrays before inspecting indices", () => {
  let descriptorCalls = 0;
  const input = new Proxy(new Array(600_000), {
    getOwnPropertyDescriptor(target, key) {
      descriptorCalls++;
      return Reflect.getOwnPropertyDescriptor(target, key);
    },
  });

  assertEquals(
    runtimeToolInputByteLength(input),
    MAX_RUNTIME_TOOL_INPUT_BYTES + 1,
  );
  assertEquals(descriptorCalls, 1);
});

Deno.test("runtime tool input descriptor checks ignore inherited value pollution", () => {
  const prior = Object.getOwnPropertyDescriptor(Object.prototype, "value");
  let getterCalls = 0;
  const input = new Array(1);
  Object.defineProperty(input, "0", {
    enumerable: true,
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
      () => runtimeToolInputByteLength(input),
      TypeError,
      "inspectable data properties",
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

Deno.test("runtime tool input budget does not consult proxy get traps", () => {
  let getTrapCount = 0;
  const input = new Proxy({ query: "safe" }, {
    get(target, property, receiver) {
      getTrapCount++;
      return Reflect.get(target, property, receiver);
    },
  });

  assertEquals(runtimeToolInputByteLength(input), jsonByteLength({ query: "safe" }));
  assertEquals(getTrapCount, 0);
});
