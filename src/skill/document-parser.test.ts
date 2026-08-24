import { assertEquals, assertThrows } from "#veryfront/testing/assert.ts";
import { register, tryResolve, unregister } from "../extensions/contracts.ts";
import {
  createSkillDocumentParserProvider,
  type SkillDocumentParserProvider,
  SkillDocumentParserProviderName,
} from "../extensions/parser/skill-document-parser.ts";
import { parseBoundedSkillDocument, snapshotSkillFrontmatterMapping } from "./document-parser.ts";

Deno.test("bounded Skill document parsing owns the envelope and passes only YAML to the provider", () => {
  let received = "";
  const provider = createSkillDocumentParserProvider((source) => {
    received = source;
    return { name: "demo", description: "Demo" };
  });

  const parsed = parseBoundedSkillDocument(
    "---\r\nname: demo\r\ndescription: Demo\r\n---\r\n# Body\r\n",
    provider,
  );

  assertEquals(received, "name: demo\r\ndescription: Demo");
  assertEquals(parsed.frontmatter, { name: "demo", description: "Demo" });
  assertEquals(parsed.body, "# Body\r\n");
});

Deno.test("bounded Skill document parsing does not resolve or invoke a provider without YAML", () => {
  let calls = 0;
  const provider = createSkillDocumentParserProvider(() => {
    calls++;
    throw new Error("must not run");
  });

  assertEquals(parseBoundedSkillDocument("plain markdown", provider), {
    frontmatter: {},
    body: "plain markdown",
  });
  assertEquals(parseBoundedSkillDocument("---\n---\nbody", provider), {
    frontmatter: {},
    body: "body",
  });
  assertEquals(calls, 0);
});

Deno.test("Skill document parsing rejects an explicit null provider instead of resolving globally", () => {
  const previous = tryResolve<SkillDocumentParserProvider>(
    SkillDocumentParserProviderName,
  );
  register(
    SkillDocumentParserProviderName,
    createSkillDocumentParserProvider(() => ({ name: "global" })),
  );

  try {
    assertThrows(
      () =>
        parseBoundedSkillDocument(
          "---\nname: authored\n---\nBody",
          null as unknown as SkillDocumentParserProvider,
        ),
      TypeError,
      "provider must be a plain object",
    );
  } finally {
    unregister(SkillDocumentParserProviderName);
    if (previous !== undefined) {
      register(SkillDocumentParserProviderName, previous);
    }
  }
});

Deno.test("bounded Skill document parsing requires a closing delimiter on its own line", () => {
  const provider = createSkillDocumentParserProvider(() => ({ name: "demo" }));

  assertThrows(
    () => parseBoundedSkillDocument("---\nname: demo\nbody", provider),
    SyntaxError,
    "closing frontmatter delimiter",
  );

  let received = "";
  const observingProvider = createSkillDocumentParserProvider((source) => {
    received = source;
    return { name: "demo" };
  });
  const parsed = parseBoundedSkillDocument(
    "---\nname: demo\ndescription: contains --- inline\n---\nbody",
    observingProvider,
  );
  assertEquals(received, "name: demo\ndescription: contains --- inline");
  assertEquals(parsed.body, "body");
});

Deno.test("Skill frontmatter mappings are detached from provider mutation", () => {
  const allowedTools = ["Read"];
  const metadata = { owner: "ops" };
  const source = {
    name: "demo",
    description: "Demo",
    "allowed-tools": allowedTools,
    metadata,
  };
  const provider = createSkillDocumentParserProvider(() => source);

  const parsed = parseBoundedSkillDocument(
    "---\nname: demo\ndescription: Demo\n---\nbody",
    provider,
  );
  allowedTools[0] = "api:*";
  metadata.owner = "attacker";
  source.name = "mutated";

  assertEquals(parsed.frontmatter, {
    name: "demo",
    description: "Demo",
    "allowed-tools": ["Read"],
    metadata: { owner: "ops" },
  });
});

Deno.test("Skill frontmatter array snapshots do not invoke inherited indexed setters", () => {
  const inherited = Object.getOwnPropertyDescriptor(Array.prototype, "0");
  const provider = createSkillDocumentParserProvider(() => ({
    name: "demo",
    "allowed-tools": ["Read"],
  }));
  let setterCalls = 0;
  let parsed: ReturnType<typeof parseBoundedSkillDocument> | undefined;
  try {
    Object.defineProperty(Array.prototype, "0", {
      configurable: true,
      set(this: unknown[], _value: unknown) {
        setterCalls += 1;
        Object.defineProperty(this, "0", {
          configurable: true,
          enumerable: true,
          value: "api:*",
          writable: true,
        });
      },
    });
    parsed = parseBoundedSkillDocument(
      "---\nname: demo\nallowed-tools: [Read]\n---\nBody",
      provider,
    );
  } finally {
    if (inherited === undefined) {
      delete (Array.prototype as { 0?: unknown })[0];
    } else {
      Object.defineProperty(Array.prototype, "0", inherited);
    }
  }

  assertEquals(setterCalls, 0);
  assertEquals(parsed?.frontmatter, {
    name: "demo",
    "allowed-tools": ["Read"],
  });
});

Deno.test("Skill frontmatter mapping snapshot rejects proxies and accessors without hooks", () => {
  let proxyTrapCalls = 0;
  let accessorCalls = 0;
  const proxied = new Proxy(
    { name: "demo" },
    {
      ownKeys(target) {
        proxyTrapCalls++;
        return Reflect.ownKeys(target);
      },
    },
  );
  const accessor = Object.defineProperty({}, "name", {
    enumerable: true,
    get() {
      accessorCalls++;
      return "demo";
    },
  });

  assertThrows(
    () => snapshotSkillFrontmatterMapping(proxied),
    TypeError,
    "data-only mapping",
  );
  assertThrows(
    () => snapshotSkillFrontmatterMapping({ nested: accessor }),
    TypeError,
    "data-only mapping",
  );
  assertEquals(proxyTrapCalls, 0);
  assertEquals(accessorCalls, 0);
});

Deno.test("Skill frontmatter mapping snapshot rejects non-mappings, cycles, and unsupported values", () => {
  for (const value of [null, "scalar", ["sequence"], new Date(0)]) {
    assertThrows(
      () => snapshotSkillFrontmatterMapping(value),
      TypeError,
      "data-only mapping",
    );
  }

  const cyclic: Record<string, unknown> = {};
  cyclic.self = cyclic;
  assertThrows(
    () => snapshotSkillFrontmatterMapping(cyclic),
    TypeError,
    "data-only mapping",
  );
  assertThrows(
    () => snapshotSkillFrontmatterMapping({ invalid: undefined }),
    TypeError,
    "data-only mapping",
  );
});

Deno.test("Skill frontmatter mapping snapshot enforces its resource bounds", () => {
  let deep: Record<string, unknown> = { leaf: "x" };
  for (let index = 0; index < 40; index += 1) {
    deep = { child: deep };
  }
  assertThrows(
    () => snapshotSkillFrontmatterMapping(deep),
    TypeError,
    "data-only mapping",
    "nesting past the depth bound is rejected instead of recursing",
  );

  let shallow: Record<string, unknown> = { leaf: "x" };
  for (let index = 0; index < 10; index += 1) {
    shallow = { child: shallow };
  }
  assertEquals(
    snapshotSkillFrontmatterMapping(shallow),
    shallow,
    "nesting within the depth bound is still snapshotted",
  );

  const wideMapping: Record<string, unknown> = {};
  for (let index = 0; index <= 2_048; index += 1) {
    wideMapping[`key-${index}`] = "x";
  }
  assertThrows(
    () => snapshotSkillFrontmatterMapping(wideMapping),
    TypeError,
    "data-only mapping",
    "a mapping past the container-entry bound is rejected",
  );

  assertThrows(
    () => snapshotSkillFrontmatterMapping({ list: new Array(2_049).fill("x") }),
    TypeError,
    "data-only mapping",
    "a sequence past the container-entry bound is rejected",
  );

  const manyNodes: Record<string, unknown> = {};
  for (let index = 0; index < 5; index += 1) {
    manyNodes[`list-${index}`] = new Array(2_000).fill("x");
  }
  assertThrows(
    () => snapshotSkillFrontmatterMapping(manyNodes),
    TypeError,
    "data-only mapping",
    "a mapping past the node bound is rejected even when every container fits",
  );
});

Deno.test("bounded Skill document parsing rejects malformed document content", () => {
  let calls = 0;
  const provider = createSkillDocumentParserProvider(() => {
    calls += 1;
    return { name: "demo" };
  });

  assertThrows(
    () => parseBoundedSkillDocument("---\nname: demo\n---\nBody \uD800", provider),
    TypeError,
    "well-formed UTF-16",
    "a lone surrogate in the document fails closed instead of reaching callers",
  );
  assertThrows(
    () => parseBoundedSkillDocument(42 as unknown as string, provider),
    TypeError,
    "must be a string",
    "non-string document content fails closed",
  );
  assertEquals(calls, 0, "the parser provider is never dispatched for malformed content");
});

Deno.test("Skill frontmatter mapping snapshot rejects decoder-created malformed Unicode", () => {
  for (
    const value of [
      { description: "\uD800" },
      { ["key\uDFFF"]: "value" },
    ]
  ) {
    assertThrows(
      () => snapshotSkillFrontmatterMapping(value),
      TypeError,
      "data-only mapping",
    );
  }
});

Deno.test("bounded Skill document parsing detaches provider failures", () => {
  const provider = createSkillDocumentParserProvider(() => {
    throw new SyntaxError(
      "bad token TOP_SECRET_42 \u001b[31m at https://user:secret@example.test/private",
    );
  });

  let error: Error | undefined;
  try {
    parseBoundedSkillDocument(
      "---\nname: [\n---\nbody",
      provider,
    );
  } catch (cause) {
    if (cause instanceof Error) error = cause;
  }
  assertEquals(error?.message, "Skill frontmatter could not be decoded");
  assertEquals(error?.message.includes("TOP_SECRET_42"), false);
  assertEquals(error?.message.includes("\u001b"), false);
});

Deno.test("Skill document parsing does not consult replaced global constructors", () => {
  const weakSetDescriptor = Object.getOwnPropertyDescriptor(globalThis, "WeakSet");
  const typeErrorDescriptor = Object.getOwnPropertyDescriptor(globalThis, "TypeError");
  const syntaxErrorDescriptor = Object.getOwnPropertyDescriptor(globalThis, "SyntaxError");
  const rangeErrorDescriptor = Object.getOwnPropertyDescriptor(globalThis, "RangeError");
  if (
    !weakSetDescriptor || !typeErrorDescriptor || !syntaxErrorDescriptor ||
    !rangeErrorDescriptor
  ) {
    throw new Error("Expected mutable global constructor descriptors");
  }

  let constructorCalls = 0;
  const Replacement = class extends Error {
    constructor() {
      constructorCalls += 1;
      super("replacement constructor executed");
    }
  };
  const provider = createSkillDocumentParserProvider(() => ({ name: "demo" }));
  let parsed: ReturnType<typeof parseBoundedSkillDocument> | undefined;
  let mappingError: unknown;
  let decodeError: unknown;
  let boundsError: unknown;
  try {
    Object.defineProperty(globalThis, "WeakSet", {
      ...weakSetDescriptor,
      value: Replacement,
    });
    Object.defineProperty(globalThis, "TypeError", {
      ...typeErrorDescriptor,
      value: Replacement,
    });
    Object.defineProperty(globalThis, "SyntaxError", {
      ...syntaxErrorDescriptor,
      value: Replacement,
    });
    Object.defineProperty(globalThis, "RangeError", {
      ...rangeErrorDescriptor,
      value: Replacement,
    });

    parsed = parseBoundedSkillDocument("---\nname: demo\n---\nBody", provider);
    try {
      snapshotSkillFrontmatterMapping({ invalid: undefined });
    } catch (error) {
      mappingError = error;
    }
    try {
      parseBoundedSkillDocument(
        "---\nname: [\n---\nBody",
        createSkillDocumentParserProvider(() => {
          throw new Error("invalid YAML");
        }),
      );
    } catch (error) {
      decodeError = error;
    }
    try {
      parseBoundedSkillDocument("x".repeat(1_048_577), provider);
    } catch (error) {
      boundsError = error;
    }
  } finally {
    Object.defineProperty(globalThis, "WeakSet", weakSetDescriptor);
    Object.defineProperty(globalThis, "TypeError", typeErrorDescriptor);
    Object.defineProperty(globalThis, "SyntaxError", syntaxErrorDescriptor);
    Object.defineProperty(globalThis, "RangeError", rangeErrorDescriptor);
  }

  assertEquals(parsed?.frontmatter, { name: "demo" });
  assertEquals(mappingError?.constructor, TypeError);
  assertEquals(decodeError?.constructor, SyntaxError);
  assertEquals(boundsError?.constructor, RangeError);
  assertEquals(constructorCalls, 0);
});
