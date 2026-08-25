import { assertEquals, assertStrictEquals, assertThrows } from "#veryfront/testing/assert.ts";
import {
  createSkillDocumentParserProvider,
  SkillDocumentParserProviderName,
  snapshotSkillDocumentParserProvider,
} from "./skill-document-parser.ts";

Deno.test("Skill document parser provider exposes a stable contract name", () => {
  assertEquals(SkillDocumentParserProviderName, "SkillDocumentParserProvider");
});

Deno.test("Skill document parser provider captures one immutable function generation", () => {
  let calls = 0;
  let observedThis: unknown = Symbol("unset");
  const original = function (this: unknown, source: string): unknown {
    calls++;
    observedThis = this;
    return { source };
  };
  const registration = { parseFrontmatter: original };
  const captured = snapshotSkillDocumentParserProvider(registration);

  registration.parseFrontmatter = () => {
    throw new Error("mutated parser must not run");
  };

  assertEquals(captured.parseFrontmatter("name: demo"), {
    source: "name: demo",
  });
  assertEquals(calls, 1);
  assertStrictEquals(observedThis, undefined);
  assertEquals(Object.isFrozen(captured), true);
});

Deno.test("Skill document parser provider rejects invalid shapes without invoking hooks", () => {
  let accessorCalls = 0;
  let proxyTrapCalls = 0;
  const accessor = Object.defineProperty({}, "parseFrontmatter", {
    enumerable: true,
    get() {
      accessorCalls++;
      return () => ({});
    },
  });
  const proxy = new Proxy(
    { parseFrontmatter: () => ({}) },
    {
      ownKeys(target) {
        proxyTrapCalls++;
        return Reflect.ownKeys(target);
      },
    },
  );
  class Parser {
    parseFrontmatter(): unknown {
      return {};
    }
  }

  for (
    const value of [
      null,
      [],
      {},
      accessor,
      proxy,
      new Parser(),
      { parseFrontmatter: () => ({}), fallback: true },
      { parseFrontmatter: "not a function" },
    ]
  ) {
    assertThrows(
      () => snapshotSkillDocumentParserProvider(value),
      TypeError,
      "one enumerable parseFrontmatter data-function property",
    );
  }

  const revoked = Proxy.revocable({ parseFrontmatter: () => ({}) }, {});
  revoked.revoke();
  assertThrows(
    () => snapshotSkillDocumentParserProvider(revoked.proxy),
    TypeError,
    "one enumerable parseFrontmatter data-function property",
  );
  assertEquals(accessorCalls, 0);
  assertEquals(proxyTrapCalls, 0);
});

Deno.test("Skill document parser provider rejects proxied parser functions without invoking them", () => {
  let applyTrapCalls = 0;
  const proxiedParser = new Proxy(
    (_source: string): unknown => ({}),
    {
      apply() {
        applyTrapCalls++;
        return {};
      },
    },
  );

  assertThrows(
    () =>
      snapshotSkillDocumentParserProvider({
        parseFrontmatter: proxiedParser,
      }),
    TypeError,
    "one enumerable parseFrontmatter data-function property",
  );
  assertEquals(applyTrapCalls, 0);
});

Deno.test("Skill document parser provider inspection is independent of mutable intrinsics", () => {
  const nativeArrayIsArray = Array.isArray;
  const nativeGetPrototypeOf = Object.getPrototypeOf;
  const nativeGetOwnPropertyDescriptors = Object.getOwnPropertyDescriptors;
  const nativeOwnKeys = Reflect.ownKeys;
  const nativeApply = Reflect.apply;
  const nativeFreeze = Object.freeze;
  const nativeIsFrozen = Object.isFrozen;
  let mutationHooks = 0;
  let parsed: unknown;
  let frozen = false;

  try {
    Array.isArray = (() => {
      mutationHooks++;
      return true;
    }) as unknown as typeof Array.isArray;
    Object.getPrototypeOf = (() => {
      mutationHooks++;
      return null;
    }) as typeof Object.getPrototypeOf;
    Object.getOwnPropertyDescriptors = (() => {
      mutationHooks++;
      return {};
    }) as typeof Object.getOwnPropertyDescriptors;
    Reflect.ownKeys = (() => {
      mutationHooks++;
      return [];
    }) as typeof Reflect.ownKeys;
    Reflect.apply = (() => {
      mutationHooks++;
      throw new Error("mutated Reflect.apply must not run");
    }) as typeof Reflect.apply;
    Object.freeze = ((value: unknown) => {
      mutationHooks++;
      return value;
    }) as typeof Object.freeze;

    const provider = snapshotSkillDocumentParserProvider({
      parseFrontmatter: (source: string) => ({ source }),
    });
    parsed = provider.parseFrontmatter("name: demo");
    frozen = nativeIsFrozen(provider);
  } finally {
    Array.isArray = nativeArrayIsArray;
    Object.getPrototypeOf = nativeGetPrototypeOf;
    Object.getOwnPropertyDescriptors = nativeGetOwnPropertyDescriptors;
    Reflect.ownKeys = nativeOwnKeys;
    Reflect.apply = nativeApply;
    Object.freeze = nativeFreeze;
  }
  assertEquals(parsed, { source: "name: demo" });
  assertEquals(frozen, true);
  assertEquals(mutationHooks, 0);
});

Deno.test("Skill document parser provider rejects accessor descriptors under prototype pollution without hooks", () => {
  const inheritedValue = Object.getOwnPropertyDescriptor(
    Object.prototype,
    "value",
  );
  let inheritedGetterCalls = 0;
  let providerGetterCalls = 0;
  const provider = Object.defineProperty({}, "parseFrontmatter", {
    enumerable: true,
    get() {
      providerGetterCalls++;
      return () => ({});
    },
  });

  try {
    Object.defineProperty(Object.prototype, "value", {
      configurable: true,
      get() {
        inheritedGetterCalls++;
        return () => ({});
      },
    });
    assertThrows(
      () => snapshotSkillDocumentParserProvider(provider),
      TypeError,
      "one enumerable parseFrontmatter data-function property",
    );
    assertEquals(inheritedGetterCalls, 0);
    assertEquals(providerGetterCalls, 0);
  } finally {
    if (inheritedValue === undefined) {
      delete (Object.prototype as { value?: unknown }).value;
    } else {
      Object.defineProperty(Object.prototype, "value", inheritedValue);
    }
  }
});

Deno.test("Skill document parser provider enforces string input and synchronous results", () => {
  const parser = createSkillDocumentParserProvider((source) => ({ source }));
  assertThrows(
    () => parser.parseFrontmatter(42 as unknown as string),
    TypeError,
    "source must be a string",
  );

  const asyncParser = createSkillDocumentParserProvider(() => Promise.resolve({}));
  assertThrows(
    () => asyncParser.parseFrontmatter("name: demo"),
    TypeError,
    "must be synchronous",
  );
});

Deno.test("Skill document parser provider observes rejected async results before rejecting them", async () => {
  let unhandledRejections = 0;
  const onUnhandledRejection = (event: PromiseRejectionEvent): void => {
    unhandledRejections += 1;
    event.preventDefault();
  };
  globalThis.addEventListener("unhandledrejection", onUnhandledRejection);

  try {
    const asyncParser = createSkillDocumentParserProvider(() =>
      Promise.reject(new Error("async parser failure"))
    );
    assertThrows(
      () => asyncParser.parseFrontmatter("name: demo"),
      TypeError,
      "must be synchronous",
    );
    await Promise.resolve();
    await new Promise((resolve) => setTimeout(resolve, 0));
  } finally {
    globalThis.removeEventListener("unhandledrejection", onUnhandledRejection);
  }

  assertEquals(unhandledRejections, 0);
});

Deno.test("Skill document parser provider observes a rejection behind a configurable own constructor", async () => {
  let unhandledRejections = 0;
  let hostileCalls = 0;
  const onUnhandledRejection = (event: PromiseRejectionEvent): void => {
    unhandledRejections += 1;
    event.preventDefault();
  };
  globalThis.addEventListener("unhandledrejection", onUnhandledRejection);

  const hostile = function HostileConstructor(): void {
    hostileCalls += 1;
  } as unknown as PromiseConstructor;
  const promise = Promise.reject(new Error("async parser failure"));
  Object.defineProperty(promise, "constructor", {
    configurable: true,
    enumerable: false,
    writable: true,
    value: hostile,
  });

  try {
    const asyncParser = createSkillDocumentParserProvider(() => promise);
    assertThrows(
      () => asyncParser.parseFrontmatter("name: demo"),
      TypeError,
      "must be synchronous",
    );
    await Promise.resolve();
    await new Promise((resolve) => setTimeout(resolve, 0));
  } finally {
    globalThis.removeEventListener("unhandledrejection", onUnhandledRejection);
  }

  assertEquals(
    unhandledRejections,
    0,
    "a rejected result with a configurable own constructor must still be observed",
  );
  assertEquals(hostileCalls, 0, "the extension-owned constructor must never be invoked");

  const restored = Object.getOwnPropertyDescriptor(promise, "constructor");
  assertStrictEquals(restored?.value, hostile, "restoration must return the original value");
  assertEquals(restored?.configurable, true, "restoration must keep the original configurable");
  assertEquals(restored?.writable, true, "restoration must keep the original writable");
  assertEquals(
    restored?.enumerable,
    false,
    "clonePropertyDescriptor must restore every original flag",
  );
});

Deno.test("Skill document parser provider rejects hostile Promise constructors without invoking them", () => {
  const asynchronousResult = Promise.resolve({});
  let constructorGetterCalls = 0;
  Object.defineProperty(asynchronousResult, "constructor", {
    get() {
      constructorGetterCalls += 1;
      throw new Error("Promise constructor hook must not run");
    },
  });
  const parser = createSkillDocumentParserProvider(() => asynchronousResult);

  assertThrows(
    () => parser.parseFrontmatter("name: demo"),
    TypeError,
    "must be synchronous",
  );
  assertEquals(constructorGetterCalls, 0);
});

Deno.test("Skill document parser provider does not consult a replaced TypeError constructor", () => {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, "TypeError");
  if (!descriptor) throw new Error("Expected a global TypeError descriptor");
  const parser = createSkillDocumentParserProvider((source) => ({ source }));
  let replacementCalls = 0;
  let inputError: unknown;
  let inspectionError: unknown;
  try {
    Object.defineProperty(globalThis, "TypeError", {
      ...descriptor,
      value: class extends Error {
        constructor() {
          replacementCalls += 1;
          super("replacement TypeError executed");
        }
      },
    });
    try {
      parser.parseFrontmatter(42 as unknown as string);
    } catch (error) {
      inputError = error;
    }
    try {
      snapshotSkillDocumentParserProvider({});
    } catch (error) {
      inspectionError = error;
    }
  } finally {
    Object.defineProperty(globalThis, "TypeError", descriptor);
  }

  assertEquals(inputError instanceof TypeError, true);
  assertEquals(inspectionError instanceof TypeError, true);
  assertEquals(replacementCalls, 0);
});

Deno.test("Skill document parser provider preserves parser failures exactly", () => {
  const failure = new SyntaxError("invalid YAML");
  const parser = createSkillDocumentParserProvider(() => {
    throw failure;
  });

  let thrown: unknown;
  try {
    parser.parseFrontmatter("[");
  } catch (error) {
    thrown = error;
  }
  assertStrictEquals(thrown, failure);
});
