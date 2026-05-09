import { assertEquals } from "#veryfront/testing/assert.ts";
import type { HostToolSet } from "#veryfront/tool";
import {
  buildDefaultHostedChildForkToolSet,
  buildHostedChildToolDescription,
  DEFAULT_HOSTED_CHILD_EXCLUDED_TOOL_NAMES,
  expandHostedChildRequestedTools,
  prepareDefaultHostedChildForkRuntimeTools,
  prepareDefaultHostedChildForkToolAssembly,
  sanitizeDefaultHostedChildRequestedTools,
  sanitizeHostedChildRequestedTools,
  selectDefaultHostedChildForkRuntimeTools,
  shouldPruneSandboxToolsFromHostedChildRequest,
} from "./hosted-child-requested-tools.ts";

const sandboxCuePattern = /\b(bash|shell|terminal|python|node|npm)\b/i;
const textArtifactPrompt = (prompt: string) => /\b(markdown|report)\b/i.test(prompt);

Deno.test("expandHostedChildRequestedTools returns undefined when tools are omitted", () => {
  assertEquals(expandHostedChildRequestedTools({}), undefined);
});

Deno.test("expandHostedChildRequestedTools preserves empty requested tool arrays", () => {
  assertEquals(expandHostedChildRequestedTools({ requestedTools: [] }), []);
});

Deno.test("expandHostedChildRequestedTools removes excluded tools and adds companions", () => {
  const result = expandHostedChildRequestedTools({
    requestedTools: ["shell", "panel", "create_file"],
    excludedTools: new Set(["panel"]),
    companionTools: { create_file: ["update_file"] },
  });

  assertEquals(result, ["shell", "create_file", "update_file"]);
});

Deno.test("expandHostedChildRequestedTools removes excluded companion tools", () => {
  const result = expandHostedChildRequestedTools({
    requestedTools: ["create_file"],
    excludedTools: new Set(["update_file"]),
    companionTools: { create_file: ["update_file"] },
  });

  assertEquals(result, ["create_file"]);
});

Deno.test("sanitizeHostedChildRequestedTools prunes sandbox tools for text artifact prompts without sandbox cues", () => {
  const result = sanitizeHostedChildRequestedTools({
    prompt: "Write a markdown report",
    requestedTools: ["create_file", "bash", "readFile"],
    sandboxRequiredCuePattern: sandboxCuePattern,
    isTextArtifactPrompt: textArtifactPrompt,
  });

  assertEquals(result, ["create_file"]);
});

Deno.test("sanitizeHostedChildRequestedTools keeps sandbox tools when prompt contains sandbox cues", () => {
  const result = sanitizeHostedChildRequestedTools({
    prompt: "Write a markdown report using python",
    requestedTools: ["create_file", "bash"],
    sandboxRequiredCuePattern: sandboxCuePattern,
    isTextArtifactPrompt: textArtifactPrompt,
  });

  assertEquals(result, ["create_file", "bash"]);
});

Deno.test("shouldPruneSandboxToolsFromHostedChildRequest is deterministic for stateful regex cues", () => {
  const statefulSandboxCuePattern = /\bpython\b/gi;
  const input = {
    prompt: "Write a markdown report using python",
    requestedTools: ["create_file", "bash"],
    sandboxRequiredCuePattern: statefulSandboxCuePattern,
    isTextArtifactPrompt: textArtifactPrompt,
  };

  assertEquals(shouldPruneSandboxToolsFromHostedChildRequest(input), false);
  assertEquals(shouldPruneSandboxToolsFromHostedChildRequest(input), false);
});

Deno.test("shouldPruneSandboxToolsFromHostedChildRequest requires artifact tools", () => {
  assertEquals(
    shouldPruneSandboxToolsFromHostedChildRequest({
      prompt: "Write a markdown report",
      requestedTools: ["bash"],
      sandboxRequiredCuePattern: sandboxCuePattern,
      isTextArtifactPrompt: textArtifactPrompt,
    }),
    false,
  );
});

Deno.test("buildHostedChildToolDescription describes child agent usage", () => {
  const description = buildHostedChildToolDescription();
  assertEquals(description.includes("child agent"), true);
  assertEquals(description.includes("parallel"), true);
});

Deno.test("DEFAULT_HOSTED_CHILD_EXCLUDED_TOOL_NAMES excludes UI-only tools", () => {
  assertEquals(DEFAULT_HOSTED_CHILD_EXCLUDED_TOOL_NAMES.has("studio_panel_control"), true);
  assertEquals(DEFAULT_HOSTED_CHILD_EXCLUDED_TOOL_NAMES.has("studio_suggestions"), true);
  assertEquals(DEFAULT_HOSTED_CHILD_EXCLUDED_TOOL_NAMES.has("form_input"), true);
  assertEquals(DEFAULT_HOSTED_CHILD_EXCLUDED_TOOL_NAMES.has("bash"), false);
  assertEquals(DEFAULT_HOSTED_CHILD_EXCLUDED_TOOL_NAMES.has("create_file"), false);
});

Deno.test("sanitizeDefaultHostedChildRequestedTools applies default exclusions and companions", () => {
  const result = sanitizeDefaultHostedChildRequestedTools({
    prompt: "hello",
    requestedTools: ["bash", "studio_panel_control", "form_input", "create_file"],
  });

  assertEquals(result, ["bash", "create_file", "update_file"]);
});

Deno.test("sanitizeDefaultHostedChildRequestedTools adds reverse file-writing companions", () => {
  const result = sanitizeDefaultHostedChildRequestedTools({
    prompt: "hello",
    requestedTools: ["update_file"],
  });

  assertEquals(result, ["update_file", "create_file"]);
});

Deno.test("sanitizeDefaultHostedChildRequestedTools prunes sandbox tools for text artifact prompts", () => {
  const result = sanitizeDefaultHostedChildRequestedTools({
    prompt: "Write a markdown research report",
    requestedTools: ["create_file", "bash"],
  });

  assertEquals(result, ["create_file", "update_file"]);
});

Deno.test("sanitizeDefaultHostedChildRequestedTools keeps sandbox tools for prompts with sandbox cues", () => {
  const result = sanitizeDefaultHostedChildRequestedTools({
    prompt: "Write a markdown report using python to parse data",
    requestedTools: ["create_file", "bash"],
  });

  assertEquals(result, ["create_file", "update_file", "bash"]);
});

Deno.test("selectDefaultHostedChildForkRuntimeTools filters requested tools after defaults", () => {
  const forkTools = {
    bash: { description: "Run shell commands" },
    create_file: { description: "Create a file" },
    update_file: { description: "Update a file" },
    knowledge_lookup: { description: "Lookup knowledge" },
  };

  const result = selectDefaultHostedChildForkRuntimeTools({
    provider: "anthropic",
    forkModel: "claude-sonnet-4-5-20250929",
    forkTools,
    effectivePrompt: "Create the requested project artifact",
    requestedTools: ["create_file"],
  });

  assertEquals(result, {
    ok: true,
    forkTools: {
      create_file: forkTools.create_file,
      update_file: forkTools.update_file,
    },
  });
});

Deno.test("prepareDefaultHostedChildForkRuntimeTools selects, decorates, and reports tool names", async () => {
  const fallbackCalls: unknown[] = [];
  const mutations: unknown[] = [];
  const logMessages: string[] = [];
  const forkTools: HostToolSet = {
    bash: { description: "Run shell commands" },
    create_file: {
      description: "Create a file",
      execute: () => ({ content: [{ type: "text", text: "file already exists" }], isError: true }),
    },
    update_file: {
      description: "Update a file",
      execute: (toolInput: unknown) => {
        fallbackCalls.push(toolInput);
        return { structuredContent: { success: true } };
      },
    },
  };

  const prepared = prepareDefaultHostedChildForkRuntimeTools({
    provider: "anthropic",
    forkModel: "claude-sonnet-4-5-20250929",
    forkTools,
    effectivePrompt: "Create the requested project artifact",
    requestedTools: ["create_file"],
    activeProjectId: "project-1",
    logger: {
      info: (message) => {
        logMessages.push(message);
      },
    },
    onSteeringMutation: (mutation) => {
      mutations.push(mutation);
    },
  });
  if (!prepared.ok) {
    throw new Error(prepared.errorMessage);
  }

  assertEquals(prepared.availableToolNames, ["create_file", "update_file"]);
  assertEquals(Object.keys(prepared.forkTools), ["create_file", "update_file"]);

  const createFileTool = prepared.forkTools.create_file;
  if (!createFileTool?.execute) {
    throw new Error("expected decorated create_file tool");
  }

  const result = await createFileTool.execute({
    project_reference: "project-1",
    path: "AGENTS.md",
    content: "updated instructions",
  });

  assertEquals(result, { structuredContent: { success: true } });
  assertEquals(fallbackCalls, [{
    project_reference: "project-1",
    path: "AGENTS.md",
    content: "updated instructions",
  }]);
  assertEquals(logMessages, [
    "Falling back from create_file to update_file for existing project artifact",
  ]);
  assertEquals(mutations, [{ instructionsChanged: true, skillsChanged: false }]);
});

Deno.test("prepareDefaultHostedChildForkToolAssembly prepares sources and returns cleanup handles", async () => {
  const closeCalls: string[] = [];
  const sourceTools: HostToolSet = {
    create_file: { description: "Create file" },
    update_file: { description: "Update file" },
  };

  const result = await prepareDefaultHostedChildForkToolAssembly({
    prepareToolSources: () =>
      Promise.resolve({
        ok: true,
        forkTools: sourceTools,
        closeTooling: () => {
          closeCalls.push("tooling");
          return Promise.resolve();
        },
        closeRuntime: () => {
          closeCalls.push("runtime");
          return Promise.resolve();
        },
      }),
    provider: "anthropic",
    forkModel: "claude-sonnet-4-5-20250929",
    effectivePrompt: "Create the requested project artifact",
    requestedTools: ["create_file"],
  });

  if (!result.ok) {
    throw new Error(result.errorMessage);
  }

  assertEquals(Object.keys(result.forkTools), ["create_file", "update_file"]);
  assertEquals(result.availableToolNames, ["create_file", "update_file"]);

  await result.closeTooling?.();
  await result.closeRuntime?.();

  assertEquals(closeCalls, ["tooling", "runtime"]);
});

Deno.test("prepareDefaultHostedChildForkToolAssembly closes sources when tool selection fails", async () => {
  const closeCalls: string[] = [];

  const result = await prepareDefaultHostedChildForkToolAssembly({
    prepareToolSources: () =>
      Promise.resolve({
        ok: true,
        forkTools: {
          create_file: { description: "Create file" },
        },
        closeTooling: () => {
          closeCalls.push("tooling");
          return Promise.resolve();
        },
        closeRuntime: () => {
          closeCalls.push("runtime");
          return Promise.resolve();
        },
      }),
    provider: "anthropic",
    forkModel: "claude-sonnet-4-5-20250929",
    effectivePrompt: "Create the requested project artifact",
    requestedTools: ["not_a_real_tool"],
  });

  assertEquals(result, {
    ok: false,
    errorMessage:
      "Requested fork tools not available in runtime: not_a_real_tool. Available: create_file, web_fetch, web_search.",
  });
  assertEquals(closeCalls, ["tooling", "runtime"]);
});

Deno.test("buildDefaultHostedChildForkToolSet merges tool sets deterministically and removes default exclusions", () => {
  const bashTool = { description: "Run shell commands" };
  const createFileTool = { description: "Create a file" };
  const updateFileTool = { description: "Update a file" };
  const replacementCreateFileTool = { description: "Create a replacement file" };

  const result = buildDefaultHostedChildForkToolSet(
    {
      studio_suggestions: { description: "Suggest UI actions" },
      update_file: updateFileTool,
      create_file: createFileTool,
    },
    {
      studio_panel_control: { description: "Control panels" },
      bash: bashTool,
      create_file: replacementCreateFileTool,
    },
  );

  assertEquals(Object.keys(result), ["bash", "create_file", "update_file"]);
  assertEquals(result, {
    bash: bashTool,
    create_file: replacementCreateFileTool,
    update_file: updateFileTool,
  });
});
