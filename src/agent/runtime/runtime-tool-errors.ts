const INVALID_TOOL_INPUT_ERROR_NAME = "AI_InvalidToolInputError";
const NO_SUCH_TOOL_ERROR_NAME = "AI_NoSuchToolError";

type ErrorWithName = {
  name: string;
};

type InvalidToolInputErrorShape = ErrorWithName & {
  toolInput: unknown;
  toolName: string;
};

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

export function isNoSuchToolError(error: unknown): boolean {
  return isErrorWithName(error, NO_SUCH_TOOL_ERROR_NAME) &&
    "toolName" in error &&
    typeof error.toolName === "string";
}

export function createInvalidToolInputErrorForTest(options: {
  cause: Error;
  toolInput: string;
  toolName: string;
}): unknown {
  const error = new Error(`Invalid input for tool ${options.toolName}: ${options.cause.message}`);
  error.name = INVALID_TOOL_INPUT_ERROR_NAME;

  return Object.assign(error, {
    cause: options.cause,
    toolInput: options.toolInput,
    toolName: options.toolName,
  });
}
