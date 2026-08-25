import type { ChatSystemMessage } from "#veryfront/chat/types.ts";

const RUNTIME_TOOL_INVENTORY_HEADER = "Current run tool inventory:";
const RUNTIME_TOOL_INVENTORY_FOOTER =
  `Only treat the tools listed above as actually available in this run.
If the list is "- none", say plainly that no tools are available.
Do NOT infer tool availability from examples, skills, or the base prompt.`;
const RUNTIME_TOOL_SEARCH_GUIDANCE =
  "When tool_search is listed, additional authorized tools may be deferred. You MUST call tool_search before declaring a requested or required tool unavailable. Query with one exact tool name when known, or one short capability phrase; do not combine alternatives in one query. A loaded match becomes callable on the next model step.";

const RUNTIME_DEFERRED_TOOL_HEADER =
  "Authorized but not loaded. You cannot call these until they are loaded:";
const RUNTIME_DEFERRED_TOOL_FOOTER =
  "Load one by calling tool_search with its exact name. It becomes callable on the next model step. You must not call a deferred tool directly.";

/** A tool the model may load but cannot yet call. */
export interface DeferredToolSummary {
  readonly name: string;
  readonly description?: string;
}

function getRuntimeToolInventoryFooter(toolNames: readonly string[]): string {
  return toolNames.includes("tool_search")
    ? `${RUNTIME_TOOL_INVENTORY_FOOTER}\n${RUNTIME_TOOL_SEARCH_GUIDANCE}`
    : RUNTIME_TOOL_INVENTORY_FOOTER;
}

/**
 * Render the deferred catalog.
 *
 * Kept out of the callable list on purpose. The footer above it tells the model
 * to treat that list as the tools it actually has, so a deferred name mixed in
 * would invite a direct call that cannot succeed. Descriptions are included
 * because a bare name gives the model nothing to match a task against, which is
 * the whole reason an unloaded tool is worth mentioning at all.
 */
function createDeferredToolSection(deferredTools: readonly DeferredToolSummary[]): string {
  const entries = deferredTools
    .map((tool) =>
      tool.description === undefined || tool.description.length === 0
        ? `- ${tool.name}`
        : `- ${tool.name}: ${tool.description}`
    )
    .join("\n");

  return `\n\n${RUNTIME_DEFERRED_TOOL_HEADER}

${entries}

${RUNTIME_DEFERRED_TOOL_FOOTER}`;
}

function createRuntimeToolInventoryMessage(
  toolNames: readonly string[],
  deferredTools: readonly DeferredToolSummary[],
): ChatSystemMessage {
  const toolList = toolNames.length > 0
    ? toolNames.map((toolName) => `- ${toolName}`).join("\n")
    : "- none";
  const deferredSection = deferredTools.length > 0 ? createDeferredToolSection(deferredTools) : "";

  return {
    role: "system",
    content: `${RUNTIME_TOOL_INVENTORY_HEADER}

${toolList}

${getRuntimeToolInventoryFooter(toolNames)}${deferredSection}`,
  };
}

function removeFlattenedRuntimeToolInventory(instructions: string): string {
  const headerIndex = instructions.lastIndexOf(RUNTIME_TOOL_INVENTORY_HEADER);
  if (headerIndex < 0) {
    return instructions;
  }

  const inventory = instructions.slice(headerIndex);
  // A deferred section, when present, is the last thing written, so it carries
  // the terminator. Missing it here would leave the previous inventory in place
  // and append a second one on the next step.
  const terminatesInventory = inventory.endsWith(RUNTIME_TOOL_INVENTORY_FOOTER) ||
    inventory.endsWith(`${RUNTIME_TOOL_INVENTORY_FOOTER}\n${RUNTIME_TOOL_SEARCH_GUIDANCE}`) ||
    inventory.endsWith(RUNTIME_DEFERRED_TOOL_FOOTER);
  if (!inventory.startsWith(`${RUNTIME_TOOL_INVENTORY_HEADER}\n\n- `) || !terminatesInventory) {
    return instructions;
  }

  return instructions.slice(0, headerIndex).trimEnd();
}

function removeStructuredRuntimeToolInventory(
  message: ChatSystemMessage,
): ChatSystemMessage | undefined {
  const content = removeFlattenedRuntimeToolInventory(message.content);
  if (content === message.content) {
    return message;
  }
  return content.length > 0 ? { ...message, content } : undefined;
}

/** Returns whether instructions already carry a hosted runtime tool inventory. */
export function hasRuntimeToolInventory(
  instructions: string | readonly ChatSystemMessage[],
): boolean {
  return typeof instructions === "string"
    ? removeFlattenedRuntimeToolInventory(instructions) !== instructions
    : instructions.some((message) =>
      removeFlattenedRuntimeToolInventory(message.content) !== message.content
    );
}

/**
 * Applies runtime tool inventory.
 *
 * `deferredTools` names capabilities the model is authorized to use but cannot
 * call yet. Listing them is what keeps an authorized tool from being invisible:
 * a tool absent from both the provider tool list and this inventory cannot even
 * be searched for, because the model has no reason to believe it exists.
 */
export function withRuntimeToolInventory(
  instructions: string | readonly ChatSystemMessage[],
  toolNames: readonly string[],
  deferredTools: readonly DeferredToolSummary[] = [],
): ChatSystemMessage[] {
  const inventoryMessage = createRuntimeToolInventoryMessage(toolNames, deferredTools);
  if (typeof instructions === "string") {
    const baseInstructions = removeFlattenedRuntimeToolInventory(instructions);
    return baseInstructions.length > 0
      ? [{ role: "system", content: baseInstructions }, inventoryMessage]
      : [inventoryMessage];
  }

  const baseInstructions = instructions
    .map(removeStructuredRuntimeToolInventory)
    .filter((message): message is ChatSystemMessage => message !== undefined);
  return [...baseInstructions, inventoryMessage];
}

/** Flatten system instructions helper. */
export function flattenSystemInstructions(instructions: readonly ChatSystemMessage[]): string {
  return instructions
    .map((message) => message.content.trim())
    .filter((content) => content.length > 0)
    .join("\n\n");
}
