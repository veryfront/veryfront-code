import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  createHostedRuntimeStateResolver,
  type HostedRuntimeStateResolverContext,
  resolveHostedToolExecutionContext,
} from "./runtime-state-resolver.ts";
import { FIRST_TURN_STARTER_INTENT_ROOT_OWNERSHIP_CONTEXT_KEY } from "../conversation/delegation-policy.ts";

function createUserMessage(text: string) {
  return {
    role: "user",
    content: text,
  };
}

function createAssistantToolCall(toolName: string) {
  return {
    role: "assistant",
    content: [{ type: "tool-call", toolCallId: `tool-${toolName}`, toolName }],
  };
}

describe("agent/hosted-runtime-state-resolver", () => {
  it("treats hosted credential identity as an atomic owned bundle", () => {
    assertEquals(
      resolveHostedToolExecutionContext(
        { projectId: "unowned-project", projectSlug: "unowned-project" },
        {
          authToken: "stale-token",
          projectId: "stale-project",
          projectSlug: "stale-project",
          runId: "run-one",
        },
      ),
      { authToken: undefined, runId: "run-one" },
    );

    const explicitlyInvalid = resolveHostedToolExecutionContext(
      {
        authToken: undefined,
        projectId: "owned-project",
        projectSlug: " owned-project ",
      },
      { runId: "run-two" },
    );
    assertEquals(Object.hasOwn(explicitlyInvalid, "authToken"), true);
    assertEquals(explicitlyInvalid, {
      authToken: undefined,
      projectId: "owned-project",
      projectSlug: "owned-project",
      runId: "run-two",
    });

    const mutableTaskContext: HostedRuntimeStateResolverContext = {
      authToken: "live-token",
      projectId: "live-project",
      projectSlug: "live-project",
    };
    const authenticated = resolveHostedToolExecutionContext(
      mutableTaskContext,
      { runId: "run-three" },
    );
    delete mutableTaskContext.authToken;

    assertEquals(
      resolveHostedToolExecutionContext(mutableTaskContext, authenticated),
      { authToken: undefined, runId: "run-three" },
    );
  });

  it("refreshes system instructions when the steering context changes", async () => {
    const taskContext = {
      projectId: "project-1",
      branchId: null,
      steeringRevision: 0,
    };
    let refreshCount = 0;
    let refreshAbortSignal: AbortSignal | undefined;
    const resolver = createHostedRuntimeStateResolver({
      taskContext,
      refreshSystem: ({ abortSignal }) => {
        refreshCount += 1;
        refreshAbortSignal = abortSignal;
        return `refreshed-${refreshCount}`;
      },
    });

    assertEquals(await resolver({ system: "initial", messages: [], step: 0 }), {
      system: "initial",
      context: { authToken: undefined },
    });

    taskContext.steeringRevision = 1;
    const abortController = new AbortController();

    assertEquals(
      await resolver({
        system: "initial",
        messages: [],
        step: 1,
        abortSignal: abortController.signal,
      }),
      {
        system: "refreshed-1",
        context: { authToken: undefined },
      },
    );
    assertEquals(refreshCount, 1);
    assertEquals(refreshAbortSignal, abortController.signal);
  });

  it("does not expose the authenticated user as legacy endUserId in runtime tool context", async () => {
    const resolver = createHostedRuntimeStateResolver({
      taskContext: {
        projectId: "project-1",
        branchId: null,
        userId: "user-123",
      },
    });

    assertEquals(await resolver({ system: "system", messages: [], step: 1 }), {
      system: "system",
      context: { authToken: undefined },
    });
  });

  it("re-stamps the live credential identity after a project switch", async () => {
    const taskContext = {
      authToken: "request-token",
      projectId: "project-1",
      projectSlug: "project-one",
      branchId: null,
      steeringRevision: 0,
    };
    const resolver = createHostedRuntimeStateResolver({ taskContext });

    const first = await resolver({
      system: "system",
      messages: [],
      step: 0,
    });
    assertEquals(first.context, {
      authToken: "request-token",
      projectId: "project-1",
      projectSlug: "project-one",
    });

    taskContext.projectId = "project-2";
    taskContext.projectSlug = "";
    taskContext.steeringRevision = 1;

    const second = await resolver({
      context: first.context,
      system: first.system,
      messages: [],
      step: 1,
    });
    assertEquals(second.context, {
      authToken: "request-token",
      projectId: "project-2",
    });

    taskContext.projectSlug = "project-two";
    const third = await resolver({
      context: second.context,
      system: second.system,
      messages: [],
      step: 2,
    });
    assertEquals(third.context, {
      authToken: "request-token",
      projectId: "project-2",
      projectSlug: "project-two",
    });
  });

  it("records submitted form input state in runtime context without changing the system prompt", async () => {
    const resolver = createHostedRuntimeStateResolver({
      taskContext: {
        projectId: "project-1",
        branchId: null,
        submittedFormInputResult: {
          values: { brief: "make me an outlook agent" },
          inputRequestId: "input-1",
        },
      },
    });

    const result = await resolver({ system: "system", messages: [], step: 2 });

    assertEquals(result.context, {
      authToken: undefined,
      hasSubmittedFormInputResult: true,
    });
    assertEquals(result.system, "system");
  });

  it("applies starter-intent blocking context only while required", async () => {
    const taskContext = {
      projectId: null,
      branchId: null,
    };
    const resolver = createHostedRuntimeStateResolver({ taskContext });

    const first = await resolver({
      system: "system",
      messages: [createUserMessage("/plan create an app")],
      step: 1,
    });

    assertEquals(first.context[FIRST_TURN_STARTER_INTENT_ROOT_OWNERSHIP_CONTEXT_KEY], true);

    const second = await resolver({
      context: first.context,
      system: first.system,
      messages: [createUserMessage("/plan create an app")],
      step: 2,
    });

    assertEquals(
      FIRST_TURN_STARTER_INTENT_ROOT_OWNERSHIP_CONTEXT_KEY in second.context,
      false,
    );
  });

  it("keeps slash-command artifact reminders until the host records the artifact path", async () => {
    const taskContext = {
      projectId: null,
      branchId: null,
      slashCommandArtifactPathSeen: false,
    };
    const resolver = createHostedRuntimeStateResolver({ taskContext });
    const result = await resolver({
      system: "system",
      messages: [
        createUserMessage("/plan build a dashboard in /plans/dashboard.md"),
        createAssistantToolCall("load_skill"),
      ],
      step: 1,
    });

    assertEquals(result.system.includes("artifact"), true);
  });
});
