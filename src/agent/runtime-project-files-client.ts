import { z } from "zod";

const DEFAULT_PROJECT_FILES_TIMEOUT_MS = 15_000;
const DEFAULT_PROJECT_FILES_PAGE_LIMIT = 100;

export const runtimeProjectFileSchema = z.object({
  path: z.string(),
  content: z.string(),
});

export const runtimeProjectFileListItemSchema = z.object({
  path: z.string(),
});

const runtimeProjectFileListRestResponseSchema = z.object({
  data: z.array(runtimeProjectFileListItemSchema),
  page_info: z.object({
    next: z.string().nullable(),
  }),
});

const apiErrorBodySchema = z
  .object({
    detail: z.string().optional(),
    message: z.string().optional(),
    error: z.string().optional(),
  })
  .passthrough();

export type RuntimeProjectFile = z.infer<typeof runtimeProjectFileSchema>;
export type RuntimeProjectFileListItem = z.infer<typeof runtimeProjectFileListItemSchema>;

export type RuntimeProjectFilesApiOptions = {
  projectId: string;
  authToken: string;
  branchId?: string | null;
};

export type RuntimeGetProjectFileOptions = RuntimeProjectFilesApiOptions & {
  path: string;
};

export type RuntimeProjectFilesFetch = (url: string, init: RequestInit) => Promise<Response>;

export type RuntimeProjectFilesTrace = <T>(name: string, fn: () => Promise<T>) => Promise<T>;

export type RuntimeProjectFilesClientOptions = {
  apiUrl: string | URL;
  fetch?: RuntimeProjectFilesFetch;
  timeoutMs?: number;
  pageLimit?: number;
  trace?: RuntimeProjectFilesTrace;
  createAccessDeniedError?: (statusCode: number, message: string) => Error;
};

export type RuntimeProjectFilesClient = {
  getProjectFile: (options: RuntimeGetProjectFileOptions) => Promise<RuntimeProjectFile | null>;
  getProjectFiles: (
    options: RuntimeProjectFilesApiOptions,
  ) => Promise<RuntimeProjectFileListItem[]>;
};

export class RuntimeProjectFilesApiAuthError extends Error {
  readonly statusCode: number;
  readonly errorCode: string;

  constructor(statusCode: number, message: string) {
    super(message);
    this.name = "RuntimeProjectFilesApiAuthError";
    this.statusCode = statusCode;
    this.errorCode = statusCode === 401 ? "UNAUTHENTICATED" : "FORBIDDEN";
  }
}

export function createRuntimeProjectFilesClient(
  options: RuntimeProjectFilesClientOptions,
): RuntimeProjectFilesClient {
  return {
    getProjectFile: (input) => getRuntimeProjectFile({ ...options, ...input }),
    getProjectFiles: (input) => getRuntimeProjectFiles({ ...options, ...input }),
  };
}

export async function getRuntimeProjectFile(
  options: RuntimeProjectFilesClientOptions & RuntimeGetProjectFileOptions,
): Promise<RuntimeProjectFile | null> {
  return traceProjectFilesRequest(options, "runtimeProjectFiles.getProjectFile", async () => {
    const url = createRuntimeProjectFileUrl({
      ...options,
      fields: "(path,content)",
    });
    const response = await fetchRuntimeProjectFilesRestResponse(url, options);

    if (response.status === 404) {
      return null;
    }

    if (!response.ok) {
      throw new Error(
        `Failed to fetch file ${options.path} for project ${options.projectId}: ${await readApiErrorMessage(
          response,
        )}`,
      );
    }

    const parsed = runtimeProjectFileSchema.safeParse(await response.json());
    if (!parsed.success) {
      throw new Error(
        `Failed to fetch file ${options.path} for project ${options.projectId}: invalid API response`,
      );
    }

    return parsed.data;
  });
}

export async function getRuntimeProjectFiles(
  options: RuntimeProjectFilesClientOptions & RuntimeProjectFilesApiOptions,
): Promise<RuntimeProjectFileListItem[]> {
  return traceProjectFilesRequest(options, "runtimeProjectFiles.getProjectFiles", async () => {
    const files: RuntimeProjectFileListItem[] = [];
    let cursor: string | null = null;

    do {
      const url = createRuntimeProjectFileUrl({
        ...options,
        fields: "(path)",
        cursor,
      });
      const response = await fetchRuntimeProjectFilesRestResponse(url, options);

      if (!response.ok) {
        throw new Error(
          `Failed to fetch files for project ${options.projectId}: ${await readApiErrorMessage(
            response,
          )}`,
        );
      }

      const parsed = runtimeProjectFileListRestResponseSchema.safeParse(await response.json());
      if (!parsed.success) {
        throw new Error(
          `Failed to fetch files for project ${options.projectId}: invalid API response`,
        );
      }

      files.push(...parsed.data.data);
      cursor = parsed.data.page_info.next;
    } while (cursor);

    return files;
  });
}

function createRuntimeProjectFileUrl(input: {
  apiUrl: string | URL;
  projectId: string;
  path?: string;
  branchId?: string | null;
  fields: string;
  cursor?: string | null;
  pageLimit?: number;
}): URL {
  const apiUrl = new URL(input.apiUrl);
  const encodedProjectId = encodeURIComponent(input.projectId);
  const pathname = input.path
    ? `/projects/${encodedProjectId}/files/${encodeURIComponent(input.path)}`
    : `/projects/${encodedProjectId}/files`;
  const url = new URL(pathname, apiUrl.origin);

  url.searchParams.set("fields", input.fields);
  if (input.branchId) {
    url.searchParams.set("branch", input.branchId);
  }
  if (input.cursor) {
    url.searchParams.set("cursor", input.cursor);
  }
  if (!input.path) {
    url.searchParams.set("limit", String(input.pageLimit ?? DEFAULT_PROJECT_FILES_PAGE_LIMIT));
  }

  return url;
}

async function fetchRuntimeProjectFilesRestResponse(
  url: URL,
  options: RuntimeProjectFilesClientOptions & { authToken: string },
): Promise<Response> {
  const response = await (options.fetch ?? fetch)(url.toString(), {
    headers: {
      Authorization: `Bearer ${options.authToken}`,
    },
    signal: AbortSignal.timeout(options.timeoutMs ?? DEFAULT_PROJECT_FILES_TIMEOUT_MS),
  });

  if (response.status === 401 || response.status === 403) {
    throw createProjectFilesAccessDeniedError(options, response.status);
  }

  return response;
}

function createProjectFilesAccessDeniedError(
  options: RuntimeProjectFilesClientOptions,
  statusCode: number,
): Error {
  const message = "Access denied to project files API";
  return options.createAccessDeniedError?.(statusCode, message) ??
    new RuntimeProjectFilesApiAuthError(statusCode, message);
}

async function readApiErrorMessage(response: Response): Promise<string> {
  const body = await response.text().catch(() => "");
  if (!body.trim()) {
    return response.statusText || `HTTP ${response.status}`;
  }

  const parsedJson = z
    .string()
    .transform((value, ctx) => {
      try {
        return JSON.parse(value);
      } catch {
        ctx.addIssue({ code: "custom", message: "Invalid JSON" });
        return z.NEVER;
      }
    })
    .pipe(apiErrorBodySchema)
    .safeParse(body);

  if (parsedJson.success) {
    return parsedJson.data.detail ?? parsedJson.data.message ?? parsedJson.data.error ?? body;
  }

  return body;
}

function traceProjectFilesRequest<T>(
  options: RuntimeProjectFilesClientOptions,
  name: string,
  fn: () => Promise<T>,
): Promise<T> {
  return options.trace ? options.trace(name, fn) : fn();
}
