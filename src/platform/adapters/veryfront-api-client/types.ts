/**
 * Veryfront API Client Types
 *
 * Re-exports types from schemas.ts and defines config/error types.
 */

export type {
  Environment,
  LookupDomainResponse,
  PageInfo,
  Project,
  ProjectFile,
} from "./schemas/index.ts";

export interface VeryfrontAPIConfig {
  apiBaseUrl: string;
  /** API token - optional in proxy mode where token comes per-request */
  apiToken?: string;
  /** Project slug - optional in proxy mode where slug comes per-request */
  projectSlug?: string;
  /** Project ID - if known, skips the listProjects lookup */
  projectId?: string;
  /** Enable proxy mode for multi-project per-request handling */
  proxyMode?: boolean;
  retry?: {
    maxRetries?: number;
    initialDelay?: number;
    maxDelay?: number;
  };
}

export class VeryfrontAPIError extends Error {
  public status?: number;
  public details?: unknown;

  constructor(message: string, status?: number, details?: unknown) {
    super(message);
    this.name = "VeryfrontAPIError";
    this.status = status;
    this.details = details;
  }
}
