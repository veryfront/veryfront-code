import type { Tool } from "#veryfront/tool";

const AGENT_RUNTIME_LOCAL_TOOL = Symbol("veryfront.agent.runtimeLocalTool");
const SKILL_DELEGATION_OVERRIDES_UNSUPPORTED = Symbol(
  "veryfront.agent.skillDelegationOverridesUnsupported",
);

type RuntimeLocalTool = Tool & {
  [AGENT_RUNTIME_LOCAL_TOOL]?: true;
  [SKILL_DELEGATION_OVERRIDES_UNSUPPORTED]?: true;
};

/** Mark a framework-created tool as local to one agent runtime. */
export function markRuntimeLocalTool(tool: Tool): Tool {
  Object.defineProperty(tool, AGENT_RUNTIME_LOCAL_TOOL, {
    value: true,
    enumerable: false,
  });
  return tool;
}

/** Check whether a tool must stay out of the project-wide tool registry. */
export function isRuntimeLocalTool(value: unknown): boolean {
  return Boolean(
    value &&
      typeof value === "object" &&
      (value as RuntimeLocalTool)[AGENT_RUNTIME_LOCAL_TOOL] === true,
  );
}

/** Mark a tool whose execution contract cannot consume hosted child-run overrides. */
export function markSkillDelegationOverridesUnsupported(tool: Tool): Tool {
  Object.defineProperty(tool, SKILL_DELEGATION_OVERRIDES_UNSUPPORTED, {
    value: true,
    enumerable: false,
  });
  return tool;
}

/** Whether a tool can consume loaded-skill child-run overrides. */
export function supportsSkillDelegationOverrides(value: unknown): boolean {
  return !(
    value &&
    typeof value === "object" &&
    (value as RuntimeLocalTool)[SKILL_DELEGATION_OVERRIDES_UNSUPPORTED] === true
  );
}
