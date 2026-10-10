import type { Tool } from "#veryfront/tool";

const objectDefineProperty = Object.defineProperty;
const objectGetOwnPropertyDescriptor = Object.getOwnPropertyDescriptor;
const AGENT_RUNTIME_LOCAL_TOOL = Symbol("veryfront.agent.runtimeLocalTool");
const AGENT_RUNTIME_PROVIDER_SCHEMA_HIDDEN = Symbol(
  "veryfront.agent.runtimeProviderSchemaHidden",
);
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
  return value !== null && typeof value === "object" &&
    objectGetOwnPropertyDescriptor(value, AGENT_RUNTIME_LOCAL_TOOL)?.value === true;
}

/** Hide a runtime-local tool from provider schemas while keeping it executable. */
export function markRuntimeProviderSchemaHiddenTool(tool: Tool): Tool {
  objectDefineProperty(tool, AGENT_RUNTIME_PROVIDER_SCHEMA_HIDDEN, {
    value: true,
    enumerable: false,
  });
  return tool;
}

/** Return whether a runtime-local tool should stay out of provider schemas. */
export function isRuntimeProviderSchemaHiddenTool(value: unknown): boolean {
  return value !== null && typeof value === "object" &&
    objectGetOwnPropertyDescriptor(value, AGENT_RUNTIME_PROVIDER_SCHEMA_HIDDEN)?.value === true;
}

/** Copy provider-schema hidden metadata across a runtime-owned wrapper. */
export function inheritRuntimeProviderSchemaHiddenTool<T extends object>(
  source: unknown,
  target: T,
): T {
  return isRuntimeProviderSchemaHiddenTool(source)
    ? markRuntimeProviderSchemaHiddenTool(target as Tool) as T
    : target;
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
