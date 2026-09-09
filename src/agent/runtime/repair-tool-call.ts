import { privateJsonParse, privateJsonStringify } from "#veryfront/security/private-json.ts";
import { privateTextTrim } from "#veryfront/security/private-text.ts";
import { createPrivateSet } from "#veryfront/security/private-set.ts";
import { isInvalidToolInputError, isNoSuchToolError } from "./runtime-tool-errors.ts";
import type { RuntimeToolCallRepairFunction } from "./runtime-tool-types.ts";

const REPAIRABLE_PROVIDER_TOOL_NAMES = createPrivateSet(["web_search"]);

export const repairToolCall: RuntimeToolCallRepairFunction = async ({
  toolCall,
  error,
}) => {
  if (isNoSuchToolError(error)) {
    return null;
  }

  if (!REPAIRABLE_PROVIDER_TOOL_NAMES.has(toolCall.toolName)) {
    return null;
  }

  if (toolCall.providerExecuted !== true) {
    return null;
  }

  if (!isInvalidToolInputError(error) || typeof toolCall.input !== "string") {
    return null;
  }

  const trimmedInput = privateTextTrim(toolCall.input);
  if (trimmedInput.length === 0) {
    return null;
  }

  let normalizedQuery = trimmedInput;

  try {
    const parsedInput = privateJsonParse(trimmedInput) as unknown;
    if (typeof parsedInput === "string") {
      normalizedQuery = privateTextTrim(parsedInput);
    }
  } catch {
    // Raw string input is also repairable for provider-native web_search.
  }

  if (normalizedQuery.length === 0) {
    return null;
  }

  return {
    ...toolCall,
    input: privateJsonStringify({ query: normalizedQuery }),
  };
};
