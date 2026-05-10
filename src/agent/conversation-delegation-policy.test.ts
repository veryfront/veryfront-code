import { assert, assertEquals, assertStringIncludes } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  addFirstTurnStarterIntentRootOwnershipReminder,
  addLoadSkillContinuationReminder,
  addSlashCommandArtifactReminder,
  buildInvokeAgentFollowupInstruction,
  buildRootOwnedChildResultHint,
  buildRootOwnedDelegatedFindingsInstruction,
  buildStarterIntentRootOwnershipBlockMessage,
  buildStarterIntentRootOwnershipReminder,
  DELEGATE_ONLY_WHEN_MATERIALLY_HELPFUL,
  evaluateStarterIntentTurnPolicy,
  extractStarterIntentId,
  FIRST_TURN_STARTER_INTENT_ROOT_OWNERSHIP_REMINDER,
  KEEP_ROOT_ASSISTANT_VISIBLE_OWNER,
  LOAD_SKILL_CONTINUATION_REMINDER,
  NO_DELEGATION_NARRATION_UNLESS_ASKED,
  ROOT_OWNED_CHILD_RESULT_INSTRUCTION,
  shouldReinforceLoadSkillContinuation,
  SLASH_COMMAND_ARTIFACT_REMINDER,
  SYNTHESIZE_DELEGATED_FINDINGS_IN_ROOT_VOICE,
  withRootOwnedChildResultHint,
} from "./conversation-delegation-policy.ts";

const RESEARCH_REQUEST = "make a deep research on a2a protocol";
const PLAN_SKILL_RESULT = { skillId: "plan", instructions: "Plan instructions" };

function userMessage(content: string) {
  return { role: "user", content };
}

function assistantMessage(content: unknown[]) {
  return { role: "assistant", content };
}

function toolMessage(content: unknown[]) {
  return { role: "tool", content };
}

function textPart(text: string) {
  return { type: "text", text };
}

function toolCall(toolCallId: string, toolName: string, input: Record<string, unknown>) {
  return {
    type: "tool-call",
    toolCallId,
    toolName,
    input,
  };
}

function loadSkillCall(toolCallId = "tool-call-1") {
  return toolCall(toolCallId, "load_skill", { skillId: "plan" });
}

function toolResult(toolCallId: string, toolName: string, output: unknown) {
  return {
    type: "tool-result",
    toolCallId,
    toolName,
    output,
  };
}

function loadSkillResult(toolCallId = "tool-call-1") {
  return toolResult(toolCallId, "load_skill", PLAN_SKILL_RESULT);
}

describe("conversation delegation policy", () => {
  it("keeps canonical root-ownership and delegation threshold wording stable", () => {
    assertEquals(
      KEEP_ROOT_ASSISTANT_VISIBLE_OWNER,
      "Keep the root assistant visibly owning the work.",
    );
    assertStringIncludes(
      DELEGATE_ONLY_WHEN_MATERIALLY_HELPFUL,
      "different tool/model budget materially helps",
    );
  });

  it("builds delegated-findings instructions in the root voice", () => {
    assertEquals(
      buildRootOwnedDelegatedFindingsInstruction(),
      `Use these delegated findings directly in your next assistant response. ${KEEP_ROOT_ASSISTANT_VISIBLE_OWNER} ${NO_DELEGATION_NARRATION_UNLESS_ASKED}`,
    );
  });

  it("builds root-owned child result hints with cleaned delegated text", () => {
    assertEquals(
      buildRootOwnedChildResultHint("I'll investigate this.\n\nFinal report delivered."),
      {
        instruction: ROOT_OWNED_CHILD_RESULT_INSTRUCTION,
        suggestedText: "Final report delivered.",
      },
    );
  });

  it("adds root-owned hints to successful local child results", () => {
    assertEquals(
      withRootOwnedChildResultHint({
        success: true,
        summary: { text: "child result" },
      }),
      {
        success: true,
        summary: { text: "child result" },
        rootResponseHint: {
          instruction: ROOT_OWNED_CHILD_RESULT_INSTRUCTION,
          suggestedText: "child result",
        },
      },
    );
  });

  it("adds root-owned hints to completed durable child results", () => {
    assertEquals(
      withRootOwnedChildResultHint({
        ok: true,
        status: "completed",
        text: "durable child result",
      }),
      {
        ok: true,
        status: "completed",
        text: "durable child result",
        rootResponseHint: {
          instruction: ROOT_OWNED_CHILD_RESULT_INSTRUCTION,
          suggestedText: "durable child result",
        },
      },
    );
  });

  it("leaves failed child results unchanged", () => {
    const failedResult = {
      success: false,
      error: "failed",
    };

    assertEquals(withRootOwnedChildResultHint(failedResult), failedResult);
  });

  it("builds invoke_agent follow-up guidance from the shared narration guard", () => {
    assertEquals(
      buildInvokeAgentFollowupInstruction(),
      `${SYNTHESIZE_DELEGATED_FINDINGS_IN_ROOT_VOICE} ${NO_DELEGATION_NARRATION_UNLESS_ASKED}`,
    );
  });

  it("builds starter-intent reminder and block text from shared policy wording", () => {
    const reminder = buildStarterIntentRootOwnershipReminder();
    assertStringIncludes(reminder, "first-turn /plan and /research starter requests");
    assertStringIncludes(reminder, "keep the root assistant visibly owning the work");
    assertStringIncludes(reminder, "continue in the same turn after load_skill");
    assertStringIncludes(reminder, "different tool/model budget materially helps");

    const blockMessage = buildStarterIntentRootOwnershipBlockMessage();
    assertStringIncludes(blockMessage, "Keep the first /plan or /research turn root-owned");
    assertStringIncludes(blockMessage, "explain the approach first");
    assertStringIncludes(blockMessage, "different tool/model budget materially helps");
  });
});

describe("load_skill continuation policy", () => {
  it("reinforces continuation after a trailing load_skill tool result", () => {
    assertEquals(
      shouldReinforceLoadSkillContinuation([
        userMessage(RESEARCH_REQUEST),
        assistantMessage([loadSkillCall()]),
        toolMessage([loadSkillResult()]),
      ]),
      true,
    );
  });

  it("does not reinforce when the assistant already produced user-visible text", () => {
    assertEquals(
      shouldReinforceLoadSkillContinuation([
        userMessage(RESEARCH_REQUEST),
        assistantMessage([textPart("I will research that."), loadSkillCall()]),
        toolMessage([loadSkillResult()]),
      ]),
      false,
    );
  });

  it("appends load_skill and slash-command reminders once for system-message arrays", () => {
    const withLoadSkillReminder = addLoadSkillContinuationReminder([{
      role: "system",
      content: "Base instructions",
    }]);

    assertEquals(withLoadSkillReminder, [
      { role: "system", content: "Base instructions" },
      { role: "system", content: LOAD_SKILL_CONTINUATION_REMINDER },
    ]);
    assertEquals(addLoadSkillContinuationReminder(withLoadSkillReminder), withLoadSkillReminder);

    const withSlashCommandReminder = addSlashCommandArtifactReminder([
      { role: "system", content: "Base instructions" },
    ]);

    assertEquals(withSlashCommandReminder, [
      { role: "system", content: "Base instructions" },
      { role: "system", content: SLASH_COMMAND_ARTIFACT_REMINDER },
    ]);
    assertEquals(
      addSlashCommandArtifactReminder(withSlashCommandReminder),
      withSlashCommandReminder,
    );
    assert(!SLASH_COMMAND_ARTIFACT_REMINDER.includes("call invoke_agent now"));
    assert(
      !SLASH_COMMAND_ARTIFACT_REMINDER.includes(
        "Do not continue repo reads or writes in the root thread",
      ),
    );
  });
});

describe("starter intent policy", () => {
  it("extracts starter intent ids from slash-command text and rich-text command spans", () => {
    assertEquals(
      extractStarterIntentId([{ role: "user", content: "/plan Create a spec." }]),
      "plan",
    );
    assertEquals(
      extractStarterIntentId([
        {
          role: "user",
          content: '<span data-command="research">/research</span> Research runtime ownership.',
        },
      ]),
      "research",
    );
  });

  it("keeps /plan and /research starter intents conversation-first on the first step", () => {
    assertEquals(
      evaluateStarterIntentTurnPolicy({
        step: 1,
        messages: [{
          role: "user",
          content: "/plan Create or update exactly /plans/runtime.md in this run.",
        }],
      }),
      {
        starterIntentId: "plan",
        keepConversationFirst: true,
        shouldAddRootOwnershipReminder: true,
        shouldBlockImmediateDelegation: true,
      },
    );

    assertEquals(
      evaluateStarterIntentTurnPolicy({
        step: 1,
        messages: [{
          role: "user",
          content: "/research Write exactly /plans/research.md in this run.",
        }],
      }),
      {
        starterIntentId: "research",
        keepConversationFirst: true,
        shouldAddRootOwnershipReminder: true,
        shouldBlockImmediateDelegation: true,
      },
    );
  });

  it("does not keep other starter intents or later plan turns conversation-first", () => {
    assertEquals(
      evaluateStarterIntentTurnPolicy({
        step: 1,
        messages: [{ role: "user", content: "/knowledge Build the knowledge base." }],
      }),
      {
        starterIntentId: "knowledge",
        keepConversationFirst: false,
        shouldAddRootOwnershipReminder: false,
        shouldBlockImmediateDelegation: false,
      },
    );

    assertEquals(
      evaluateStarterIntentTurnPolicy({
        step: 2,
        messages: [{
          role: "user",
          content: "/plan Create or update exactly /plans/runtime.md in this run.",
        }],
      }),
      {
        starterIntentId: "plan",
        keepConversationFirst: false,
        shouldAddRootOwnershipReminder: false,
        shouldBlockImmediateDelegation: false,
      },
    );
  });

  it("blocks immediate delegation but skips duplicate reminders after invoke_agent starts", () => {
    assertEquals(
      evaluateStarterIntentTurnPolicy({
        step: 1,
        messages: [
          { role: "user", content: "/research Gather findings and write a short memo." },
          assistantMessage([
            toolCall("tool-call-1", "invoke_agent", { description: "Find sources" }),
          ]),
        ],
      }),
      {
        starterIntentId: "research",
        keepConversationFirst: true,
        shouldAddRootOwnershipReminder: false,
        shouldBlockImmediateDelegation: true,
      },
    );
  });

  it("appends the first-turn root-ownership reminder only once", () => {
    const system = addFirstTurnStarterIntentRootOwnershipReminder("Base instructions");

    assertStringIncludes(system, FIRST_TURN_STARTER_INTENT_ROOT_OWNERSHIP_REMINDER);
    assertEquals(addFirstTurnStarterIntentRootOwnershipReminder(system), system);
  });
});
