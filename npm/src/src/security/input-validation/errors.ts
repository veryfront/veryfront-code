export class ValidationError extends Error {
  public readonly details?: unknown;

  constructor(message: string, details?: unknown) {
    super(message);
    this.name = "ValidationError";
    this.details = details;
  }
}
