import {
  InvalidToolInputError,
  NoSuchToolError,
  type ToolCallRepairFunction,
  type ToolSet,
} from "ai";

const REPAIRABLE_PROVIDER_TOOL_NAMES = new Set(["web_search"]);

export const repairToolCall: ToolCallRepairFunction<ToolSet> = async ({
  toolCall,
  error,
}) => {
  if (NoSuchToolError.isInstance(error)) {
    return null;
  }

  if (!REPAIRABLE_PROVIDER_TOOL_NAMES.has(toolCall.toolName)) {
    return null;
  }

  if (!InvalidToolInputError.isInstance(error) || typeof toolCall.input !== "string") {
    return null;
  }

  const trimmedInput = toolCall.input.trim();
  if (trimmedInput.length === 0) {
    return null;
  }

  let normalizedQuery = trimmedInput;

  try {
    const parsedInput = JSON.parse(trimmedInput) as unknown;
    if (typeof parsedInput === "string") {
      normalizedQuery = parsedInput.trim();
    } else {
      return null;
    }
  } catch {
    // Raw string input is also repairable for provider-native web_search.
  }

  if (normalizedQuery.length === 0) {
    return null;
  }

  return {
    ...toolCall,
    input: JSON.stringify({ query: normalizedQuery }),
  };
};
