import { defineSchema, lazySchema } from "#veryfront/schemas/index.ts";
import type { Schema } from "#veryfront/extensions/schema/index.ts";
import { NETWORK_ERROR } from "#veryfront/errors";

const DEFAULT_PROJECT_FILES_TIMEOUT_MS = 15_000;
const DEFAULT_PROJECT_FILES_PAGE_LIMIT = 100;

/** Project file returned by the runtime files API. */
export interface RuntimeProjectFile {
  /** Project-relative file path. */
  path: string;
  /** UTF-8 file contents. */
  content: string;
}

/** Project file entry returned by a runtime files listing. */
export interface RuntimeProjectFileListItem {
  /** Project-relative file path. */
  path: string;
}

/** Returns the runtime project file schema. */
export const getRuntimeProjectFileSchema: () => Schema<RuntimeProjectFile> = defineSchema((v) =>
  v.object({
    path: v.string(),
    content: v.string(),
  })
);

/** Returns the runtime project file list item schema. */
export const getRuntimeProjectFileListItemSchema: () => Schema<RuntimeProjectFileListItem> =
  defineSchema((v) =>
    v.object({
      path: v.string(),
    })
  );

const getRuntimeProjectFileListRestResponseSchema = defineSchema((v) =>
  v.object({
    data: v.array(getRuntimeProjectFileListItemSchema()),
    page_info: v.object({
      next: v.string().nullable(),
    }),
  })
);

const getApiErrorBodySchema = defineSchema((v) =>
  v.object({
    detail: v.string().optional(),
    message: v.string().optional(),
    error: v.string().optional(),
  }).passthrough()
);

/** Schema for runtime project file.
 * @deprecated Use getRuntimeProjectFileSchema()
 */
export const runtimeProjectFileSchema: Schema<RuntimeProjectFile> = lazySchema(
  getRuntimeProjectFileSchema,
);
/** Schema for runtime project file list item.
 * @deprecated Use getRuntimeProjectFileListItemSchema()
 */
export const runtimeProjectFileListItemSchema: Schema<RuntimeProjectFileListItem> = lazySchema(
  getRuntimeProjectFileListItemSchema,
);

/** Options accepted by runtime project files API. */
export type RuntimeProjectFilesApiOptions = {
  projectId: string;
  authToken: string;
  branchId?: string | null;
};

/** Options accepted by runtime get project file. */
export type RuntimeGetProjectFileOptions = RuntimeProjectFilesApiOptions & {
  path: string;
};

/** Public API contract for runtime project files fetch. */
export type RuntimeProjectFilesFetch = (url: string, init: RequestInit) => Promise<Response>;

/** Public API contract for runtime project files trace. */
export type RuntimeProjectFilesTrace = <T>(name: string, fn: () => Promise<T>) => Promise<T>;

/** Options accepted by runtime project files client. */
export type RuntimeProjectFilesClientOptions = {
  apiUrl: string | URL;
  fetch?: RuntimeProjectFilesFetch;
  timeoutMs?: number;
  pageLimit?: number;
  trace?: RuntimeProjectFilesTrace;
  createAccessDeniedError?: (statusCode: number, message: string) => Error;
};

/** Public API contract for runtime project files client. */
export type RuntimeProjectFilesClient = {
  getProjectFile: (options: RuntimeGetProjectFileOptions) => Promise<RuntimeProjectFile | null>;
  getProjectFiles: (
    options: RuntimeProjectFilesApiOptions,
  ) => Promise<RuntimeProjectFileListItem[]>;
};

/** Error shape for runtime project files API auth. */
export class RuntimeProjectFilesApiAuthError extends Error {
  /** Status code value. */
  readonly statusCode: number;
  /** Error code value. */
  readonly errorCode: string;

  /** Creates an instance with the supplied dependencies. */
  constructor(statusCode: number, message: string) {
    super(message);
    this.name = "RuntimeProjectFilesApiAuthError";
    this.statusCode = statusCode;
    this.errorCode = statusCode === 401 ? "UNAUTHENTICATED" : "FORBIDDEN";
  }
}

/** Create runtime project files client. */
export function createRuntimeProjectFilesClient(
  options: RuntimeProjectFilesClientOptions,
): RuntimeProjectFilesClient {
  return {
    getProjectFile: (input) => getRuntimeProjectFile({ ...options, ...input }),
    getProjectFiles: (input) => getRuntimeProjectFiles({ ...options, ...input }),
  };
}

/** Return runtime project file. */
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
      throw NETWORK_ERROR.create({
        detail:
          `Failed to fetch file ${options.path} for project ${options.projectId}: ${await readApiErrorMessage(
            response,
          )}`,
      });
    }

    const parsed = getRuntimeProjectFileSchema().safeParse(await response.json());
    if (!parsed.success) {
      throw NETWORK_ERROR.create({
        detail:
          `Failed to fetch file ${options.path} for project ${options.projectId}: invalid API response`,
      });
    }

    return parsed.data;
  });
}

/** Return runtime project files. */
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
        throw NETWORK_ERROR.create({
          detail:
            `Failed to fetch files for project ${options.projectId}: ${await readApiErrorMessage(
              response,
            )}`,
        });
      }

      const parsed = getRuntimeProjectFileListRestResponseSchema().safeParse(await response.json());
      if (!parsed.success) {
        throw NETWORK_ERROR.create({
          detail: `Failed to fetch files for project ${options.projectId}: invalid API response`,
        });
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

  let parsedJson: { success: true; data: { detail?: string; message?: string; error?: string } } | {
    success: false;
  };
  try {
    const jsonValue = JSON.parse(body);
    const result = getApiErrorBodySchema().safeParse(jsonValue);
    parsedJson = result.success ? { success: true, data: result.data } : { success: false };
  } catch {
    parsedJson = { success: false };
  }

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
