import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import type { HostToolDefinition, HostToolSet } from "#veryfront/tool";
import { selectHostedChildForkRuntimeTools } from "./child-requested-tools.ts";

const createFileTool: HostToolDefinition = {
  description: "Create a file",
  parameters: { type: "object", properties: {} },
};
const updateFileTool: HostToolDefinition = {
  description: "Update a file",
  parameters: { type: "object", properties: {} },
};
const bashTool: HostToolDefinition = {
  description: "Run shell",
  parameters: { type: "object", properties: {} },
};
const forkTools: HostToolSet = {
  create_file: createFileTool,
  update_file: updateFileTool,
  bash: bashTool,
};

Deno.test("selectHostedChildForkRuntimeTools returns all fork tools when no requested tools are provided", () => {
  const result = selectHostedChildForkRuntimeTools({
    provider: "openai",
    forkModel: "openai/gpt-5.4",
    forkTools,
  });

  assertEquals(result, {
    ok: true,
    forkTools,
  });
});

Deno.test("selectHostedChildForkRuntimeTools narrows fork tools to requested runtime tools", () => {
  const result = selectHostedChildForkRuntimeTools({
    provider: "openai",
    forkModel: "openai/gpt-5.4",
    forkTools,
    requestedTools: ["update_file", "bash"],
  });

  assertEquals(result, {
    ok: true,
    forkTools: {
      update_file: updateFileTool,
      bash: bashTool,
    },
  });
});

Deno.test("selectHostedChildForkRuntimeTools accepts provider-native requested tool names", () => {
  const result = selectHostedChildForkRuntimeTools({
    provider: "anthropic",
    forkModel: "anthropic/claude-sonnet-4.5",
    forkTools,
    requestedTools: ["web_search", "create_file"],
  });

  assertEquals(result, {
    ok: true,
    forkTools: {
      create_file: createFileTool,
    },
  });
});

Deno.test("selectHostedChildForkRuntimeTools reports requested tools unavailable to the runtime", () => {
  const result = selectHostedChildForkRuntimeTools({
    provider: "openai",
    forkModel: "openai/gpt-5.4",
    forkTools,
    requestedTools: ["missing_tool"],
  });

  assertEquals(result, {
    ok: false,
    errorMessage:
      "Requested fork tools not available in runtime: missing_tool. Available: bash, create_file, update_file.",
  });
});
