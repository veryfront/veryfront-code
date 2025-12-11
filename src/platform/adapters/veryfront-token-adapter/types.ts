
import { createError, toError } from "../../../core/errors/veryfront-error.ts";

export interface TokenStorageAdapter {
  get(key: string): Promise<string | null>;

  set(key: string, value: string): Promise<void>;

  delete(key: string): Promise<void>;

  list?(prefix?: string): Promise<string[]>;

  initialize?(): Promise<void>;

  dispose?(): void;
}

export interface TokenStorageAdapterConfig {
  type: "memory" | "veryfront-api";

  veryfront?: {
    apiToken?: string;
    projectSlug?: string;
    baseUrl?: string;
    retry?: {
      maxRetries?: number;
      initialDelay?: number;
      maxDelay?: number;
    };
  };
}

export interface VeryfrontTokenConfig {
  apiBaseUrl: string;
  apiToken: string;
  projectSlug: string;
  retry: {
    maxRetries: number;
    initialDelay: number;
    maxDelay: number;
  };
}

export function createTokenConfig(config: TokenStorageAdapterConfig): VeryfrontTokenConfig {
  if (!config.veryfront) {
    throw toError(
      createError({
        type: "config",
        message: "Veryfront token adapter requires veryfront configuration",
      }),
    );
  }

  if (!config.veryfront.apiToken) {
    throw toError(
      createError({
        type: "config",
        message: "Veryfront token adapter requires apiToken",
      }),
    );
  }

  if (!config.veryfront.projectSlug) {
    throw toError(
      createError({
        type: "config",
        message: "Veryfront token adapter requires projectSlug",
      }),
    );
  }

  return {
    apiBaseUrl: config.veryfront.baseUrl || "https://api.veryfront.com",
    apiToken: config.veryfront.apiToken,
    projectSlug: config.veryfront.projectSlug,
    retry: {
      maxRetries: config.veryfront.retry?.maxRetries ?? 3,
      initialDelay: config.veryfront.retry?.initialDelay ?? 1000,
      maxDelay: config.veryfront.retry?.maxDelay ?? 10000,
    },
  };
}

export class TokenStorageError extends Error {
  constructor(
    message: string,
    public readonly statusCode?: number,
    public readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "TokenStorageError";
  }
}
