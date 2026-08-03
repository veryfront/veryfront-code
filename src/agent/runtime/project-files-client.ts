import { defineSchema, lazySchema } from "#veryfront/schemas/index.ts";
import type { InferSchema } from "#veryfront/extensions/schema/index.ts";
import { NETWORK_ERROR } from "#veryfront/errors";
import {
  SKILL_PATH_SEGMENT_MAX_LENGTH,
  SKILL_TEXT_FILE_MAX_BYTES,
} from "#veryfront/skill/limits.ts";
import {
  hasControlCharacters,
  isUtf8WithinByteLimit,
  isWellFormedUtf16,
} from "#veryfront/skill/string-safety.ts";

const DEFAULT_PROJECT_FILES_TIMEOUT_MS = 15_000;
const DEFAULT_PROJECT_FILES_PAGE_LIMIT = 100;
const PROJECT_FILE_JSON_OVERHEAD_BYTES = 65_536;
const PROJECT_FILE_PATH_MAX_CHARACTERS = 4_096;
const PROJECT_FILE_CURSOR_MAX_CHARACTERS = 4_096;
const PROJECT_FILE_LIST_MAX_PAGES = 50;
const PROJECT_FILE_LIST_TOTAL_MAX_BYTES = 16 * 1_048_576;
const PROJECT_FILE_LIST_PAGE_MAX_BYTES =
  DEFAULT_PROJECT_FILES_PAGE_LIMIT * PROJECT_FILE_PATH_MAX_CHARACTERS * 6 +
  PROJECT_FILE_JSON_OVERHEAD_BYTES;
const PROJECT_FILE_RESPONSE_BLOCK_BYTES = 65_536;
const PROJECT_FILE_RESPONSE_YIELD_CHUNKS = 256;
const PROJECT_FILE_RESPONSE_MAX_CONSECUTIVE_EMPTY_CHUNKS = 4_096;
const utf8Decoder = new TextDecoder("utf-8", { fatal: true });
const utf8Encoder = new TextEncoder();
const WINDOWS_DRIVE_PATH_REGEX = /^[A-Za-z]:\//;

/** Maximum aggregate file records retained by one project listing. */
export const MAX_RUNTIME_PROJECT_FILES_TOTAL_ITEMS = PROJECT_FILE_LIST_MAX_PAGES *
  DEFAULT_PROJECT_FILES_PAGE_LIMIT;

/** Whether a value is a canonical, bounded project-relative file path. */
export function isRuntimeProjectFilePath(path: unknown): path is string {
  if (
    typeof path !== "string" ||
    path.length === 0 ||
    path.length > PROJECT_FILE_PATH_MAX_CHARACTERS ||
    !isWellFormedUtf16(path) ||
    hasControlCharacters(path) ||
    path.startsWith("/") ||
    path.includes("\\") ||
    WINDOWS_DRIVE_PATH_REGEX.test(path)
  ) {
    return false;
  }
  return path.split("/").every((segment) =>
    segment.length > 0 &&
    segment.length <= SKILL_PATH_SEGMENT_MAX_LENGTH &&
    segment !== "." &&
    segment !== ".."
  );
}

/** Whether a value fits the shared runtime Skill text-file budget. */
export function isRuntimeProjectFileContent(content: unknown): content is string {
  return typeof content === "string" &&
    content.length <= SKILL_TEXT_FILE_MAX_BYTES &&
    isWellFormedUtf16(content) &&
    isUtf8WithinByteLimit(content, SKILL_TEXT_FILE_MAX_BYTES);
}

export const getRuntimeProjectFileSchema = defineSchema((v) =>
  v.object({
    path: v.string(),
    content: v.string(),
  })
);

export const getRuntimeProjectFileListItemSchema = defineSchema((v) =>
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
export const runtimeProjectFileSchema = lazySchema(getRuntimeProjectFileSchema);
/** Schema for runtime project file list item.
 * @deprecated Use getRuntimeProjectFileListItemSchema()
 */
export const runtimeProjectFileListItemSchema = lazySchema(getRuntimeProjectFileListItemSchema);

/** Public API contract for runtime project file. */
export type RuntimeProjectFile = InferSchema<ReturnType<typeof getRuntimeProjectFileSchema>>;
/** Public API contract for runtime project file list item. */
export type RuntimeProjectFileListItem = InferSchema<
  ReturnType<typeof getRuntimeProjectFileListItemSchema>
>;

/** Options accepted by runtime project files API. */
export type RuntimeProjectFilesApiOptions = {
  projectId: string;
  authToken: string;
  branchId?: string | null;
  /** Stop pagination before retaining more than this many entries. */
  maximumEntries?: number;
  /** Restrict the API listing to this bounded server-side path prefix. */
  pathPrefix?: string;
  /** Shared bounded-listing budget used when one catalog spans several prefixes. */
  listingBudget?: RuntimeProjectFileListingBudget;
  /** Cooperatively cancel all requests and body reads in this listing. */
  abortSignal?: AbortSignal;
  /** Bound the complete request/pagination operation. */
  timeoutMs?: number;
};

/** Options accepted by runtime get project file. */
export type RuntimeGetProjectFileOptions = RuntimeProjectFilesApiOptions & {
  path: string;
  /** Reject returned text content above this character count. */
  maximumContentCharacters?: number;
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

/** Opaque cumulative budget shared by related project-file listings. */
export type RuntimeProjectFileListingBudget = {
  consumePage(): void;
  consumeBytes(byteCount: number): void;
};

/** Create a cumulative project-file listing budget. */
export function createRuntimeProjectFileListingBudget(): RuntimeProjectFileListingBudget {
  let pages = 0;
  let bytes = 0;
  return Object.freeze({
    consumePage(): void {
      pages += 1;
      if (pages > PROJECT_FILE_LIST_MAX_PAGES) {
        throw new RangeError(
          `Project file listing may contain at most ${PROJECT_FILE_LIST_MAX_PAGES} pages`,
        );
      }
    },
    consumeBytes(byteCount: number): void {
      bytes += byteCount;
      if (bytes > PROJECT_FILE_LIST_TOTAL_MAX_BYTES) {
        throw new RangeError(
          `Project file listing responses may contain at most ${PROJECT_FILE_LIST_TOTAL_MAX_BYTES} bytes`,
        );
      }
    },
  });
}

/** Error shape for runtime project files API auth. */
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

/** Create runtime project files client. */
export function createRuntimeProjectFilesClient(
  options: RuntimeProjectFilesClientOptions,
): RuntimeProjectFilesClient {
  // Snapshot the trusted transport configuration. Callers can pass plain
  // JavaScript objects at runtime, so spreading request input into this scope
  // would let excess properties replace the configured origin or transport.
  const apiUrl = new URL(options.apiUrl).toString();
  const configuredTimeoutMs = options.timeoutMs;
  const configuredFetch = options.fetch;
  const configuredPageLimit = options.pageLimit;
  const configuredTrace = options.trace;
  const configuredAccessDeniedErrorFactory = options.createAccessDeniedError;

  return Object.freeze({
    getProjectFile: (input) =>
      getRuntimeProjectFile({
        apiUrl,
        fetch: configuredFetch,
        pageLimit: configuredPageLimit,
        trace: configuredTrace,
        createAccessDeniedError: configuredAccessDeniedErrorFactory,
        projectId: input.projectId,
        authToken: input.authToken,
        branchId: input.branchId,
        maximumEntries: input.maximumEntries,
        pathPrefix: input.pathPrefix,
        listingBudget: input.listingBudget,
        abortSignal: input.abortSignal,
        timeoutMs: input.timeoutMs ?? configuredTimeoutMs,
        path: input.path,
        maximumContentCharacters: input.maximumContentCharacters,
      }),
    getProjectFiles: (input) =>
      getRuntimeProjectFiles({
        apiUrl,
        fetch: configuredFetch,
        pageLimit: configuredPageLimit,
        trace: configuredTrace,
        createAccessDeniedError: configuredAccessDeniedErrorFactory,
        projectId: input.projectId,
        authToken: input.authToken,
        branchId: input.branchId,
        maximumEntries: input.maximumEntries,
        pathPrefix: input.pathPrefix,
        listingBudget: input.listingBudget,
        abortSignal: input.abortSignal,
        timeoutMs: input.timeoutMs ?? configuredTimeoutMs,
      }),
  });
}

/** Return runtime project file. */
export async function getRuntimeProjectFile(
  options: RuntimeProjectFilesClientOptions & RuntimeGetProjectFileOptions,
): Promise<RuntimeProjectFile | null> {
  if (
    options.maximumContentCharacters !== undefined &&
    (!Number.isSafeInteger(options.maximumContentCharacters) ||
      options.maximumContentCharacters <= 0 ||
      options.maximumContentCharacters >
        Math.floor((Number.MAX_SAFE_INTEGER - PROJECT_FILE_JSON_OVERHEAD_BYTES) / 6))
  ) {
    throw new RangeError(
      "Project file maximumContentCharacters must be a positive bounded safe integer",
    );
  }
  return withRuntimeProjectFilesRequestSignal(
    options,
    (signal) =>
      traceProjectFilesRequest(options, "runtimeProjectFiles.getProjectFile", async () => {
        const url = createRuntimeProjectFileUrl({
          ...options,
          fields: "(path,content)",
        });
        const response = await fetchRuntimeProjectFilesRestResponse(url, options, signal);

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

        const responseValue = options.maximumContentCharacters === undefined
          ? await response.json()
          : await readJsonResponseWithinLimit(
            response,
            options.maximumContentCharacters * 6 + PROJECT_FILE_JSON_OVERHEAD_BYTES,
            signal,
          );
        const parsed = getRuntimeProjectFileSchema().safeParse(responseValue);
        if (!parsed.success) {
          throw NETWORK_ERROR.create({
            detail:
              `Failed to fetch file ${options.path} for project ${options.projectId}: invalid API response`,
          });
        }

        if (
          options.maximumContentCharacters !== undefined &&
          parsed.data.content.length > options.maximumContentCharacters
        ) {
          throw new RangeError(
            `Project file content may contain at most ${options.maximumContentCharacters} characters`,
          );
        }
        return parsed.data;
      }),
  );
}

async function readJsonResponseWithinLimit(
  response: Response,
  byteLimit: number,
  abortSignal?: AbortSignal,
  listingBudget?: RuntimeProjectFileListingBudget,
): Promise<unknown> {
  throwIfAborted(abortSignal);
  const declaredLength = response.headers.get("content-length");
  if (declaredLength !== null) {
    const length = Number(declaredLength);
    if (Number.isFinite(length) && length > byteLimit) {
      throw new RangeError(`Project file response may contain at most ${byteLimit} bytes`);
    }
  }
  if (!response.body) {
    const text = await response.text();
    throwIfAborted(abortSignal);
    const byteLength = utf8Encoder.encode(text).byteLength;
    listingBudget?.consumeBytes(byteLength);
    if (byteLength > byteLimit) {
      throw new RangeError(`Project file response may contain at most ${byteLimit} bytes`);
    }
    return JSON.parse(text);
  }

  const reader = response.body.getReader();
  const blocks: Uint8Array[] = [];
  let total = 0;
  let currentBlock: Uint8Array | undefined;
  let currentBlockLength = 0;
  let chunksSinceYield = 0;
  let consecutiveEmptyChunks = 0;
  const abortBodyRead = () => {
    void reader.cancel(abortSignal?.reason).catch(() => undefined);
  };
  abortSignal?.addEventListener("abort", abortBodyRead, { once: true });
  try {
    while (true) {
      const result = await reader.read();
      throwIfAborted(abortSignal);
      if (result.done) break;

      const chunk = result.value;
      if (chunk.byteLength === 0) {
        consecutiveEmptyChunks += 1;
        if (consecutiveEmptyChunks > PROJECT_FILE_RESPONSE_MAX_CONSECUTIVE_EMPTY_CHUNKS) {
          throw new RangeError("Project file response stream made no byte progress");
        }
      } else {
        consecutiveEmptyChunks = 0;
      }

      total += chunk.byteLength;
      listingBudget?.consumeBytes(chunk.byteLength);
      if (total > byteLimit) {
        throw new RangeError(`Project file response may contain at most ${byteLimit} bytes`);
      }

      let chunkOffset = 0;
      while (chunkOffset < chunk.byteLength) {
        if (!currentBlock) {
          currentBlock = new Uint8Array(
            Math.min(PROJECT_FILE_RESPONSE_BLOCK_BYTES, byteLimit),
          );
          currentBlockLength = 0;
        }
        const copied = Math.min(
          currentBlock.byteLength - currentBlockLength,
          chunk.byteLength - chunkOffset,
        );
        currentBlock.set(chunk.subarray(chunkOffset, chunkOffset + copied), currentBlockLength);
        currentBlockLength += copied;
        chunkOffset += copied;
        if (currentBlockLength === currentBlock.byteLength) {
          blocks.push(currentBlock);
          currentBlock = undefined;
          currentBlockLength = 0;
        }
      }

      chunksSinceYield += 1;
      if (chunksSinceYield >= PROJECT_FILE_RESPONSE_YIELD_CHUNKS) {
        chunksSinceYield = 0;
        await new Promise<void>((resolve) => setTimeout(resolve, 0));
        throwIfAborted(abortSignal);
      }
    }
  } catch (error) {
    void reader.cancel(error).catch(() => undefined);
    throw error;
  } finally {
    abortSignal?.removeEventListener("abort", abortBodyRead);
    reader.releaseLock();
  }

  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const block of blocks) {
    bytes.set(block, offset);
    offset += block.byteLength;
  }
  if (currentBlock && currentBlockLength > 0) {
    bytes.set(currentBlock.subarray(0, currentBlockLength), offset);
  }
  return JSON.parse(utf8Decoder.decode(bytes));
}

/** Return runtime project files. */
export async function getRuntimeProjectFiles(
  options: RuntimeProjectFilesClientOptions & RuntimeProjectFilesApiOptions,
): Promise<RuntimeProjectFileListItem[]> {
  if (
    options.maximumEntries !== undefined &&
    (!Number.isSafeInteger(options.maximumEntries) || options.maximumEntries <= 0)
  ) {
    throw new RangeError("Project file maximumEntries must be a positive safe integer");
  }
  if (
    options.pathPrefix !== undefined &&
    (options.pathPrefix.length === 0 ||
      options.pathPrefix.length > PROJECT_FILE_PATH_MAX_CHARACTERS ||
      options.pathPrefix.startsWith("/") || options.pathPrefix.endsWith("/") ||
      options.pathPrefix.includes("\\") || options.pathPrefix.includes("\0") ||
      options.pathPrefix.split("/").some((segment) =>
        segment.length === 0 || segment === "." || segment === ".."
      ))
  ) {
    throw new RangeError(
      `Project file list path must contain between 1 and ${PROJECT_FILE_PATH_MAX_CHARACTERS} characters`,
    );
  }
  return withRuntimeProjectFilesRequestSignal(
    options,
    (signal) =>
      traceProjectFilesRequest(options, "runtimeProjectFiles.getProjectFiles", async () => {
        const files: RuntimeProjectFileListItem[] = [];
        const listingBudget = options.listingBudget ?? createRuntimeProjectFileListingBudget();
        const seenCursors = new Set<string>();
        let cursor: string | null = null;

        do {
          throwIfAborted(signal);
          listingBudget.consumePage();
          const url = createRuntimeProjectFileUrl({
            ...options,
            fields: "(path)",
            cursor,
          });
          const response = await fetchRuntimeProjectFilesRestResponse(url, options, signal);
          throwIfAborted(signal);

          if (!response.ok) {
            throw NETWORK_ERROR.create({
              detail:
                `Failed to fetch files for project ${options.projectId}: ${await readApiErrorMessage(
                  response,
                )}`,
            });
          }

          const parsed = getRuntimeProjectFileListRestResponseSchema().safeParse(
            await readJsonResponseWithinLimit(
              response,
              PROJECT_FILE_LIST_PAGE_MAX_BYTES,
              signal,
              listingBudget,
            ),
          );
          if (!parsed.success) {
            throw NETWORK_ERROR.create({
              detail:
                `Failed to fetch files for project ${options.projectId}: invalid API response`,
            });
          }

          for (const file of parsed.data.data) {
            if (file.path.length > PROJECT_FILE_PATH_MAX_CHARACTERS) {
              throw new RangeError(
                `Project file paths may contain at most ${PROJECT_FILE_PATH_MAX_CHARACTERS} characters`,
              );
            }
          }
          if (
            parsed.data.page_info.next !== null &&
            parsed.data.page_info.next.length > PROJECT_FILE_CURSOR_MAX_CHARACTERS
          ) {
            throw new RangeError(
              `Project file cursors may contain at most ${PROJECT_FILE_CURSOR_MAX_CHARACTERS} characters`,
            );
          }

          if (
            options.maximumEntries !== undefined &&
            files.length + parsed.data.data.length > options.maximumEntries
          ) {
            throw new RangeError(
              `Project file listing may contain at most ${options.maximumEntries} entries`,
            );
          }
          files.push(...parsed.data.data);
          cursor = parsed.data.page_info.next;
          if (cursor !== null && seenCursors.has(cursor)) {
            throw new RangeError("Project file listing returned a repeated pagination cursor");
          }
          if (cursor !== null) seenCursors.add(cursor);
        } while (cursor);

        return files;
      }),
  );
}

function createRuntimeProjectFileUrl(input: {
  apiUrl: string | URL;
  projectId: string;
  path?: string;
  branchId?: string | null;
  fields: string;
  cursor?: string | null;
  pageLimit?: number;
  pathPrefix?: string;
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
  if (input.pathPrefix) {
    url.searchParams.set("path", input.pathPrefix);
  }
  if (!input.path) {
    url.searchParams.set("limit", String(input.pageLimit ?? DEFAULT_PROJECT_FILES_PAGE_LIMIT));
  }

  return url;
}

async function fetchRuntimeProjectFilesRestResponse(
  url: URL,
  options: RuntimeProjectFilesClientOptions & { authToken: string },
  signal: AbortSignal,
): Promise<Response> {
  const response = await (options.fetch ?? fetch)(url.toString(), {
    headers: {
      Authorization: `Bearer ${options.authToken}`,
    },
    signal,
  });

  if (response.status === 401 || response.status === 403) {
    throw createProjectFilesAccessDeniedError(options, response.status);
  }

  return response;
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (!signal?.aborted) return;
  throw signal.reason ?? new DOMException("The operation was aborted", "AbortError");
}

async function withRuntimeProjectFilesRequestSignal<T>(
  options: RuntimeProjectFilesClientOptions & { abortSignal?: AbortSignal },
  fn: (signal: AbortSignal) => Promise<T>,
): Promise<T> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_PROJECT_FILES_TIMEOUT_MS;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0) {
    throw new RangeError("Project files timeoutMs must be a positive safe integer");
  }
  const controller = new AbortController();
  const externalSignal = options.abortSignal;
  const abortFromExternal = () => controller.abort(externalSignal?.reason);
  if (externalSignal) {
    externalSignal.addEventListener("abort", abortFromExternal, { once: true });
    if (externalSignal.aborted) abortFromExternal();
  }
  const timeoutId = setTimeout(
    () => controller.abort(new DOMException("The operation timed out", "TimeoutError")),
    timeoutMs,
  );
  try {
    throwIfAborted(controller.signal);
    const result = await fn(controller.signal);
    throwIfAborted(controller.signal);
    return result;
  } finally {
    clearTimeout(timeoutId);
    externalSignal?.removeEventListener("abort", abortFromExternal);
  }
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
