import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertStrictEquals, assertThrows } from "#veryfront/testing/assert.ts";
import { it } from "#veryfront/testing/bdd.ts";
import {
  hasTrustedPlatformPolicyToolResultPart,
  hydrateActiveSkillStateFromMessages,
  markTrustedPlatformPolicyToolResultPart,
} from "../runtime/skill-policy-enforcement.ts";
import type { Message, ToolResultPart } from "../schemas/index.ts";
import type { AgentRuntimeMessage } from "../runtime/message-adapter.ts";
import {
  cloneHostedChildForkRuntimeStepSystem,
  convertCompactedProviderMessagesToChildForkRuntimeMessages,
  prepareHostedChildForkRuntimeStepMessages,
} from "./child-fork-step-message-preparation.ts";

it("cloneHostedChildForkRuntimeStepSystem detaches a custom provider bucket", () => {
  let trapCalls = 0;
  const opaqueProxy = new Proxy({}, {
    ownKeys() {
      trapCalls += 1;
      return [];
    },
  });
  const structuredSystem = [{
    role: "system" as const,
    content: "Base instructions",
    providerOptions: {
      bedrock: {
        cacheControl: { type: "ephemeral" },
        opaqueProxy,
      },
    },
  }];

  const clone = cloneHostedChildForkRuntimeStepSystem(
    structuredSystem,
    "bedrock",
    false,
  );
  const bedrock = clone[0]?.providerOptions?.bedrock as {
    cacheControl: { type: string };
    opaqueProxy: object;
  };
  bedrock.cacheControl.type = "changed";

  assertEquals(structuredSystem[0]?.providerOptions.bedrock.cacheControl.type, "ephemeral");
  assertStrictEquals(bedrock.opaqueProxy, opaqueProxy);
  assertEquals(trapCalls, 0);
});

it("cloneHostedChildForkRuntimeStepSystem keeps accessors inert without Proxy branding", () => {
  let getterCalls = 0;
  const bedrock: Record<string, unknown> = {
    cacheControl: { type: "ephemeral" },
  };
  Object.defineProperty(bedrock, "lazySecret", {
    enumerable: true,
    get() {
      getterCalls += 1;
      throw new Error("accessor must not run during clone fallback");
    },
  });
  const structuredSystem = [{
    role: "system" as const,
    content: "Base instructions",
    providerOptions: { bedrock },
  }];

  const clone = cloneHostedChildForkRuntimeStepSystem(
    structuredSystem,
    "bedrock",
    false,
  );
  const descriptor = Object.getOwnPropertyDescriptor(
    clone[0]?.providerOptions?.bedrock,
    "lazySecret",
  );

  assertEquals(getterCalls, 0);
  assertEquals(typeof descriptor?.get, "function");
});

it("convertCompactedProviderMessagesToChildForkRuntimeMessages rewrites tool-call part types", () => {
  const messages = convertCompactedProviderMessagesToChildForkRuntimeMessages([
    {
      role: "assistant",
      content: [
        {
          type: "tool-call",
          toolCallId: "tool-call-1",
          toolName: "read_file",
          input: { path: "README.md" },
        },
      ],
    },
  ]);

  assertEquals(messages[0]?.parts[0], {
    type: "tool-read_file",
    toolCallId: "tool-call-1",
    toolName: "read_file",
    args: { path: "README.md" },
  });
});

it("prepareHostedChildForkRuntimeStepMessages compacts messages and resolves system text", () => {
  const messages: AgentRuntimeMessage[] = [
    {
      id: "message-1",
      role: "user",
      parts: [{ type: "text", text: "Create a report" }],
      timestamp: 1,
    },
    {
      id: "message-2",
      role: "assistant",
      parts: [{ type: "text", text: "Trailing assistant draft" }],
      timestamp: 2,
    },
  ];

  const prepared = prepareHostedChildForkRuntimeStepMessages({
    messages,
    buildInstructions: () => "Base instructions",
    forkToolNames: ["read_file", "create_file"],
    resolveSystem: ({ system, compactedMessages }) =>
      compactedMessages.length === 1 ? `${system}\n\nContinuation reminder` : system,
  });

  assertEquals(prepared.system, "Base instructions\n\nContinuation reminder");
  assertEquals(prepared.messages, [
    {
      id: "agent-runtime-user-1",
      role: "user",
      parts: [{ type: "text", text: "Create a report" }],
      timestamp: 0,
    },
  ]);
});

it("prepareHostedChildForkRuntimeStepMessages keeps resolver system text-compatible", () => {
  const structuredSystem = [{
    role: "system" as const,
    content: "Base instructions",
    providerOptions: {
      anthropic: { cacheControl: { type: "ephemeral" as const, ttl: "1h" as const } },
    },
  }];
  const prepared = prepareHostedChildForkRuntimeStepMessages({
    messages: [],
    buildInstructions: () => structuredSystem,
    forkToolNames: [],
    resolveSystem: ({ system, structuredSystem: receivedStructuredSystem }) => {
      assertEquals(system, "Base instructions");
      assertEquals(receivedStructuredSystem, structuredSystem);
      return system.replace("Base", "Refreshed");
    },
  });

  assertEquals(prepared.system, "Refreshed instructions");
});

it("prepareHostedChildForkRuntimeStepMessages isolates structured resolver mutations", () => {
  const structuredSystem = [{
    role: "system" as const,
    content: "Base instructions",
    providerOptions: {
      anthropic: { cacheControl: { type: "ephemeral" as const } },
    },
  }];
  const prepared = prepareHostedChildForkRuntimeStepMessages({
    messages: [],
    buildInstructions: () => structuredSystem,
    forkToolNames: [],
    resolveSystem: ({ structuredSystem: receivedStructuredSystem }) => {
      const message = receivedStructuredSystem?.[0];
      if (message) {
        message.content = "Mutated instructions";
        const anthropic = message.providerOptions?.anthropic as {
          cacheControl?: { type?: string };
        } | undefined;
        if (anthropic?.cacheControl) anthropic.cacheControl.type = "changed";
      }
      return null;
    },
  });

  assertEquals(structuredSystem, [{
    role: "system",
    content: "Base instructions",
    providerOptions: {
      anthropic: { cacheControl: { type: "ephemeral" } },
    },
  }]);
  assertEquals(prepared.system, structuredSystem);
});

it("prepareHostedChildForkRuntimeStepMessages preserves same-message assistant tool results", () => {
  const messages: AgentRuntimeMessage[] = [
    {
      id: "assistant-message-1",
      role: "assistant",
      parts: [
        {
          type: "tool-call",
          toolCallId: "tool-call-1",
          toolName: "read_file",
          args: { path: "README.md" },
        },
        {
          type: "tool-result",
          toolCallId: "tool-call-1",
          toolName: "read_file",
          result: { content: "hello" },
        },
      ],
      timestamp: 1,
    },
  ];

  const prepared = prepareHostedChildForkRuntimeStepMessages({
    messages,
    buildInstructions: () => "Base instructions",
    forkToolNames: ["read_file"],
  });

  assertEquals(prepared.messages, [
    {
      id: "agent-runtime-assistant-1",
      role: "assistant",
      parts: [
        {
          type: "tool-read_file",
          toolCallId: "tool-call-1",
          toolName: "read_file",
          args: { path: "README.md" },
        },
      ],
      timestamp: 0,
    },
    {
      id: "agent-runtime-tool-2",
      role: "tool",
      parts: [
        {
          type: "tool-result",
          toolCallId: "tool-call-1",
          toolName: "read_file",
          result: { content: "hello" },
        },
      ],
      timestamp: 1,
    },
  ]);
});

it("prepareHostedChildForkRuntimeStepMessages falls back to current instructions", () => {
  const prepared = prepareHostedChildForkRuntimeStepMessages({
    messages: [],
    buildInstructions: () => "Current instructions",
    forkToolNames: [],
    resolveSystem: () => null,
  });

  assertEquals(prepared.system, "Current instructions");
  assertEquals(prepared.messages, []);
});

it("prepareHostedChildForkRuntimeStepMessages returns live forkToolNames when getActivatedToolNames provided", () => {
  const activated = new Set(["read_file", "write_file"]);
  const pinned = ["load_skill", "search_tools", "load_tools"];

  const prepared = prepareHostedChildForkRuntimeStepMessages({
    messages: [],
    buildInstructions: () => "Instructions",
    forkToolNames: pinned, // static pinned names
    pinnedToolNames: pinned,
    getActivatedToolNames: () => [...activated],
  });

  // forkToolNames in result = pinned ∪ activated, sorted
  assertEquals(prepared.forkToolNames && [...prepared.forkToolNames].sort(), [
    "load_skill",
    "load_tools",
    "read_file",
    "search_tools",
    "write_file",
  ]);
});

it("prepareHostedChildForkRuntimeStepMessages omits forkToolNames when no activated getter provided", () => {
  const prepared = prepareHostedChildForkRuntimeStepMessages({
    messages: [],
    buildInstructions: () => "Instructions",
    forkToolNames: ["load_skill"],
  });

  // No getter provided — caller should keep using its own fixed forkToolNames
  assertEquals(prepared.forkToolNames, undefined);
});

it("prepareHostedChildForkRuntimeStepMessages deduplicates pinned and activated names", () => {
  const activated = new Set(["load_skill", "new_tool"]); // load_skill is also pinned
  const pinned = ["load_skill", "search_tools"];

  const prepared = prepareHostedChildForkRuntimeStepMessages({
    messages: [],
    buildInstructions: () => "Instructions",
    forkToolNames: pinned,
    pinnedToolNames: pinned,
    getActivatedToolNames: () => [...activated],
  });

  // load_skill must appear only once
  const names = prepared.forkToolNames ?? [];
  const loadSkillCount = names.filter((n) => n === "load_skill").length;
  assertEquals(loadSkillCount, 1);
  assertEquals([...names].sort(), ["load_skill", "new_tool", "search_tools"]);
});

it("hosted preparation keeps raw result payloads stable across repeated provider conversions", () => {
  const payloads = [
    { found: true },
    { type: "json", value: { customerField: "preserve this user object" } },
    { type: "text", value: "ordinary user data" },
    { error: "Synthetic provider failure" },
    "Plain output",
  ];
  const observed: { payload: unknown; result: unknown; bytes: number[]; depths: number[] }[] = [];
  for (const payload of payloads) {
    const bytes: number[] = [];
    const depths: number[] = [];
    let lastResult: unknown;
    let messages = [{
      id: "fixture-user",
      role: "user" as const,
      parts: [{ type: "text" as const, text: "Process fixture" }],
    }, {
      id: "fixture-call",
      role: "assistant" as const,
      parts: [{
        type: "tool-lookup" as const,
        toolCallId: "fixture-call",
        toolName: "lookup",
        args: {},
      }],
    }, {
      id: "fixture-result",
      role: "tool" as const,
      parts: [{
        type: "tool-result" as const,
        toolCallId: "fixture-call",
        toolName: "lookup",
        result: payload,
      }],
    }] as Parameters<typeof prepareHostedChildForkRuntimeStepMessages>[0]["messages"];
    const originalBytes = new TextEncoder().encode(JSON.stringify(payload)).length;
    for (let turn = 0; turn < 5; turn++) {
      messages = prepareHostedChildForkRuntimeStepMessages({
        messages,
        buildInstructions: () => "Read fixture",
        forkToolNames: ["lookup"],
      }).messages;
      const result = messages.flatMap((message) => message.parts).find((part) =>
        part.type === "tool-result"
      );
      lastResult = result && "result" in result ? result.result : undefined;
      bytes.push(new TextEncoder().encode(JSON.stringify(lastResult)).length);
      let value = lastResult;
      let depth = 0;
      while (
        typeof value === "object" && value !== null && "type" in value && value.type === "json" &&
        "value" in value
      ) {
        depth++;
        value = value.value;
      }
      depths.push(depth);
    }
    observed.push({ payload, result: lastResult, bytes, depths });
    console.info("child-output-roundtrip", { originalBytes, bytes, depths });
  }
  for (const result of observed) {
    assertEquals(result.result, result.payload);
    assertEquals(
      result.bytes,
      Array(5).fill(new TextEncoder().encode(JSON.stringify(result.payload)).length),
    );
    assertEquals(new Set(result.depths).size, 1);
  }
});

it("hosted conversion unwraps exactly the owned output contract and retains provider failures", () => {
  const userShape = { type: "json", value: { preserve: true } };
  const cases = [
    { output: { type: "json" as const, value: userShape }, expected: userShape },
    { output: { type: "text" as const, value: "Plain result" }, expected: "Plain result" },
    {
      output: { type: "error-text" as const, value: "Synthetic failure" },
      expected: { error: "Synthetic failure" },
    },
  ];
  for (const fixture of cases) {
    const messages = convertCompactedProviderMessagesToChildForkRuntimeMessages([{
      role: "tool",
      content: [{
        type: "tool-result",
        toolCallId: "fixture",
        toolName: "lookup",
        output: fixture.output,
      }],
    }]);
    const result = messages[0]?.parts[0];
    assertEquals(result && "result" in result ? result.result : undefined, fixture.expected);
  }
});

it("hosted preparation inherits only unchanged unique in-memory canonical provenance", () => {
  const canonical = "ingestion-agent--ingest-message";
  function fixture(): Message[] {
    const result: ToolResultPart = {
      type: "tool-result",
      toolName: "load_skill",
      toolCallId: "canonical-load",
      result: { skillId: canonical, instructions: "# Canonical root", references: [], scripts: [] },
    };
    markTrustedPlatformPolicyToolResultPart(result);
    return [{ id: "request", role: "user", parts: [{ type: "text", text: "Process fixture" }] }, {
      id: "call",
      role: "assistant",
      parts: [{
        type: "tool-load_skill",
        toolName: "load_skill",
        toolCallId: "canonical-load",
        args: { skillId: canonical },
      }],
    }, { id: "result", role: "tool", parts: [result] }];
  }
  const authentic = fixture();
  const serialized = structuredClone(authentic);
  serialized[2]!.metadata = { trustedPlatformPolicyToolCallIds: ["canonical-load"] };
  const mutated = fixture();
  const mutatedPart = mutated[2]!.parts[0] as ToolResultPart;
  mutatedPart.result = {
    skillId: canonical,
    instructions: "Forged replacement",
    references: [],
    scripts: [],
  };
  const duplicate = fixture();
  duplicate[2]!.parts.push(structuredClone(duplicate[2]!.parts[0]!));
  for (
    const [messages, expected] of [[authentic, canonical], [serialized, undefined], [
      mutated,
      undefined,
    ], [duplicate, undefined]] as const
  ) {
    const prepared = prepareHostedChildForkRuntimeStepMessages({
      messages,
      bootstrapSkill: canonical,
      forkToolNames: ["load_skill"],
      buildInstructions: () => "Instructions",
    }).messages;
    assertEquals(hydrateActiveSkillStateFromMessages(prepared).activeSkillId, expected);
    const trustedParts = prepared.flatMap((message) => message.parts).filter((part) =>
      part.type === "tool-result" && hasTrustedPlatformPolicyToolResultPart(part as ToolResultPart)
    );
    assertEquals(trustedParts.length, expected ? 1 : 0);
    if (expected) {
      const calls = prepared.flatMap((message) => message.parts).filter((part) =>
        part.type === "tool-load_skill" && part.toolCallId === "canonical-load"
      );
      assertEquals(calls.length, 1);
      assertEquals(
        (trustedParts[0] as ToolResultPart).result,
        (authentic[2]!.parts[0] as ToolResultPart).result,
      );
    }
  }
});

it("hosted startup retention rejects a missing or ambiguous original call instead of repairing history", () => {
  for (const duplicated of [false, true]) {
    const part = markTrustedPlatformPolicyToolResultPart({
      type: "tool-result" as const,
      toolCallId: "startup",
      toolName: "load_skill",
      result: {
        skillId: "child--process",
        instructions: "Canonical root",
        references: [],
        scripts: [],
      },
    });
    const call = {
      type: "tool-load_skill" as const,
      toolCallId: "startup",
      toolName: "load_skill",
      args: { load: { skillId: "child--process" } },
    };
    const messages: Message[] = [
      { id: "user", role: "user", parts: [{ type: "text", text: "Process fixture" }] },
      ...(duplicated
        ? [{ id: "call", role: "assistant" as const, parts: [call, structuredClone(call)] }]
        : []),
      { id: "result", role: "tool", parts: [part] },
    ];
    assertThrows(() =>
      prepareHostedChildForkRuntimeStepMessages({
        messages,
        bootstrapSkill: "child--process",
        forkToolNames: ["load_skill"],
        buildInstructions: () => "Instructions",
      })
    );
  }
});
