import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { afterEach, describe, it } from "#veryfront/testing/bdd.ts";
import { defineSchema } from "#veryfront/schemas";
import { tool } from "#veryfront/tool";
import { toolRegistry } from "#veryfront/tool/registry.ts";
import { step, workflow } from "#veryfront/workflow";
import {
  clearProjectAgentRuntimeRegistries,
  type ProjectAgentRuntimeDiscovery,
} from "../../../src/agent/project/agent-runtime.ts";
import { getActiveSourceIntegrationPolicy } from "../../../src/integrations/source-policy-context.ts";
import {
  normalizeSourceIntegrationPolicy,
  type SourceIntegrationPolicyManifest,
} from "../../../src/integrations/source-policy.ts";
import { saveToken } from "../../auth/token-store.ts";
import { formatWorkflowDiscoveryErrors, runWorkflowCommand } from "./command.ts";

const originalRedisUrl = Deno.env.get("REDIS_URL");
const originalRunResultPath = Deno.env.get("VERYFRONT_RUN_RESULT_PATH");
const originalApiToken = Deno.env.get("VERYFRONT_API_TOKEN");
const originalProjectSlug = Deno.env.get("VERYFRONT_PROJECT_SLUG");
const originalXdgConfigHome = Deno.env.get("XDG_CONFIG_HOME");

function restoreEnv() {
  if (originalRedisUrl === undefined) {
    Deno.env.delete("REDIS_URL");
  } else {
    Deno.env.set("REDIS_URL", originalRedisUrl);
  }

  if (originalRunResultPath === undefined) {
    Deno.env.delete("VERYFRONT_RUN_RESULT_PATH");
  } else {
    Deno.env.set("VERYFRONT_RUN_RESULT_PATH", originalRunResultPath);
  }

  if (originalApiToken === undefined) {
    Deno.env.delete("VERYFRONT_API_TOKEN");
  } else {
    Deno.env.set("VERYFRONT_API_TOKEN", originalApiToken);
  }

  if (originalProjectSlug === undefined) {
    Deno.env.delete("VERYFRONT_PROJECT_SLUG");
  } else {
    Deno.env.set("VERYFRONT_PROJECT_SLUG", originalProjectSlug);
  }

  if (originalXdgConfigHome === undefined) {
    Deno.env.delete("XDG_CONFIG_HOME");
  } else {
    Deno.env.set("XDG_CONFIG_HOME", originalXdgConfigHome);
  }
}

function createEmptyDiscoveryResult(
  sourceIntegrationPolicy: SourceIntegrationPolicyManifest = normalizeSourceIntegrationPolicy(
    undefined,
  ),
): ProjectAgentRuntimeDiscovery {
  return {
    tools: new Map(),
    agents: new Map(),
    skills: new Map(),
    resources: new Map(),
    prompts: new Map(),
    workflows: new Map(),
    tasks: new Map(),
    schedules: new Map(),
    webhooks: new Map(),
    evals: new Map(),
    errors: [],
    sourceIntegrationPolicy,
  };
}

describe("workflow command", () => {
  afterEach(() => {
    restoreEnv();
    clearProjectAgentRuntimeRegistries();
  });

  it("formats workflow load errors for non-debug logs", () => {
    const lines = formatWorkflowDiscoveryErrors([
      {
        filePath: "workflows/my-workflow.ts",
        error: "Step \"start\" must specify either 'agent' or 'tool'",
      },
    ]);

    assertEquals(lines, [
      "  - workflows/my-workflow.ts: Step \"start\" must specify either 'agent' or 'tool'",
    ]);
  });

  it("limits workflow load errors in logs", () => {
    const lines = formatWorkflowDiscoveryErrors(
      Array.from({ length: 6 }, (_, index) => ({
        filePath: `workflows/workflow-${index}.ts`,
        error: "Invalid workflow",
      })),
    );

    assertEquals(lines.length, 6);
    assertEquals(lines.at(-1), "  - 1 more workflow file failed to load");
  });

  it("runs project workflows with discovered project tool steps", async () => {
    const projectDir = await Deno.makeTempDir({ prefix: "vf-workflow-command-" });
    const resultPath = `${projectDir}/.veryfront/result.json`;

    try {
      const echoTool = tool({
        id: "echo",
        description: "Echo workflow input.",
        inputSchema: defineSchema((v) => v.object({ message: v.string() }))(),
        execute: (input) => ({
          echoed: input.message,
          sourceIntegrationPolicy: getActiveSourceIntegrationPolicy(),
        }),
      });

      const echoWorkflow = workflow({
        id: "echo",
        description: "Echo a message through a project-local tool.",
        steps: [step("start", { tool: "echo", input: { message: "hello" } })],
      });

      Deno.env.delete("REDIS_URL");
      Deno.env.set("VERYFRONT_RUN_RESULT_PATH", resultPath);

      await runWorkflowCommand(
        {
          action: "run",
          name: "echo",
          input: undefined,
          debug: false,
          projectDir,
        },
        {
          discoverProjectAgentRuntime: () => {
            toolRegistry.register(echoTool.id, echoTool);

            const discovery = createEmptyDiscoveryResult(
              normalizeSourceIntegrationPolicy({
                allow: { confluence: { allowedTools: ["search_content"] } },
              }),
            );
            discovery.tools.set(echoTool.id, echoTool);
            discovery.workflows.set(echoWorkflow.id, echoWorkflow);

            return Promise.resolve(discovery);
          },
        },
      );

      assertEquals(JSON.parse(await Deno.readTextFile(resultPath)), {
        start: {
          echoed: "hello",
          sourceIntegrationPolicy: {
            schemaVersion: 1,
            mode: "allowlist",
            integrations: {
              confluence: { allowedToolIds: ["search_content"] },
            },
          },
        },
      });
    } finally {
      await Deno.remove(projectDir, { recursive: true });
    }
  });

  it("hydrates runtime auth from the stored login token and project config", async () => {
    const projectDir = await Deno.makeTempDir({ prefix: "vf-workflow-command-" });
    const configHome = await Deno.makeTempDir({ prefix: "vf-workflow-auth-" });
    const resultPath = `${projectDir}/.veryfront/result.json`;

    try {
      Deno.env.delete("VERYFRONT_API_TOKEN");
      Deno.env.delete("VERYFRONT_PROJECT_SLUG");
      Deno.env.delete("REDIS_URL");
      Deno.env.set("XDG_CONFIG_HOME", configHome);
      Deno.env.set("VERYFRONT_RUN_RESULT_PATH", resultPath);
      await saveToken("stored-token");
      await Deno.writeTextFile(
        `${projectDir}/veryfront.config.ts`,
        'export default { projectSlug: "configured-workflow-project" };\n',
      );

      const echoTool = tool({
        id: "echo",
        description: "Echo workflow input.",
        inputSchema: defineSchema((v) => v.object({ message: v.string() }))(),
        execute: (input) => ({ echoed: input.message }),
      });

      const echoWorkflow = workflow({
        id: "echo",
        description: "Echo a message through a project-local tool.",
        steps: [step("start", { tool: "echo", input: { message: "hello" } })],
      });

      await runWorkflowCommand(
        {
          action: "run",
          name: "echo",
          input: undefined,
          debug: false,
          projectDir,
        },
        {
          discoverProjectAgentRuntime: () => {
            toolRegistry.register(echoTool.id, echoTool);

            const discovery = createEmptyDiscoveryResult();
            discovery.tools.set(echoTool.id, echoTool);
            discovery.workflows.set(echoWorkflow.id, echoWorkflow);

            return Promise.resolve(discovery);
          },
        },
      );

      assertEquals(Deno.env.get("VERYFRONT_API_TOKEN"), "stored-token");
      assertEquals(Deno.env.get("VERYFRONT_PROJECT_SLUG"), "configured-workflow-project");
    } finally {
      await Deno.remove(projectDir, { recursive: true });
      await Deno.remove(configHome, { recursive: true });
    }
  });
});
