import type { ChatSystemMessage } from "#veryfront/chat/types.ts";

const RUNTIME_TOOL_INVENTORY_HEADER = "Current run tool inventory:";

function createRuntimeToolInventoryMessage(toolNames: readonly string[]): ChatSystemMessage {
  const toolList = toolNames.length > 0
    ? toolNames.map((toolName) => `- ${toolName}`).join("\n")
    : "- none";

  return {
    role: "system",
    content: `${RUNTIME_TOOL_INVENTORY_HEADER}

${toolList}

Only treat the tools listed above as actually available in this run.
If the list is "- none", say plainly that no tools are available.
Do NOT infer tool availability from examples, skills, or the base prompt.`,
  };
}

function isRuntimeToolInventoryMessage(message: ChatSystemMessage): boolean {
  return message.content.includes(RUNTIME_TOOL_INVENTORY_HEADER);
}

/** Applies runtime tool inventory. */
export function withRuntimeToolInventory(
  instructions: string | readonly ChatSystemMessage[],
  toolNames: readonly string[],
): ChatSystemMessage[] {
  const inventoryMessage = createRuntimeToolInventoryMessage(toolNames);
  if (typeof instructions === "string") {
    return [{ role: "system", content: instructions }, inventoryMessage];
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
