import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertRejects, assertStrictEquals } from "#veryfront/testing/assert.ts";
import { afterEach, describe, it } from "#veryfront/testing/bdd.ts";
import { defineSchema } from "#veryfront/schemas";
import { tool } from "#veryfront/tool";
import { toolRegistry } from "#veryfront/tool/registry.ts";
import { step, workflow } from "#veryfront/workflow";
import { MemoryBackend } from "../../../src/workflow/backends/memory.ts";
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

  it("rejects valid JSON values that are not workflow input objects", async () => {
    for (const input of ["null", "[]", '"text"', "42"]) {
      await assertRejects(
        () =>
          runWorkflowCommand({
            action: "run",
            name: "example",
            input,
            debug: false,
          }),
        Error,
        "must be a valid JSON object",
      );
    }
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

      Deno.env.set("REDIS_URL", "rediss://ignored.example.test:6380");
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
          createDistributedWorkflowBackend: () => {
            throw new Error("environment variables must not select a workflow backend");
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

  it("activates project extensions before creating an explicitly selected distributed backend", async () => {
    const projectDir = await Deno.makeTempDir({ prefix: "vf-workflow-command-" });
    const resultPath = `${projectDir}/.veryfront/result.json`;
    const events: string[] = [];

    try {
      Deno.env.set("VERYFRONT_RUN_RESULT_PATH", resultPath);
      const echoTool = tool({
        id: "distributed-echo",
        description: "Echo workflow input.",
        inputSchema: defineSchema((v) => v.object({ message: v.string() }))(),
        execute: (input) => ({ echoed: input.message }),
      });
      const echoWorkflow = workflow({
        id: "distributed-echo",
        description: "Echo through an explicitly selected backend.",
        steps: [
          step("start", {
            tool: "distributed-echo",
            input: { message: "durable" },
          }),
        ],
      });

      const backend = new MemoryBackend();
      const originalInitialize = backend.initialize.bind(backend);
      const originalDestroy = backend.destroy.bind(backend);
      backend.initialize = () => {
        events.push("backend:initialize");
        return originalInitialize();
      };
      backend.destroy = () => {
        events.push("backend:destroy");
        return originalDestroy();
      };

      await runWorkflowCommand(
        {
          action: "run",
          name: echoWorkflow.id,
          input: undefined,
          backend: "distributed",
          debug: false,
          projectDir,
        },
        {
          orchestrateExtensions: (options) => {
            events.push("extensions:setup");
            assertEquals(options.projectDir, projectDir);
            return Promise.resolve({
              teardownAll: () => {
                events.push("extensions:teardown");
                return Promise.resolve();
              },
            });
          },
          discoverProjectAgentRuntime: () => {
            events.push("workflow:discover");
            toolRegistry.register(echoTool.id, echoTool);
            const discovery = createEmptyDiscoveryResult();
            discovery.tools.set(echoTool.id, echoTool);
            discovery.workflows.set(echoWorkflow.id, echoWorkflow);
            return Promise.resolve(discovery);
          },
          createDistributedWorkflowBackend: () => {
            events.push("backend:create");
            return backend;
          },
        },
      );

      assertEquals(JSON.parse(await Deno.readTextFile(resultPath)), {
        start: { echoed: "durable" },
      });
      assertEquals(events, [
        "extensions:setup",
        "workflow:discover",
        "backend:create",
        "backend:initialize",
        "backend:destroy",
        "extensions:teardown",
      ]);
    } finally {
      await Deno.remove(projectDir, { recursive: true });
    }
  });

  it("destroys an explicitly selected backend when client initialization fails", async () => {
    const projectDir = await Deno.makeTempDir({ prefix: "vf-workflow-command-" });
    const initializationError = new Error("distributed backend initialization failed");
    const backend = new MemoryBackend();
    let initializeCalls = 0;
    let destroyCalls = 0;
    backend.initialize = () => {
      initializeCalls++;
      return Promise.reject(initializationError);
    };
    backend.destroy = () => {
      destroyCalls++;
      return Promise.resolve();
    };
    const candidate = workflow({
      id: "distributed-initialization-failure",
      description: "Exercise distributed workflow lifecycle ownership.",
      steps: [],
    });

    try {
      const failure = await assertRejects(
        () =>
          runWorkflowCommand(
            {
              action: "run",
              name: candidate.id,
              input: undefined,
              backend: "distributed",
              debug: false,
              projectDir,
            },
            {
              orchestrateExtensions: () =>
                Promise.resolve({ teardownAll: () => Promise.resolve() }),
              discoverProjectAgentRuntime: () => {
                const discovery = createEmptyDiscoveryResult();
                discovery.workflows.set(candidate.id, candidate);
                return Promise.resolve(discovery);
              },
              createDistributedWorkflowBackend: () => backend,
            },
          ),
        Error,
        initializationError.message,
      );
      assertStrictEquals(failure, initializationError);
      assertEquals(initializeCalls, 1);
      assertEquals(destroyCalls, 1);
    } finally {
      await Deno.remove(projectDir, { recursive: true });
    }
  });

  it("destroys an explicitly selected backend when client construction fails before extension teardown", async () => {
    const projectDir = await Deno.makeTempDir({ prefix: "vf-workflow-command-" });
    const events: string[] = [];
    const backend = new MemoryBackend();
    let destroyCalls = 0;
    Object.defineProperty(backend, "acquireLock", { value: undefined });
    backend.destroy = () => {
      destroyCalls++;
      events.push("backend:destroy");
      return Promise.resolve();
    };
    const candidate = workflow({
      id: "distributed-construction-failure",
      description: "Exercise backend cleanup after client construction failure.",
      steps: [],
    });

    try {
      await assertRejects(
        () =>
          runWorkflowCommand(
            {
              action: "run",
              name: candidate.id,
              input: undefined,
              backend: "distributed",
              debug: false,
              projectDir,
            },
            {
              orchestrateExtensions: () =>
                Promise.resolve({
                  teardownAll: () => {
                    events.push("extensions:teardown");
                    return Promise.resolve();
                  },
                }),
              discoverProjectAgentRuntime: () => {
                const discovery = createEmptyDiscoveryResult();
                discovery.workflows.set(candidate.id, candidate);
                return Promise.resolve(discovery);
              },
              createDistributedWorkflowBackend: () => backend,
            },
          ),
        Error,
        "locking requires backend acquireLock, extendLock, releaseLock, and lock-fenced update",
      );

      assertEquals(destroyCalls, 1);
      assertEquals(events, ["backend:destroy", "extensions:teardown"]);
    } finally {
      await Deno.remove(projectDir, { recursive: true });
    }
  });

  it("preserves initialization and backend cleanup failures while tearing down extensions afterward", async () => {
    const projectDir = await Deno.makeTempDir({ prefix: "vf-workflow-command-" });
    const events: string[] = [];
    const initializationError = new Error("distributed backend initialization failed");
    const destroyError = new Error("distributed backend cleanup failed");
    const backend = new MemoryBackend();
    let initializeCalls = 0;
    let destroyCalls = 0;
    backend.initialize = () => {
      initializeCalls++;
      events.push("backend:initialize");
      return Promise.reject(initializationError);
    };
    backend.destroy = () => {
      destroyCalls++;
      events.push("backend:destroy");
      return Promise.reject(destroyError);
    };
    const candidate = workflow({
      id: "distributed-initialization-and-cleanup-failure",
      description: "Preserve lifecycle failure identities during command cleanup.",
      steps: [],
    });

    try {
      const failure = await assertRejects(
        () =>
          runWorkflowCommand(
            {
              action: "run",
              name: candidate.id,
              input: undefined,
              backend: "distributed",
              debug: false,
              projectDir,
            },
            {
              orchestrateExtensions: () =>
                Promise.resolve({
                  teardownAll: () => {
                    events.push("extensions:teardown");
                    return Promise.resolve();
                  },
                }),
              discoverProjectAgentRuntime: () => {
                const discovery = createEmptyDiscoveryResult();
                discovery.workflows.set(candidate.id, candidate);
                return Promise.resolve(discovery);
              },
              createDistributedWorkflowBackend: () => backend,
            },
          ),
        AggregateError,
        "Workflow execution and backend cleanup failed",
      );

      if (!(failure instanceof AggregateError)) {
        throw new Error("Expected combined workflow lifecycle failure");
      }
      assertEquals(initializeCalls, 1);
      assertEquals(destroyCalls, 1);
      assertEquals(events, [
        "backend:initialize",
        "backend:destroy",
        "extensions:teardown",
      ]);
      assertEquals(failure.errors.length, 2);
      assertStrictEquals(failure.errors[0], initializationError);

      const cleanupFailure = failure.errors[1];
      if (!(cleanupFailure instanceof AggregateError)) {
        throw new Error("Expected backend cleanup failure to be aggregated");
      }
      assertEquals(cleanupFailure.errors.length, 1);
      assertStrictEquals(cleanupFailure.errors[0], destroyError);
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
