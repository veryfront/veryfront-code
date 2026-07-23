const INVALID_TOOL_INPUT_ERROR_NAME = "AI_InvalidToolInputError";
const INVALID_TOOL_RESULT_ERROR_NAME = "AI_InvalidToolResultError";
const MISSING_TOOL_RESULT_ERROR_NAME = "AI_MissingToolResultError";
const NO_SUCH_TOOL_ERROR_NAME = "AI_NoSuchToolError";
const TOOL_CALL_REPAIR_ERROR_NAME = "AI_ToolCallRepairError";
const TOOL_INPUT_LIMIT_ERROR_NAME = "AI_ToolInputLimitError";

type ErrorWithName = {
  name: string;
};

type InvalidToolInputErrorShape = ErrorWithName & {
  cause?: unknown;
  toolInput: unknown;
  toolName: string;
};

type NoSuchToolErrorShape = ErrorWithName & {
  availableTools?: string[];
  toolName: string;
};

type MissingToolResultErrorShape = ErrorWithName & {
  toolCallId: string;
  toolName: string;
};

type InvalidToolResultErrorShape = ErrorWithName & {
  cause?: unknown;
  result: unknown;
  toolCallId: string;
  toolName: string;
};

type ToolInputLimitErrorShape = ErrorWithName & {
  limit: number;
  limitKind: "bytes" | "deltas" | "toolCalls";
  toolCallId: string;
  toolName: string;
};

type ToolCallRepairErrorShape = ErrorWithName & {
  cause?: unknown;
  originalError: InvalidToolInputErrorShape | NoSuchToolErrorShape;
};

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isErrorWithName(error: unknown, expectedName: string): error is ErrorWithName {
  return !!error &&
    typeof error === "object" &&
    "name" in error &&
    error.name === expectedName;
}

export function isInvalidToolInputError(error: unknown): error is InvalidToolInputErrorShape {
  return isErrorWithName(error, INVALID_TOOL_INPUT_ERROR_NAME) &&
    "toolName" in error &&
    typeof error.toolName === "string" &&
    "toolInput" in error;
}

export function isNoSuchToolError(error: unknown): error is NoSuchToolErrorShape {
  return isErrorWithName(error, NO_SUCH_TOOL_ERROR_NAME) &&
    "toolName" in error &&
    typeof error.toolName === "string";
}

export function isMissingToolResultError(
  error: unknown,
): error is MissingToolResultErrorShape {
  return isErrorWithName(error, MISSING_TOOL_RESULT_ERROR_NAME) &&
    "toolCallId" in error &&
    typeof error.toolCallId === "string" &&
    "toolName" in error &&
    typeof error.toolName === "string";
}

export function isInvalidToolResultError(
  error: unknown,
): error is InvalidToolResultErrorShape {
  return isErrorWithName(error, INVALID_TOOL_RESULT_ERROR_NAME) &&
    "toolCallId" in error &&
    typeof error.toolCallId === "string" &&
    "toolName" in error &&
    typeof error.toolName === "string" &&
    "result" in error;
}

export function isToolCallRepairError(error: unknown): error is ToolCallRepairErrorShape {
  return isErrorWithName(error, TOOL_CALL_REPAIR_ERROR_NAME) &&
    "originalError" in error &&
    (isInvalidToolInputError(error.originalError) || isNoSuchToolError(error.originalError));
}

export function createNoSuchToolError(options: {
  toolName: string;
  availableTools?: string[];
}): Error & NoSuchToolErrorShape {
  const available = options.availableTools?.length
    ? ` Available tools: ${options.availableTools.join(", ")}.`
    : "";
  const error = new Error(`Tool "${options.toolName}" is not available.${available}`);
  error.name = NO_SUCH_TOOL_ERROR_NAME;
  return Object.assign(error, {
    toolName: options.toolName,
    ...(options.availableTools ? { availableTools: [...options.availableTools] } : {}),
  });
}

export function createInvalidToolInputError(options: {
  cause: unknown;
  toolInput: unknown;
  toolName: string;
}): Error & InvalidToolInputErrorShape {
  const error = new Error(
    `Invalid input for tool ${options.toolName}: ${getErrorMessage(options.cause)}`,
    { cause: options.cause },
  );
  error.name = INVALID_TOOL_INPUT_ERROR_NAME;
  return Object.assign(error, {
    toolInput: options.toolInput,
    toolName: options.toolName,
  });
}

export function createMissingToolResultError(options: {
  toolCallId: string;
  toolName: string;
}): Error & MissingToolResultErrorShape {
  const error = new Error(
    `Provider-executed tool "${options.toolName}" (${options.toolCallId}) is missing a correlated result`,
  );
  error.name = MISSING_TOOL_RESULT_ERROR_NAME;
  return Object.assign(error, options);
}

export function createInvalidToolResultError(options: {
  cause: unknown;
  result: unknown;
  toolCallId: string;
  toolName: string;
}): Error & InvalidToolResultErrorShape {
  const error = new Error(
    `Invalid result for provider tool ${options.toolName} (${options.toolCallId}): ${
      getErrorMessage(options.cause)
    }`,
    { cause: options.cause },
  );
  error.name = INVALID_TOOL_RESULT_ERROR_NAME;
  return Object.assign(error, {
    result: options.result,
    toolCallId: options.toolCallId,
    toolName: options.toolName,
  });
}

export function createToolInputLimitError(options: {
  limit: number;
  limitKind: "bytes" | "deltas" | "toolCalls";
  toolCallId: string;
  toolName: string;
}): Error & ToolInputLimitErrorShape {
  const unit = options.limitKind === "toolCalls"
    ? "distinct streamed tool calls"
    : options.limitKind === "bytes"
    ? "input bytes"
    : "input deltas";
  const error = new Error(
    `Streamed tool call "${options.toolName}" (${options.toolCallId}) exceeded the limit of ${options.limit} ${unit}`,
  );
  error.name = TOOL_INPUT_LIMIT_ERROR_NAME;
  return Object.assign(error, options);
}

export function createToolCallRepairError(options: {
  cause: unknown;
  originalError: InvalidToolInputErrorShape | NoSuchToolErrorShape;
}): Error & ToolCallRepairErrorShape {
  const error = new Error(`Error repairing tool call: ${getErrorMessage(options.cause)}`, {
    cause: options.cause,
  });
  error.name = TOOL_CALL_REPAIR_ERROR_NAME;
  return Object.assign(error, { originalError: options.originalError });
}

export function createInvalidToolInputErrorForTest(options: {
  cause: Error;
  toolInput: string;
  toolName: string;
}): unknown {
  return createInvalidToolInputError(options);
}
