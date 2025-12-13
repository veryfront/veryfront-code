export interface VeryfrontAPIConfig {
  apiBaseUrl: string;

  apiToken: string;

  projectSlug: string;

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
  path: string;
  size: number;
  type: string;
  mimeType?: string;
  createdAt: string;
  updatedAt: string;
}

export interface ListFilesResponse {
  data: ProjectFile[];
  pageInfo?: {
    hasNextPage: boolean;
    nextCursor?: string | null;
    hasPreviousPage: boolean;
    previousCursor?: string | null;
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
