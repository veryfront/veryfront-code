import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { createHostedRuntimeStateResolver } from "./runtime-state-resolver.ts";
import {
  FIRST_TURN_STARTER_INTENT_ROOT_OWNERSHIP_CONTEXT_KEY,
  SLASH_COMMAND_ARTIFACT_REMINDER,
} from "../conversation/delegation-policy.ts";

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
  it("refreshes system instructions when the steering context changes", async () => {
    const taskContext = {
      projectId: "project-1",
      branchId: null,
      steeringRevision: 0,
    };
    let refreshCount = 0;
    const resolver = createHostedRuntimeStateResolver({
      taskContext,
      refreshSystem: () => {
        refreshCount += 1;
        return `refreshed-${refreshCount}`;
      },
    });

    assertEquals(await resolver({ system: "initial", messages: [], step: 0 }), {
      system: "initial",
      context: {},
    });

    taskContext.steeringRevision = 1;

    assertEquals(await resolver({ system: "initial", messages: [], step: 1 }), {
      system: "refreshed-1",
      context: {},
    });
    assertEquals(refreshCount, 1);
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
      context: {},
    });
  });

  it("returns structured system instructions separately from hook-compatible text", async () => {
    const structuredSystem = [{
      role: "system" as const,
      content: "structured",
      providerOptions: { cacheControl: { type: "ephemeral" } },
    }];
    const resolver = createHostedRuntimeStateResolver({
      taskContext: {
        projectId: "project-1",
        branchId: null,
      },
    });

    assertEquals(
      await resolver({
        system: "flattened",
        structuredSystem,
        messages: [],
        step: 1,
      }),
      {
        structuredSystem,
        context: {},
      },
    );
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

    assertEquals(result.context, { hasSubmittedFormInputResult: true });
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
    if (first.system === undefined) {
      throw new Error("Expected text system instructions");
    }

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

    assertEquals(typeof result.system, "string");
    if (typeof result.system !== "string") {
      throw new Error("Expected string system instructions");
    }
    assertEquals(
      result.system.includes(SLASH_COMMAND_ARTIFACT_REMINDER),
      true,
      "reminder must be kept while the artifact path is unseen",
    );

    const messagesWithoutExactPath = [
      createUserMessage("/plan build a dashboard"),
      createAssistantToolCall("load_skill"),
    ];
    const unseen = await resolver({
      system: "system",
      messages: messagesWithoutExactPath,
      step: 1,
    });
    assertEquals(typeof unseen.system, "string");
    if (typeof unseen.system !== "string") {
      throw new Error("Expected string system instructions");
    }
    assertEquals(
      unseen.system.includes(SLASH_COMMAND_ARTIFACT_REMINDER),
      false,
      "reminder must not be injected without an exact path when the host has not recorded one",
    );

    taskContext.slashCommandArtifactPathSeen = true;
    const seen = await resolver({
      system: "system",
      messages: messagesWithoutExactPath,
      step: 1,
    });
    assertEquals(typeof seen.system, "string");
    if (typeof seen.system !== "string") {
      throw new Error("Expected string system instructions");
    }
    assertEquals(
      seen.system.includes(SLASH_COMMAND_ARTIFACT_REMINDER),
      true,
      "reminder must be kept once the host records the artifact path",
    );
  });
});
