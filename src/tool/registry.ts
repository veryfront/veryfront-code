import type { Tool, ToolDefinition, ToolExecutionContext } from "./types.ts";
import { zodToJsonSchema } from "./schema/zod-json-schema.ts";
import { agentLogger } from "#veryfront/utils/logger/logger.ts";
import { ScopedRegistryFacade } from "#veryfront/registry/scoped-registry-facade.ts";
import { ProjectScopedRegistryManager } from "#veryfront/registry/project-scoped-registry-manager.ts";
import { getErrorMessage, INVALID_ARGUMENT, TOOL_ID_CONFLICT } from "#veryfront/errors";
import { snapshotJsonValue } from "./json-value.ts";
import { isFrameworkSkillToolId } from "./framework-tool-ids.ts";

/**
 * Returns true when `incoming` is considered the same definition as `existing`:
 * same object reference, or matching identity, description, and ownership.
 * Equivalent definitions may replace each other (HMR re-registration must
 * pick up an edited execute or schema); anything else under an existing ID is
 * a conflict. Ownership is part of identity so one agent cannot replace
 * another agent's same-named definition.
 */
function isSameToolDefinition(existing: Tool, incoming: Tool): boolean {
  return existing === incoming ||
    (existing.id === incoming.id && existing.description === incoming.description &&
      existing.ownerAgentId === incoming.ownerAgentId &&
      existing.shortName === incoming.shortName);
}

function validateToolRegistration(id: string, existing: Tool, incoming: Tool): void {
  if (isSameToolDefinition(existing, incoming)) return;
  throw TOOL_ID_CONFLICT.create({
    detail:
      `Tool "${id}" is already registered with a different definition. Use a unique tool ID or rename one of the conflicting tools.`,
  });
}

const MAX_LOCAL_TOOL_ID_LENGTH = 128;
const MAX_LOCAL_TOOL_DESCRIPTION_LENGTH = 16_384;

function hasUnsafeControlCharacter(
  value: string,
  allowFormattingWhitespace = false,
): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (
      code === 127 ||
      (code < 32 && !(allowFormattingWhitespace && (code === 9 || code === 10 || code === 13)))
    ) {
      return true;
    }
  }
  return false;
}

function assertToolId(id: string, allowFrameworkSkillTool: boolean): void {
  if (
    typeof id !== "string" || id.trim().length === 0 || id.trim() !== id ||
    id.length > MAX_LOCAL_TOOL_ID_LENGTH || hasUnsafeControlCharacter(id)
  ) {
    throw INVALID_ARGUMENT.create({ detail: "Local tool id must be a non-empty string" });
  }

  if (id.includes("__")) {
    throw INVALID_ARGUMENT.create({
      detail:
        `Local tool "${id}" cannot use the reserved integration tool namespace "integration__tool". Rename the local tool without "__".`,
    });
  }

  if (!allowFrameworkSkillTool && isFrameworkSkillToolId(id)) {
    throw INVALID_ARGUMENT.create({
      detail: `Local tool "${id}" cannot use a framework skill tool ID. Rename the local tool.`,
    });
  }
}

export function assertLocalToolId(id: string): void {
  assertToolId(id, false);
}

type ValidatedToolRegistration = {
  id: string;
  ownerAgentId: string | undefined;
  shortName: string | undefined;
};

function invalidToolRegistration(detail: string): never {
  throw INVALID_ARGUMENT.create({ detail });
}

function getDataProperty(
  descriptors: PropertyDescriptorMap,
  property: string,
  required: boolean,
): unknown {
  const descriptor = descriptors[property];
  if (!descriptor) {
    if (required) invalidToolRegistration(`Tool ${property} is required`);
    return undefined;
  }
  if (!("value" in descriptor)) {
    invalidToolRegistration(`Tool ${property} must be a data property`);
  }
  return descriptor.value;
}

function validateScopeMetadata(value: unknown, property: string): string | undefined {
  if (value === undefined) return undefined;
  if (
    typeof value !== "string" || value.trim().length === 0 || value.trim() !== value ||
    value.length > MAX_LOCAL_TOOL_ID_LENGTH || hasUnsafeControlCharacter(value)
  ) {
    invalidToolRegistration(`Tool ${property} must be a non-empty string`);
  }
  return value;
}

function validateToolShape(
  item: Tool,
  allowFrameworkSkillTool = false,
): ValidatedToolRegistration {
  if (typeof item !== "object" || item === null || Array.isArray(item)) {
    invalidToolRegistration("Tool definition must be an object");
  }

  let descriptors: PropertyDescriptorMap;
  try {
    descriptors = Object.getOwnPropertyDescriptors(item);
  } catch {
    invalidToolRegistration("Tool definition could not be inspected");
  }

  const id = getDataProperty(descriptors, "id", true);
  if (typeof id !== "string") invalidToolRegistration("Tool id must be a string");
  assertToolId(id, allowFrameworkSkillTool);

  const type = getDataProperty(descriptors, "type", true);
  if (type !== "function" && type !== "dynamic") {
    invalidToolRegistration("Tool type must be function or dynamic");
  }

  const description = getDataProperty(descriptors, "description", true);
  if (
    typeof description !== "string" || description.trim().length === 0 ||
    description.length > MAX_LOCAL_TOOL_DESCRIPTION_LENGTH ||
    hasUnsafeControlCharacter(description, true)
  ) {
    invalidToolRegistration("Tool description must be a non-empty string");
  }

  const inputSchema = getDataProperty(descriptors, "inputSchema", true);
  if ((typeof inputSchema !== "object" && typeof inputSchema !== "function") || !inputSchema) {
    invalidToolRegistration("Tool inputSchema must be an object");
  }
  if (typeof getDataProperty(descriptors, "execute", true) !== "function") {
    invalidToolRegistration("Tool execute must be a function");
  }

  const ownerAgentId = validateScopeMetadata(
    getDataProperty(descriptors, "ownerAgentId", false),
    "ownerAgentId",
  );
  const shortName = validateScopeMetadata(
    getDataProperty(descriptors, "shortName", false),
    "shortName",
  );
  if (shortName !== undefined && ownerAgentId === undefined) {
    invalidToolRegistration("Tool shortName requires ownerAgentId");
  }
  return { id, ownerAgentId, shortName };
}

function lockToolScope(item: Tool, validated: ValidatedToolRegistration): void {
  for (const [property, value] of Object.entries(validated)) {
    const current = Object.getOwnPropertyDescriptor(item, property);
    if (current && current.configurable === false) {
      if (!("value" in current) || current.writable || !Object.is(current.value, value)) {
        invalidToolRegistration(`Tool ${property} cannot be locked for registration`);
      }
      continue;
    }
    // An absent property on a non-extensible object is already immutable.
    if (!current && !Object.isExtensible(item)) continue;
    try {
      Object.defineProperty(item, property, {
        value,
        enumerable: true,
        configurable: false,
        writable: false,
      });
    } catch {
      invalidToolRegistration(`Tool ${property} cannot be locked for registration`);
    }
  }
}

const toolManager = new ProjectScopedRegistryManager<Tool>("tool", {
  validateRegistration: validateToolRegistration,
});

const REGISTER_FRAMEWORK_SKILL_TOOL = Symbol("register-framework-skill-tool");

class ToolRegistryClass extends ScopedRegistryFacade<Tool> {
  override register(id: string, item: Tool): void {
    assertLocalToolId(id);
    const validated = validateToolShape(item);
    if (validated.id !== id) {
      throw INVALID_ARGUMENT.create({
        detail: `Registry key "${id}" must match tool id "${validated.id}"`,
      });
    }
    lockToolScope(item, validated);

    // Equivalent-registration diagnostics inspect the project scope only;
    // the manager enforces conflicts here and again against journaled order.
    // Shared/framework tools remain intentionally shadowable.
    const existing = this.getOwn(id);
    if (existing !== undefined && existing !== item && isSameToolDefinition(existing, item)) {
      agentLogger.debug(`[tool] "${id}" re-registered with equivalent definition; replacing.`);
    }
    super.register(id, item);
  }

  override registerShared(id: string, item: Tool): void {
    this.registerSharedTool(id, item, false);
  }

  [REGISTER_FRAMEWORK_SKILL_TOOL](id: string, item: Tool): void {
    if (!isFrameworkSkillToolId(id)) {
      invalidToolRegistration("Framework skill registration requires a reserved skill tool ID");
    }
    const existing = this.getShared(id);
    if (existing !== undefined && existing !== item) {
      invalidToolRegistration(`Framework skill tool "${id}" is already registered`);
    }
    this.registerSharedTool(id, item, true);
  }

  private registerSharedTool(
    id: string,
    item: Tool,
    allowFrameworkSkillTool: boolean,
  ): void {
    assertToolId(id, allowFrameworkSkillTool);
    const validated = validateToolShape(item, allowFrameworkSkillTool);
    if (validated.id !== id) {
      throw INVALID_ARGUMENT.create({
        detail: `Registry key "${id}" must match tool id "${validated.id}"`,
      });
    }
    lockToolScope(item, validated);
    super.registerShared(id, item);
  }

  getToolsForProvider(context?: ToolExecutionContext): ToolDefinition[] {
    return [...this.getAll().values()]
      .filter((tool) => tool.ownerAgentId === undefined || tool.ownerAgentId === context?.agentId)
      .map(toolToProviderDefinition);
  }
}

/** Shared tool registry value. */
export const toolRegistry = new ToolRegistryClass(toolManager);

/** Register one framework-owned skill tool through the internal capability path. */
export function registerFrameworkSkillTool(id: string, item: Tool): void {
  toolRegistry[REGISTER_FRAMEWORK_SKILL_TOOL](id, item);
}

export function toolToProviderDefinition(tool: Tool): ToolDefinition {
  const hasPreConvertedSchema = tool.inputSchemaJson != null;
  let jsonSchema: ToolDefinition["parameters"];
  try {
    jsonSchema = snapshotJsonValue(
      tool.inputSchemaJson ?? zodToJsonSchema(tool.inputSchema),
      { label: `Tool "${tool.id}" provider schema` },
    );
  } catch (error) {
    throw INVALID_ARGUMENT.create({ detail: getErrorMessage(error) });
  }

  agentLogger.debug(
    `[TOOL] Using ${
      hasPreConvertedSchema ? "pre-converted" : "runtime-converted"
    } schema for "${tool.id}"`,
  );

  return {
    name: tool.id,
    description: tool.description,
    parameters: jsonSchema,
  };
}
