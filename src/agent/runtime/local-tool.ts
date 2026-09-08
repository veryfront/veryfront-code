import type { Tool } from "#veryfront/tool";

const objectDefineProperty = Object.defineProperty;
const objectGetOwnPropertyDescriptor = Object.getOwnPropertyDescriptor;
const AGENT_RUNTIME_LOCAL_TOOL = Symbol("veryfront.agent.runtimeLocalTool");
const SKILL_DELEGATION_OVERRIDES_UNSUPPORTED = Symbol(
  "veryfront.agent.skillDelegationOverridesUnsupported",
);

/** Mark a framework-created tool as local to one agent runtime. */
export function markRuntimeLocalTool(tool: Tool): Tool {
  objectDefineProperty(tool, AGENT_RUNTIME_LOCAL_TOOL, {
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
      objectGetOwnPropertyDescriptor(value, AGENT_RUNTIME_LOCAL_TOOL)?.value === true,
  );
}

/** Mark a tool whose execution contract cannot consume hosted child-run overrides. */
export function markSkillDelegationOverridesUnsupported(tool: Tool): Tool {
  objectDefineProperty(tool, SKILL_DELEGATION_OVERRIDES_UNSUPPORTED, {
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
    objectGetOwnPropertyDescriptor(value, SKILL_DELEGATION_OVERRIDES_UNSUPPORTED)?.value === true
  );
}
