import type { ChatSystemMessage } from "#veryfront/chat/types.ts";

const RUNTIME_TOOL_INVENTORY_HEADER = "Current run tool inventory:";
const RUNTIME_TOOL_INVENTORY_FOOTER =
  `Only treat the tools listed above as actually available in this run.
If the list is "- none", say plainly that no tools are available.
Do NOT infer tool availability from examples, skills, or the base prompt.`;
const RUNTIME_TOOL_SEARCH_GUIDANCE =
  "When tool_search is listed, additional authorized tools may be deferred. If the task requires a tool that is not listed, call tool_search before saying it is unavailable. Query with one exact tool name when known, or one short capability phrase; do not combine alternatives in one query. A loaded match becomes callable on the next model step.";

function getRuntimeToolInventoryFooter(toolNames: readonly string[]): string {
  return toolNames.includes("tool_search")
    ? `${RUNTIME_TOOL_INVENTORY_FOOTER}\n${RUNTIME_TOOL_SEARCH_GUIDANCE}`
    : RUNTIME_TOOL_INVENTORY_FOOTER;
}

function createRuntimeToolInventoryMessage(toolNames: readonly string[]): ChatSystemMessage {
  const toolList = toolNames.length > 0
    ? toolNames.map((toolName) => `- ${toolName}`).join("\n")
    : "- none";

  return {
    role: "system",
    content: `${RUNTIME_TOOL_INVENTORY_HEADER}

${toolList}

${getRuntimeToolInventoryFooter(toolNames)}`,
  };
}

function isRuntimeToolInventoryMessage(message: ChatSystemMessage): boolean {
  return message.content.includes(RUNTIME_TOOL_INVENTORY_HEADER);
}

function removeFlattenedRuntimeToolInventory(instructions: string): string {
  const headerIndex = instructions.lastIndexOf(RUNTIME_TOOL_INVENTORY_HEADER);
  if (headerIndex < 0) {
    return instructions;
  }

  const inventory = instructions.slice(headerIndex);
  if (
    !inventory.startsWith(`${RUNTIME_TOOL_INVENTORY_HEADER}\n\n- `) ||
    !inventory.endsWith(RUNTIME_TOOL_INVENTORY_FOOTER) &&
      !inventory.endsWith(`${RUNTIME_TOOL_INVENTORY_FOOTER}\n${RUNTIME_TOOL_SEARCH_GUIDANCE}`)
  ) {
    return instructions;
  }

  return instructions.slice(0, headerIndex).trimEnd();
}

/** Returns whether instructions already carry a hosted runtime tool inventory. */
export function hasRuntimeToolInventory(
  instructions: string | readonly ChatSystemMessage[],
): boolean {
  return typeof instructions === "string"
    ? instructions.includes(RUNTIME_TOOL_INVENTORY_HEADER)
    : instructions.some(isRuntimeToolInventoryMessage);
}

/** Applies runtime tool inventory. */
export function withRuntimeToolInventory(
  instructions: string | readonly ChatSystemMessage[],
  toolNames: readonly string[],
): ChatSystemMessage[] {
  const inventoryMessage = createRuntimeToolInventoryMessage(toolNames);
  if (typeof instructions === "string") {
    const baseInstructions = removeFlattenedRuntimeToolInventory(instructions);
    return baseInstructions.length > 0
      ? [{ role: "system", content: baseInstructions }, inventoryMessage]
      : [inventoryMessage];
  }

  return [
    ...instructions.filter((message) => !isRuntimeToolInventoryMessage(message)),
    inventoryMessage,
  ];
}

/** Flatten system instructions helper. */
export function flattenSystemInstructions(instructions: readonly ChatSystemMessage[]): string {
  return instructions
    .map((message) => message.content.trim())
    .filter((content) => content.length > 0)
    .join("\n\n");
}
