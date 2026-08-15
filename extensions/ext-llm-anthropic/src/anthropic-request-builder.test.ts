import { assertEquals, assertExists, assertThrows } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import type {
  ModelRuntimePromptMessage,
  RuntimeAssistantContentPart,
  RuntimePromptMessage,
} from "veryfront/provider/shared";
import { AnthropicServerToolResultError } from "./anthropic-native-content.ts";
import { buildAnthropicMessagesRequest } from "./anthropic-request-builder.ts";

function captureThrownError(
  fn: () => unknown,
  expectedType?: typeof Error,
  messageIncludes?: string,
): Error {
  try {
    fn();
  } catch (error) {
    if (!(error instanceof Error)) throw error;
    const actualName = error.name;
    if (expectedType && !(error instanceof expectedType)) {
      throw new Error(`Expected ${expectedType.name}, received ${actualName}`);
    }
    if (messageIncludes && !error.message.includes(messageIncludes)) {
      throw new Error(`Expected error message to include ${messageIncludes}`);
    }
    return error;
  }
  throw new Error("Expected function to throw");
}

function createWarningCollector() {
  const warnings: Array<{
    type: "unsupported-setting" | "other";
    setting?: string;
    details?: string;
    provider: string;
  }> = [];

  return {
    push(warning: {
      type: "unsupported-setting" | "other";
      setting?: string;
      details?: string;
      provider: string;
    }) {
      warnings.push(warning);
    },
    drain() {
      return warnings.slice();
    },
  };
}

async function runNoBrandEval(script: string): Promise<unknown> {
  const output = await new Deno.Command(Deno.execPath(), {
    args: ["eval", "--config=deno.json", script],
    cwd: new URL("../../../", import.meta.url),
    stdout: "piped",
    stderr: "piped",
  }).output();
  const stderr = new TextDecoder().decode(output.stderr);
  assertEquals(output.code, 0, stderr);
  return JSON.parse(new TextDecoder().decode(output.stdout));
}

describe("ext-llm-anthropic/anthropic-request-builder", () => {
  it("keeps a cached static system block separate from the uncached dynamic tail", () => {
    const body = buildAnthropicMessagesRequest(
      "claude-sonnet-4-5-20250929",
      "anthropic",
      {
        prompt: [
          {
            role: "system",
            content: "Shared prompt",
            providerOptions: {
              anthropic: { cacheControl: { type: "ephemeral", ttl: "1h" } },
            },
          },
          { role: "system", content: "Dynamic tail" },
          { role: "user", content: [{ type: "text", text: "Hello" }] },
        ],
      },
      false,
      createWarningCollector(),
    );

    assertEquals(body.system, [
      {
        type: "text",
        text: "Shared prompt",
        cache_control: { type: "ephemeral", ttl: "1h" },
      },
      { type: "text", text: "Dynamic tail" },
    ]);
  });

  it("uses the provider alias and normalizes the default cache TTL", () => {
    const buildSystem = (providerName: string) =>
      buildAnthropicMessagesRequest(
        "claude-sonnet-4-5-20250929",
        providerName,
        {
          prompt: [
            {
              role: "system",
              content: "Shared prompt",
              providerOptions: {
                anthropic: { cacheControl: { type: "ephemeral", ttl: "5m" } },
                bedrock: { cacheControl: { type: "ephemeral", ttl: "1h" } },
              },
            },
            { role: "user", content: [{ type: "text", text: "Hello" }] },
          ],
        },
        false,
        createWarningCollector(),
      ).system;

    assertEquals(buildSystem("anthropic"), [{
      type: "text",
      text: "Shared prompt",
      cache_control: { type: "ephemeral" },
    }]);
    assertEquals(buildSystem("bedrock"), [{
      type: "text",
      text: "Shared prompt",
      cache_control: { type: "ephemeral", ttl: "1h" },
    }]);
  });

  it("does not let an undefined provider alias hide the canonical cache control", () => {
    const body = buildAnthropicMessagesRequest(
      "claude-sonnet-4-5-20250929",
      "bedrock",
      {
        prompt: [
          {
            role: "system",
            content: "Shared prompt",
            providerOptions: {
              anthropic: { cacheControl: { type: "ephemeral", ttl: "1h" } },
              bedrock: { cacheControl: undefined },
            },
          },
          { role: "user", content: [{ type: "text", text: "Hello" }] },
        ],
      },
      false,
      createWarningCollector(),
    );

    assertEquals(body.system, [{
      type: "text",
      text: "Shared prompt",
      cache_control: { type: "ephemeral", ttl: "1h" },
    }]);
  });

  it("applies the call-level cache breakpoint to the final system block", () => {
    const body = buildAnthropicMessagesRequest(
      "claude-sonnet-4-5-20250929",
      "anthropic",
      {
        prompt: [
          {
            role: "system",
            content: "Shared prompt",
            providerOptions: {
              anthropic: { cacheControl: { type: "ephemeral", ttl: "1h" } },
            },
          },
          { role: "system", content: "Dynamic tail" },
          { role: "user", content: [{ type: "text", text: "Hello" }] },
        ],
        cacheControl: { system: true },
      },
      false,
      createWarningCollector(),
    );

    assertEquals(body.system, [
      {
        type: "text",
        text: "Shared prompt",
        cache_control: { type: "ephemeral", ttl: "1h" },
      },
      {
        type: "text",
        text: "Dynamic tail",
        cache_control: { type: "ephemeral" },
      },
    ]);
  });

  it("retains later system cache breakpoints ahead of tool breakpoints", () => {
    const cachedSystem = (content: string) => ({
      role: "system" as const,
      content,
      providerOptions: {
        anthropic: { cacheControl: { type: "ephemeral" } },
      },
    });
    const body = buildAnthropicMessagesRequest(
      "claude-sonnet-4-5-20250929",
      "anthropic",
      {
        prompt: [
          cachedSystem("First system breakpoint"),
          cachedSystem("Second system breakpoint"),
          cachedSystem("Third system breakpoint"),
          cachedSystem("Interactive final breakpoint"),
          { role: "user", content: [{ type: "text", text: "Hello" }] },
        ],
        tools: [{
          type: "function",
          name: "lookup",
          description: "Look up a value",
          inputSchema: { jsonSchema: { type: "object", properties: {} } },
        }],
        cacheControl: { tools: true },
      },
      false,
      createWarningCollector(),
    );

    const system = body.system as Array<Record<string, unknown>>;
    const tools = body.tools as Array<Record<string, unknown>>;
    assertEquals(
      system.filter((block) => block.cache_control !== undefined).length +
        tools.filter((tool) => tool.cache_control !== undefined).length,
      4,
    );
    assertEquals(system[0]?.cache_control, { type: "ephemeral" });
    assertEquals(tools[0]?.cache_control, undefined);
  });

  it("counts every emitted tool cache breakpoint in the request budget", () => {
    const cachedSystem = (content: string) => ({
      role: "system" as const,
      content,
      providerOptions: {
        anthropic: { cacheControl: { type: "ephemeral" as const } },
      },
    });
    const body = buildAnthropicMessagesRequest(
      "claude-sonnet-4-6",
      "anthropic",
      {
        prompt: [
          cachedSystem("First system breakpoint"),
          cachedSystem("Second system breakpoint"),
          cachedSystem("Interactive final breakpoint"),
          { role: "user", content: [{ type: "text", text: "Hello" }] },
        ],
        mcpServers: [{
          type: "url",
          url: "https://mcp.example.test",
          name: "docs",
        }],
        tools: [{
          type: "provider",
          name: "docs",
          id: "anthropic.mcp_toolset",
          args: { cacheControl: { type: "ephemeral", ttl: "1h" } },
        }, {
          type: "function",
          name: "lookup",
          description: "Look up a value",
          inputSchema: { jsonSchema: { type: "object", properties: {} } },
        }],
        cacheControl: { tools: true },
      },
      false,
      createWarningCollector(),
    );

    const system = body.system as Array<Record<string, unknown>>;
    const tools = body.tools as Array<Record<string, unknown>>;
    assertEquals(
      system.filter((block) => block.cache_control !== undefined).length +
        tools.filter((tool) => tool.cache_control !== undefined).length,
      4,
    );
    assertEquals(system[0]?.cache_control, { type: "ephemeral" });
    assertEquals(system[1]?.cache_control, { type: "ephemeral" });
    assertEquals(tools.map((tool) => tool.cache_control), [
      undefined,
      { type: "ephemeral" },
    ]);
  });

  it("upgrades retained tool breakpoints before a 1h system breakpoint", () => {
    const body = buildAnthropicMessagesRequest(
      "claude-sonnet-4-6",
      "anthropic",
      {
        prompt: [
          {
            role: "system",
            content: "Interactive system prompt",
            providerOptions: {
              anthropic: { cacheControl: { type: "ephemeral", ttl: "1h" } },
            },
          },
          { role: "user", content: [{ type: "text", text: "Hello" }] },
        ],
        tools: [{
          type: "provider",
          name: "search",
          id: "anthropic.web_search",
          args: { cacheControl: { type: "ephemeral" } },
        }, {
          type: "function",
          name: "lookup",
          description: "Look up a value",
          inputSchema: { jsonSchema: { type: "object", properties: {} } },
        }],
        cacheControl: { tools: true },
      },
      false,
      createWarningCollector(),
    );

    assertEquals(
      (body.tools as Array<Record<string, unknown>>).map((tool) => tool.cache_control),
      [
        { type: "ephemeral", ttl: "1h" },
        { type: "ephemeral", ttl: "1h" },
      ],
    );
    assertEquals(body.system, [{
      type: "text",
      text: "Interactive system prompt",
      cache_control: { type: "ephemeral", ttl: "1h" },
    }]);
  });

  it("rejects boxed cache strings before emitting mixed TTL requests", () => {
    assertThrows(
      () =>
        buildAnthropicMessagesRequest(
          "claude-sonnet-4-6",
          "anthropic",
          {
            prompt: [{ role: "user", content: [{ type: "text", text: "Hello" }] }],
            providerOptions: {
              anthropic: {
                tools: [{
                  name: "lookup",
                  input_schema: { type: "object", properties: {} },
                  cache_control: {
                    type: new String("ephemeral"),
                    ttl: new String("5m"),
                  },
                }],
              },
            },
          },
          false,
          createWarningCollector(),
        ),
      TypeError,
      "Anthropic cache strings must use primitive string values",
    );
  });

  it("rejects boxed cache string coercion hooks without invoking them", () => {
    for (const hookKey of ["toString", Symbol.toPrimitive]) {
      let hookCalls = 0;
      const ttl = new String("5m");
      Object.defineProperty(ttl, hookKey, {
        value() {
          hookCalls += 1;
          return "1h";
        },
      });

      assertThrows(
        () =>
          buildAnthropicMessagesRequest(
            "claude-sonnet-4-6",
            "anthropic",
            {
              prompt: [{ role: "user", content: [{ type: "text", text: "Hello" }] }],
              providerOptions: {
                anthropic: {
                  tools: [{
                    name: "lookup",
                    input_schema: { type: "object", properties: {} },
                    cache_control: { type: "ephemeral", ttl },
                  }],
                },
              },
            },
            false,
            createWarningCollector(),
          ),
        TypeError,
        "Anthropic cache strings must use primitive string values",
      );
      assertEquals(hookCalls, 0);
    }
  });

  it("uses the captured boxed-string brand check", async () => {
    const result = await runNoBrandEval(`
      const { buildAnthropicMessagesRequest } = await import(
        "./extensions/ext-llm-anthropic/src/anthropic-request-builder.ts"
      );
      let hookCalls = 0;
      Object.defineProperty(String.prototype, "valueOf", {
        configurable: true,
        value() {
          hookCalls += 1;
          throw new Error("mutable prototype hook");
        },
        writable: true,
      });

      let error;
      try {
        buildAnthropicMessagesRequest(
          "claude-sonnet-4-6",
          "anthropic",
          {
            prompt: [{ role: "user", content: [{ type: "text", text: "Hello" }] }],
            providerOptions: {
              anthropic: {
                tools: [{
                  name: "lookup",
                  input_schema: { type: "object", properties: {} },
                  cache_control: { type: "ephemeral", ttl: new String("5m") },
                }],
              },
            },
          },
          false,
          { push() {}, drain() { return []; } },
        );
      } catch (thrown) {
        error = thrown instanceof Error ? thrown.message : String(thrown);
      }
      console.log(JSON.stringify({ error, hookCalls }));
    `);

    assertEquals(result, {
      error: "Anthropic cache strings must use primitive string values",
      hookCalls: 0,
    });
  });

  it("rejects edge-runtime Proxy cache fields without invoking traps", async () => {
    const result = await runNoBrandEval(`
      Object.defineProperty(globalThis, "caches", {
        configurable: true,
        value: {},
      });
      Object.defineProperty(globalThis, "WebSocketPair", {
        configurable: true,
        value: function WebSocketPair() {},
      });

      const { canIdentifyProxyWithoutHooks } = await import(
        "./src/platform/compat/error-introspection.ts"
      );
      const { buildAnthropicMessagesRequest } = await import(
        "./extensions/ext-llm-anthropic/src/anthropic-request-builder.ts"
      );
      const warnings = { push() {}, drain() { return []; } };
      const prompt = [{ role: "user", content: [{ type: "text", text: "Hello" }] }];
      const plain = buildAnthropicMessagesRequest(
        "claude-sonnet-4-6",
        "anthropic",
        {
          prompt,
          providerOptions: {
            anthropic: {
              messages: [{
                role: "user",
                content: [{
                  type: "text",
                  text: "Cached",
                  cache_control: { type: "ephemeral" },
                }],
              }],
            },
          },
        },
        false,
        warnings,
      );

      let trapCalls = 0;
      const block = new Proxy(
        {
          type: "text",
          text: "Cached",
          cache_control: { type: "ephemeral" },
        },
        {
          getOwnPropertyDescriptor(target, property) {
            trapCalls += 1;
            return Reflect.getOwnPropertyDescriptor(target, property);
          },
        },
      );
      let error;
      try {
        buildAnthropicMessagesRequest(
          "claude-sonnet-4-6",
          "anthropic",
          {
            prompt,
            providerOptions: {
              anthropic: {
                messages: [{ role: "user", content: [block] }],
              },
            },
          },
          false,
          warnings,
        );
      } catch (thrown) {
        error = thrown instanceof Error ? thrown.message : String(thrown);
      }

      console.log(JSON.stringify({
        canIdentifyProxyWithoutHooks,
        error,
        plainCacheControl: plain.messages[0].content[0].cache_control,
        trapCalls,
      }));
    `);

    assertEquals(result, {
      canIdentifyProxyWithoutHooks: false,
      error: "Anthropic provider options could not be inspected",
      plainCacheControl: { type: "ephemeral" },
      trapCalls: 0,
    });
  });

  it("ignores non-emitted cache metadata when normalizing mixed TTLs", () => {
    const metadataKey = Symbol("metadata");
    const cacheControl: Record<PropertyKey, unknown> = {
      type: "ephemeral",
      optional: undefined,
    };
    Object.defineProperty(cacheControl, "hidden", {
      enumerable: false,
      value: "not serialized",
    });
    cacheControl[metadataKey] = "not serialized";

    const body = buildAnthropicMessagesRequest(
      "claude-sonnet-4-6",
      "anthropic",
      {
        prompt: [
          {
            role: "system",
            content: "Interactive system prompt",
            providerOptions: {
              anthropic: { cacheControl: { type: "ephemeral", ttl: "1h" } },
            },
          },
          { role: "user", content: [{ type: "text", text: "Hello" }] },
        ],
        providerOptions: {
          anthropic: {
            tools: [{
              name: "lookup",
              input_schema: { type: "object", properties: {} },
              cache_control: cacheControl,
            }],
          },
        },
      },
      false,
      createWarningCollector(),
    );

    assertEquals((body.tools as Array<Record<string, unknown>>)[0]?.cache_control, {
      type: "ephemeral",
      ttl: "1h",
    });
  });

  it("treats JSON-omitted cache TTL values as absent", () => {
    for (const ttl of [() => "5m", Symbol("5m")]) {
      const body = buildAnthropicMessagesRequest(
        "claude-sonnet-4-6",
        "anthropic",
        {
          prompt: [
            {
              role: "system",
              content: "Interactive system prompt",
              providerOptions: {
                anthropic: { cacheControl: { type: "ephemeral", ttl: "1h" } },
              },
            },
            { role: "user", content: [{ type: "text", text: "Hello" }] },
          ],
          providerOptions: {
            anthropic: {
              tools: [{
                name: "lookup",
                input_schema: { type: "object", properties: {} },
                cache_control: { type: "ephemeral", ttl },
              }],
            },
          },
        },
        false,
        createWarningCollector(),
      );

      assertEquals((body.tools as Array<Record<string, unknown>>)[0]?.cache_control, {
        type: "ephemeral",
        ttl: "1h",
      });
    }
  });

  it("ignores JSON-omitted cache controls in the breakpoint budget", () => {
    const body = buildAnthropicMessagesRequest(
      "claude-sonnet-4-6",
      "anthropic",
      {
        prompt: [
          {
            role: "system",
            content: "Interactive system prompt",
            providerOptions: {
              anthropic: { cacheControl: { type: "ephemeral", ttl: "1h" } },
            },
          },
          { role: "user", content: [{ type: "text", text: "Hello" }] },
        ],
        providerOptions: {
          anthropic: {
            messages: [{
              role: "user",
              content: Array.from({ length: 4 }, (_, index) => ({
                type: "text",
                text: `Uncached ${index}`,
                cache_control: index % 2 === 0 ? () => "ignored" : Symbol("ignored"),
              })),
            }],
          },
        },
      },
      false,
      createWarningCollector(),
    );

    assertEquals((body.system as Array<Record<string, unknown>>)[0]?.cache_control, {
      type: "ephemeral",
      ttl: "1h",
    });
  });

  it("budgets raw message breakpoints without invoking array entries overrides", () => {
    let entriesCalls = 0;
    const content = Array.from({ length: 5 }, (_, index) => ({
      type: "text",
      text: `Cached ${index}`,
      cache_control: { type: "ephemeral" },
    }));
    Object.defineProperty(content, "entries", {
      enumerable: true,
      value() {
        entriesCalls += 1;
        return [][Symbol.iterator]();
      },
    });

    const body = buildAnthropicMessagesRequest(
      "claude-sonnet-4-6",
      "anthropic",
      {
        prompt: [{ role: "user", content: [{ type: "text", text: "Hello" }] }],
        providerOptions: {
          anthropic: {
            messages: [{ role: "user", content }],
          },
        },
      },
      false,
      createWarningCollector(),
    );

    assertEquals(entriesCalls, 0);
    assertEquals(body.messages[0]?.content[0]?.cache_control, undefined);
    assertEquals(
      body.messages[0]?.content
        .filter((block: Record<string, unknown>) => block.cache_control !== undefined)
        .length,
      4,
    );
  });

  it("budgets raw tool breakpoints without invoking array method overrides", () => {
    let flatMapCalls = 0;
    const tools = Array.from({ length: 5 }, (_, index) => ({
      name: `lookup-${index}`,
      input_schema: { type: "object", properties: {} },
      cache_control: { type: "ephemeral" },
    }));
    Object.defineProperty(tools, "flatMap", {
      enumerable: true,
      value() {
        flatMapCalls += 1;
        return [];
      },
    });

    const body = buildAnthropicMessagesRequest(
      "claude-sonnet-4-6",
      "anthropic",
      {
        prompt: [{ role: "user", content: [{ type: "text", text: "Hello" }] }],
        providerOptions: { anthropic: { tools } },
      },
      false,
      createWarningCollector(),
    );

    const emitted = body.tools as Array<Record<string, unknown>>;
    assertEquals(flatMapCalls, 0);
    assertEquals(emitted[0]?.cache_control, undefined);
    assertEquals(
      emitted.filter((tool) => tool.cache_control !== undefined).length,
      4,
    );
  });

  it("rejects cache-affecting toJSON hooks without invoking them", () => {
    for (
      const placement of [
        "request",
        "messages",
        "message",
        "block",
        "cache-control",
      ] as const
    ) {
      let hookCalls = 0;
      const toJSON = () => {
        hookCalls += 1;
        return undefined;
      };
      const cacheControl = placement === "cache-control"
        ? { type: "ephemeral", toJSON }
        : { type: "ephemeral" };
      const block = {
        type: "text",
        text: "Cached",
        cache_control: cacheControl,
        ...(placement === "block" ? { toJSON } : {}),
      };
      const message = {
        role: "user",
        content: [block],
        ...(placement === "message" ? { toJSON } : {}),
      };
      const messages = [message];
      if (placement === "messages") {
        Object.defineProperty(messages, "toJSON", {
          enumerable: true,
          value: toJSON,
        });
      }
      const anthropic = {
        messages,
        ...(placement === "request" ? { toJSON } : {}),
      };

      assertThrows(
        () =>
          buildAnthropicMessagesRequest(
            "claude-sonnet-4-6",
            "anthropic",
            {
              prompt: [{ role: "user", content: [{ type: "text", text: "Hello" }] }],
              providerOptions: { anthropic },
            },
            false,
            createWarningCollector(),
          ),
        TypeError,
        "Anthropic cache inputs must not define toJSON hooks",
      );
      assertEquals(hookCalls, 0);
    }
  });

  it("rejects function-valued cache toJSON hooks without invoking them", () => {
    for (const placement of ["cache-control", "type"] as const) {
      for (const inherited of [false, true]) {
        let hookCalls = 0;
        const toJSON = () => {
          hookCalls += 1;
          return placement === "cache-control" ? { type: "ephemeral" } : "ephemeral";
        };
        const hookedFunction = () => undefined;
        if (inherited) {
          Object.setPrototypeOf(
            hookedFunction,
            Object.create(Function.prototype, {
              toJSON: { configurable: true, value: toJSON },
            }),
          );
        } else {
          Object.defineProperty(hookedFunction, "toJSON", {
            configurable: true,
            value: toJSON,
          });
        }
        const cacheControl = placement === "cache-control"
          ? hookedFunction
          : { type: hookedFunction };

        assertThrows(
          () =>
            buildAnthropicMessagesRequest(
              "claude-sonnet-4-6",
              "anthropic",
              {
                prompt: [{ role: "user", content: [{ type: "text", text: "Hello" }] }],
                providerOptions: {
                  anthropic: {
                    messages: [{
                      role: "user",
                      content: [{
                        type: "text",
                        text: "Cached",
                        cache_control: cacheControl,
                      }],
                    }],
                  },
                },
              },
              false,
              createWarningCollector(),
            ),
          TypeError,
          "Anthropic cache inputs must not define toJSON hooks",
        );
        assertEquals(hookCalls, 0);
      }
    }
  });

  it("rejects non-array message content hooks without invoking them", () => {
    for (const contentType of ["object", "function"] as const) {
      let hookCalls = 0;
      const toJSON = () => {
        hookCalls += 1;
        return Array.from({ length: 5 }, (_, index) => ({
          type: "text",
          text: `Cached ${index}`,
          cache_control: { type: "ephemeral" },
        }));
      };
      const content = contentType === "object"
        ? { toJSON }
        : Object.assign(() => undefined, { toJSON });

      assertThrows(
        () =>
          buildAnthropicMessagesRequest(
            "claude-sonnet-4-6",
            "anthropic",
            {
              prompt: [{ role: "user", content: [{ type: "text", text: "Hello" }] }],
              providerOptions: {
                anthropic: { messages: [{ role: "user", content }] },
              },
            },
            false,
            createWarningCollector(),
          ),
        TypeError,
        "Anthropic cache inputs must not define toJSON hooks",
      );
      assertEquals(hookCalls, 0);
    }
  });

  it("rejects non-array message content proxies without invoking them", () => {
    let trapCalls = 0;
    const content = new Proxy({}, {
      get() {
        trapCalls += 1;
        return undefined;
      },
    });

    assertThrows(
      () =>
        buildAnthropicMessagesRequest(
          "claude-sonnet-4-6",
          "anthropic",
          {
            prompt: [{ role: "user", content: [{ type: "text", text: "Hello" }] }],
            providerOptions: {
              anthropic: { messages: [{ role: "user", content }] },
            },
          },
          false,
          createWarningCollector(),
        ),
      TypeError,
      "Anthropic cache inputs must not contain Proxy values",
    );
    assertEquals(trapCalls, 0);
  });

  it("preserves primitive raw message content", () => {
    const body = buildAnthropicMessagesRequest(
      "claude-sonnet-4-6",
      "anthropic",
      {
        prompt: [{ role: "user", content: [{ type: "text", text: "Hello" }] }],
        providerOptions: {
          anthropic: { messages: [{ role: "user", content: "Raw message" }] },
        },
      },
      false,
      createWarningCollector(),
    );

    assertEquals(
      (body.messages[0] as unknown as { content: unknown }).content,
      "Raw message",
    );
  });

  it("rejects toJSON hooks nested inside cache-control values", () => {
    let hookCalls = 0;
    const toJSON = () => {
      hookCalls += 1;
      return "ephemeral";
    };

    assertThrows(
      () =>
        buildAnthropicMessagesRequest(
          "claude-sonnet-4-6",
          "anthropic",
          {
            prompt: [{ role: "user", content: [{ type: "text", text: "Hello" }] }],
            providerOptions: {
              anthropic: {
                messages: [{
                  role: "user",
                  content: [{
                    type: "text",
                    text: "Cached",
                    cache_control: { type: { toJSON } },
                  }],
                }],
              },
            },
          },
          false,
          createWarningCollector(),
        ),
      TypeError,
      "Anthropic cache inputs must not define toJSON hooks",
    );
    assertEquals(hookCalls, 0);
  });

  it("rejects Proxy cache inputs without invoking synthesized hooks", () => {
    let hookCalls = 0;
    const toJSON = () => {
      hookCalls += 1;
      return undefined;
    };
    const block = new Proxy(
      {
        type: "text",
        text: "Cached",
        cache_control: { type: "ephemeral" },
      },
      {
        get(target, property, receiver) {
          if (property === "toJSON") return toJSON;
          return Reflect.get(target, property, receiver);
        },
      },
    );

    assertThrows(
      () =>
        buildAnthropicMessagesRequest(
          "claude-sonnet-4-6",
          "anthropic",
          {
            prompt: [{ role: "user", content: [{ type: "text", text: "Hello" }] }],
            providerOptions: {
              anthropic: {
                messages: [{ role: "user", content: [block] }],
              },
            },
          },
          false,
          createWarningCollector(),
        ),
      TypeError,
      "Anthropic cache inputs must not contain Proxy values",
    );
    assertEquals(hookCalls, 0);
  });

  it("rejects malformed raw request collections before cache processing", () => {
    for (
      const [field, value, message] of [
        ["messages", {}, "Anthropic messages must be an array"],
        ["system", {}, "Anthropic system must be a string or an array"],
        ["tools", {}, "Anthropic tools must be an array"],
        ["tools", null, "Anthropic tools must be an array"],
      ] as const
    ) {
      assertThrows(
        () =>
          buildAnthropicMessagesRequest(
            "claude-sonnet-4-6",
            "anthropic",
            {
              prompt: [{ role: "user", content: [{ type: "text", text: "Hello" }] }],
              providerOptions: { anthropic: { [field]: value } },
            },
            false,
            createWarningCollector(),
          ),
        TypeError,
        message,
      );
    }
  });

  it("preserves a raw string system prompt supported by Anthropic", () => {
    const body = buildAnthropicMessagesRequest(
      "claude-sonnet-4-6",
      "anthropic",
      {
        prompt: [{ role: "user", content: [{ type: "text", text: "Hello" }] }],
        providerOptions: { anthropic: { system: "Raw system prompt" } },
      },
      false,
      createWarningCollector(),
    );

    assertEquals(body.system, "Raw system prompt");
  });

  it("upgrades retained prefix breakpoints before a 1h message breakpoint", () => {
    const body = buildAnthropicMessagesRequest(
      "claude-sonnet-4-6",
      "anthropic",
      {
        prompt: [
          {
            role: "system",
            content: "Shared system prompt",
            providerOptions: {
              anthropic: { cacheControl: { type: "ephemeral" } },
            },
          },
          { role: "user", content: [{ type: "text", text: "Hello" }] },
        ],
        tools: [{
          type: "function",
          name: "lookup",
          description: "Look up a value",
          inputSchema: { jsonSchema: { type: "object", properties: {} } },
        }],
        cacheControl: { tools: true },
        providerOptions: {
          anthropic: {
            messages: [{
              role: "user",
              content: [{
                type: "text",
                text: "Cached conversation",
                cache_control: { type: "ephemeral", ttl: "1h" },
              }],
            }],
          },
        },
      },
      false,
      createWarningCollector(),
    );

    assertEquals((body.tools as Array<Record<string, unknown>>)[0]?.cache_control, {
      type: "ephemeral",
      ttl: "1h",
    });
    assertEquals((body.system as Array<Record<string, unknown>>)[0]?.cache_control, {
      type: "ephemeral",
      ttl: "1h",
    });
    assertEquals(body.messages[0]?.content[0]?.cache_control, {
      type: "ephemeral",
      ttl: "1h",
    });
  });

  it("retains at most four tool cache breakpoints", () => {
    const tools = Array.from({ length: 5 }, (_, index) => ({
      type: "provider" as const,
      name: `web-${index}`,
      id: "anthropic.web_search" as const,
      args: { cacheControl: { type: "ephemeral" as const } },
    }));
    const body = buildAnthropicMessagesRequest(
      "claude-sonnet-4-6",
      "anthropic",
      {
        prompt: [{ role: "user", content: [{ type: "text", text: "Search" }] }],
        tools,
      },
      false,
      createWarningCollector(),
    );
    const emittedTools = body.tools as Array<Record<string, unknown>>;

    assertEquals(
      emittedTools.filter((tool) => tool.cache_control !== undefined).length,
      4,
    );
    assertEquals(emittedTools[0]?.cache_control, undefined);
    assertEquals(emittedTools[4]?.cache_control, { type: "ephemeral" });
  });

  it("counts message-content cache breakpoints in the request budget", () => {
    const cachedSystem = (content: string) => ({
      role: "system" as const,
      content,
      providerOptions: {
        anthropic: { cacheControl: { type: "ephemeral" as const } },
      },
    });
    const body = buildAnthropicMessagesRequest(
      "claude-sonnet-4-6",
      "anthropic",
      {
        prompt: [
          cachedSystem("First system breakpoint"),
          cachedSystem("Second system breakpoint"),
          cachedSystem("Third system breakpoint"),
          cachedSystem("Fourth system breakpoint"),
          { role: "user", content: [{ type: "text", text: "Hello" }] },
        ],
        providerOptions: {
          anthropic: {
            messages: [{
              role: "user",
              content: [{
                type: "text",
                text: "Raw provider message",
                cache_control: { type: "ephemeral" },
              }],
            }],
          },
        },
      },
      false,
      createWarningCollector(),
    );

    const system = body.system as Array<Record<string, unknown>>;
    const messageContent = body.messages.flatMap((message) => message.content);
    assertEquals(
      system.filter((block) => block.cache_control !== undefined).length +
        messageContent.filter((block) => block.cache_control !== undefined).length,
      4,
    );
    assertEquals(system[0], { type: "text", text: "First system breakpoint" });
    assertEquals(messageContent[0]?.cache_control, { type: "ephemeral" });
  });

  it("ignores inherited tool cache metadata", () => {
    const inheritedCacheControl = {
      cache_control: { type: "ephemeral" },
    };
    const inheritedTools = Array.from(
      { length: 4 },
      (_, index) =>
        Object.assign(Object.create(inheritedCacheControl), {
          name: `inherited-${index}`,
          input_schema: { type: "object", properties: {} },
        }) as Record<string, unknown>,
    );
    const body = buildAnthropicMessagesRequest(
      "claude-sonnet-4-6",
      "anthropic",
      {
        prompt: [{
          role: "system",
          content: "Shared prompt",
          providerOptions: {
            anthropic: { cacheControl: { type: "ephemeral" } },
          },
        }, {
          role: "user",
          content: [{ type: "text", text: "Hello" }],
        }],
        providerOptions: {
          anthropic: { tools: inheritedTools },
        },
      },
      false,
      createWarningCollector(),
    );

    assertEquals(body.system, [{
      type: "text",
      text: "Shared prompt",
      cache_control: { type: "ephemeral" },
    }]);
  });

  it("rejects tool cache metadata accessors without invoking them", () => {
    let getterCalls = 0;
    const accessorTool = Object.defineProperty(
      {
        name: "accessor",
        input_schema: { type: "object", properties: {} },
      },
      "cache_control",
      {
        enumerable: true,
        get() {
          getterCalls += 1;
          return { type: "ephemeral" };
        },
      },
    );

    assertThrows(
      () =>
        buildAnthropicMessagesRequest(
          "claude-sonnet-4-6",
          "anthropic",
          {
            prompt: [{ role: "user", content: [{ type: "text", text: "Hello" }] }],
            providerOptions: {
              anthropic: { tools: [accessorTool] },
            },
          },
          false,
          createWarningCollector(),
        ),
      TypeError,
      "Anthropic cache_control must be an own enumerable data property",
    );
    assertEquals(getterCalls, 0);
  });

  it("rejects nested cache-control accessors without invoking them", () => {
    for (const [placement, field] of [["tool", "type"], ["message", "ttl"]] as const) {
      let getterCalls = 0;
      const cacheControl = Object.defineProperty(
        { type: "ephemeral" },
        field,
        {
          configurable: true,
          enumerable: true,
          get() {
            getterCalls += 1;
            return field === "type" ? "ephemeral" : "5m";
          },
        },
      );
      const anthropic = placement === "tool"
        ? {
          tools: [{
            name: "lookup",
            input_schema: { type: "object", properties: {} },
            cache_control: cacheControl,
          }],
        }
        : {
          messages: [{
            role: "user",
            content: [{ type: "text", text: "Cached", cache_control: cacheControl }],
          }],
        };

      assertThrows(
        () =>
          buildAnthropicMessagesRequest(
            "claude-sonnet-4-6",
            "anthropic",
            {
              prompt: [{ role: "user", content: [{ type: "text", text: "Hello" }] }],
              providerOptions: { anthropic },
            },
            false,
            createWarningCollector(),
          ),
        TypeError,
        "Anthropic cache_control must contain only enumerable data properties",
      );
      assertEquals(getterCalls, 0);
    }
  });

  it("rejects system cache metadata accessors without invoking them", () => {
    let accessed = false;
    const cacheControl = Object.defineProperty({}, "type", {
      enumerable: true,
      get() {
        accessed = true;
        return "ephemeral";
      },
    });

    assertThrows(
      () =>
        buildAnthropicMessagesRequest(
          "claude-sonnet-4-5-20250929",
          "anthropic",
          {
            prompt: [
              {
                role: "system",
                content: "Shared prompt",
                providerOptions: { anthropic: { cacheControl } },
              },
              { role: "user", content: [{ type: "text", text: "Hello" }] },
            ],
          },
          false,
          createWarningCollector(),
        ),
      TypeError,
      "only enumerable data properties",
    );
    assertEquals(accessed, false);
  });

  it("rejects system provider-options accessors without invoking them", () => {
    let accessed = 0;
    const systemMessage = Object.defineProperty(
      { role: "system", content: "Shared prompt" },
      "providerOptions",
      {
        enumerable: true,
        get() {
          accessed += 1;
          return { anthropic: { cacheControl: { type: "ephemeral" } } };
        },
      },
    ) as ModelRuntimePromptMessage;

    assertThrows(
      () =>
        buildAnthropicMessagesRequest(
          "claude-sonnet-4-5-20250929",
          "anthropic",
          {
            prompt: [
              systemMessage,
              { role: "user", content: [{ type: "text", text: "Hello" }] },
            ],
          },
          false,
          createWarningCollector(),
        ),
      TypeError,
      "providerOptions must be an own enumerable data property",
    );
    assertEquals(accessed, 0);
  });

  it("rejects provider cache-control accessors without invoking them", () => {
    let accessed = false;
    const anthropicOptions = Object.defineProperty({}, "cacheControl", {
      enumerable: true,
      get() {
        accessed = true;
        return { type: "ephemeral", ttl: "1h" };
      },
    });

    assertThrows(
      () =>
        buildAnthropicMessagesRequest(
          "claude-sonnet-4-5-20250929",
          "anthropic",
          {
            prompt: [
              {
                role: "system",
                content: "Shared prompt",
                providerOptions: { anthropic: anthropicOptions },
              },
              { role: "user", content: [{ type: "text", text: "Hello" }] },
            ],
          },
          false,
          createWarningCollector(),
        ),
      TypeError,
      "enumerable data propert",
    );
    assertEquals(accessed, false);
  });

  it("preserves Messages request shaping, provider option merge order, and warnings", () => {
    const prompt: RuntimePromptMessage[] = [
      { role: "system", content: "You are careful." },
      {
        role: "user",
        content: [
          { type: "text", text: "Inspect this." },
          { type: "image", mediaType: "image/png", url: "https://example.test/image.png" },
        ],
      },
      {
        role: "assistant",
        content: [
          { type: "text", text: "I will check." },
          {
            type: "tool-call",
            toolCallId: "tool_1",
            toolName: "lookup",
            input: { id: "abc" },
          },
          {
            type: "reasoning",
            text: "Thinking trace",
            signature: "sig_123",
          },
        ],
      },
      {
        role: "tool",
        content: [{
          type: "tool-result",
          toolCallId: "tool_1",
          toolName: "lookup",
          output: { type: "json", value: { ok: true } },
        }],
      },
    ];
    const warnings = createWarningCollector();

    const body = buildAnthropicMessagesRequest(
      "claude-sonnet-4-5-20250929",
      "bedrock",
      {
        prompt,
        maxOutputTokens: 20_000,
        temperature: 0.4,
        topP: 0.9,
        topK: 10,
        stopSequences: ["one", "two", "three", "four", "five"],
        tools: [
          {
            type: "function",
            name: "lookup",
            description: "Look up a value",
            inputSchema: {
              jsonSchema: { type: "object", properties: { id: { type: "string" } } },
            },
          },
          {
            type: "provider",
            name: "web",
            id: "anthropic.web_search",
            args: { maxUses: 2 },
          },
        ],
        toolChoice: "auto",
        seed: 7,
        presencePenalty: 0.1,
        frequencyPenalty: 0.2,
        cacheControl: { system: true, tools: "1h" },
        reasoning: { enabled: true, effort: "high" },
        responseFormat: { type: "json" },
        userId: "user_123",
        mcpServers: [{
          type: "url",
          url: "https://example.test/mcp",
          name: "example-mcp",
          authorizationToken: "token_123",
          toolConfiguration: {
            allowedTools: ["read_file"],
          },
        }],
        anthropicContainer: { id: "ctr_1" },
        providerOptions: {
          anthropic: {
            custom_anthropic: true,
            max_tokens: 222,
          },
          bedrock: {
            custom_bedrock: true,
            temperature: 0.1,
          },
        },
      },
      true,
      warnings,
    );

    assertEquals(body, {
      model: "claude-sonnet-4-5-20250929",
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: "Inspect this." },
            {
              type: "image",
              source: {
                type: "url",
                url: "https://example.test/image.png",
              },
            },
          ],
        },
        {
          role: "assistant",
          content: [
            { type: "text", text: "I will check." },
            {
              type: "tool_use",
              id: "tool_1",
              name: "lookup",
              input: { id: "abc" },
            },
            {
              type: "thinking",
              thinking: "Thinking trace",
              signature: "sig_123",
            },
          ],
        },
        {
          role: "user",
          content: [{
            type: "tool_result",
            tool_use_id: "tool_1",
            content: '{"ok":true}',
          }],
        },
      ],
      max_tokens: 222,
      stream: true,
      system: [{
        type: "text",
        text: "You are careful.",
        cache_control: { type: "ephemeral" },
      }],
      stop_sequences: ["one", "two", "three", "four"],
      tools: [
        {
          name: "lookup",
          description: "Look up a value",
          input_schema: { type: "object", properties: { id: { type: "string" } } },
        },
        {
          type: "web_search_20250305",
          name: "web",
          max_uses: 2,
        },
        {
          type: "mcp_toolset",
          mcp_server_name: "example-mcp",
          default_config: { enabled: false },
          configs: {
            read_file: { enabled: true },
          },
          cache_control: { type: "ephemeral", ttl: "1h" },
        },
      ],
      tool_choice: { type: "auto" },
      thinking: { type: "enabled", budget_tokens: 16_384 },
      metadata: { user_id: "user_123" },
      mcp_servers: [{
        type: "url",
        url: "https://example.test/mcp",
        name: "example-mcp",
        authorization_token: "token_123",
      }],
      container: { id: "ctr_1" },
      custom_anthropic: true,
      custom_bedrock: true,
      temperature: 0.1,
    });
    assertEquals(warnings.drain().map((warning) => warning.setting), [
      "presencePenalty",
      "frequencyPenalty",
      "seed",
      "topK",
      "stopSequences",
      "temperature",
      "topP",
      "responseFormat",
    ]);
  });

  it("maps an explicit generic provider MCP toolset to the matching server identity", () => {
    const body = buildAnthropicMessagesRequest(
      "claude-sonnet-4-6",
      "anthropic",
      {
        prompt: [{ role: "user", content: [{ type: "text", text: "Use docs." }] }],
        mcpServers: [{
          type: "url",
          url: "https://mcp.example.test",
          name: "docs",
        }],
        tools: [{
          type: "provider",
          name: "docs",
          id: "anthropic.mcp_toolset",
          args: {
            defaultConfig: { enabled: false, deferLoading: true },
            configs: {
              searchEvents: { enabled: true, deferLoading: false },
            },
            cacheControl: { type: "ephemeral", ttl: "1h" },
          },
        }],
      },
      false,
      createWarningCollector(),
    );

    assertEquals(body.mcp_servers, [{
      type: "url",
      url: "https://mcp.example.test",
      name: "docs",
    }]);
    assertEquals(body.tools, [{
      type: "mcp_toolset",
      mcp_server_name: "docs",
      default_config: { enabled: false, defer_loading: true },
      configs: {
        searchEvents: { enabled: true, defer_loading: false },
      },
      cache_control: { type: "ephemeral", ttl: "1h" },
    }]);
  });

  it("validates an official raw MCP contract supplied through providerOptions", () => {
    const body = buildAnthropicMessagesRequest(
      "claude-sonnet-4-6",
      "anthropic",
      {
        prompt: [{ role: "user", content: [{ type: "text", text: "Use docs." }] }],
        providerOptions: {
          anthropic: {
            mcp_servers: [{
              type: "url",
              url: "https://mcp.example.test",
              name: "docs",
            }],
            tools: [{
              type: "mcp_toolset",
              mcp_server_name: "docs",
            }],
          },
        },
      },
      false,
      createWarningCollector(),
    );

    assertEquals(body.mcp_servers, [{
      type: "url",
      url: "https://mcp.example.test",
      name: "docs",
    }]);
    assertEquals(body.tools, [{
      type: "mcp_toolset",
      mcp_server_name: "docs",
    }]);
  });

  it("rejects ambiguous MCP configuration sources", () => {
    const prompt: RuntimePromptMessage[] = [
      { role: "user", content: [{ type: "text", text: "Use docs." }] },
    ];
    const server = {
      type: "url",
      url: "https://mcp.example.test",
      name: "docs",
    };
    const explicitToolset = {
      type: "provider" as const,
      name: "docs",
      id: "anthropic.mcp_toolset" as const,
      args: {},
    };

    const ambiguousOptions = [{
      prompt,
      mcpServers: [server],
      providerOptions: {
        anthropic: { mcp_servers: [server] },
      },
    }, {
      prompt,
      mcpServers: [server],
      providerOptions: {
        anthropic: {
          tools: [{ type: "mcp_toolset", mcp_server_name: "docs" }],
        },
      },
    }, {
      prompt,
      mcpServers: [{
        ...server,
        toolConfiguration: { enabled: true },
      }],
      tools: [explicitToolset],
    }];

    for (const options of ambiguousOptions) {
      assertThrows(
        () =>
          buildAnthropicMessagesRequest(
            "claude-sonnet-4-6",
            "anthropic",
            options,
            false,
            createWarningCollector(),
          ),
        TypeError,
      );
    }
  });

  it("replays raw mixed server/client assistant blocks before the local tool result", () => {
    const rawAssistantMessages = [[{
      type: "server_tool_use",
      id: "server_search_1",
      name: "web_search",
      input: { query: "Veryfront" },
    }, {
      type: "tool_use",
      id: "local_lookup_1",
      name: "local_lookup",
      input: { query: "runtime" },
    }]];
    const [rawAssistantContent] = rawAssistantMessages;
    assertExists(rawAssistantContent);
    const prompt = [{
      role: "user",
      content: [{ type: "text", text: "Search and inspect" }],
    }, {
      role: "assistant",
      content: [{
        type: "tool-call",
        toolCallId: "local_lookup_1",
        toolName: "local_lookup",
        input: { query: "runtime" },
      }],
      providerMetadata: { anthropic: { rawAssistantMessages } },
    }, {
      role: "tool",
      content: [{
        type: "tool-result",
        toolCallId: "local_lookup_1",
        toolName: "local_lookup",
        output: { type: "json", value: { matches: 1 } },
      }],
    }] as unknown as RuntimePromptMessage[];

    const body = buildAnthropicMessagesRequest(
      "claude-sonnet-4-6",
      "anthropic",
      { prompt, maxOutputTokens: 64 },
      false,
      createWarningCollector(),
    );

    assertEquals(body.messages, [{
      role: "user",
      content: [{ type: "text", text: "Search and inspect" }],
    }, {
      role: "assistant",
      content: rawAssistantContent,
    }, {
      role: "user",
      content: [{
        type: "tool_result",
        tool_use_id: "local_lookup_1",
        content: '{"matches":1}',
      }],
    }]);
  });

  it("rejects raw client tool tampering when canonical content survives", () => {
    const canonicalCall = {
      type: "tool-call" as const,
      toolCallId: "safe_lookup_1",
      toolName: "safe_lookup",
      input: '{"accountId":"public-account","operation":"read"}',
    };
    const build = (rawToolUse: Record<string, unknown>) =>
      buildAnthropicMessagesRequest(
        "claude-sonnet-4-6",
        "anthropic",
        {
          prompt: [{
            role: "assistant",
            content: [canonicalCall],
            providerMetadata: {
              anthropic: { rawAssistantMessages: [[rawToolUse]] },
            },
          }],
        },
        false,
        createWarningCollector(),
      );
    const safeRawToolUse = {
      type: "tool_use",
      id: "safe_lookup_1",
      name: "safe_lookup",
      input: { accountId: "public-account", operation: "read" },
    };

    assertEquals(build(safeRawToolUse).messages, [{
      role: "assistant",
      content: [safeRawToolUse],
    }]);

    for (
      const tamperedRawToolUse of [
        { ...safeRawToolUse, id: "attacker_selected_id" },
        { ...safeRawToolUse, name: "delete_account" },
        {
          ...safeRawToolUse,
          input: { accountId: "victim-account", operation: "delete" },
        },
      ]
    ) {
      assertThrows(
        () => build(tamperedRawToolUse),
        TypeError,
        "Anthropic raw client tool call does not match canonical client-executed content",
      );
    }
  });

  it("correlates raw client tool calls one-for-one in occurrence order", () => {
    const firstCall = {
      type: "tool-call" as const,
      toolCallId: "lookup_1",
      toolName: "lookup",
      input: { id: 1 },
    };
    const secondCall = {
      type: "tool-call" as const,
      toolCallId: "lookup_2",
      toolName: "lookup",
      input: { id: 2 },
    };
    const firstRawCall = {
      type: "tool_use",
      id: "lookup_1",
      name: "lookup",
      input: { id: 1 },
    };
    const secondRawCall = {
      type: "tool_use",
      id: "lookup_2",
      name: "lookup",
      input: { id: 2 },
    };
    const build = (
      rawCalls: Record<string, unknown>[],
      content = [firstCall, secondCall],
    ) =>
      buildAnthropicMessagesRequest(
        "claude-sonnet-4-6",
        "anthropic",
        {
          prompt: [{
            role: "assistant",
            content,
            providerMetadata: {
              anthropic: { rawAssistantMessages: [rawCalls] },
            },
          }],
        },
        false,
        createWarningCollector(),
      );

    assertEquals(build([firstRawCall, secondRawCall]).messages, [{
      role: "assistant",
      content: [firstRawCall, secondRawCall],
    }]);
    for (
      const rawCalls of [
        [secondRawCall, firstRawCall],
        [firstRawCall],
        [firstRawCall, firstRawCall],
        [firstRawCall, secondRawCall, secondRawCall],
      ]
    ) {
      assertThrows(
        () => build(rawCalls),
        TypeError,
        "Anthropic raw client tool call does not match canonical client-executed content",
      );
    }
    assertThrows(
      () => build([firstRawCall, firstRawCall], [firstCall, firstCall]),
      TypeError,
      "Anthropic raw client tool call does not match canonical client-executed content",
    );
  });

  it("allows raw-only client tool replay when its canonical projection was compacted", () => {
    const rawToolUse = {
      type: "tool_use",
      id: "historical_lookup_1",
      name: "historical_lookup",
      input: { retained: true },
    };
    const body = buildAnthropicMessagesRequest(
      "claude-sonnet-4-6",
      "anthropic",
      {
        prompt: [{
          role: "assistant",
          content: [{
            type: "text",
            text: "The normalized client call was compacted.",
          }],
          providerMetadata: {
            anthropic: { rawAssistantMessages: [[rawToolUse]] },
          },
        }],
      },
      false,
      createWarningCollector(),
    );

    assertEquals(body.messages, [{
      role: "assistant",
      content: [rawToolUse],
    }]);
  });

  it("preserves the surviving client/provider call and result interleaving", () => {
    const rawOrdinaryCall = {
      type: "tool_use",
      id: "lookup_1",
      name: "lookup",
      input: { id: 1 },
    };
    const rawProviderCall = {
      type: "server_tool_use",
      id: "code_1",
      name: "code_execution",
      input: { code: "print(1)" },
    };
    const rawProviderResult = {
      type: "code_execution_tool_result",
      tool_use_id: "code_1",
      content: {
        type: "code_execution_result",
        stdout: "1\n",
        stderr: "",
        return_code: 0,
        content: [],
      },
    };
    const ordinaryCall = {
      type: "tool-call" as const,
      toolCallId: "lookup_1",
      toolName: "lookup",
      input: { id: 1 },
    };
    const providerCall = {
      type: "tool-call" as const,
      toolCallId: "code_1",
      toolName: "code_execution",
      input: { code: "print(1)" },
      providerExecuted: true as const,
    };
    const providerResult = {
      type: "tool-result" as const,
      toolCallId: "code_1",
      toolName: "code_execution",
      result: {
        type: "code_execution_result",
        stdout: "1\n",
        stderr: "",
        returnCode: 0,
        content: [],
      },
      providerExecuted: true as const,
    };
    const rawAssistantContent = [
      rawOrdinaryCall,
      rawProviderCall,
      rawProviderResult,
    ];
    const rawAssistantMessages = [rawAssistantContent];
    const build = (content: RuntimeAssistantContentPart[]) =>
      buildAnthropicMessagesRequest(
        "claude-sonnet-4-6",
        "anthropic",
        {
          prompt: [{
            role: "assistant",
            content,
            providerToolCalls: [{
              toolCallId: "code_1",
              toolName: "code_execution",
              input: { code: "print(1)" },
            }],
            providerMetadata: {
              anthropic: { rawAssistantMessages },
            },
          }],
        },
        false,
        createWarningCollector(),
      );

    assertEquals(
      build([ordinaryCall, providerCall, providerResult]).messages,
      [{
        role: "assistant",
        content: rawAssistantContent,
      }],
    );
    for (
      const content of [
        [providerCall, ordinaryCall, providerResult],
        [ordinaryCall, providerResult, providerCall],
      ]
    ) {
      assertThrows(
        () => build(content),
        TypeError,
        "Anthropic raw tool event order does not match canonical assistant content",
      );
    }
  });

  it("replays the latest pure provider-tool round before a later user message", () => {
    const rawAssistantContent = [{
      type: "server_tool_use",
      id: "srvtool_code_1",
      name: "code_execution",
      input: { code: "print(2)" },
    }, {
      type: "code_execution_tool_result",
      tool_use_id: "srvtool_code_1",
      content: {
        type: "code_execution_result",
        stdout: "2\n",
        stderr: "",
        return_code: 0,
        content: [],
      },
    }, {
      type: "text",
      text: "The result is 2.",
    }];
    const prompt: ModelRuntimePromptMessage[] = [{
      role: "user",
      content: [{ type: "text", text: "Run the calculation." }],
    }, {
      role: "assistant",
      content: [{
        type: "tool-call",
        toolCallId: "srvtool_code_1",
        toolName: "code_execution",
        input: { code: "print(2)" },
        providerExecuted: true,
      }, {
        type: "tool-result",
        toolCallId: "srvtool_code_1",
        toolName: "code_execution",
        result: {
          type: "code_execution_result",
          stdout: "2\n",
          stderr: "",
          returnCode: 0,
          content: [],
        },
        providerExecuted: true,
      }, {
        type: "text",
        text: "The result is 2.",
      }],
      providerMetadata: {
        anthropic: { rawAssistantMessages: [rawAssistantContent] },
      },
    }, {
      role: "user",
      content: [{ type: "text", text: "Explain it." }],
    }];

    const body = buildAnthropicMessagesRequest(
      "claude-sonnet-4-6",
      "anthropic",
      { prompt },
      false,
      createWarningCollector(),
    );

    assertEquals(body.messages, [{
      role: "user",
      content: [{ type: "text", text: "Run the calculation." }],
    }, {
      role: "assistant",
      content: rawAssistantContent,
    }, {
      role: "user",
      content: [{ type: "text", text: "Explain it." }],
    }]);
  });

  it("rejects replayed provider-tool calls that conflict with canonical content", () => {
    const rawAssistantMessages = [[{
      type: "server_tool_use",
      id: "srvtool_code_1",
      name: "code_execution",
      input: { code: "print(2)" },
    }]];
    const canonicalVariants = [{
      toolCallId: "different_id",
      toolName: "code_execution",
      input: { code: "print(2)" },
    }, {
      toolCallId: "srvtool_code_1",
      toolName: "web_search",
      input: { code: "print(2)" },
    }, {
      toolCallId: "srvtool_code_1",
      toolName: "code_execution",
      input: { code: "print(3)" },
    }];

    for (const canonical of canonicalVariants) {
      assertThrows(
        () =>
          buildAnthropicMessagesRequest(
            "claude-sonnet-4-6",
            "anthropic",
            {
              prompt: [{
                role: "assistant",
                content: [{
                  type: "tool-call",
                  ...canonical,
                  providerExecuted: true,
                }],
                providerMetadata: { anthropic: { rawAssistantMessages } },
              }],
            },
            false,
            createWarningCollector(),
          ),
        TypeError,
        "Anthropic raw provider tool call does not match canonical provider-executed content",
      );
    }
  });

  it("rejects replayed provider-tool results that conflict with canonical content", () => {
    const rawAssistantMessages = [[{
      type: "server_tool_use",
      id: "srvtool_code_1",
      name: "code_execution",
      input: { code: "print(2)" },
    }, {
      type: "code_execution_tool_result",
      tool_use_id: "srvtool_code_1",
      content: {
        type: "code_execution_result",
        stdout: "2\n",
        stderr: "",
        return_code: 0,
        content: [],
      },
    }]];
    const canonicalCall = {
      type: "tool-call" as const,
      toolCallId: "srvtool_code_1",
      toolName: "code_execution",
      input: { code: "print(2)" },
      providerExecuted: true as const,
    };
    const matchingResult = {
      type: "code_execution_result",
      stdout: "2\n",
      stderr: "",
      returnCode: 0,
      content: [],
    };
    const canonicalVariants = [{
      toolCallId: "different_id",
      toolName: "code_execution",
      result: matchingResult,
    }, {
      toolCallId: "srvtool_code_1",
      toolName: "web_search",
      result: matchingResult,
    }, {
      toolCallId: "srvtool_code_1",
      toolName: "code_execution",
      result: { ...matchingResult, stdout: "different\n" },
    }, {
      toolCallId: "srvtool_code_1",
      toolName: "code_execution",
      result: matchingResult,
      isError: true,
    }];

    for (const canonical of canonicalVariants) {
      assertThrows(
        () =>
          buildAnthropicMessagesRequest(
            "claude-sonnet-4-6",
            "anthropic",
            {
              prompt: [{
                role: "assistant",
                content: [
                  canonicalCall,
                  {
                    type: "tool-result",
                    ...canonical,
                    providerExecuted: true,
                  },
                ],
                providerMetadata: { anthropic: { rawAssistantMessages } },
              }],
            },
            false,
            createWarningCollector(),
          ),
        TypeError,
        "Anthropic raw provider tool result does not match canonical provider-executed content",
      );
    }
  });

  it("rejects reordered or duplicated canonical provider-tool occurrences", () => {
    const rawCalls = [{
      type: "server_tool_use",
      id: "server_search_1",
      name: "web_search",
      input: { query: "Veryfront" },
    }, {
      type: "server_tool_use",
      id: "server_search_2",
      name: "web_search",
      input: { query: "runtime" },
    }];
    const firstCall = {
      toolCallId: "server_search_1",
      toolName: "web_search",
      input: { query: "Veryfront" },
      supportsDeferredResults: true,
    };
    const secondCall = {
      toolCallId: "server_search_2",
      toolName: "web_search",
      input: { query: "runtime" },
      supportsDeferredResults: true,
    };
    const build = (
      providerToolCalls: typeof firstCall[],
      content: unknown[] = [],
    ) =>
      buildAnthropicMessagesRequest(
        "claude-sonnet-4-6",
        "anthropic",
        {
          prompt: [{
            role: "assistant",
            content,
            providerToolCalls,
            providerMetadata: {
              anthropic: { rawAssistantMessages: [rawCalls] },
            },
          }] as unknown as ModelRuntimePromptMessage[],
        },
        false,
        createWarningCollector(),
      );

    assertThrows(
      () => build([secondCall, firstCall]),
      TypeError,
      "Anthropic raw provider tool call does not match canonical provider-executed content",
    );
    assertThrows(
      () => build([firstCall, firstCall]),
      TypeError,
      "Anthropic raw provider tool call does not match canonical provider-executed content",
    );
    assertThrows(
      () =>
        build([firstCall, secondCall], [{
          type: "tool-call",
          toolCallId: "server_search_2",
          toolName: "web_search",
          input: { query: "runtime" },
          providerExecuted: true,
        }, {
          type: "tool-call",
          toolCallId: "server_search_1",
          toolName: "web_search",
          input: { query: "Veryfront" },
          providerExecuted: true,
        }]),
      TypeError,
      "Anthropic raw provider tool call does not match canonical provider-executed content",
    );
  });

  it("rejects reordered or duplicated canonical provider-tool results", () => {
    const rawAssistantMessages = [[{
      type: "server_tool_use",
      id: "server_search_1",
      name: "web_search",
      input: { query: "Veryfront" },
    }, {
      type: "web_search_tool_result",
      tool_use_id: "server_search_1",
      content: [],
    }, {
      type: "server_tool_use",
      id: "server_search_2",
      name: "web_search",
      input: { query: "runtime" },
    }, {
      type: "web_search_tool_result",
      tool_use_id: "server_search_2",
      content: [],
    }]];
    const firstCall = {
      type: "tool-call" as const,
      toolCallId: "server_search_1",
      toolName: "web_search",
      input: { query: "Veryfront" },
      providerExecuted: true as const,
    };
    const secondCall = {
      type: "tool-call" as const,
      toolCallId: "server_search_2",
      toolName: "web_search",
      input: { query: "runtime" },
      providerExecuted: true as const,
    };
    const firstResult = {
      type: "tool-result" as const,
      toolCallId: "server_search_1",
      toolName: "web_search",
      result: [],
      providerExecuted: true as const,
    };
    const secondResult = {
      type: "tool-result" as const,
      toolCallId: "server_search_2",
      toolName: "web_search",
      result: [],
      providerExecuted: true as const,
    };
    const build = (results: typeof firstResult[]) =>
      buildAnthropicMessagesRequest(
        "claude-sonnet-4-6",
        "anthropic",
        {
          prompt: [{
            role: "assistant",
            content: [firstCall, secondCall, ...results],
            providerMetadata: {
              anthropic: { rawAssistantMessages },
            },
          }],
        },
        false,
        createWarningCollector(),
      );

    assertThrows(
      () => build([secondResult, firstResult]),
      TypeError,
      "Anthropic raw provider tool result does not match canonical provider-executed content",
    );
    assertThrows(
      () => build([firstResult, firstResult]),
      TypeError,
      "Anthropic raw provider tool result does not match canonical provider-executed content",
    );
  });

  it("correlates the exact provider error payload and rejects a different error", () => {
    const rawAssistantContent = [{
      type: "server_tool_use",
      id: "server_search_1",
      name: "web_search",
      input: { query: "Veryfront" },
    }, {
      type: "web_search_tool_result",
      tool_use_id: "server_search_1",
      content: {
        type: "web_search_tool_result_error",
        error_code: "unavailable",
      },
    }];
    const rawAssistantMessages = [rawAssistantContent];
    const build = (code: string) =>
      buildAnthropicMessagesRequest(
        "claude-sonnet-4-6",
        "anthropic",
        {
          prompt: [{
            role: "assistant",
            content: [{
              type: "tool-call",
              toolCallId: "server_search_1",
              toolName: "web_search",
              input: { query: "Veryfront" },
              providerExecuted: true,
            }, {
              type: "tool-result",
              toolCallId: "server_search_1",
              toolName: "web_search",
              result: new AnthropicServerToolResultError({
                code,
                toolCallId: "server_search_1",
                toolName: "web_search",
              }),
              isError: true,
              providerExecuted: true,
            }],
            providerMetadata: { anthropic: { rawAssistantMessages } },
          }],
        },
        false,
        createWarningCollector(),
      );

    assertEquals(build("unavailable").messages, [{
      role: "assistant",
      content: rawAssistantContent,
    }]);
    assertThrows(
      () => build("max_uses_exceeded"),
      TypeError,
      "Anthropic raw provider tool result does not match canonical provider-executed content",
    );
  });

  it("correlates a JSON-round-tripped provider error payload", () => {
    const rawAssistantContent = [{
      type: "server_tool_use",
      id: "server_search_round_trip",
      name: "web_search",
      input: { query: "Veryfront" },
    }, {
      type: "web_search_tool_result",
      tool_use_id: "server_search_round_trip",
      content: {
        type: "web_search_tool_result_error",
        error_code: "unavailable",
      },
    }];
    const result = JSON.parse(JSON.stringify(
      new AnthropicServerToolResultError({
        code: "unavailable",
        toolCallId: "server_search_round_trip",
        toolName: "web_search",
      }),
    ));

    const request = buildAnthropicMessagesRequest(
      "claude-sonnet-4-6",
      "anthropic",
      {
        prompt: [{
          role: "assistant",
          content: [{
            type: "tool-call",
            toolCallId: "server_search_round_trip",
            toolName: "web_search",
            input: { query: "Veryfront" },
            providerExecuted: true,
          }, {
            type: "tool-result",
            toolCallId: "server_search_round_trip",
            toolName: "web_search",
            result,
            isError: true,
            providerExecuted: true,
          }],
          providerMetadata: {
            anthropic: { rawAssistantMessages: [rawAssistantContent] },
          },
        }],
      },
      false,
      createWarningCollector(),
    );

    assertEquals(request.messages, [{
      role: "assistant",
      content: rawAssistantContent,
    }]);
  });

  it("rejects extra fields on a serialized provider error", () => {
    const toolCallId = "server_search_extra_field";
    const result = {
      ...JSON.parse(JSON.stringify(
        new AnthropicServerToolResultError({
          code: "unavailable",
          toolCallId,
          toolName: "web_search",
        }),
      )),
      extra: "must not be ignored",
    };

    assertThrows(
      () =>
        buildAnthropicMessagesRequest(
          "claude-sonnet-4-6",
          "anthropic",
          {
            prompt: [{
              role: "assistant",
              content: [{
                type: "tool-call",
                toolCallId,
                toolName: "web_search",
                input: { query: "Veryfront" },
                providerExecuted: true,
              }, {
                type: "tool-result",
                toolCallId,
                toolName: "web_search",
                result,
                isError: true,
                providerExecuted: true,
              }],
              providerMetadata: {
                anthropic: {
                  rawAssistantMessages: [[{
                    type: "server_tool_use",
                    id: toolCallId,
                    name: "web_search",
                    input: { query: "Veryfront" },
                  }, {
                    type: "web_search_tool_result",
                    tool_use_id: toolCallId,
                    content: {
                      type: "web_search_tool_result_error",
                      error_code: "unavailable",
                    },
                  }]],
                },
              },
            }],
          },
          false,
          createWarningCollector(),
        ),
      TypeError,
      "Anthropic raw provider tool result does not match canonical provider-executed content",
    );
  });

  it("rejects provider error accessors without invoking them", () => {
    let codeReads = 0;
    const result = Object.defineProperty(
      {
        name: "AnthropicServerToolResultError",
        provider: "anthropic",
        toolCallId: "server_search_accessor",
        toolName: "web_search",
      },
      "code",
      {
        enumerable: true,
        get() {
          codeReads++;
          return "unavailable";
        },
      },
    );

    assertThrows(
      () =>
        buildAnthropicMessagesRequest(
          "claude-sonnet-4-6",
          "anthropic",
          {
            prompt: [{
              role: "assistant",
              content: [{
                type: "tool-call",
                toolCallId: "server_search_accessor",
                toolName: "web_search",
                input: { query: "Veryfront" },
                providerExecuted: true,
              }, {
                type: "tool-result",
                toolCallId: "server_search_accessor",
                toolName: "web_search",
                result,
                isError: true,
                providerExecuted: true,
              }],
              providerMetadata: {
                anthropic: {
                  rawAssistantMessages: [[{
                    type: "server_tool_use",
                    id: "server_search_accessor",
                    name: "web_search",
                    input: { query: "Veryfront" },
                  }, {
                    type: "web_search_tool_result",
                    tool_use_id: "server_search_accessor",
                    content: {
                      type: "web_search_tool_result_error",
                      error_code: "unavailable",
                    },
                  }]],
                },
              },
            }],
          },
          false,
          createWarningCollector(),
        ),
      TypeError,
      "Anthropic raw provider tool result does not match canonical provider-executed content",
    );
    assertEquals(codeReads, 0);
  });

  it("keeps a cross-assistant provider call and result in one replay transaction", () => {
    const rawProviderCall = {
      type: "server_tool_use",
      id: "server_search_1",
      name: "web_search",
      input: { query: "Veryfront" },
    };
    const rawLocalCall = {
      type: "tool_use",
      id: "local_lookup_1",
      name: "local_lookup",
      input: { query: "runtime" },
    };
    const rawProviderResult = {
      type: "web_search_tool_result",
      tool_use_id: "server_search_1",
      content: [{
        type: "web_search_result",
        url: "https://veryfront.com",
        title: "Veryfront",
        encrypted_content: "encrypted-result",
        page_age: null,
      }],
    };
    const prompt: ModelRuntimePromptMessage[] = [{
      role: "user",
      content: [{ type: "text", text: "Search and inspect" }],
    }, {
      role: "assistant",
      content: [{
        type: "tool-call",
        toolCallId: "local_lookup_1",
        toolName: "local_lookup",
        input: { query: "runtime" },
      }],
      providerToolCalls: [{
        toolCallId: "server_search_1",
        toolName: "web_search",
        input: { query: "Veryfront" },
        supportsDeferredResults: true,
      }],
      providerMetadata: {
        anthropic: { rawAssistantMessages: [[rawProviderCall, rawLocalCall]] },
      },
    }, {
      role: "tool",
      content: [{
        type: "tool-result",
        toolCallId: "local_lookup_1",
        toolName: "local_lookup",
        output: { type: "json", value: { matches: 1 } },
      }],
    }, {
      role: "assistant",
      content: [{
        type: "tool-result",
        toolCallId: "server_search_1",
        toolName: "web_search",
        result: [{
          type: "web_search_result",
          url: "https://veryfront.com",
          title: "Veryfront",
          pageAge: null,
          encryptedContent: "encrypted-result",
        }],
        providerExecuted: true,
      }, {
        type: "text",
        text: "Combined both results.",
      }],
      providerMetadata: {
        anthropic: {
          rawAssistantMessages: [[rawProviderResult, {
            type: "text",
            text: "Combined both results.",
          }]],
        },
      },
    }, {
      role: "user",
      content: [{ type: "text", text: "Summarize that" }],
    }];

    const body = buildAnthropicMessagesRequest(
      "claude-sonnet-4-6",
      "anthropic",
      { prompt },
      false,
      createWarningCollector(),
    );

    assertEquals(body.messages, [{
      role: "user",
      content: [{ type: "text", text: "Search and inspect" }],
    }, {
      role: "assistant",
      content: [rawProviderCall, rawLocalCall],
    }, {
      role: "user",
      content: [{
        type: "tool_result",
        tool_use_id: "local_lookup_1",
        content: '{"matches":1}',
      }],
    }, {
      role: "assistant",
      content: [rawProviderResult, {
        type: "text",
        text: "Combined both results.",
      }],
    }, {
      role: "user",
      content: [{ type: "text", text: "Summarize that" }],
    }]);
  });

  it("rejects a canonical provider result backed only by a raw legacy call", () => {
    const toolCallId = "mcptool_raw_only";
    assertThrows(
      () =>
        buildAnthropicMessagesRequest(
          "claude-sonnet-4-6",
          "anthropic",
          {
            prompt: [{
              role: "user",
              content: [{ type: "text", text: "Echo" }],
            }, {
              role: "assistant",
              content: [{ type: "text", text: "Calling a legacy provider tool." }],
              providerMetadata: {
                anthropic: {
                  rawAssistantMessages: [[{
                    type: "mcp_tool_use",
                    id: toolCallId,
                    name: "echo",
                    server_name: "example-mcp",
                    input: { value: "hello" },
                  }]],
                },
              },
            }, {
              role: "assistant",
              content: [{
                type: "tool-result",
                toolCallId,
                toolName: "echo",
                result: "hello",
                providerExecuted: true,
              }],
              providerMetadata: {
                anthropic: {
                  rawAssistantMessages: [[{
                    type: "mcp_tool_result",
                    tool_use_id: toolCallId,
                    is_error: false,
                    content: "hello",
                  }]],
                },
              },
            }],
          },
          false,
          createWarningCollector(),
        ),
      TypeError,
      "Anthropic raw provider tool result does not match canonical provider-executed content",
    );
  });

  it("rejects malformed present Anthropic replay metadata", () => {
    assertThrows(
      () =>
        buildAnthropicMessagesRequest(
          "claude-sonnet-4-6",
          "anthropic",
          {
            prompt: [{
              role: "assistant",
              content: [{ type: "text", text: "Do not silently fall back." }],
              providerMetadata: {
                anthropic: { rawAssistantMessages: "invalid" },
              },
            }],
          },
          false,
          createWarningCollector(),
        ),
      TypeError,
      "Anthropic raw assistant messages must be a non-empty array",
    );
    assertThrows(
      () =>
        buildAnthropicMessagesRequest(
          "claude-sonnet-4-6",
          "anthropic",
          {
            prompt: [{
              role: "assistant",
              content: [{ type: "text", text: "Do not replay unknown blocks." }],
              providerMetadata: {
                anthropic: {
                  rawAssistantMessages: [[{ type: "future_unsupported_block" }]],
                },
              },
            }],
          },
          false,
          createWarningCollector(),
        ),
      TypeError,
      "Anthropic raw assistant content block type is unsupported",
    );
    assertThrows(
      () =>
        buildAnthropicMessagesRequest(
          "claude-sonnet-4-6",
          "anthropic",
          {
            prompt: [{
              role: "assistant",
              content: [{
                type: "tool-result",
                toolCallId: "orphan",
                toolName: "web_search",
                result: [],
                providerExecuted: true,
              }],
              providerMetadata: {
                anthropic: {
                  rawAssistantMessages: [[{
                    type: "web_search_tool_result",
                    tool_use_id: "orphan",
                    content: [],
                  }]],
                },
              },
            }],
          },
          false,
          createWarningCollector(),
        ),
      TypeError,
      "Anthropic raw assistant provider tool result is malformed or unpaired",
    );
  });

  it("rejects replay metadata accessors without invoking them", () => {
    let namespaceReads = 0;
    const hostileNamespace = Object.defineProperty({}, "anthropic", {
      enumerable: true,
      get() {
        namespaceReads += 1;
        throw new Error("private namespace diagnostic");
      },
    }) as Record<string, unknown>;
    const build = (providerMetadata: Record<string, unknown>) =>
      buildAnthropicMessagesRequest(
        "claude-sonnet-4-6",
        "anthropic",
        {
          prompt: [{
            role: "assistant",
            content: [{ type: "text", text: "Do not invoke metadata accessors." }],
            providerMetadata,
          }],
        },
        false,
        createWarningCollector(),
      );

    const namespaceError = captureThrownError(
      () => build(hostileNamespace),
      TypeError,
      "Anthropic provider metadata namespace must be an enumerable data property",
    );
    assertEquals(namespaceReads, 0);
    assertEquals(namespaceError.message.includes("private namespace diagnostic"), false);

    let rawHistoryReads = 0;
    const hostileRawHistory = Object.defineProperty({}, "rawAssistantMessages", {
      enumerable: true,
      get() {
        rawHistoryReads += 1;
        throw new Error("private history diagnostic");
      },
    });
    const historyError = captureThrownError(
      () => build({ anthropic: hostileRawHistory }),
      TypeError,
      "Anthropic raw assistant messages must be an enumerable data property",
    );
    assertEquals(rawHistoryReads, 0);
    assertEquals(historyError.message.includes("private history diagnostic"), false);

    let proxyPropertyReads = 0;
    const rawAssistantMessages = new Proxy([[{
      type: "server_tool_use",
      id: "server_search_proxy",
      name: "web_search",
      input: { query: "Veryfront" },
    }]], {
      get() {
        proxyPropertyReads += 1;
        throw new Error("proxy property read");
      },
    });
    captureThrownError(
      () =>
        buildAnthropicMessagesRequest(
          "claude-sonnet-4-6",
          "anthropic",
          {
            prompt: [{
              role: "assistant",
              content: [{
                type: "tool-call",
                toolCallId: "server_search_proxy",
                toolName: "web_search",
                input: { query: "Veryfront" },
                providerExecuted: true,
              }],
              providerMetadata: {
                anthropic: { rawAssistantMessages },
              },
            }],
          },
          false,
          createWarningCollector(),
        ),
      TypeError,
      "Anthropic raw assistant metadata was not valid bounded JSON",
    );
    assertEquals(proxyPropertyReads, 0);
  });

  it("compacts raw provider tool history after the turn has completed", () => {
    const prompt: RuntimePromptMessage[] = [{
      role: "user",
      content: [{ type: "text", text: "Search and inspect" }],
    }, {
      role: "assistant",
      content: [{
        type: "tool-call",
        toolCallId: "local_lookup_1",
        toolName: "local_lookup",
        input: { query: "runtime" },
      }],
      providerToolCalls: [{
        toolCallId: "server_search_1",
        toolName: "web_search",
        input: { query: "Veryfront" },
        supportsDeferredResults: true,
      }],
      providerMetadata: {
        anthropic: {
          rawAssistantMessages: [[{
            type: "server_tool_use",
            id: "server_search_1",
            name: "web_search",
            input: { query: "Veryfront" },
          }, {
            type: "tool_use",
            id: "local_lookup_1",
            name: "local_lookup",
            input: { query: "runtime" },
          }]],
        },
      },
    }, {
      role: "tool",
      content: [{
        type: "tool-result",
        toolCallId: "local_lookup_1",
        toolName: "local_lookup",
        output: { type: "json", value: { matches: 1 } },
      }],
    }, {
      role: "assistant",
      content: [{ type: "text", text: "Combined both results." }],
      providerMetadata: {
        anthropic: {
          rawAssistantMessages: [[{
            type: "web_search_tool_result",
            tool_use_id: "server_search_1",
            content: [{
              type: "web_search_result",
              url: "https://veryfront.com",
              title: "Veryfront",
              encrypted_content: "encrypted-result",
              page_age: null,
            }],
          }, {
            type: "text",
            text: "Combined both results.",
          }]],
        },
      },
    }, {
      role: "user",
      content: [{ type: "text", text: "Summarize that" }],
    }];

    const body = buildAnthropicMessagesRequest(
      "claude-sonnet-4-6",
      "anthropic",
      { prompt },
      false,
      createWarningCollector(),
    );

    assertEquals(body.messages, [{
      role: "user",
      content: [{ type: "text", text: "Search and inspect" }],
    }, {
      role: "assistant",
      content: [{ type: "text", text: "Combined both results." }],
    }, {
      role: "user",
      content: [{ type: "text", text: "Summarize that" }],
    }]);
  });

  it("treats provider-option thinking as enabled while shaping sampling settings", () => {
    const prompt: RuntimePromptMessage[] = [
      { role: "user", content: [{ type: "text", text: "Think carefully." }] },
    ];
    const warnings = createWarningCollector();

    const body = buildAnthropicMessagesRequest(
      "claude-sonnet-4-6",
      "anthropic",
      {
        prompt,
        maxOutputTokens: 4096,
        temperature: 0.2,
        topP: 0.9,
        providerOptions: {
          anthropic: {
            thinking: { type: "enabled", budget_tokens: 2048 },
          },
        },
      },
      false,
      warnings,
    );

    assertEquals(body.temperature, undefined);
    assertEquals(body.top_p, undefined);
    assertEquals(body.thinking, { type: "enabled", budget_tokens: 2048 });
    assertEquals(body.max_tokens, 6144);
    assertEquals(warnings.drain().map((warning) => warning.setting), [
      "temperature",
      "topP",
    ]);
  });

  it("rejects unsafe or non-integral explicit thinking budgets", () => {
    const prompt: RuntimePromptMessage[] = [
      { role: "user", content: [{ type: "text", text: "Think carefully." }] },
    ];
    const invalidBudgets = [
      Number.NaN,
      Number.POSITIVE_INFINITY,
      1023,
      1024.5,
      Number.MAX_SAFE_INTEGER + 1,
    ];

    for (const budgetTokens of invalidBudgets) {
      assertThrows(
        () =>
          buildAnthropicMessagesRequest(
            "claude-sonnet-4-6",
            "anthropic",
            {
              prompt,
              reasoning: { enabled: true, budgetTokens },
            },
            false,
            createWarningCollector(),
          ),
        TypeError,
        "budgetTokens must be a safe integer of at least 1024",
      );
      assertThrows(
        () =>
          buildAnthropicMessagesRequest(
            "claude-sonnet-4-6",
            "anthropic",
            {
              prompt,
              providerOptions: {
                anthropic: {
                  thinking: { type: "enabled", budget_tokens: budgetTokens },
                },
              },
            },
            false,
            createWarningCollector(),
          ),
        TypeError,
        "thinking.budget_tokens must be a safe integer of at least 1024",
      );
    }

    for (
      const thinking of [
        null,
        [],
        "enabled",
        {},
        { type: "" },
        { type: "enabled" },
      ]
    ) {
      assertThrows(
        () =>
          buildAnthropicMessagesRequest(
            "claude-sonnet-4-6",
            "anthropic",
            {
              prompt,
              providerOptions: { anthropic: { thinking } },
            },
            false,
            createWarningCollector(),
          ),
        TypeError,
        "Anthropic provider thinking",
      );
    }
  });

  it("keeps provider-neutral reasoning authoritative over raw thinking options", () => {
    const body = buildAnthropicMessagesRequest(
      "claude-sonnet-4-6",
      "anthropic",
      {
        prompt: [{ role: "user", content: [{ type: "text", text: "Think." }] }],
        reasoning: { enabled: true, budgetTokens: 4096 },
        providerOptions: {
          anthropic: {
            thinking: { type: "enabled", budget_tokens: 2048 },
          },
        },
      },
      false,
      createWarningCollector(),
    );

    assertEquals(body.thinking, { type: "enabled", budget_tokens: 4096 });
  });

  it("compacts completed historical tool rounds before replaying later user turns", () => {
    const prompt: RuntimePromptMessage[] = [
      { role: "user", content: [{ type: "text", text: "Build a briefing." }] },
      {
        role: "assistant",
        content: [
          { type: "text", text: "I'll fetch both sources." },
          {
            type: "tool-call",
            toolCallId: "toolu_calendar",
            toolName: "calendar__list_events",
            input: {},
          },
          {
            type: "tool-call",
            toolCallId: "toolu_gmail",
            toolName: "gmail__search_emails",
            input: {},
          },
        ],
      },
      {
        role: "tool",
        content: [
          {
            type: "tool-result",
            toolCallId: "toolu_calendar",
            toolName: "calendar__list_events",
            output: { type: "json", value: { events: 1 } },
          },
          {
            type: "tool-result",
            toolCallId: "toolu_gmail",
            toolName: "gmail__search_emails",
            output: { type: "json", value: { messages: 20 } },
          },
        ],
      },
      {
        role: "assistant",
        content: [
          { type: "text", text: "I have the briefing." },
          {
            type: "tool-call",
            toolCallId: "toolu_email_1",
            toolName: "gmail__get_email",
            input: {},
          },
          {
            type: "tool-call",
            toolCallId: "toolu_email_2",
            toolName: "gmail__get_email",
            input: {},
          },
        ],
      },
      {
        role: "tool",
        content: [
          {
            type: "tool-result",
            toolCallId: "toolu_email_1",
            toolName: "gmail__get_email",
            output: { type: "json", value: { id: "email-1" } },
          },
          {
            type: "tool-result",
            toolCallId: "toolu_email_2",
            toolName: "gmail__get_email",
            output: { type: "json", value: { id: "email-2" } },
          },
        ],
      },
      { role: "assistant", content: [{ type: "text", text: "Agenda, inbox, and follow-ups." }] },
      { role: "user", content: [{ type: "text", text: "retry" }] },
    ];
    const warnings = createWarningCollector();

    const body = buildAnthropicMessagesRequest(
      "claude-sonnet-4-6",
      "anthropic",
      { prompt },
      false,
      warnings,
    );

    assertEquals(body.messages, [
      { role: "user", content: [{ type: "text", text: "Build a briefing." }] },
      { role: "assistant", content: [{ type: "text", text: "I'll fetch both sources." }] },
      { role: "assistant", content: [{ type: "text", text: "I have the briefing." }] },
      { role: "assistant", content: [{ type: "text", text: "Agenda, inbox, and follow-ups." }] },
      { role: "user", content: [{ type: "text", text: "retry" }] },
    ]);
  });

  it("keeps same-turn tool results when later assistant steps continue without a user turn", () => {
    const prompt: RuntimePromptMessage[] = [
      { role: "user", content: [{ type: "text", text: "Create an integration agent." }] },
      {
        role: "assistant",
        content: [
          { type: "text", text: "I will load the platform skill." },
          {
            type: "tool-call",
            toolCallId: "toolu_load_skill",
            toolName: "load_skill",
            input: { skillId: "veryfront" },
          },
        ],
      },
      {
        role: "tool",
        content: [{
          type: "tool-result",
          toolCallId: "toolu_load_skill",
          toolName: "load_skill",
          output: {
            type: "json",
            value: {
              skillId: "veryfront",
              instructions: "Create agents with create_agent after gathering context.",
            },
          },
        }],
      },
      {
        role: "assistant",
        content: [
          { type: "text", text: "Now I will inspect the integration." },
          {
            type: "tool-call",
            toolCallId: "toolu_get_integration",
            toolName: "get_integration",
            input: { integration: "harvest" },
          },
        ],
      },
      {
        role: "tool",
        content: [{
          type: "tool-result",
          toolCallId: "toolu_get_integration",
          toolName: "get_integration",
          output: {
            type: "json",
            value: { slug: "harvest", name: "Harvest" },
          },
        }],
      },
    ];
    const warnings = createWarningCollector();

    const body = buildAnthropicMessagesRequest(
      "claude-sonnet-4-6",
      "anthropic",
      { prompt },
      false,
      warnings,
    );

    assertEquals(body.messages, [
      { role: "user", content: [{ type: "text", text: "Create an integration agent." }] },
      {
        role: "assistant",
        content: [
          { type: "text", text: "I will load the platform skill." },
          {
            type: "tool_use",
            id: "toolu_load_skill",
            name: "load_skill",
            input: { skillId: "veryfront" },
          },
        ],
      },
      {
        role: "user",
        content: [{
          type: "tool_result",
          tool_use_id: "toolu_load_skill",
          content:
            '{"skillId":"veryfront","instructions":"Create agents with create_agent after gathering context."}',
        }],
      },
      {
        role: "assistant",
        content: [
          { type: "text", text: "Now I will inspect the integration." },
          {
            type: "tool_use",
            id: "toolu_get_integration",
            name: "get_integration",
            input: { integration: "harvest" },
          },
        ],
      },
      {
        role: "user",
        content: [{
          type: "tool_result",
          tool_use_id: "toolu_get_integration",
          content: '{"slug":"harvest","name":"Harvest"}',
        }],
      },
    ]);
  });

  it("keeps historical tool-only rounds when active same-turn assistant text follows the latest user", () => {
    const prompt: RuntimePromptMessage[] = [
      { role: "user", content: [{ type: "text", text: "Start with account context." }] },
      {
        role: "assistant",
        content: [{
          type: "tool-call",
          toolCallId: "toolu_account",
          toolName: "account__lookup",
          input: { id: "acct-1" },
        }],
      },
      {
        role: "tool",
        content: [{
          type: "tool-result",
          toolCallId: "toolu_account",
          toolName: "account__lookup",
          output: { type: "json", value: { plan: "pro" } },
        }],
      },
      { role: "user", content: [{ type: "text", text: "retry with more detail" }] },
      {
        role: "assistant",
        content: [{ type: "text", text: "I will continue from the account context." }],
      },
    ];
    const warnings = createWarningCollector();

    const body = buildAnthropicMessagesRequest(
      "claude-sonnet-4-6",
      "anthropic",
      { prompt },
      false,
      warnings,
    );

    assertEquals(body.messages, [
      { role: "user", content: [{ type: "text", text: "Start with account context." }] },
      {
        role: "assistant",
        content: [{
          type: "tool_use",
          id: "toolu_account",
          name: "account__lookup",
          input: { id: "acct-1" },
        }],
      },
      {
        role: "user",
        content: [
          {
            type: "tool_result",
            tool_use_id: "toolu_account",
            content: '{"plan":"pro"}',
          },
          { type: "text", text: "retry with more detail" },
        ],
      },
      {
        role: "assistant",
        content: [{ type: "text", text: "I will continue from the account context." }],
      },
    ]);
  });

  it("drops orphaned tool results when their tool use was not emitted", () => {
    const prompt: RuntimePromptMessage[] = [
      {
        role: "tool",
        content: [{
          type: "tool-result",
          toolCallId: "srvtoolu_search_1",
          toolName: "web_search",
          output: { type: "json", value: { results: [] } },
        }],
      },
      { role: "user", content: [{ type: "text", text: "Continue the conversation." }] },
      {
        role: "assistant",
        content: [
          { type: "text", text: "I will use the current tools." },
          {
            type: "tool-call",
            toolCallId: "toolu_lookup_1",
            toolName: "lookup",
            input: { query: "current" },
          },
        ],
      },
      {
        role: "tool",
        content: [
          {
            type: "tool-result",
            toolCallId: "srvtoolu_search_1",
            toolName: "web_search",
            output: { type: "json", value: { stale: true } },
          },
          {
            type: "tool-result",
            toolCallId: "toolu_lookup_1",
            toolName: "lookup",
            output: { type: "json", value: { ok: true } },
          },
        ],
      },
    ];
    const warnings = createWarningCollector();

    const body = buildAnthropicMessagesRequest(
      "claude-sonnet-4-6",
      "anthropic",
      { prompt },
      false,
      warnings,
    );

    assertEquals(body.messages, [
      { role: "user", content: [{ type: "text", text: "Continue the conversation." }] },
      {
        role: "assistant",
        content: [
          { type: "text", text: "I will use the current tools." },
          {
            type: "tool_use",
            id: "toolu_lookup_1",
            name: "lookup",
            input: { query: "current" },
          },
        ],
      },
      {
        role: "user",
        content: [{
          type: "tool_result",
          tool_use_id: "toolu_lookup_1",
          content: '{"ok":true}',
        }],
      },
    ]);
  });

  it("requires raw metadata to replay provider-executed assistant results", () => {
    assertThrows(
      () =>
        buildAnthropicMessagesRequest(
          "claude-sonnet-4-6",
          "anthropic",
          {
            prompt: [{
              role: "assistant",
              content: [{
                type: "tool-call",
                toolCallId: "srvtoolu_search_1",
                toolName: "web_search",
                input: { query: "Veryfront" },
                providerExecuted: true,
              }],
            }],
          },
          false,
          createWarningCollector(),
        ),
      TypeError,
      "Anthropic provider-executed assistant tool calls require exact raw replay metadata",
    );
    assertThrows(
      () =>
        buildAnthropicMessagesRequest(
          "claude-sonnet-4-6",
          "anthropic",
          {
            prompt: [{
              role: "assistant",
              content: [{
                type: "tool-result",
                toolCallId: "srvtoolu_search_1",
                toolName: "web_search",
                result: { results: [] },
                providerExecuted: true,
              }],
            }],
          },
          false,
          createWarningCollector(),
        ),
      TypeError,
      "Anthropic provider-executed assistant tool results require exact raw replay metadata",
    );
  });
});
