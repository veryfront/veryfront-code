import type { Tool, ToolDefinition } from "./types.ts";
import { zodToJsonSchema } from "./schema/zod-json-schema.ts";
import { agentLogger } from "#veryfront/utils";
import {
  ScopedRegistryFacade,
  ScopedRegistryView,
} from "#veryfront/registry/scoped-registry-facade.ts";
import { ProjectScopedRegistryManager } from "#veryfront/registry/project-scoped-registry-manager.ts";
import { INVALID_ARGUMENT, TOOL_ID_CONFLICT } from "#veryfront/errors";
import { snapshotBoundedJsonValue } from "#veryfront/schemas/json-value.ts";
import type { JsonSchema } from "#veryfront/extensions/schema/index.ts";
import type { ToolAnnotations } from "#veryfront/mcp/annotations.ts";
import { isToolAnnotations, snapshotToolMcpConfig } from "./mcp-metadata.ts";

/**
 * Returns true when `incoming` is considered the same definition as `existing`:
 * same object reference, or matching id + description. Equivalent definitions
 * may replace each other (HMR re-registration must pick up an edited execute
 * or schema); anything else under an existing ID is a conflict.
 */
function isSameToolDefinition(existing: Tool, incoming: Tool): boolean {
  return existing === incoming ||
    (existing.id === incoming.id && existing.description === incoming.description);
}

function validateToolRegistration(id: string, existing: Tool, incoming: Tool): void {
  if (isSameToolDefinition(existing, incoming)) return;
  throw TOOL_ID_CONFLICT.create({
    detail:
      `Tool "${id}" is already registered with a different definition. Use a unique tool ID or rename one of the conflicting tools.`,
  });
}

export function assertLocalToolId(id: string): void {
  if (!id.includes("__")) return;

  throw INVALID_ARGUMENT.create({
    detail:
      `Local tool "${id}" cannot use the reserved integration tool namespace "integration__tool". Rename the local tool without "__".`,
  });
}

const toolManager = new ProjectScopedRegistryManager<Tool>("tool", {
  validateRegistration: validateToolRegistration,
});

class ToolRegistryInternal extends ScopedRegistryFacade<Tool> {
  override register(id: string, item: Tool): void {
    assertLocalToolId(id);
    if (item.id !== id) assertLocalToolId(item.id);

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
    assertLocalToolId(id);
    if (item.id !== id) assertLocalToolId(item.id);
    super.registerShared(id, item);
  }

  getToolsForProvider(): ToolDefinition[] {
    return [...this.getAll().values()].map(toolToProviderDefinition);
  }
}

/** Framework-only tool registry with process-wide maintenance capabilities. */
export const toolRegistryInternal = new ToolRegistryInternal(toolManager);

/**
 * Application-facing project-scoped tool registry API.
 *
 * Process-wide maintenance methods remain for compatibility; framework
 * composition roots should use `toolRegistryInternal` for that behavior.
 */
class ToolRegistry extends ScopedRegistryView<Tool> {
  getToolsForProvider(): ToolDefinition[] {
    return [...this.getAll().values()].map(toolToProviderDefinition);
  }
}

/** Project-scoped tool registry value. */
export const toolRegistry = new ToolRegistry(toolRegistryInternal);

function snapshotProviderSchema(value: unknown, toolId: string): JsonSchema {
  const snapshot = snapshotBoundedJsonValue(value);
  if (
    !snapshot.success ||
    typeof snapshot.value !== "object" ||
    snapshot.value === null ||
    Array.isArray(snapshot.value)
  ) {
    throw new TypeError(`Tool "${toolId}" provider schema must be a bounded JSON object`);
  }
  return snapshot.value;
}

function snapshotProviderMcpMetadata(
  value: Tool["mcp"],
  toolId: string,
): Pick<ToolDefinition, "annotations" | "title"> {
  if (value === undefined) return {};
  const snapshot = snapshotToolMcpConfig(value, toolId);
  const title = typeof snapshot?.title === "string" &&
      snapshot.title.length > 0
    ? snapshot.title
    : undefined;
  const annotations = isToolAnnotations(snapshot?.annotations)
    ? snapshot.annotations as ToolAnnotations
    : undefined;
  return {
    ...(title ? { title } : {}),
    ...(annotations ? { annotations } : {}),
  };
}

export function toolToProviderDefinition(tool: Tool): ToolDefinition {
  const hasPreConvertedSchema = tool.inputSchemaJson != null;
  const jsonSchema = snapshotProviderSchema(
    tool.inputSchemaJson ?? zodToJsonSchema(tool.inputSchema),
    tool.id,
  );

  agentLogger.debug(
    `[TOOL] Using ${
      hasPreConvertedSchema ? "pre-converted" : "runtime-converted"
    } schema for "${tool.id}"`,
  );

  return {
    name: tool.id,
    description: tool.description,
    parameters: jsonSchema,
    ...snapshotProviderMcpMetadata(tool.mcp, tool.id),
  };
}
