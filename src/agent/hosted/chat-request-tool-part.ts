function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/**
 * Resolve the identity carried by a normalized UI tool part.
 *
 * Static tools derive their name from `tool-<name>` while dynamic and replay
 * tool parts carry an explicit `toolName`.
 */
export function getHostedChatUiToolIdentity(
  part: unknown,
): { toolCallId: string; toolName: string } | null {
  if (!isRecord(part) || typeof part.type !== "string") {
    return null;
  }

  const toolCallId = typeof part.toolCallId === "string" ? part.toolCallId : "";
  const explicitToolName = typeof part.toolName === "string" ? part.toolName : "";
  const derivedToolName = part.type.startsWith("tool-") ? part.type.slice("tool-".length) : "";
  const toolName = explicitToolName || derivedToolName;

  return toolCallId && toolName ? { toolCallId, toolName } : null;
}
