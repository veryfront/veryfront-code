import { assertEquals } from "@std/assert";
import {
  containsExactArtifactPathValue,
  evaluateSlashCommandArtifactPolicy,
} from "./slash-command-artifact-policy.ts";

const EXACT_PLAN_COMMAND =
  '<span data-command="plan">/plan</span> Create or update exactly /plans/budget-planning.md in this run.';
const FORM_INPUT_PLAN_COMMAND =
  '<span data-command="plan">/plan</span> Create a concrete implementation plan for this idea. Ask clarifying questions first, then produce markdown that matches the existing /plans conventions in this repository.';
const FORM_INPUT_IDEA =
  "Write a consolidated budget-planning plan to /plans/budget-planning.md that supersedes the existing plan.";
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

function toolRoleJsonStringMessage(toolCallId: string, content: string) {
  return { role: "tool", toolCallId, content };
}

function loadSkillCall(toolCallId = "tool-call-1") {
  return toolCall(toolCallId, "load_skill", { skillId: "plan" });
}

function formInputCall(toolCallId = "tool-call-2") {
  return toolCall(toolCallId, "form_input", { title: "What should the plan cover?" });
}

function invokeAgentCall(toolCallId = "tool-call-2") {
  return toolCall(toolCallId, "invoke_agent", { task: "Write the plan" });
}

function toolCall(toolCallId: string, toolName: string, input: Record<string, unknown>) {
  return {
    type: "tool-call",
    toolCallId,
    toolName,
    input,
  };
}

function loadSkillResult(toolCallId = "tool-call-1") {
  return toolResult(toolCallId, "load_skill", PLAN_SKILL_RESULT);
}

function formInputResult(toolCallId = "tool-call-2") {
  return toolResult(toolCallId, "form_input", formInputSubmission());
}

function formInputResultWithoutToolName(toolCallId = "tool-call-2") {
  return {
    type: "tool-result",
    toolCallId,
    output: formInputSubmission(),
  };
}

function toolResult(toolCallId: string, toolName: string, output: unknown) {
  return {
    type: "tool-result",
    toolCallId,
    toolName,
    output,
  };
}

function formInputSubmission() {
  return {
    submitted: true,
    values: {
      idea: FORM_INPUT_IDEA,
    },
  };
}

Deno.test("slash-command artifact policy detects exact artifact paths inside submitted values", () => {
  assertEquals(
    containsExactArtifactPathValue({
      submitted: true,
      values: { idea: FORM_INPUT_IDEA },
    }),
    true,
  );
});

Deno.test("slash-command artifact policy keeps the artifact reminder after load_skill", () => {
  assertEquals(
    evaluateSlashCommandArtifactPolicy({
      messages: [
        userMessage(EXACT_PLAN_COMMAND),
        assistantMessage([loadSkillCall()]),
        toolMessage([loadSkillResult()]),
      ],
    }),
    {
      hasSlashCommand: true,
      hasExactArtifactPath: true,
      hasLoadSkill: true,
      hasInvokeAgent: false,
      shouldKeepReminder: true,
    },
  );
});

Deno.test("slash-command artifact policy keeps the artifact reminder for form_input results", () => {
  assertEquals(
    evaluateSlashCommandArtifactPolicy({
      messages: [
        userMessage(FORM_INPUT_PLAN_COMMAND),
        assistantMessage([loadSkillCall(), formInputCall()]),
        toolMessage([loadSkillResult(), formInputResult()]),
      ],
    }),
    {
      hasSlashCommand: true,
      hasExactArtifactPath: true,
      hasLoadSkill: true,
      hasInvokeAgent: false,
      shouldKeepReminder: true,
    },
  );
});

Deno.test("slash-command artifact policy resolves resumed form_input results without toolName", () => {
  assertEquals(
    evaluateSlashCommandArtifactPolicy({
      messages: [
        userMessage(FORM_INPUT_PLAN_COMMAND),
        assistantMessage([loadSkillCall(), formInputCall()]),
        assistantMessage([formInputResultWithoutToolName()]),
      ],
    }),
    {
      hasSlashCommand: true,
      hasExactArtifactPath: true,
      hasLoadSkill: true,
      hasInvokeAgent: false,
      shouldKeepReminder: true,
    },
  );
});

Deno.test("slash-command artifact policy resolves resumed form_input tool-role JSON strings", () => {
  assertEquals(
    evaluateSlashCommandArtifactPolicy({
      messages: [
        userMessage(FORM_INPUT_PLAN_COMMAND),
        assistantMessage([loadSkillCall(), formInputCall()]),
        toolRoleJsonStringMessage("tool-call-2", JSON.stringify(formInputSubmission())),
      ],
    }),
    {
      hasSlashCommand: true,
      hasExactArtifactPath: true,
      hasLoadSkill: true,
      hasInvokeAgent: false,
      shouldKeepReminder: true,
    },
  );
});

Deno.test("slash-command artifact policy drops the reminder after invoke_agent starts", () => {
  assertEquals(
    evaluateSlashCommandArtifactPolicy({
      messages: [
        userMessage(EXACT_PLAN_COMMAND),
        assistantMessage([loadSkillCall(), invokeAgentCall()]),
        toolMessage([loadSkillResult()]),
      ],
    }),
    {
      hasSlashCommand: true,
      hasExactArtifactPath: true,
      hasLoadSkill: true,
      hasInvokeAgent: true,
      shouldKeepReminder: false,
    },
  );
});

Deno.test("slash-command artifact policy preserves persisted exact-path state before invoke_agent", () => {
  assertEquals(
    evaluateSlashCommandArtifactPolicy({
      messages: [userMessage(FORM_INPUT_PLAN_COMMAND), assistantMessage([loadSkillCall()])],
      slashCommandArtifactPathSeen: true,
    }),
    {
      hasSlashCommand: true,
      hasExactArtifactPath: true,
      hasLoadSkill: true,
      hasInvokeAgent: false,
      shouldKeepReminder: true,
    },
  );
});

Deno.test("slash-command artifact policy drops persisted exact-path state after invoke_agent starts", () => {
  assertEquals(
    evaluateSlashCommandArtifactPolicy({
      messages: [
        userMessage(EXACT_PLAN_COMMAND),
        assistantMessage([loadSkillCall(), invokeAgentCall()]),
      ],
      slashCommandArtifactPathSeen: true,
    }),
    {
      hasSlashCommand: true,
      hasExactArtifactPath: true,
      hasLoadSkill: true,
      hasInvokeAgent: true,
      shouldKeepReminder: false,
    },
  );
});
