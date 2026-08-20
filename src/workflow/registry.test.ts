import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertExists, assertThrows } from "#veryfront/testing/assert.ts";
import { afterEach, beforeEach, describe, it } from "#veryfront/testing/bdd.ts";
import { defineSchema } from "#veryfront/schemas/index.ts";
import { ERROR_DIAGNOSTIC_MAX_LENGTH_CHARS } from "#veryfront/errors/safe-diagnostics.ts";
import { getAllWorkflowIds, getWorkflow, registerWorkflow, workflowRegistry } from "./registry.ts";
import { workflowRegistry as publicWorkflowRegistry } from "./index.ts";
import type { NodeInfo, WorkflowMetadata } from "./index.ts";
import { waitForApproval } from "./dsl/wait.ts";
import type { WorkflowDefinition, WorkflowNode } from "./types.ts";
import { MAX_WORKFLOW_DEFINITION_DEPTH, MAX_WORKFLOW_DEFINITION_NODES } from "./limits.ts";
import { workflow } from "./dsl/workflow.ts";
import { step } from "./dsl/step.ts";
import { parallel } from "./dsl/parallel.ts";
import { branch } from "./dsl/branch.ts";
import { captureWorkflowDefinition } from "./executor/workflow-definition-snapshot.ts";

function node(id: string, type: string): WorkflowNode {
  return {
    id,
    config: type === "step" ? { type, tool: `${id}-tool` } : { type } as WorkflowNode["config"],
  };
}

function validSteps(): WorkflowNode[] {
  return [node("registered-step", "step")];
}

describe("WorkflowRegistry", () => {
  beforeEach(() => workflowRegistry.clear());
  afterEach(() => workflowRegistry.clear());

  describe("register()", () => {
    it("should register a workflow definition", () => {
      const definition: WorkflowDefinition = {
        id: "test-workflow",
        description: "A test workflow",
        steps: validSteps(),
      };

      workflowRegistry.register({ definition, id: "test-workflow" });

      assertEquals(workflowRegistry.has("test-workflow"), true);
    });

    it("should register a plain workflow definition", () => {
      const definition: WorkflowDefinition = {
        id: "plain-workflow",
        steps: [node("step1", "step")],
      };

      workflowRegistry.register(definition);

      assertEquals(workflowRegistry.has("plain-workflow"), true);
    });

    it("should extract metadata from definition", () => {
      const definition: WorkflowDefinition = {
        id: "metadata-test",
        description: "Test description",
        version: "1.0.0",
        timeout: "30m",
        integrationRequirements: [{
          integration: "slack",
          requiredScopes: ["channels:read"],
          resources: [{ kind: "channel", id: "C012345" }],
        }],
        steps: [
          node("step1", "step"),
          parallel("step2", [node("parallel-child", "step")]),
        ],
      };

      workflowRegistry.register(definition);

      const metadata = workflowRegistry.get("metadata-test");
      assertExists(metadata);
      assertEquals(metadata.id, "metadata-test");
      assertEquals(metadata.description, "Test description");
      assertEquals(metadata.version, "1.0.0");
      assertEquals(metadata.timeout, "30m");
      assertEquals(metadata.integrationRequirements, [{
        integration: "slack",
        requiredScopes: ["channels:read"],
        resources: [{ kind: "channel", id: "C012345" }],
      }]);
      assertEquals(metadata.nodeCount, 2);
      assertEquals([...metadata.nodeTypes].sort(), ["parallel", "step"]);
      assertEquals(metadata.hasInputSchema, false);
      assertEquals(metadata.hasOutputSchema, false);
    });

    it("keeps integration metadata immutable without ambient freeze", () => {
      const originalObjectFreeze = Object.freeze;
      let poisonCalls = 0;

      try {
        Object.freeze = ((value: object) => {
          poisonCalls += 1;
          return value;
        }) as typeof Object.freeze;
        workflowRegistry.register({
          id: "freeze-poison-workflow",
          steps: () => [],
          integrationRequirements: [{
            integration: "slack",
            requiredScopes: ["chat:write"],
            resources: [],
          }],
        });
      } finally {
        Object.freeze = originalObjectFreeze;
      }

      const stored = workflowRegistry.getDefinition("freeze-poison-workflow");
      const metadata = workflowRegistry.get("freeze-poison-workflow");
      assertEquals(poisonCalls, 0);
      assertEquals(Object.isFrozen(stored), true);
      assertEquals(Object.isFrozen(metadata), true);
      assertThrows(
        () => {
          (stored as { integrationRequirements?: unknown[] }).integrationRequirements = [];
        },
        TypeError,
      );
      assertThrows(
        () => {
          (metadata as { integrationRequirements?: unknown[] }).integrationRequirements = [];
        },
        TypeError,
      );
    });
  });

  describe("canonical admission", () => {
    it("validates the empty-declaration capture option without invoking hooks", () => {
      let proxyTrapCalls = 0;
      let accessorReads = 0;
      const proxiedOptions = new Proxy({ allowEmptySteps: true }, {
        get() {
          proxyTrapCalls++;
          throw new Error("option get trap must not run");
        },
        getOwnPropertyDescriptor() {
          proxyTrapCalls++;
          throw new Error("option descriptor trap must not run");
        },
        ownKeys() {
          proxyTrapCalls++;
          throw new Error("option ownKeys trap must not run");
        },
      });
      const accessorOptions = Object.defineProperty({}, "allowEmptySteps", {
        enumerable: true,
        get() {
          accessorReads++;
          return true;
        },
      });
      const definition = { id: "option-validation", steps: validSteps() };

      assertThrows(
        () => captureWorkflowDefinition(definition, proxiedOptions),
        Error,
        "non-Proxy plain record",
      );
      assertThrows(
        () =>
          captureWorkflowDefinition(
            definition,
            accessorOptions as { allowEmptySteps?: boolean },
          ),
        Error,
        "own data property",
      );
      assertEquals(proxyTrapCalls, 0);
      assertEquals(accessorReads, 0);
    });

    it("stores detached immutable definition and metadata snapshots", () => {
      const staticInput = { nested: { value: 1 } };
      const dependencies = ["first"];
      const integrationRequirements = [{
        integration: "slack",
        requiredScopes: ["channels:read"],
        resources: [{ kind: "channel", id: "C012345" }],
      }];
      const steps: WorkflowNode[] = [
        node("first", "step"),
        {
          id: "second",
          dependsOn: dependencies,
          config: {
            type: "step",
            agent: "original-agent",
            input: staticInput,
          },
        },
      ];
      const definition: WorkflowDefinition = {
        id: "detached-registration",
        integrationRequirements,
        steps,
      };

      workflowRegistry.register(definition);

      steps.push(node("late", "step"));
      dependencies[0] = "late";
      integrationRequirements[0]!.requiredScopes![0] = "mutated";
      integrationRequirements[0]!.resources![0]!.id = "mutated";
      staticInput.nested.value = 2;
      (steps[1]!.config as unknown as Record<string, unknown>).agent = "mutated-agent";

      const stored = workflowRegistry.getDefinition(definition.id);
      const metadata = workflowRegistry.get(definition.id);
      assertExists(stored);
      assertExists(metadata);
      assertEquals(Array.isArray(stored.steps), true);
      assertEquals((stored.steps as WorkflowNode[]).length, 2);
      assertEquals((stored.steps as WorkflowNode[])[1]!.dependsOn, ["first"]);
      assertEquals(
        ((stored.steps as WorkflowNode[])[1]!.config as unknown as Record<string, unknown>).agent,
        "original-agent",
      );
      assertEquals(
        (((stored.steps as WorkflowNode[])[1]!.config as unknown as Record<string, unknown>)
          .input as { nested: { value: number } }).nested.value,
        1,
      );
      assertEquals(metadata.agentRefs, ["original-agent"]);
      assertEquals(stored.integrationRequirements, [{
        integration: "slack",
        requiredScopes: ["channels:read"],
        resources: [{ kind: "channel", id: "C012345" }],
      }]);
      assertEquals(metadata.integrationRequirements, [{
        integration: "slack",
        requiredScopes: ["channels:read"],
        resources: [{ kind: "channel", id: "C012345" }],
      }]);
      assertEquals(metadata.nodes.find((entry) => entry.id === "second")?.dependsOn, ["first"]);
      assertEquals(Object.isFrozen(stored), true);
      assertEquals(Object.isFrozen(stored.steps), true);
      assertEquals(Object.isFrozen(metadata), true);
      assertEquals(Object.isFrozen(metadata.nodes), true);
      assertThrows(
        () => (stored.steps as WorkflowNode[]).push(node("forbidden", "step")),
        TypeError,
      );
      assertThrows(
        () => (metadata.agentRefs as string[]).push("forbidden"),
        TypeError,
      );
      assertEquals(workflowRegistry.get(definition.id)?.agentRefs, ["original-agent"]);
    });

    it("rejects malformed integration requirement metadata", () => {
      assertThrows(
        () =>
          workflowRegistry.register({
            id: "invalid-integration-label",
            integrationRequirements: [{ integration: "Slack" }],
            steps: validSteps(),
          }),
        Error,
        "Workflow integrationRequirements[0].integration",
      );

      for (
        const [integrationRequirements, message] of [
          [[{ integration: 42 }], "integration"],
          [[{ integration: "slack", requiredScopes: "channels:read" }], "requiredScopes"],
          [[{ integration: "slack", resources: [{ kind: "channel", id: 42 }] }], "resources"],
          [[{ integration: "Slack" }], "lowercase integration identifier"],
          [[{ integration: "slack" }, { integration: "slack" }], "duplicate integration"],
          [[{
            integration: "slack",
            requiredScopes: ["channels:read", "channels:read"],
          }], "duplicate scope"],
          [[{
            integration: "slack",
            resources: [{ kind: "Channel", id: "C012345" }],
          }], "lowercase resource kind"],
          [[{
            integration: "slack",
            resources: [
              { kind: "channel", id: "C012345" },
              { kind: "channel", id: "C012345" },
            ],
          }], "duplicate resource identity"],
        ] as const
      ) {
        assertThrows(
          () =>
            workflowRegistry.register({
              id: "invalid-integration-requirements",
              integrationRequirements,
              steps: validSteps(),
            } as unknown as WorkflowDefinition),
          Error,
          message,
        );
      }
    });

    it("unwraps workflow instances without evaluating wrapper accessors", () => {
      let definitionReads = 0;
      const wrapper = Object.defineProperty({}, "definition", {
        enumerable: true,
        get() {
          definitionReads++;
          return { id: "must-not-register", steps: validSteps() };
        },
      });

      assertThrows(
        () => workflowRegistry.register(wrapper as unknown as WorkflowDefinition),
        Error,
        "unsupported field",
      );
      assertEquals(definitionReads, 0);
      assertEquals(workflowRegistry.has("must-not-register"), false);
    });

    it("rejects proxied registration structures without invoking traps", () => {
      let trapCalls = 0;
      const handler: ProxyHandler<object> = {
        get() {
          trapCalls++;
          throw new Error("get trap must not run");
        },
        getOwnPropertyDescriptor() {
          trapCalls++;
          throw new Error("descriptor trap must not run");
        },
        getPrototypeOf() {
          trapCalls++;
          throw new Error("prototype trap must not run");
        },
        has() {
          trapCalls++;
          throw new Error("has trap must not run");
        },
        ownKeys() {
          trapCalls++;
          throw new Error("ownKeys trap must not run");
        },
      };
      const proxiedDefinition = new Proxy(
        { id: "proxied-definition", steps: validSteps() },
        handler,
      );
      const proxiedWrapper = new Proxy(
        {
          id: "proxied-wrapper",
          definition: { id: "proxied-wrapper", steps: validSteps() },
        },
        handler,
      );

      assertThrows(
        () => workflowRegistry.register(proxiedDefinition as WorkflowDefinition),
        Error,
        "non-Proxy",
      );
      assertThrows(
        () => workflowRegistry.register(proxiedWrapper as unknown as WorkflowDefinition),
        Error,
        "non-Proxy",
      );
      assertEquals(trapCalls, 0);
      assertEquals(workflowRegistry.has("proxied-definition"), false);
      assertEquals(workflowRegistry.has("proxied-wrapper"), false);
    });

    it("rejects structural accessors without evaluating them", () => {
      let idReads = 0;
      const definition = Object.defineProperties({}, {
        id: {
          enumerable: true,
          get() {
            idReads++;
            return "accessor-definition";
          },
        },
        steps: { enumerable: true, value: validSteps() },
      });

      assertThrows(
        () => workflowRegistry.register(definition as WorkflowDefinition),
        Error,
        "own data property",
      );
      assertEquals(idReads, 0);
      assertEquals(workflowRegistry.has("accessor-definition"), false);
    });

    it("does not inspect accessor collaborator IDs or invoke rejected Proxy collaborators", () => {
      let accessorReads = 0;
      let proxyTrapCalls = 0;
      const accessorCollaborator = Object.defineProperty({}, "id", {
        get() {
          accessorReads++;
          return "private-accessor-id";
        },
      });
      const proxiedCollaborator = new Proxy({ id: "private-proxy-id" }, {
        get() {
          proxyTrapCalls++;
          throw new Error("collaborator get trap must not run");
        },
        getOwnPropertyDescriptor() {
          proxyTrapCalls++;
          throw new Error("collaborator descriptor trap must not run");
        },
      });

      workflowRegistry.register({
        id: "opaque-collaborators",
        steps: [{
          id: "opaque-agent-step",
          config: {
            type: "step",
            agent: accessorCollaborator,
          } as unknown as WorkflowNode["config"],
        }],
      });

      assertThrows(
        () =>
          workflowRegistry.register({
            id: "proxied-collaborator",
            steps: [{
              id: "opaque-tool-step",
              config: {
                type: "step",
                tool: proxiedCollaborator,
              } as unknown as WorkflowNode["config"],
            }],
          }),
        Error,
        "non-Proxy collaborator object",
      );

      assertEquals(workflowRegistry.get("opaque-collaborators")?.agentRefs, []);
      assertEquals(workflowRegistry.get("opaque-collaborators")?.toolRefs, []);
      assertEquals(workflowRegistry.has("proxied-collaborator"), false);
      assertEquals(accessorReads, 0);
      assertEquals(proxyTrapCalls, 0);
    });

    it("canonicalizes dynamic introspection output before traversing it", () => {
      let trapCalls = 0;
      const proxiedNodes = new Proxy(validSteps(), {
        get() {
          trapCalls++;
          throw new Error("dynamic result get trap must not run");
        },
        getOwnPropertyDescriptor() {
          trapCalls++;
          throw new Error("dynamic result descriptor trap must not run");
        },
        ownKeys() {
          trapCalls++;
          throw new Error("dynamic result ownKeys trap must not run");
        },
      });

      workflowRegistry.register({
        id: "proxied-dynamic-result",
        introspect: true,
        steps: () => proxiedNodes,
      });

      const metadata = workflowRegistry.get("proxied-dynamic-result");
      assertExists(metadata);
      assertEquals(metadata.dynamicSteps, true);
      assertEquals(metadata.nodeCount, 0);
      assertEquals(metadata.introspectionError?.includes("non-Proxy array"), true);
      assertEquals(trapCalls, 0);
    });

    it("stores bounded introspection diagnostics without invoking throwable hooks", () => {
      let messageReads = 0;
      let coercionCalls = 0;
      const hostileThrowable = Object.defineProperties({}, {
        message: {
          get() {
            messageReads++;
            throw new Error("message getter must not run");
          },
        },
        [Symbol.toPrimitive]: {
          value() {
            coercionCalls++;
            throw new Error("coercion hook must not run");
          },
        },
      });

      workflowRegistry.register({
        id: "hostile-introspection-error",
        introspect: true,
        steps: () => {
          throw hostileThrowable;
        },
      });
      workflowRegistry.register({
        id: "oversized-introspection-error",
        introspect: true,
        steps: () => {
          throw new Error("x".repeat(ERROR_DIAGNOSTIC_MAX_LENGTH_CHARS * 2));
        },
      });

      assertEquals(
        workflowRegistry.get("hostile-introspection-error")?.introspectionError,
        "Unknown error",
      );
      assertEquals(messageReads, 0);
      assertEquals(coercionCalls, 0);
      assertEquals(
        workflowRegistry.get("oversized-introspection-error")?.introspectionError?.length,
        ERROR_DIAGNOSTIC_MAX_LENGTH_CHARS,
      );
    });

    it("preserves empty declarations while rejecting duplicate and reserved node identities", () => {
      workflowRegistry.register({ id: "empty-definition", steps: [] });
      const emptyDefinition = workflowRegistry.getDefinition("empty-definition");
      const emptyMetadata = workflowRegistry.get("empty-definition");
      assertExists(emptyDefinition);
      assertExists(emptyMetadata);
      assertEquals(emptyDefinition.steps, []);
      assertEquals(Object.isFrozen(emptyDefinition.steps), true);
      assertEquals(emptyMetadata.nodeCount, 0);

      assertThrows(
        () =>
          workflowRegistry.register({
            id: "duplicate-nodes",
            steps: [node("duplicate", "step"), node("duplicate", "step")],
          }),
        Error,
        "duplicate node ID",
      );

      for (const reservedId of ["input", "env", "_tenant", "_loop", "task_loop_state"]) {
        assertThrows(
          () =>
            workflowRegistry.register({
              id: `reserved-${reservedId}`,
              steps: [node(reservedId, "step")],
            }),
          Error,
          "reserved workflow context namespace",
        );
      }
      assertEquals(workflowRegistry.has("empty-definition"), true);
      assertEquals(workflowRegistry.has("duplicate-nodes"), false);
    });

    it("rejects recursive and over-depth workflow graphs", () => {
      const recursiveChildren: WorkflowNode[] = [];
      const recursiveNode: WorkflowNode = {
        id: "recursive",
        config: { type: "parallel", nodes: recursiveChildren },
      };
      recursiveChildren.push(recursiveNode);

      assertThrows(
        () =>
          workflowRegistry.register({
            id: "recursive-definition",
            steps: [recursiveNode],
          }),
        Error,
        "recursive node reference",
      );

      let nested = node("depth-leaf", "step");
      for (let depth = 0; depth <= MAX_WORKFLOW_DEFINITION_DEPTH; depth++) {
        nested = {
          id: `depth-${depth}`,
          config: { type: "parallel", nodes: [nested] },
        };
      }
      assertThrows(
        () => workflowRegistry.register({ id: "over-depth", steps: [nested] }),
        Error,
        "maximum nesting depth",
      );
      assertEquals(workflowRegistry.has("recursive-definition"), false);
      assertEquals(workflowRegistry.has("over-depth"), false);
    });

    it("rejects workflow graphs over the canonical node budget", () => {
      const children = Array.from(
        { length: MAX_WORKFLOW_DEFINITION_NODES },
        (_, index) => node(`child-${index}`, "step"),
      );

      assertThrows(
        () =>
          workflowRegistry.register({
            id: "over-node-budget",
            steps: [{
              id: "root",
              config: { type: "parallel", nodes: children },
            }],
          }),
        Error,
        `more than ${MAX_WORKFLOW_DEFINITION_NODES} nodes`,
      );
      assertEquals(workflowRegistry.has("over-node-budget"), false);
    });
  });

  describe("get()", () => {
    it("should return metadata for registered workflow", () => {
      workflowRegistry.register({ id: "get-test", steps: validSteps() });

      const metadata = workflowRegistry.get("get-test");
      assertExists(metadata);
      assertEquals(metadata.id, "get-test");
    });

    it("should return undefined for non-existent workflow", () => {
      assertEquals(workflowRegistry.get("non-existent"), undefined);
    });
  });

  describe("getDefinition()", () => {
    it("should return definition for registered workflow", () => {
      const definition: WorkflowDefinition = {
        id: "def-test",
        description: "Definition test",
        steps: validSteps(),
      };

      workflowRegistry.register(definition);

      const stored = workflowRegistry.getDefinition("def-test");
      assertExists(stored);
      assertEquals(stored.id, "def-test");
      assertEquals(stored.description, "Definition test");
    });

    it("should return undefined for non-existent workflow", () => {
      assertEquals(workflowRegistry.getDefinition("non-existent"), undefined);
    });
  });

  describe("has()", () => {
    it("should return true for registered workflow", () => {
      workflowRegistry.register({ id: "has-test", steps: validSteps() });
      assertEquals(workflowRegistry.has("has-test"), true);
    });

    it("should return false for non-registered workflow", () => {
      assertEquals(workflowRegistry.has("not-registered"), false);
    });
  });

  describe("getAllIds()", () => {
    it("should return all registered workflow IDs", () => {
      workflowRegistry.register({ id: "wf-1", steps: validSteps() });
      workflowRegistry.register({ id: "wf-2", steps: validSteps() });
      workflowRegistry.register({ id: "wf-3", steps: validSteps() });

      const ids = workflowRegistry.getAllIds();
      assertEquals(ids.length, 3);
      assertEquals(ids.sort(), ["wf-1", "wf-2", "wf-3"]);
    });

    it("should return empty array when no workflows registered", () => {
      assertEquals(workflowRegistry.getAllIds(), []);
    });
  });

  describe("getAll()", () => {
    it("should return all workflow metadata as a Map", () => {
      workflowRegistry.register({ id: "map-1", steps: validSteps() });
      workflowRegistry.register({ id: "map-2", steps: validSteps() });

      const all = workflowRegistry.getAll();
      assertEquals(all.size, 2);
      assertExists(all.get("map-1"));
      assertExists(all.get("map-2"));
    });
  });

  describe("getAllAsArray()", () => {
    it("should return all workflow metadata as an array", () => {
      workflowRegistry.register({ id: "arr-1", steps: validSteps() });
      workflowRegistry.register({ id: "arr-2", steps: validSteps() });

      const all = workflowRegistry.getAllAsArray();
      assertEquals(all.length, 2);
      assertEquals(all.map((m) => m.id).sort(), ["arr-1", "arr-2"]);
    });
  });

  describe("getStats()", () => {
    it("should return correct statistics", () => {
      workflowRegistry.register({
        id: "stats-1",
        steps: [node("s1", "step"), node("s2", "step")],
      });
      workflowRegistry.register({
        id: "stats-2",
        steps: [parallel("p1", [node("parallel-child", "step")])],
      });

      const stats = workflowRegistry.getStats();
      assertEquals(stats.total, 2);
      assertEquals(stats.byNodeType["step"], 2);
      assertEquals(stats.byNodeType["parallel"], 1);
    });

    it("should count schemas", () => {
      const getSchema = defineSchema((v) => v.object({}).passthrough());
      workflowRegistry.register({
        id: "schema-test",
        inputSchema: getSchema(),
        outputSchema: getSchema(),
        steps: validSteps(),
      });

      const stats = workflowRegistry.getStats();
      assertEquals(stats.withInputSchema, 1);
      assertEquals(stats.withOutputSchema, 1);
    });
  });

  describe("unregister()", () => {
    it("should remove a workflow", () => {
      workflowRegistry.register({ id: "to-remove", steps: validSteps() });
      assertEquals(workflowRegistry.has("to-remove"), true);

      const result = workflowRegistry.unregister("to-remove");
      assertEquals(result, true);
      assertEquals(workflowRegistry.has("to-remove"), false);
    });

    it("should return false for non-existent workflow", () => {
      assertEquals(workflowRegistry.unregister("not-there"), false);
    });
  });

  describe("clear()", () => {
    it("should remove all workflows", () => {
      workflowRegistry.register({ id: "clear-1", steps: validSteps() });
      workflowRegistry.register({ id: "clear-2", steps: validSteps() });

      workflowRegistry.clear();

      assertEquals(workflowRegistry.getAllIds(), []);
    });
  });
});

describe("Exported helper functions", () => {
  beforeEach(() => workflowRegistry.clear());
  afterEach(() => workflowRegistry.clear());

  describe("registerWorkflow()", () => {
    it("should register via helper function", () => {
      registerWorkflow({ id: "helper-test", steps: validSteps() });
      assertEquals(workflowRegistry.has("helper-test"), true);
    });
  });

  describe("getWorkflow()", () => {
    it("should get workflow via helper function", () => {
      workflowRegistry.register({ id: "get-helper", steps: validSteps() });

      const metadata = getWorkflow("get-helper");
      assertExists(metadata);
      assertEquals(metadata.id, "get-helper");
    });
  });

  describe("getAllWorkflowIds()", () => {
    it("should get all IDs via helper function", () => {
      workflowRegistry.register({ id: "ids-1", steps: validSteps() });
      workflowRegistry.register({ id: "ids-2", steps: validSteps() });

      const ids = getAllWorkflowIds();
      assertEquals(ids.sort(), ["ids-1", "ids-2"]);
    });
  });
});

describe("Auto-registration with workflow() DSL", () => {
  beforeEach(() => workflowRegistry.clear());
  afterEach(() => workflowRegistry.clear());

  it("should auto-register when creating workflow via DSL", () => {
    const wf = workflow({
      id: "auto-registered",
      description: "Auto-registered workflow",
      steps: [step("step1", { agent: "test-agent" })],
    });

    assertEquals(wf.id, "auto-registered");
    assertEquals(workflowRegistry.has("auto-registered"), true);

    const metadata = workflowRegistry.get("auto-registered");
    assertExists(metadata);
    assertEquals(metadata.description, "Auto-registered workflow");
    assertEquals(metadata.nodeCount, 1);
  });

  it("should extract node types from parallel nodes", () => {
    workflow({
      id: "parallel-test",
      steps: [
        parallel("p1", [
          step("s1", { agent: "a1" }),
          step("s2", { agent: "a2" }),
        ]),
      ],
    });

    const metadata = workflowRegistry.get("parallel-test");
    assertExists(metadata);
    assertEquals(metadata.nodeTypes.includes("parallel"), true);
  });

  it("should extract node types from branch nodes", () => {
    workflow({
      id: "branch-test",
      steps: [
        branch("b1", {
          condition: () => true,
          then: [step("then-step", { agent: "a1" })],
          else: [step("else-step", { agent: "a2" })],
        }),
      ],
    });

    const metadata = workflowRegistry.get("branch-test");
    assertExists(metadata);
    assertEquals(metadata.nodeTypes.includes("branch"), true);
  });
});

describe("workflow graph metadata as a public surface", () => {
  beforeEach(() => workflowRegistry.clear());
  afterEach(() => workflowRegistry.clear());

  it("is reachable from the package entry point", () => {
    registerWorkflow(
      workflow({ id: "public-surface", steps: [step("only", { tool: "t" })] }),
    );

    const metadata: WorkflowMetadata | undefined = publicWorkflowRegistry.get("public-surface");
    assertExists(metadata);
    const nodes: readonly NodeInfo[] = metadata.nodes;
    assertEquals(nodes.map((n) => n.id), ["only"]);
  });

  it("reports composite child ids exactly as the executor keys them", () => {
    registerWorkflow(
      workflow({
        id: "id-scheme",
        steps: [
          step("first", { tool: "t" }),
          parallel("group", [step("p1", { tool: "t" })]),
          branch("gate", {
            condition: () => true,
            then: [waitForApproval("inner-wait", { message: "m" })],
            else: [step("otherwise", { tool: "t" })],
          }),
        ],
      }),
    );

    const metadata = publicWorkflowRegistry.get("id-scheme");
    assertExists(metadata);
    // These are the same strings the executor writes into run.nodeStates, so a
    // consumer can join metadata to run state without guessing the scheme.
    assertEquals(metadata.nodes.map((n) => n.id), [
      "first",
      "group/p1",
      "group",
      "gate/then/inner-wait",
      "gate/else/otherwise",
      "gate",
    ]);
  });

  it("carries an optional per-node description through to the metadata", () => {
    registerWorkflow(
      workflow({
        id: "described",
        steps: [
          step("verify", { tool: "t", description: "Check the claim against the record" }),
          parallel("fan-out", [step("child", { tool: "t" })], {
            description: "Run the independent checks together",
          }),
        ],
      }),
    );

    const metadata = publicWorkflowRegistry.get("described");
    assertExists(metadata);
    const byId = new Map(metadata.nodes.map((n) => [n.id, n]));
    assertEquals(byId.get("verify")!.description, "Check the claim against the record");
    assertEquals(byId.get("fan-out")!.description, "Run the independent checks together");
    assertEquals(byId.get("fan-out/child")!.description, undefined);
  });
});
