import { stringifyToolError } from "./error-utils.ts";

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

const MISSING_OWN_DATA = Symbol("missing-own-data");

function readOwnData(
  value: unknown,
  key: string,
): unknown | typeof MISSING_OWN_DATA {
  if (
    (typeof value !== "object" || value === null) &&
    typeof value !== "function"
  ) {
    return MISSING_OWN_DATA;
  }

  try {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    return descriptor && Object.hasOwn(descriptor, "value") ? descriptor.value : MISSING_OWN_DATA;
  } catch {
    return MISSING_OWN_DATA;
  }
}

function isErrorWithName(error: unknown, expectedName: string): error is ErrorWithName {
  return readOwnData(error, "name") === expectedName;
}

export function isInvalidToolInputError(error: unknown): error is InvalidToolInputErrorShape {
  return isErrorWithName(error, INVALID_TOOL_INPUT_ERROR_NAME) &&
    typeof readOwnData(error, "toolName") === "string" &&
    readOwnData(error, "toolInput") !== MISSING_OWN_DATA;
}

export function isNoSuchToolError(error: unknown): error is NoSuchToolErrorShape {
  return isErrorWithName(error, NO_SUCH_TOOL_ERROR_NAME) &&
    typeof readOwnData(error, "toolName") === "string";
}

export function isMissingToolResultError(
  error: unknown,
): error is MissingToolResultErrorShape {
  return isErrorWithName(error, MISSING_TOOL_RESULT_ERROR_NAME) &&
    typeof readOwnData(error, "toolCallId") === "string" &&
    typeof readOwnData(error, "toolName") === "string";
}

export function isInvalidToolResultError(
  error: unknown,
): error is InvalidToolResultErrorShape {
  return isErrorWithName(error, INVALID_TOOL_RESULT_ERROR_NAME) &&
    typeof readOwnData(error, "toolCallId") === "string" &&
    typeof readOwnData(error, "toolName") === "string" &&
    readOwnData(error, "result") !== MISSING_OWN_DATA;
}

export function isToolCallRepairError(error: unknown): error is ToolCallRepairErrorShape {
  if (!isErrorWithName(error, TOOL_CALL_REPAIR_ERROR_NAME)) return false;
  const originalError = readOwnData(error, "originalError");
  return originalError !== MISSING_OWN_DATA &&
    (isInvalidToolInputError(originalError) || isNoSuchToolError(originalError));
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
    `Invalid input for tool ${options.toolName}: ${stringifyToolError(options.cause)}`,
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
      stringifyToolError(options.cause)
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
  const error = new Error(`Error repairing tool call: ${stringifyToolError(options.cause)}`, {
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
