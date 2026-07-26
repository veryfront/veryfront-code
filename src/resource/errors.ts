/** Error raised when a resource rejects URI-derived parameters. */
export class ResourceParamsValidationError extends Error {
  readonly resourceId: string;

  constructor(resourceId: string, cause: unknown) {
    const detail = cause instanceof Error ? cause.message : String(cause);
    super(`Resource "${resourceId}" params validation failed: ${detail}`, {
      cause,
    });
    this.name = "ResourceParamsValidationError";
    this.resourceId = resourceId;
  }
}

/** Error raised when a URI cannot be safely decoded against a resource template. */
export class ResourceUriValidationError extends Error {
  readonly parameterName: string;

  constructor(parameterName: string, cause: unknown) {
    super(
      `Resource URI has invalid percent-encoding for parameter "${parameterName}"`,
      { cause },
    );
    this.name = "ResourceUriValidationError";
    this.parameterName = parameterName;
  }
}

/** Error raised when a resource URI is malformed or exceeds its input bound. */
export class ResourceUriSyntaxError extends Error {
  constructor(detail: string) {
    super(`Resource URI ${detail}`);
    this.name = "ResourceUriSyntaxError";
  }
}
