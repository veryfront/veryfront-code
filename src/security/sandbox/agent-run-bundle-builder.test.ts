import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertRejects } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { createMockAdapter } from "#veryfront/platform/adapters/mock.ts";
import type {
  AgentRunWorkerPreparationRequest,
  AgentRunWorkerPreparationResponse,
} from "./agent-run-worker-contract.ts";
import {
  type AgentRunModuleBundlerInput,
  buildAgentRunExecutionBundle,
} from "./agent-run-bundle-builder.ts";

const projectId = "10000000-1000-4000-8000-100000000005";

function request() {
  return {
    runId: "run_1",
    threadId: "10000000-1000-4000-8000-100000000001",
    agentId: "assistant-1",
    messages: [],
    tools: [],
    context: [],
    agentSource: { type: "branch" as const, branch: "main" },
  };
}

function prepared(
  input: AgentRunWorkerPreparationRequest,
  roots: { agentDirs: string[]; toolDirs: string[]; skillDirs: string[] },
): AgentRunWorkerPreparationResponse {
  return {
    type: "agent-run-prepared",
    schemaVersion: 1,
    preparationId: input.preparationId,
    sourceDigest: input.sourceDigest,
    projection: {
      ...roots,
      sourceIntegrationPolicy: { schemaVersion: 1, mode: "unrestricted" },
    },
  };
}

function baseInput() {
  const adapter = createMockAdapter();
  return {
    adapter,
    input: {
      projectDir: "/project",
      adapter,
      run: {
        runId: "run_1",
        agentId: "assistant-1",
        projectId,
        projectSlug: "demo-project",
        runtimeTarget: { runtimeTargetKind: "main_branch" as const },
      },
      request: request(),
      framework: {
        apiUrl: "https://api.example.com",
        projectId,
      },
    },
  };
}

describe("security/sandbox/agent-run-bundle-builder", () => {
  it("compiles only Worker-selected custom roots from the immutable source snapshot", async () => {
    delete (globalThis as Record<string, unknown>).__agentConfigEvaluatedInHost;
    const { adapter, input } = baseInput();
    adapter.fs.files.set(
      "/project/veryfront.config.js",
      [
        "globalThis.__agentConfigEvaluatedInHost = true;",
        "export default { ai: { agents: { discovery: { paths: ['custom-agents'] } } } };",
      ].join("\n"),
    );
    adapter.fs.files.set("/project/agents/default.ts", "export default 'default';");
    adapter.fs.files.set("/project/custom-agents/selected.ts", "export default 'snapshot';");

    const bundledSources: Array<{ sourcePath: string; source: string }> = [];
    const bundle = await buildAgentRunExecutionBundle({
      ...input,
      prepareInWorker: async (preparation) => {
        assertEquals(preparation.configModule?.moduleCode.includes("custom-agents"), true);
        adapter.fs.files.set(
          "/project/custom-agents/selected.ts",
          "export default 'mutated-after-snapshot';",
        );
        return prepared(preparation, {
          agentDirs: ["custom-agents"],
          toolDirs: ["custom-tools"],
          skillDirs: ["custom-skills"],
        });
      },
      bundleModule: async (moduleInput: AgentRunModuleBundlerInput) => {
        bundledSources.push({
          sourcePath: moduleInput.sourcePath,
          source: await moduleInput.adapter.fs.readFile(moduleInput.modulePath),
        });
        return "export default {};";
      },
    });

    assertEquals(bundle.discovery.agentDirs, ["custom-agents"]);
    assertEquals(bundle.discovery.modules.map((module) => module.sourcePath), [
      "custom-agents/selected.ts",
    ]);
    assertEquals(bundledSources, [{
      sourcePath: "custom-agents/selected.ts",
      source: "export default 'snapshot';",
    }]);
    assertEquals(
      (globalThis as Record<string, unknown>).__agentConfigEvaluatedInHost,
      undefined,
    );
  });

  it("rejects a preparation response for a different source before compiling modules", async () => {
    const { adapter, input } = baseInput();
    adapter.fs.files.set("/project/agents/assistant.ts", "export default {};");
    let compileCalls = 0;

    await assertRejects(
      () =>
        buildAgentRunExecutionBundle({
          ...input,
          prepareInWorker: (preparation) =>
            Promise.resolve({
              ...prepared(preparation, {
                agentDirs: ["agents"],
                toolDirs: ["tools"],
                skillDirs: ["skills"],
              }),
              sourceDigest: "f".repeat(64),
            }),
          bundleModule: () => {
            compileCalls++;
            return Promise.resolve("export default {};");
          },
        }),
      TypeError,
      "identity",
    );
    assertEquals(compileCalls, 0);
  });

  it("merges overlapping agent and tool roots into one deterministic module entry", async () => {
    const { adapter, input } = baseInput();
    adapter.fs.files.set("/project/shared/definition.ts", "export default {};");

    const bundle = await buildAgentRunExecutionBundle({
      ...input,
      prepareInWorker: (preparation) =>
        Promise.resolve(prepared(preparation, {
          agentDirs: ["shared"],
          toolDirs: ["shared"],
          skillDirs: ["skills"],
        })),
      bundleModule: () => Promise.resolve("export default {};"),
    });

    assertEquals(bundle.discovery.modules, [{
      concepts: ["agent", "tool"],
      sourcePath: "shared/definition.ts",
      moduleCode: "export default {};",
    }]);
  });

  it("rejects hostile input accessors without invoking them in the host", async () => {
    const { input } = baseInput();
    let accessorCalls = 0;
    Object.defineProperty(input.run, "agentId", {
      enumerable: true,
      get() {
        accessorCalls++;
        return "assistant-1";
      },
    });

    await assertRejects(
      () => buildAgentRunExecutionBundle(input),
      TypeError,
      "enumerable data properties",
    );
    assertEquals(accessorCalls, 0);
  });
});
