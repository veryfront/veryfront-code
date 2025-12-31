export interface VeryfrontAPIConfig {
  apiBaseUrl: string;

  /** API token - optional in proxy mode where token comes per-request */
  apiToken?: string;

  /** Project slug - optional in proxy mode where slug comes per-request */
  projectSlug?: string;

  /** Enable proxy mode for multi-project per-request handling */
  proxyMode?: boolean;

  retry?: {
    maxRetries?: number;
    initialDelay?: number;
    maxDelay?: number;
  };
}

export interface Project {
  id: string;
  name: string;
  slug: string;
  description?: string;
  createdAt: string;
  updatedAt: string;
  provider?: string;
  layout?: string;
  config?: string;
}

export interface ProjectFile {
  id?: string; // Entity UUID - available when fetched from veryfront-api
  path: string;
  size: number;
  type: string;
  mimeType?: string;
  createdAt: string;
  updatedAt: string;
}

export interface ListFilesResponse {
  data: ProjectFile[];
  pagination?: {
    cursor?: string;
    hasMore: boolean;
  };
}

export interface ListProjectsResponse {
  data: Project[];
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
