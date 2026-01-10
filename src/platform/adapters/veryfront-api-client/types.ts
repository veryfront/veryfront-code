/**
 * Veryfront API Client Types
 *
 * Re-exports types from schemas.ts and defines config/error types.
 */

// Re-export all types from schemas
export type {
  GetComponentResponse,
  GetFileContentResponse,
  GetProjectResponse,
  GetPublishedFileContentResponse,
  ListFilesResponse,
  ListProjectsResponse,
  ListPublishedFilesResponse,
  LookupDomainResponse,
  Pagination,
  Project,
  ProjectFile,
} from "./schemas.ts";

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
  constructor(
    message: string,
    public status?: number,
    public details?: unknown,
  ) {
    super(message);
    this.name = "VeryfrontAPIError";
  }
}
