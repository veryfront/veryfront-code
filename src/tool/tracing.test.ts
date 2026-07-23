import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertRejects, assertStrictEquals } from "@std/assert";
import { it } from "#veryfront/testing/bdd.ts";
import type { HostToolSet } from "./host-tools.ts";
import { traceHostTools, type TraceHostToolsOptions } from "./tracing.ts";

function requireTool(tools: HostToolSet, toolName: string) {
  const definition = tools[toolName];
  if (!definition) {
    throw new Error(`Missing tool ${toolName}`);
  }
  return definition;
}

it("traceHostTools passes through tools without execute unchanged", () => {
  const providerTool = { description: "A provider tool" };
  const toolset: HostToolSet = { web_search: providerTool };

  const traced = traceHostTools(toolset, {
    trace: (_spanName, operation) => operation(),
  });

  assertStrictEquals(traced.web_search, providerTool);
});

it("traceHostTools wraps executable tools with a trace span", async () => {
  const spans: string[] = [];
  const calls: unknown[] = [];
  const toolset: HostToolSet = {
    my_tool: {
      description: "does something",
      execute: (input: unknown) => {
        calls.push(input);
        return { result: "ok" };
      },
    },
  };

  const traced = traceHostTools(toolset, {
    trace: (spanName, operation) => {
      spans.push(spanName);
      return operation();
    },
  });

  const result = await requireTool(traced, "my_tool").execute?.({ input: "val" });

  assertEquals(result, { result: "ok" });
  assertEquals(spans, ["tool.my_tool"]);
  assertEquals(calls, [{ input: "val" }]);
});

it("traceHostTools publishes attributes with tool name and tool call id", async () => {
  const attributes: Record<string, unknown>[] = [];
  const toolset: HostToolSet = {
    bash: {
      execute: () => null,
    },
  };

  const traced = traceHostTools(toolset, {
    trace: (_spanName, operation) => operation(),
    buildAttributes: ({ toolName, toolCallId, context }) => ({
      "tool.name": toolName,
      "tool.call.id": toolCallId,
      "context.seen": Boolean(context),
    }),
    setAttributes: (nextAttributes) => {
      attributes.push(nextAttributes);
    },
  });

  await requireTool(traced, "bash").execute?.({}, { toolCallId: "call-abc" });

  assertEquals(attributes, [
    {
      "tool.name": "bash",
      "tool.call.id": "call-abc",
      "context.seen": true,
    },
  ]);
});

it("traceHostTools keeps build/set attribute callbacks on the same narrowed type", async () => {
  type NarrowAttributes = Record<string, string | number>;
  const seen: NarrowAttributes[] = [];
  const options: TraceHostToolsOptions<NarrowAttributes> = {
    trace: (_spanName, operation) => operation(),
    buildAttributes: ({ toolName }) => ({
      "tool.name": toolName,
      count: 1,
    }),
    setAttributes: (attributes) => {
      const toolName: string | number | undefined = attributes["tool.name"];
      if (toolName) {
        seen.push(attributes);
      }
    },
  };
  const traced = traceHostTools({ typed: { execute: () => "ok" } }, options);

  await requireTool(traced, "typed").execute?.({});

  assertEquals(seen, [{ "tool.name": "typed", count: 1 }]);
});

it("traceHostTools preserves non-execute properties on wrapped tools", () => {
  const providerOptions = { anthropic: { cacheControl: { type: "ephemeral" } } };
  const toolset: HostToolSet = {
    my_tool: {
      description: "original desc",
      providerOptions,
      execute: () => undefined,
    },
  };

  const traced = traceHostTools(toolset, {
    trace: (_spanName, operation) => operation(),
  });

  const tracedTool = requireTool(traced, "my_tool");
  assertEquals(tracedTool.description, "original desc");
  assertStrictEquals(tracedTool.providerOptions, providerOptions);
});

it("traceHostTools preserves prototype-named tools as own properties", async () => {
  const toolset: HostToolSet = {};
  Object.defineProperty(toolset, "__proto__", {
    value: { execute: () => "ok" },
    enumerable: true,
  });

  const traced = traceHostTools(toolset, {
    trace: (_spanName, operation) => operation(),
  });

  assertEquals(Object.hasOwn(traced, "__proto__"), true);
  assertEquals(await requireTool(traced, "__proto__").execute?.({}), "ok");
});

it("traceHostTools propagates errors from the original execute function", async () => {
  const toolset: HostToolSet = {
    fail: {
      execute: () => {
        throw new Error("tool failed");
      },
    },
  };

  const traced = traceHostTools(toolset, {
    trace: (_spanName, operation) => operation(),
  });

  await assertRejects(
    async () => {
      await requireTool(traced, "fail").execute?.({});
    },
    Error,
    "tool failed",
  );
});

it("traceHostTools returns an empty toolset for empty input", () => {
  const traced = traceHostTools({}, {
    trace: (_spanName, operation) => operation(),
  });
  assertEquals(traced, {});
});
