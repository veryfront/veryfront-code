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
import {
  addAbortSignalListenerOnce,
  getAbortSignalReason,
  isAbortSignalAborted,
  isAbortSignalWithoutHooks,
  removeAbortSignalListener,
} from "#veryfront/platform/compat/abort-signal.ts";

const DEFAULT_PROJECT_FILES_TIMEOUT_MS = 15_000;
const DEFAULT_PROJECT_FILES_PAGE_LIMIT = 100;
const DEFAULT_PROJECT_FILES_OPERATION_TIMEOUT_MS = 300_000;
const MAX_PROJECT_FILES_TIMEOUT_MS = 300_000;
const MAX_PROJECT_FILES_OPERATION_TIMEOUT_MS = 300_000;
const MAX_PROJECT_FILES_PAGE_LIMIT = 100;

// Project paths and pagination cursors cross a remote trust boundary and are
// retained in memory by the hosted Skill catalog.
const MAX_PROJECT_FILE_PATH_CHARACTERS = 4_096;
const MAX_PROJECT_FILES_CURSOR_CHARACTERS = 4_096;
const MAX_PROJECT_FILES_PER_PAGE = MAX_PROJECT_FILES_PAGE_LIMIT;
/** Maximum aggregate file records returned by one project listing. */
export const MAX_RUNTIME_PROJECT_FILES_TOTAL_ITEMS = 10_000;
// Defense-in-depth for internal callers that supply a shared/custom listing
// budget. The public default budget intentionally imposes the tighter 50-page
// aggregate cap across all related listings.
const MAX_PROJECT_FILES_TOTAL_PAGES = 200;
const MAX_PROJECT_FILES_API_URL_CHARACTERS = 8_192;
const MAX_PROJECT_FILES_IDENTIFIER_CHARACTERS = 256;
const MAX_PROJECT_FILES_AUTH_TOKEN_CHARACTERS = 16_384;

// JSON can expand one decoded byte to six ASCII bytes (for example "\u0000").
// These budgets therefore admit every valid 1 MiB file plus bounded path and
// envelope overhead without permitting an unbounded transport allocation.
const MAX_JSON_ESCAPE_BYTES_PER_DECODED_BYTE = 6;
const PROJECT_FILES_JSON_ENVELOPE_BYTES = 64 * 1_024;
const MAX_PROJECT_FILE_RESPONSE_BYTES =
  (SKILL_TEXT_FILE_MAX_BYTES + MAX_PROJECT_FILE_PATH_CHARACTERS) *
    MAX_JSON_ESCAPE_BYTES_PER_DECODED_BYTE +
  PROJECT_FILES_JSON_ENVELOPE_BYTES;
const MAX_PROJECT_FILE_LIST_PAGE_BYTES =
  (MAX_PROJECT_FILES_PER_PAGE * MAX_PROJECT_FILE_PATH_CHARACTERS +
      MAX_PROJECT_FILES_CURSOR_CHARACTERS) *
    MAX_JSON_ESCAPE_BYTES_PER_DECODED_BYTE +
  PROJECT_FILES_JSON_ENVELOPE_BYTES;
const MAX_PROJECT_FILES_ERROR_BODY_BYTES = 64 * 1_024;
const MAX_PROJECT_FILES_ERROR_MESSAGE_CHARACTERS = 4_096;
const WINDOWS_DRIVE_PATH_REGEX = /^[A-Za-z]:\//;

// Established public-client limits. The strict hosted client below adds a
// narrower trust-boundary contract without weakening these public safeguards.
const PUBLIC_PROJECT_FILE_JSON_OVERHEAD_BYTES = 65_536;
const PUBLIC_PROJECT_FILE_LIST_MAX_PAGES = 50;
const PUBLIC_PROJECT_FILE_LIST_TOTAL_MAX_BYTES = 16 * 1_048_576;
const PUBLIC_PROJECT_FILE_LIST_PAGE_MAX_BYTES =
  DEFAULT_PROJECT_FILES_PAGE_LIMIT * MAX_PROJECT_FILE_PATH_CHARACTERS * 6 +
  PUBLIC_PROJECT_FILE_JSON_OVERHEAD_BYTES;
const PUBLIC_PROJECT_FILE_RESPONSE_BLOCK_BYTES = 65_536;
const PUBLIC_PROJECT_FILE_RESPONSE_YIELD_CHUNKS = 256;
const PUBLIC_PROJECT_FILE_RESPONSE_MAX_CONSECUTIVE_EMPTY_CHUNKS = 4_096;
const publicProjectFileUtf8Decoder = new TextDecoder("utf-8", { fatal: true });
const publicProjectFileUtf8Encoder = new TextEncoder();

/** Whether a value is a canonical project-relative file path. */
export function isRuntimeProjectFilePath(path: unknown): path is string {
  if (
    typeof path !== "string" ||
    path.length === 0 ||
    path.length > MAX_PROJECT_FILE_PATH_CHARACTERS ||
    !isWellFormedUtf16(path) ||
    hasControlCharacters(path) ||
    path.startsWith("/") ||
    path.includes("\\") ||
    WINDOWS_DRIVE_PATH_REGEX.test(path)
  ) {
    return false;
  }
  const segments = path.split("/");
  return segments.every((segment) =>
    segment.length > 0 &&
    segment.length <= SKILL_PATH_SEGMENT_MAX_LENGTH &&
    segment !== "." &&
    segment !== ".."
  );
}

const getStrictRuntimeProjectFilePathSchema = defineSchema((v) =>
  v.string().min(1).max(MAX_PROJECT_FILE_PATH_CHARACTERS)
    .refine(isWellFormedUtf16, "Project file path must contain well-formed UTF-16")
    .refine(
      (path) => !hasControlCharacters(path),
      "Project file path must not contain control characters",
    )
    .refine(
      isRuntimeProjectFilePath,
      "Project file path must be a canonical project-relative path",
    )
);

const getStrictRuntimeProjectFilesCursorSchema = defineSchema((v) =>
  v.string().min(1).max(MAX_PROJECT_FILES_CURSOR_CHARACTERS)
    .refine(isWellFormedUtf16, "Project files cursor must contain well-formed UTF-16")
    .refine(
      (cursor) => !hasControlCharacters(cursor),
      "Project files cursor must not contain control characters",
    )
);

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

/** Strict hosted-boundary schema for a runtime project file. */
export const getStrictRuntimeProjectFileSchema = defineSchema((v) =>
  v.object({
    path: getStrictRuntimeProjectFilePathSchema(),
    content: v.string(),
  })
);

/** Strict hosted-boundary schema for a runtime project file list item. */
export const getStrictRuntimeProjectFileListItemSchema = defineSchema((v) =>
  v.object({
    path: getStrictRuntimeProjectFilePathSchema(),
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

const getStrictRuntimeProjectFileListRestResponseSchema = defineSchema((v) =>
  v.object({
    data: v.array(getStrictRuntimeProjectFileListItemSchema()).max(MAX_PROJECT_FILES_PER_PAGE),
    page_info: v.object({
      next: getStrictRuntimeProjectFilesCursorSchema().nullable(),
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

const getStrictApiErrorBodySchema = defineSchema((v) =>
  v.object({
    detail: v.string().max(MAX_PROJECT_FILES_ERROR_MESSAGE_CHARACTERS).optional(),
    message: v.string().max(MAX_PROJECT_FILES_ERROR_MESSAGE_CHARACTERS).optional(),
    error: v.string().max(MAX_PROJECT_FILES_ERROR_MESSAGE_CHARACTERS).optional(),
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

/** Internal options for fail-closed hosted project-file reads. */
export type StrictRuntimeProjectFilesClientOptions = RuntimeProjectFilesClientOptions & {
  /** Aggregate listing timeout, capped at five minutes. */
  operationTimeoutMs?: number;
};

/** Internal per-call context for fail-closed hosted project-file reads. */
type StrictRuntimeProjectFilesRequestContext = {
  /** Caller cancellation composed with request and aggregate deadlines. */
  signal?: AbortSignal;
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
      if (pages > PUBLIC_PROJECT_FILE_LIST_MAX_PAGES) {
        throw new RangeError(
          `Project file listing may contain at most ${PUBLIC_PROJECT_FILE_LIST_MAX_PAGES} pages`,
        );
      }
    },
    consumeBytes(byteCount: number): void {
      bytes += byteCount;
      if (bytes > PUBLIC_PROJECT_FILE_LIST_TOTAL_MAX_BYTES) {
        throw new RangeError(
          `Project file listing responses may contain at most ${PUBLIC_PROJECT_FILE_LIST_TOTAL_MAX_BYTES} bytes`,
        );
      }
    },
  });
}

/** Internal client contract that accepts request-scoped cancellation. */
type StrictRuntimeProjectFilesClient = {
  getProjectFile: (
    options: RuntimeGetProjectFileOptions & StrictRuntimeProjectFilesRequestContext,
  ) => Promise<RuntimeProjectFile | null>;
  getProjectFiles: (
    options: RuntimeProjectFilesApiOptions & StrictRuntimeProjectFilesRequestContext,
  ) => Promise<RuntimeProjectFileListItem[]>;
};

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
  // Snapshot trusted transport configuration. Untyped JavaScript callers can
  // supply excess request properties, so request input must never replace the
  // configured origin, fetch implementation, or access-denied factory.
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

/**
 * Create a runtime project files client that enforces hosted trust-boundary
 * validation and resource limits.
 */
export function createStrictRuntimeProjectFilesClient(
  options: StrictRuntimeProjectFilesClientOptions,
): StrictRuntimeProjectFilesClient {
  const clientOptions = normalizeRuntimeProjectFilesClientOptions(options);
  return {
    getProjectFile: (input) =>
      getStrictRuntimeProjectFile({
        ...clientOptions,
        projectId: input.projectId,
        authToken: input.authToken,
        branchId: input.branchId,
        maximumEntries: input.maximumEntries,
        pathPrefix: input.pathPrefix,
        listingBudget: input.listingBudget,
        abortSignal: input.abortSignal,
        signal: input.signal,
        timeoutMs: input.timeoutMs ?? clientOptions.timeoutMs,
        path: input.path,
        maximumContentCharacters: input.maximumContentCharacters,
      }),
    getProjectFiles: (input) =>
      getStrictRuntimeProjectFiles({
        ...clientOptions,
        projectId: input.projectId,
        authToken: input.authToken,
        branchId: input.branchId,
        maximumEntries: input.maximumEntries,
        pathPrefix: input.pathPrefix,
        listingBudget: input.listingBudget,
        abortSignal: input.abortSignal,
        signal: input.signal,
        timeoutMs: input.timeoutMs ?? clientOptions.timeoutMs,
      }),
  };
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
        Math.floor((Number.MAX_SAFE_INTEGER - PUBLIC_PROJECT_FILE_JSON_OVERHEAD_BYTES) / 6))
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
          : await readPublicJsonResponseWithinLimit(
            response,
            options.maximumContentCharacters * 6 + PUBLIC_PROJECT_FILE_JSON_OVERHEAD_BYTES,
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

async function readPublicJsonResponseWithinLimit(
  response: Response,
  byteLimit: number,
  abortSignal?: AbortSignal,
  listingBudget?: RuntimeProjectFileListingBudget,
): Promise<unknown> {
  throwIfRuntimeProjectFilesAborted(abortSignal);
  const declaredLength = response.headers.get("content-length");
  if (declaredLength !== null) {
    const length = Number(declaredLength);
    if (Number.isFinite(length) && length > byteLimit) {
      throw new RangeError(`Project file response may contain at most ${byteLimit} bytes`);
    }
  }
  if (!response.body) {
    const text = await response.text();
    throwIfRuntimeProjectFilesAborted(abortSignal);
    const byteLength = publicProjectFileUtf8Encoder.encode(text).byteLength;
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
      throwIfRuntimeProjectFilesAborted(abortSignal);
      if (result.done) break;

      const chunk = result.value;
      if (chunk.byteLength === 0) {
        consecutiveEmptyChunks += 1;
        if (
          consecutiveEmptyChunks >
            PUBLIC_PROJECT_FILE_RESPONSE_MAX_CONSECUTIVE_EMPTY_CHUNKS
        ) {
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
            Math.min(PUBLIC_PROJECT_FILE_RESPONSE_BLOCK_BYTES, byteLimit),
          );
          currentBlockLength = 0;
        }
        const copied = Math.min(
          currentBlock.byteLength - currentBlockLength,
          chunk.byteLength - chunkOffset,
        );
        currentBlock.set(
          chunk.subarray(chunkOffset, chunkOffset + copied),
          currentBlockLength,
        );
        currentBlockLength += copied;
        chunkOffset += copied;
        if (currentBlockLength === currentBlock.byteLength) {
          blocks.push(currentBlock);
          currentBlock = undefined;
          currentBlockLength = 0;
        }
      }

      chunksSinceYield += 1;
      if (chunksSinceYield >= PUBLIC_PROJECT_FILE_RESPONSE_YIELD_CHUNKS) {
        chunksSinceYield = 0;
        await new Promise<void>((resolve) => setTimeout(resolve, 0));
        throwIfRuntimeProjectFilesAborted(abortSignal);
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
  return JSON.parse(publicProjectFileUtf8Decoder.decode(bytes));
}

/** Return a runtime project file with strict hosted-boundary enforcement. */
export async function getStrictRuntimeProjectFile(
  options:
    & StrictRuntimeProjectFilesClientOptions
    & RuntimeGetProjectFileOptions
    & StrictRuntimeProjectFilesRequestContext,
): Promise<RuntimeProjectFile | null> {
  validateRuntimeProjectFilesClientOptions(options, false);
  validateRuntimeProjectFilesApiOptions(options);
  validateProjectFileRequestPath(options.path);
  const callerScope = createStrictProjectFilesCallerSignalScope(options);

  const request = runStrictProjectFilesRequest(
    options,
    callerScope.signal,
    (requestScope) =>
      traceStrictProjectFilesRequest(options, "runtimeProjectFiles.getProjectFile", async () => {
        const url = createStrictRuntimeProjectFileUrl({
          ...options,
          fields: "(path,content)",
        });
        return await withStrictRuntimeProjectFilesRestResponse(
          url,
          options,
          requestScope,
          async (response, activeRequestScope) => {
            if (response.status === 404) {
              cancelResponseBodyWithoutWaiting(response);
              return null;
            }

            if (!response.ok) {
              throw NETWORK_ERROR.create({
                detail:
                  `Failed to fetch file ${options.path} for project ${options.projectId}: ${await readStrictApiErrorMessage(
                    response,
                    activeRequestScope,
                  )}`,
              });
            }

            const responseJson = await readBoundedJsonResponse(
              response,
              MAX_PROJECT_FILE_RESPONSE_BYTES,
              "Project file response",
              activeRequestScope,
            ).catch((error) => {
              if (!(error instanceof RuntimeProjectFilesProtocolError)) {
                throw error;
              }
              throw createInvalidProjectFileResponseError(options, error);
            });
            const parsed = getStrictRuntimeProjectFileSchema().safeParse(responseJson);
            if (!parsed.success) {
              throw createInvalidProjectFileResponseError(options);
            }
            if (parsed.data.path !== options.path) {
              throw createInvalidProjectFileResponseError(
                options,
                new RuntimeProjectFilesProtocolError(
                  "Project file response path did not match the request",
                ),
              );
            }
            if (!isRuntimeProjectFileContent(parsed.data.content)) {
              throw NETWORK_ERROR.create({
                detail:
                  `Failed to fetch file ${options.path} for project ${options.projectId}: content exceeds ${SKILL_TEXT_FILE_MAX_BYTES} bytes`,
              });
            }

            return parsed.data;
          },
        );
      }),
  );
  return request.finally(callerScope.dispose);
}

/** Whether a runtime project file content value fits the shared Skill budget. */
export function isRuntimeProjectFileContent(content: unknown): content is string {
  return typeof content === "string" &&
    content.length <= SKILL_TEXT_FILE_MAX_BYTES &&
    isWellFormedUtf16(content) &&
    isUtf8WithinByteLimit(content, SKILL_TEXT_FILE_MAX_BYTES);
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
      options.pathPrefix.length > MAX_PROJECT_FILE_PATH_CHARACTERS ||
      options.pathPrefix.startsWith("/") ||
      options.pathPrefix.endsWith("/") ||
      options.pathPrefix.includes("\\") ||
      options.pathPrefix.includes("\0") ||
      options.pathPrefix.split("/").some((segment) =>
        segment.length === 0 || segment === "." || segment === ".."
      ))
  ) {
    throw new RangeError(
      `Project file list path must contain between 1 and ${MAX_PROJECT_FILE_PATH_CHARACTERS} characters`,
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
          throwIfRuntimeProjectFilesAborted(signal);
          listingBudget.consumePage();
          const url = createRuntimeProjectFileUrl({
            ...options,
            fields: "(path)",
            cursor,
          });
          const response = await fetchRuntimeProjectFilesRestResponse(url, options, signal);
          throwIfRuntimeProjectFilesAborted(signal);

          if (!response.ok) {
            throw NETWORK_ERROR.create({
              detail:
                `Failed to fetch files for project ${options.projectId}: ${await readApiErrorMessage(
                  response,
                )}`,
            });
          }

          const parsed = getRuntimeProjectFileListRestResponseSchema().safeParse(
            await readPublicJsonResponseWithinLimit(
              response,
              PUBLIC_PROJECT_FILE_LIST_PAGE_MAX_BYTES,
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
            if (file.path.length > MAX_PROJECT_FILE_PATH_CHARACTERS) {
              throw new RangeError(
                `Project file paths may contain at most ${MAX_PROJECT_FILE_PATH_CHARACTERS} characters`,
              );
            }
          }
          if (
            parsed.data.page_info.next !== null &&
            parsed.data.page_info.next.length > MAX_PROJECT_FILES_CURSOR_CHARACTERS
          ) {
            throw new RangeError(
              `Project file cursors may contain at most ${MAX_PROJECT_FILES_CURSOR_CHARACTERS} characters`,
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

/** Return runtime project files with strict hosted-boundary enforcement. */
export async function getStrictRuntimeProjectFiles(
  options:
    & StrictRuntimeProjectFilesClientOptions
    & RuntimeProjectFilesApiOptions
    & StrictRuntimeProjectFilesRequestContext,
): Promise<RuntimeProjectFileListItem[]> {
  validateRuntimeProjectFilesClientOptions(options);
  validateRuntimeProjectFilesApiOptions(options);
  const callerScope = createStrictProjectFilesCallerSignalScope(options);
  const pageLimit = resolveProjectFilesPageLimit(options.pageLimit);
  const maximumEntries = Math.min(
    options.maximumEntries ?? MAX_RUNTIME_PROJECT_FILES_TOTAL_ITEMS,
    MAX_RUNTIME_PROJECT_FILES_TOTAL_ITEMS,
  );
  const listingBudget = options.listingBudget ?? createRuntimeProjectFileListingBudget();
  const operationDeadline = performance.now() +
    resolveProjectFilesOperationTimeoutMs(options.operationTimeoutMs);
  const operationScope = createStrictProjectFilesOperationScope(
    callerScope.signal,
    operationDeadline,
  );

  try {
    return await waitForStrictProjectFilesOperationPromise(
      operationScope,
      operationDeadline,
      () =>
        traceStrictProjectFilesRequest(options, "runtimeProjectFiles.getProjectFiles", async () => {
          const files: RuntimeProjectFileListItem[] = [];
          const seenCursors = new Set<string>();
          let cursor: string | null = null;
          let pageCount = 0;

          do {
            throwIfStrictProjectFilesOperationExpired(
              operationScope,
              operationDeadline,
            );
            if (pageCount >= MAX_PROJECT_FILES_TOTAL_PAGES) {
              throw createProjectFilesListLimitError(
                options.projectId,
                `pagination exceeds ${MAX_PROJECT_FILES_TOTAL_PAGES} pages`,
              );
            }
            pageCount += 1;
            listingBudget.consumePage();

            const remainingEntries = maximumEntries - files.length;
            if (remainingEntries <= 0) {
              throw createProjectFilesListLimitError(
                options.projectId,
                `file count exceeds ${maximumEntries}`,
              );
            }
            const requestPageLimit = Math.min(pageLimit, remainingEntries);

            const url = createStrictRuntimeProjectFileUrl({
              ...options,
              fields: "(path)",
              cursor,
              pageLimit: requestPageLimit,
            });
            const page = await runStrictProjectFilesRequest(
              options,
              operationScope.signal,
              (requestScope) =>
                withStrictRuntimeProjectFilesRestResponse(
                  url,
                  options,
                  requestScope,
                  async (response, activeRequestScope) => {
                    if (!response.ok) {
                      throw NETWORK_ERROR.create({
                        detail:
                          `Failed to fetch files for project ${options.projectId}: ${await readStrictApiErrorMessage(
                            response,
                            activeRequestScope,
                            listingBudget,
                          )}`,
                      });
                    }

                    const responseJson = await readBoundedJsonResponse(
                      response,
                      MAX_PROJECT_FILE_LIST_PAGE_BYTES,
                      "Project files list response",
                      activeRequestScope,
                      listingBudget,
                    ).catch((error) => {
                      if (!(error instanceof RuntimeProjectFilesProtocolError)) {
                        throw error;
                      }
                      throw createInvalidProjectFilesListResponseError(options.projectId, error);
                    });
                    const parsed = getStrictRuntimeProjectFileListRestResponseSchema().safeParse(
                      responseJson,
                    );
                    if (!parsed.success) {
                      throw createInvalidProjectFilesListResponseError(options.projectId);
                    }
                    return parsed.data;
                  },
                ),
            );
            throwIfStrictProjectFilesOperationExpired(
              operationScope,
              operationDeadline,
            );

            if (page.data.length > requestPageLimit) {
              throw createProjectFilesListLimitError(
                options.projectId,
                `page returned more than the requested ${requestPageLimit} files`,
              );
            }
            if (
              files.length + page.data.length > maximumEntries
            ) {
              throw createProjectFilesListLimitError(
                options.projectId,
                `file count exceeds ${maximumEntries}`,
              );
            }

            const nextCursor = page.page_info.next;
            if (
              nextCursor !== null &&
              files.length + page.data.length >= maximumEntries
            ) {
              throw createProjectFilesListLimitError(
                options.projectId,
                `file count exceeds ${maximumEntries}`,
              );
            }
            files.push(...page.data);
            if (nextCursor !== null) {
              if (seenCursors.has(nextCursor)) {
                throw createProjectFilesListLimitError(
                  options.projectId,
                  "pagination returned a repeated cursor",
                );
              }
              seenCursors.add(nextCursor);
            }
            cursor = nextCursor;
          } while (cursor);

          throwIfStrictProjectFilesOperationExpired(
            operationScope,
            operationDeadline,
          );
          return files;
        }),
    );
  } catch (error) {
    operationScope.abort(error);
    throw error;
  } finally {
    operationScope.dispose();
    callerScope.dispose();
  }
}

function createInvalidProjectFileResponseError(
  options: RuntimeGetProjectFileOptions,
  cause?: unknown,
): Error {
  const reason = cause instanceof Error ? `: ${cause.message}` : "";
  return NETWORK_ERROR.create({
    detail:
      `Failed to fetch file ${options.path} for project ${options.projectId}: invalid API response${reason}`,
  });
}

/*
 * The legacy and strict implementations intentionally coexist above. Keep the
 * helpers below split as well so future hosted hardening cannot silently narrow
 * the established public contract.
 */

function createInvalidProjectFilesListResponseError(
  projectId: string,
  cause?: unknown,
): Error {
  const reason = cause instanceof Error ? `: ${cause.message}` : "";
  return NETWORK_ERROR.create({
    detail: `Failed to fetch files for project ${projectId}: invalid API response${reason}`,
  });
}

function createProjectFilesListLimitError(projectId: string, reason: string): Error {
  return NETWORK_ERROR.create({
    detail: `Failed to fetch files for project ${projectId}: ${reason}`,
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

function createStrictRuntimeProjectFileUrl(input: {
  apiUrl: string | URL;
  projectId: string;
  path?: string;
  pathPrefix?: string;
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
  if (input.pathPrefix) {
    url.searchParams.set("path", input.pathPrefix);
  }
  if (!input.path) {
    url.searchParams.set("limit", String(resolveProjectFilesPageLimit(input.pageLimit)));
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

function throwIfRuntimeProjectFilesAborted(signal: AbortSignal | undefined): void {
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
    throwIfRuntimeProjectFilesAborted(controller.signal);
    const result = await fn(controller.signal);
    throwIfRuntimeProjectFilesAborted(controller.signal);
    return result;
  } finally {
    clearTimeout(timeoutId);
    externalSignal?.removeEventListener("abort", abortFromExternal);
  }
}

async function withStrictRuntimeProjectFilesRestResponse<TResult>(
  url: URL,
  options:
    & StrictRuntimeProjectFilesClientOptions
    & StrictRuntimeProjectFilesRequestContext
    & { authToken: string },
  requestScope: StrictProjectFilesRequestScope,
  handleResponse: (
    response: Response,
    requestScope: StrictProjectFilesRequestScope,
  ) => Promise<TResult>,
): Promise<TResult> {
  const response = await waitForStrictProjectFilesRequestPromise(
    requestScope,
    () =>
      (options.fetch ?? fetch)(url.toString(), {
        headers: {
          Authorization: `Bearer ${options.authToken}`,
        },
        signal: requestScope.signal,
      }),
    (lateResponse, reason) => {
      cancelResponseBodyWithoutWaiting(lateResponse, reason);
    },
  );

  if (response.status === 401 || response.status === 403) {
    cancelResponseBodyWithoutWaiting(response);
    throw createProjectFilesAccessDeniedError(options, response.status);
  }

  try {
    const result = await handleResponse(response, requestScope);
    throwIfStrictProjectFilesRequestExpired(requestScope);
    return result;
  } catch (error) {
    throwIfStrictProjectFilesRequestExpired(requestScope);
    throw error;
  }
}

function validateRuntimeProjectFilesClientOptions(
  options: StrictRuntimeProjectFilesClientOptions,
  validatePageLimit = true,
): void {
  normalizeProjectFilesApiUrl(options.apiUrl);
  resolveProjectFilesTimeoutMs(options.timeoutMs);
  resolveProjectFilesOperationTimeoutMs(options.operationTimeoutMs);
  if (validatePageLimit) {
    resolveProjectFilesPageLimit(options.pageLimit);
  }
  if (options.fetch !== undefined && typeof options.fetch !== "function") {
    throw new TypeError("fetch must be a function");
  }
  if (options.trace !== undefined && typeof options.trace !== "function") {
    throw new TypeError("trace must be a function");
  }
  if (
    options.createAccessDeniedError !== undefined &&
    typeof options.createAccessDeniedError !== "function"
  ) {
    throw new TypeError("createAccessDeniedError must be a function");
  }
}

function normalizeRuntimeProjectFilesClientOptions(
  options: StrictRuntimeProjectFilesClientOptions,
): Readonly<StrictRuntimeProjectFilesClientOptions> {
  validateRuntimeProjectFilesClientOptions(options);
  return Object.freeze({
    apiUrl: normalizeProjectFilesApiUrl(options.apiUrl),
    ...(options.fetch === undefined ? {} : { fetch: options.fetch }),
    timeoutMs: resolveProjectFilesTimeoutMs(options.timeoutMs),
    operationTimeoutMs: resolveProjectFilesOperationTimeoutMs(options.operationTimeoutMs),
    pageLimit: resolveProjectFilesPageLimit(options.pageLimit),
    ...(options.trace === undefined ? {} : { trace: options.trace }),
    ...(options.createAccessDeniedError === undefined
      ? {}
      : { createAccessDeniedError: options.createAccessDeniedError }),
  });
}

function normalizeProjectFilesApiUrl(value: unknown): string {
  if (
    !(typeof value === "string" || value instanceof URL) ||
    String(value).length === 0 ||
    String(value).length > MAX_PROJECT_FILES_API_URL_CHARACTERS
  ) {
    throw new TypeError(
      `apiUrl must be a URL no greater than ${MAX_PROJECT_FILES_API_URL_CHARACTERS} characters`,
    );
  }
  const url = new URL(value);
  if (
    (url.protocol !== "https:" && url.protocol !== "http:") ||
    url.username.length > 0 ||
    url.password.length > 0
  ) {
    throw new TypeError("apiUrl must be an HTTP(S) URL without embedded credentials");
  }
  return url.origin;
}

function requireBoundedWireString(
  value: unknown,
  label: string,
  maxLength: number,
): string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > maxLength ||
    !isWellFormedUtf16(value) ||
    hasControlCharacters(value)
  ) {
    throw new TypeError(
      `${label} must be a non-empty bounded string with well-formed UTF-16 and no control characters`,
    );
  }
  return value;
}

function validateRuntimeProjectFilesApiOptions(
  options: RuntimeProjectFilesApiOptions,
): void {
  if (
    options.maximumEntries !== undefined &&
    (!Number.isSafeInteger(options.maximumEntries) || options.maximumEntries <= 0)
  ) {
    throw new RangeError("Project file maximumEntries must be a positive safe integer");
  }
  const projectId = requireBoundedWireString(
    options.projectId,
    "projectId",
    MAX_PROJECT_FILES_IDENTIFIER_CHARACTERS,
  );
  if (
    projectId === "." ||
    projectId === ".." ||
    projectId.includes("/") ||
    projectId.includes("\\")
  ) {
    throw new TypeError("projectId must be a single route-safe identifier");
  }
  requireBoundedWireString(
    options.authToken,
    "authToken",
    MAX_PROJECT_FILES_AUTH_TOKEN_CHARACTERS,
  );
  // Preserve the historical wire contract: an empty branch identifier means
  // "use the project's default branch" and is omitted from the query string.
  if (
    options.branchId !== undefined &&
    options.branchId !== null &&
    options.branchId !== ""
  ) {
    requireBoundedWireString(
      options.branchId,
      "branchId",
      MAX_PROJECT_FILES_IDENTIFIER_CHARACTERS,
    );
  }
  if (options.pathPrefix !== undefined) {
    validateProjectFileRequestPath(options.pathPrefix);
  }
}

function resolveProjectFilesTimeoutMs(timeoutMs: number | undefined): number {
  const value = timeoutMs ?? DEFAULT_PROJECT_FILES_TIMEOUT_MS;
  if (!Number.isSafeInteger(value) || value <= 0 || value > MAX_PROJECT_FILES_TIMEOUT_MS) {
    throw new RangeError(
      `timeoutMs must be a positive safe integer no greater than ${MAX_PROJECT_FILES_TIMEOUT_MS}`,
    );
  }
  return value;
}

function resolveProjectFilesOperationTimeoutMs(timeoutMs: number | undefined): number {
  const value = timeoutMs ?? DEFAULT_PROJECT_FILES_OPERATION_TIMEOUT_MS;
  if (
    !Number.isSafeInteger(value) ||
    value <= 0 ||
    value > MAX_PROJECT_FILES_OPERATION_TIMEOUT_MS
  ) {
    throw new RangeError(
      `operationTimeoutMs must be a positive safe integer no greater than ${MAX_PROJECT_FILES_OPERATION_TIMEOUT_MS}`,
    );
  }
  return value;
}

type StrictProjectFilesAbortScope = {
  signal: AbortSignal;
  abort: (reason: unknown) => void;
  dispose: () => void;
};

type StrictProjectFilesCallerSignalScope = {
  signal: AbortSignal | undefined;
  dispose: () => void;
};

type StrictProjectFilesRequestScope = StrictProjectFilesAbortScope & {
  deadline: number;
};

function createStrictProjectFilesAggregateDeadlineError(): DOMException {
  return new DOMException(
    "Project files listing exceeded its aggregate deadline",
    "TimeoutError",
  );
}

function createStrictProjectFilesRequestTimeoutError(): DOMException {
  return new DOMException("Project files request timed out", "TimeoutError");
}

function getStrictProjectFilesAbortReason(signal: AbortSignal): unknown {
  return signal.reason === undefined
    ? new DOMException("Project files request was aborted", "AbortError")
    : signal.reason;
}

function createStrictProjectFilesCallerSignalScope(
  options: RuntimeProjectFilesApiOptions & StrictRuntimeProjectFilesRequestContext,
): StrictProjectFilesCallerSignalScope {
  validateStrictRuntimeProjectFilesRequestContext(options);
  const publicSignal = options.abortSignal;
  const internalSignal = options.signal;
  if (publicSignal === undefined || publicSignal === internalSignal) {
    return {
      signal: internalSignal ?? publicSignal,
      dispose: () => undefined,
    };
  }
  if (internalSignal === undefined) {
    return {
      signal: publicSignal,
      dispose: () => undefined,
    };
  }

  const controller = new AbortController();
  const listeners: Array<{ signal: AbortSignal; listener: () => void }> = [];
  let disposed = false;
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    for (const entry of listeners) {
      removeAbortSignalListener(entry.signal, entry.listener);
    }
    listeners.length = 0;
  };
  const attach = (source: AbortSignal) => {
    if (isAbortSignalAborted(source)) {
      if (!controller.signal.aborted) {
        controller.abort(getAbortSignalReason(source));
      }
      dispose();
      return;
    }
    const listener = () => {
      if (!controller.signal.aborted) {
        controller.abort(getAbortSignalReason(source));
      }
      dispose();
    };
    addAbortSignalListenerOnce(source, listener);
    listeners.push({ signal: source, listener });
    if (isAbortSignalAborted(source)) {
      listener();
    }
  };

  attach(publicSignal);
  if (!controller.signal.aborted) {
    attach(internalSignal);
  }
  return { signal: controller.signal, dispose };
}

function createStrictProjectFilesAbortScope(
  upstreamSignal: AbortSignal | undefined,
  timeoutMs: number,
  createTimeoutReason: () => unknown,
): StrictProjectFilesAbortScope {
  if (upstreamSignal?.aborted) {
    return {
      signal: upstreamSignal,
      abort: () => undefined,
      dispose: () => undefined,
    };
  }

  const controller = new AbortController();
  if (timeoutMs <= 0) {
    controller.abort(createTimeoutReason());
    return {
      signal: controller.signal,
      abort: () => undefined,
      dispose: () => undefined,
    };
  }

  let disposed = false;
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  const abortFromUpstream = () => {
    if (!controller.signal.aborted && upstreamSignal) {
      controller.abort(getStrictProjectFilesAbortReason(upstreamSignal));
    }
  };

  if (upstreamSignal) {
    upstreamSignal.addEventListener("abort", abortFromUpstream, { once: true });
    if (upstreamSignal.aborted) {
      abortFromUpstream();
    }
  }
  if (!controller.signal.aborted) {
    timeoutId = setTimeout(() => {
      controller.abort(createTimeoutReason());
    }, Math.max(1, Math.ceil(timeoutMs)));
  }

  return {
    signal: controller.signal,
    abort: (reason) => {
      if (!controller.signal.aborted) {
        controller.abort(reason);
      }
    },
    dispose: () => {
      if (disposed) return;
      disposed = true;
      if (timeoutId !== undefined) {
        clearTimeout(timeoutId);
      }
      upstreamSignal?.removeEventListener("abort", abortFromUpstream);
    },
  };
}

function createStrictProjectFilesOperationScope(
  callerSignal: AbortSignal | undefined,
  operationDeadline: number,
): StrictProjectFilesAbortScope {
  return createStrictProjectFilesAbortScope(
    callerSignal,
    operationDeadline - performance.now(),
    createStrictProjectFilesAggregateDeadlineError,
  );
}

function createStrictProjectFilesRequestScope(
  upstreamSignal: AbortSignal | undefined,
  timeoutMs: number,
): StrictProjectFilesRequestScope {
  const deadline = performance.now() + timeoutMs;
  return {
    ...createStrictProjectFilesAbortScope(
      upstreamSignal,
      deadline - performance.now(),
      createStrictProjectFilesRequestTimeoutError,
    ),
    deadline,
  };
}

function throwIfStrictProjectFilesRequestExpired(
  requestScope: StrictProjectFilesRequestScope,
): void {
  throwIfStrictProjectFilesAborted(requestScope.signal);
  if (performance.now() >= requestScope.deadline) {
    const error = createStrictProjectFilesRequestTimeoutError();
    requestScope.abort(error);
    throw error;
  }
}

function consumeStrictProjectFilesPromise<TResult>(
  promise: Promise<TResult>,
): void {
  promise.then(
    () => undefined,
    () => undefined,
  );
}

async function waitForStrictProjectFilesRequestPromise<TResult>(
  requestScope: StrictProjectFilesRequestScope,
  createPromise: () => Promise<TResult>,
  onLateFulfilled?: (value: TResult, reason: unknown) => void,
): Promise<TResult> {
  throwIfStrictProjectFilesRequestExpired(requestScope);

  let promise: Promise<TResult>;
  try {
    promise = Promise.resolve(createPromise());
  } catch (error) {
    throwIfStrictProjectFilesRequestExpired(requestScope);
    throw error;
  }

  const guardedPromise = promise.then((value) => {
    try {
      throwIfStrictProjectFilesRequestExpired(requestScope);
      return value;
    } catch (error) {
      try {
        onLateFulfilled?.(value, error);
      } catch {
        // Best-effort cleanup must not replace the deadline or cancellation.
      }
      throw error;
    }
  });

  try {
    throwIfStrictProjectFilesRequestExpired(requestScope);
  } catch (error) {
    consumeStrictProjectFilesPromise(guardedPromise);
    throw error;
  }

  let result: TResult;
  try {
    result = await waitForStrictProjectFilesAbort(
      guardedPromise,
      requestScope.signal,
    );
  } catch (error) {
    throwIfStrictProjectFilesRequestExpired(requestScope);
    throw error;
  }

  try {
    throwIfStrictProjectFilesRequestExpired(requestScope);
    return result;
  } catch (error) {
    try {
      onLateFulfilled?.(result, error);
    } catch {
      // Best-effort cleanup must not replace the deadline or cancellation.
    }
    throw error;
  }
}

async function runStrictProjectFilesRequest<TResult>(
  options: StrictRuntimeProjectFilesClientOptions,
  upstreamSignal: AbortSignal | undefined,
  operation: (requestScope: StrictProjectFilesRequestScope) => Promise<TResult>,
): Promise<TResult> {
  const requestScope = createStrictProjectFilesRequestScope(
    upstreamSignal,
    resolveProjectFilesTimeoutMs(options.timeoutMs),
  );
  try {
    return await waitForStrictProjectFilesRequestPromise(
      requestScope,
      () => operation(requestScope),
    );
  } catch (error) {
    requestScope.abort(error);
    throw error;
  } finally {
    requestScope.dispose();
  }
}

function throwIfStrictProjectFilesAborted(signal: AbortSignal): void {
  if (signal.aborted) {
    throw getStrictProjectFilesAbortReason(signal);
  }
}

function throwIfStrictProjectFilesOperationExpired(
  operationScope: StrictProjectFilesAbortScope,
  operationDeadline: number,
): void {
  throwIfStrictProjectFilesAborted(operationScope.signal);
  if (performance.now() >= operationDeadline) {
    const error = createStrictProjectFilesAggregateDeadlineError();
    operationScope.abort(error);
    throw error;
  }
}

async function waitForStrictProjectFilesOperationPromise<TResult>(
  operationScope: StrictProjectFilesAbortScope,
  operationDeadline: number,
  createPromise: () => Promise<TResult>,
): Promise<TResult> {
  throwIfStrictProjectFilesOperationExpired(operationScope, operationDeadline);

  let promise: Promise<TResult>;
  try {
    promise = Promise.resolve(createPromise());
  } catch (error) {
    throwIfStrictProjectFilesOperationExpired(operationScope, operationDeadline);
    throw error;
  }

  const guardedPromise = promise.then((value) => {
    throwIfStrictProjectFilesOperationExpired(operationScope, operationDeadline);
    return value;
  });

  try {
    throwIfStrictProjectFilesOperationExpired(operationScope, operationDeadline);
  } catch (error) {
    consumeStrictProjectFilesPromise(guardedPromise);
    throw error;
  }

  try {
    const result = await waitForStrictProjectFilesAbort(
      guardedPromise,
      operationScope.signal,
    );
    throwIfStrictProjectFilesOperationExpired(operationScope, operationDeadline);
    return result;
  } catch (error) {
    throwIfStrictProjectFilesOperationExpired(operationScope, operationDeadline);
    throw error;
  }
}

function waitForStrictProjectFilesAbort<TResult>(
  promise: Promise<TResult>,
  signal: AbortSignal,
): Promise<TResult> {
  if (signal.aborted) {
    promise.then(
      () => undefined,
      () => undefined,
    );
    return Promise.reject(getStrictProjectFilesAbortReason(signal));
  }

  return new Promise<TResult>((resolve, reject) => {
    let settled = false;
    const settle = (action: () => void) => {
      if (settled) return;
      settled = true;
      signal.removeEventListener("abort", onAbort);
      action();
    };
    const onAbort = () => settle(() => reject(getStrictProjectFilesAbortReason(signal)));

    signal.addEventListener("abort", onAbort, { once: true });
    if (signal.aborted) {
      onAbort();
    }
    promise.then(
      (value) => settle(() => resolve(value)),
      (error) => settle(() => reject(error)),
    );
  });
}

function validateStrictRuntimeProjectFilesRequestContext(
  options: RuntimeProjectFilesApiOptions & StrictRuntimeProjectFilesRequestContext,
): void {
  if (options.abortSignal !== undefined && !isAbortSignalWithoutHooks(options.abortSignal)) {
    throw new TypeError("abortSignal must be an AbortSignal");
  }
  if (options.signal !== undefined && !isAbortSignalWithoutHooks(options.signal)) {
    throw new TypeError("signal must be an AbortSignal");
  }
}

function resolveProjectFilesPageLimit(pageLimit: number | undefined): number {
  const value = pageLimit ?? DEFAULT_PROJECT_FILES_PAGE_LIMIT;
  if (!Number.isSafeInteger(value) || value <= 0 || value > MAX_PROJECT_FILES_PAGE_LIMIT) {
    throw new RangeError(
      `pageLimit must be a positive safe integer no greater than ${MAX_PROJECT_FILES_PAGE_LIMIT}`,
    );
  }
  return value;
}

function validateProjectFileRequestPath(path: string): void {
  const parsed = getStrictRuntimeProjectFilePathSchema().safeParse(path);
  if (!parsed.success) {
    throw new RangeError(
      `path must be a canonical project-relative path of 1-${MAX_PROJECT_FILE_PATH_CHARACTERS} well-formed UTF-16 characters without controls`,
    );
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

class RuntimeProjectFilesProtocolError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RuntimeProjectFilesProtocolError";
  }
}

function cancelResponseBodyWithoutWaiting(response: Response, reason?: unknown): void {
  try {
    void response.body?.cancel(reason).catch(() => undefined);
  } catch {
    // Best-effort cleanup; preserve the primary protocol result.
  }
}

function cancelReaderWithoutWaiting(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  reason?: unknown,
): void {
  let cancellation: Promise<void> | undefined;
  try {
    cancellation = reader.cancel(reason);
  } catch {
    // Best-effort cleanup; preserve the primary protocol error.
  }
  try {
    reader.releaseLock();
  } catch {
    // Best-effort cleanup; preserve the primary protocol error.
  }
  if (cancellation) {
    void cancellation.catch(() => undefined);
  }
}

function parseDeclaredContentLength(response: Response, maxBytes: number, label: string): void {
  const contentLength = response.headers.get("content-length");
  if (contentLength === null) {
    return;
  }
  if (!/^\d+$/.test(contentLength)) {
    cancelResponseBodyWithoutWaiting(response);
    throw new RuntimeProjectFilesProtocolError(`${label} had an invalid Content-Length header`);
  }
  const declaredBytes = Number(contentLength);
  if (!Number.isSafeInteger(declaredBytes) || declaredBytes > maxBytes) {
    cancelResponseBodyWithoutWaiting(response);
    throw new RuntimeProjectFilesProtocolError(`${label} exceeds ${maxBytes} bytes`);
  }
}

async function readBoundedResponseText(
  response: Response,
  maxBytes: number,
  label: string,
  requestScope: StrictProjectFilesRequestScope,
  listingBudget?: RuntimeProjectFileListingBudget,
): Promise<string> {
  throwIfStrictProjectFilesRequestExpired(requestScope);
  parseDeclaredContentLength(response, maxBytes, label);
  throwIfStrictProjectFilesRequestExpired(requestScope);

  const reader = response.body?.getReader();
  if (!reader) {
    throwIfStrictProjectFilesRequestExpired(requestScope);
    return "";
  }

  let bytes = new Uint8Array(0);
  let byteLength = 0;
  let completed = false;
  let failure: unknown;

  try {
    while (true) {
      const { done, value } = await waitForStrictProjectFilesRequestPromise(
        requestScope,
        () => reader.read(),
      );
      if (done) {
        completed = true;
        break;
      }
      listingBudget?.consumeBytes(value.byteLength);
      if (value.byteLength > maxBytes - byteLength) {
        throw new RuntimeProjectFilesProtocolError(`${label} exceeds ${maxBytes} bytes`);
      }

      const nextByteLength = byteLength + value.byteLength;
      if (bytes.byteLength < nextByteLength) {
        let capacity = Math.min(maxBytes, Math.max(1_024, bytes.byteLength * 2));
        while (capacity < nextByteLength) {
          capacity = Math.min(maxBytes, capacity * 2);
        }
        const grown = new Uint8Array(capacity);
        grown.set(bytes.subarray(0, byteLength));
        bytes = grown;
      }
      bytes.set(value, byteLength);
      byteLength = nextByteLength;
    }
  } catch (error) {
    failure = error;
    throw error;
  } finally {
    if (!completed) {
      cancelReaderWithoutWaiting(reader, failure);
    } else {
      reader.releaseLock();
    }
  }

  throwIfStrictProjectFilesRequestExpired(requestScope);
  try {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(
      bytes.subarray(0, byteLength),
    );
    throwIfStrictProjectFilesRequestExpired(requestScope);
    return text;
  } catch {
    throwIfStrictProjectFilesRequestExpired(requestScope);
    throw new RuntimeProjectFilesProtocolError(`${label} was not valid UTF-8`);
  }
}

async function readBoundedJsonResponse(
  response: Response,
  maxBytes: number,
  label: string,
  requestScope: StrictProjectFilesRequestScope,
  listingBudget?: RuntimeProjectFileListingBudget,
): Promise<unknown> {
  const text = await readBoundedResponseText(
    response,
    maxBytes,
    label,
    requestScope,
    listingBudget,
  );
  throwIfStrictProjectFilesRequestExpired(requestScope);
  try {
    const value = JSON.parse(text);
    throwIfStrictProjectFilesRequestExpired(requestScope);
    return value;
  } catch {
    throwIfStrictProjectFilesRequestExpired(requestScope);
    throw new RuntimeProjectFilesProtocolError(`${label} was not valid JSON`);
  }
}

function truncateApiErrorMessage(message: string): string {
  if (message.length <= MAX_PROJECT_FILES_ERROR_MESSAGE_CHARACTERS) {
    return message;
  }
  const suffix = "...[truncated]";
  return `${message.slice(0, MAX_PROJECT_FILES_ERROR_MESSAGE_CHARACTERS - suffix.length)}${suffix}`;
}

function isRequestCancellationError(error: unknown): boolean {
  const seen = new Set<unknown>();
  let current = error;
  while (typeof current === "object" && current !== null && !seen.has(current)) {
    seen.add(current);
    const errorLike = current as { name?: unknown; cause?: unknown };
    if (errorLike.name === "AbortError" || errorLike.name === "TimeoutError") {
      return true;
    }
    current = errorLike.cause;
  }
  return false;
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

async function readStrictApiErrorMessage(
  response: Response,
  requestScope: StrictProjectFilesRequestScope,
  listingBudget?: RuntimeProjectFileListingBudget,
): Promise<string> {
  let body: string;
  try {
    body = await readBoundedResponseText(
      response,
      MAX_PROJECT_FILES_ERROR_BODY_BYTES,
      "Project files API error response",
      requestScope,
      listingBudget,
    );
  } catch (error) {
    throwIfStrictProjectFilesRequestExpired(requestScope);
    if (isRequestCancellationError(error)) {
      throw error;
    }
    if (error instanceof RangeError) {
      throw error;
    }
    return truncateApiErrorMessage(
      error instanceof Error ? error.message : response.statusText || `HTTP ${response.status}`,
    );
  }
  if (!body.trim()) {
    return response.statusText || `HTTP ${response.status}`;
  }

  let parsedJson: { success: true; data: { detail?: string; message?: string; error?: string } } | {
    success: false;
  };
  try {
    const jsonValue = JSON.parse(body);
    const result = getStrictApiErrorBodySchema().safeParse(jsonValue);
    parsedJson = result.success ? { success: true, data: result.data } : { success: false };
  } catch {
    parsedJson = { success: false };
  }

  if (parsedJson.success) {
    return truncateApiErrorMessage(
      parsedJson.data.detail ?? parsedJson.data.message ?? parsedJson.data.error ?? body,
    );
  }

  return truncateApiErrorMessage(body);
}

function traceProjectFilesRequest<T>(
  options: RuntimeProjectFilesClientOptions,
  name: string,
  fn: () => Promise<T>,
): Promise<T> {
  return options.trace ? options.trace(name, fn) : fn();
}

async function traceStrictProjectFilesRequest<T>(
  options: StrictRuntimeProjectFilesClientOptions,
  name: string,
  fn: () => Promise<T>,
): Promise<T> {
  const trace = options.trace;
  if (!trace) {
    return await fn();
  }

  let traceSettled = false;
  let operationInvoked = false;
  let operationPromise: Promise<T> | undefined;
  let invocationError: TypeError | undefined;
  const rejectInvocation = (error: TypeError): Promise<T> => {
    const promise = Promise.reject<T>(error);
    consumeStrictProjectFilesPromise(promise);
    return promise;
  };
  const invokeOperation = (): Promise<T> => {
    if (traceSettled) {
      return rejectInvocation(
        new TypeError("trace invoked the project files operation after settling"),
      );
    }
    if (operationInvoked) {
      invocationError ??= new TypeError(
        "trace must invoke the project files operation exactly once",
      );
      return rejectInvocation(invocationError);
    }
    operationInvoked = true;
    try {
      operationPromise = Promise.resolve(fn());
    } catch (error) {
      operationPromise = Promise.reject(error);
    }
    consumeStrictProjectFilesPromise(operationPromise);
    return operationPromise;
  };

  let tracePromise: Promise<T>;
  try {
    tracePromise = Promise.resolve(trace(name, invokeOperation));
  } catch (error) {
    traceSettled = true;
    if (operationPromise) {
      consumeStrictProjectFilesPromise(operationPromise);
    }
    throw error;
  }

  try {
    await tracePromise;
  } catch (error) {
    traceSettled = true;
    if (operationPromise) {
      consumeStrictProjectFilesPromise(operationPromise);
    }
    throw error;
  }

  traceSettled = true;
  if (!operationInvoked || !operationPromise) {
    throw new TypeError("trace must invoke the project files operation exactly once");
  }
  const result = await operationPromise;
  if (invocationError) {
    throw invocationError;
  }
  return result;
}
