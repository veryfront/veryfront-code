export type ApplicationErrorAttributeValue = string | number | boolean;

export type ApplicationErrorLevel = "fatal" | "error" | "warning" | "info" | "debug";

export type ApplicationErrorContext = {
  boundary: string;
  level?: ApplicationErrorLevel;
  method?: string;
  processRole?: string;
  requestId?: string;
  spanId?: string;
  traceId?: string;
  attributes?: Record<string, ApplicationErrorAttributeValue>;
};

export type ApplicationErrorReporter = {
  capture(error: unknown, context: ApplicationErrorContext): string | undefined;
  flush(timeoutMs?: number): Promise<boolean>;
};
