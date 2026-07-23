import { ensureBuiltinSchemaValidator } from "#veryfront/extensions/builtin-extensions.ts";
import { API_CLIENT_ERROR, INVALID_ARGUMENT, TIMEOUT_ERROR } from "#veryfront/errors";
import type { InferSchema } from "#veryfront/extensions/schema/index.ts";
import { defineSchema } from "#veryfront/schemas/index.ts";
import type { LiveEvalProjectFile } from "./runner.ts";
import {
  assertRequestTimeoutMs,
  createRequestTimeoutSignal,
  encodeApiPathSegment,
  readBoundedJsonResponse,
  stringifyBoundedJsonRequest,
  waitForDelay,
} from "../http-safety.ts";

ensureBuiltinSchemaValidator();

const MAX_LIVE_EVAL_UPLOAD_BYTES = 64 * 1024 * 1024;
const MAX_LIVE_EVAL_POLL_ATTEMPTS = 10_000;
const MAX_LIVE_EVAL_PATH_LENGTH = 4_096;
const MAX_LIVE_EVAL_TEXT_LENGTH = 16_384;

/** Context for live eval API. */
export interface LiveEvalApiContext {
  apiUrl: string;
  authToken: string;
  projectId: string | null;
  fetch?: (input: string | URL | Request, init?: RequestInit) => Promise<Response>;
}

/** Input payload for live eval request timeout. */
export interface LiveEvalRequestTimeoutInput {
  requestTimeoutMs: number;
  abortSignal?: AbortSignal;
}

/** Input payload for live eval create conversation. */
export interface LiveEvalCreateConversationInput extends LiveEvalRequestTimeoutInput {
  title: string;
}

/** Input payload for live eval conversation. */
export interface LiveEvalConversationInput extends LiveEvalRequestTimeoutInput {
  conversationId: string;
}

/** Input payload for live eval project upload fixture. */
export interface LiveEvalProjectUploadFixtureInput extends LiveEvalRequestTimeoutInput {
  filePath: string;
  contentType: string;
  body: BodyInit | Uint8Array;
  size?: number;
  pollIntervalMs?: number;
  maxAttempts?: number;
}

/** Input payload for live eval project file. */
export interface LiveEvalProjectFileInput extends LiveEvalRequestTimeoutInput {
  filePath: string;
}

/** Input payload for live eval create release. */
export interface LiveEvalCreateReleaseInput extends LiveEvalRequestTimeoutInput {
  description?: string;
}

/** Input payload for live eval wait for open input request. */
export interface LiveEvalWaitForOpenInputRequestInput extends LiveEvalConversationInput {
  abortSignal: AbortSignal;
  pollIntervalMs?: number;
  timeoutMs?: number;
}

/** Public API contract for live eval input response values. */
export interface LiveEvalInputResponseValues {
  [key: string]: string | boolean | number | null;
}

/** Input payload for live eval submit input response. */
export interface LiveEvalSubmitInputResponseInput extends LiveEvalRequestTimeoutInput {
  conversationId: string;
  inputRequestId: string;
  values: LiveEvalInputResponseValues;
}

/** Input payload for live eval input request. */
export interface LiveEvalInputRequestInput extends LiveEvalRequestTimeoutInput {
  conversationId: string;
  inputRequestId: string;
}

const getLiveEvalIdResponseSchema = defineSchema((v) =>
  v.object({
    id: v.string().optional(),
  })
);

const getProjectUploadResponseSchema = defineSchema((v) =>
  v.object({
    file_upload_url: v.string().optional(),
    required_headers: v.record(v.string(), v.string()).optional(),
  })
);

const getProjectUploadListResponseSchema = defineSchema((v) =>
  v.object({
    data: v.array(v.object({ path: v.string().optional() }).passthrough()).optional(),
  })
);

const getProjectFileResponseSchema = defineSchema((v) =>
  v.object({
    path: v.string().optional(),
    content: v.string(),
  })
);

const getInputRequestRecordSchema = defineSchema((v) =>
  v.object({
    id: v.string(),
    status: v.string(),
  })
);

const getInputRequestListResponseSchema = defineSchema((v) =>
  v.object({
    data: v.array(getInputRequestRecordSchema()).optional(),
  })
);

/** Record shape for live eval input request. */
export type LiveEvalInputRequestRecord = InferSchema<
  ReturnType<typeof getInputRequestRecordSchema>
>;

/** Public API contract for live eval API client. */
export interface LiveEvalApiClient {
  createConversation(input: LiveEvalCreateConversationInput): Promise<string>;
  deleteConversation(input: LiveEvalConversationInput): Promise<void>;
  createProjectUploadFixture(input: LiveEvalProjectUploadFixtureInput): Promise<string>;
  getProjectFile(input: LiveEvalProjectFileInput): Promise<LiveEvalProjectFile | null>;
  createRelease(input: LiveEvalCreateReleaseInput): Promise<string>;
  deleteProjectFile(input: LiveEvalProjectFileInput): Promise<void>;
  listOpenInputRequests(input: LiveEvalConversationInput): Promise<LiveEvalInputRequestRecord[]>;
  waitForOpenInputRequest(input: LiveEvalWaitForOpenInputRequestInput): Promise<string>;
  submitInputResponse(input: LiveEvalSubmitInputResponseInput): Promise<void>;
  cancelInputRequest(input: LiveEvalInputRequestInput): Promise<void>;
}

function createLiveEvalAuthHeaders(context: LiveEvalApiContext): Headers {
  const headers = new Headers();
  headers.set("Authorization", `Bearer ${context.authToken}`);
  return headers;
}

function createLiveEvalJsonHeaders(context: LiveEvalApiContext): Headers {
  const headers = createLiveEvalAuthHeaders(context);
  headers.set("Content-Type", "application/json");
  return headers;
}

function requireLiveEvalProjectId(projectId: string | null, errorMessage: string): string {
  if (!projectId) {
    throw INVALID_ARGUMENT.create({ detail: errorMessage });
  }

  return projectId;
}

function assertLiveEvalText(
  value: string,
  label: string,
  maxLength = MAX_LIVE_EVAL_TEXT_LENGTH,
): void {
  if (typeof value !== "string" || value.length === 0 || value.length > maxLength) {
    throw INVALID_ARGUMENT.create({
      detail: `${label} must be a non-empty string of at most ${maxLength} characters`,
    });
  }
}

function createFetch(context: LiveEvalApiContext) {
  return context.fetch ?? fetch;
}

function createLiveEvalRequestSignal(input: LiveEvalRequestTimeoutInput): AbortSignal {
  const timeoutSignal = createRequestTimeoutSignal(input.requestTimeoutMs);
  return input.abortSignal ? AbortSignal.any([input.abortSignal, timeoutSignal]) : timeoutSignal;
}

function createApiUrl(context: LiveEvalApiContext, path: string): URL {
  const baseHref = context.apiUrl.endsWith("/") ? context.apiUrl : `${context.apiUrl}/`;
  const relativePath = path.startsWith("/") ? path.slice(1) : path;
  return new URL(relativePath, baseHref);
}

function createProjectUploadHeaders(
  requiredHeaders: Record<string, string> | undefined,
  contentType: string,
): Headers {
  const uploadHeaders = new Headers(requiredHeaders);
  if (!uploadHeaders.has("Content-Type")) {
    uploadHeaders.set("Content-Type", contentType);
  }

  return uploadHeaders;
}

function getProjectUploadBodySize(
  body: BodyInit | Uint8Array,
  explicitSize: number | undefined,
): number {
  let inferredSize: number | undefined;
  if (typeof body === "string") {
    inferredSize = new TextEncoder().encode(body).byteLength;
  } else if (body instanceof Blob) {
    inferredSize = body.size;
  } else if (body instanceof URLSearchParams) {
    inferredSize = new TextEncoder().encode(body.toString()).byteLength;
  } else if (body instanceof ArrayBuffer) {
    inferredSize = body.byteLength;
  } else if (ArrayBuffer.isView(body)) {
    inferredSize = body.byteLength;
  }
  if (explicitSize !== undefined && typeof explicitSize !== "number") {
    throw INVALID_ARGUMENT.create({
      detail: "Project upload fixture size must be a number when provided",
    });
  }
  if (inferredSize !== undefined && explicitSize !== undefined && explicitSize !== inferredSize) {
    throw INVALID_ARGUMENT.create({
      detail: "Project upload fixture size does not match the request body",
    });
  }
  const size = inferredSize ?? explicitSize;
  if (size === undefined) {
    throw INVALID_ARGUMENT.create({
      detail: "Project upload fixtures require size when body length cannot be inferred",
    });
  }
  if (!Number.isSafeInteger(size) || size < 0 || size > MAX_LIVE_EVAL_UPLOAD_BYTES) {
    throw INVALID_ARGUMENT.create({
      detail: `Project upload fixture size must be between 0 and ${MAX_LIVE_EVAL_UPLOAD_BYTES}`,
    });
  }
  return size;
}

function createProjectUploadBody(body: BodyInit | Uint8Array, contentType: string): BodyInit {
  if (body instanceof Blob) {
    return body;
  }
  if (typeof body === "string") {
    return new Blob([body], { type: contentType });
  }
  if (body instanceof Uint8Array) {
    return new Blob([body.slice()], { type: contentType });
  }
  return body;
}

async function waitForProjectUploadFixture(
  context: LiveEvalApiContext,
  input: {
    projectId: string;
    filePath: string;
    requestTimeoutMs: number;
    abortSignal?: AbortSignal;
    pollIntervalMs?: number;
    maxAttempts?: number;
  },
): Promise<string> {
  const listUrl = createApiUrl(
    context,
    `/projects/${encodeApiPathSegment(input.projectId, "projectId")}/uploads`,
  );
  const requestFetch = createFetch(context);
  const maxAttempts = input.maxAttempts ?? 12;
  const pollIntervalMs = input.pollIntervalMs ?? 2_000;
  if (
    !Number.isSafeInteger(maxAttempts) || maxAttempts < 1 ||
    maxAttempts > MAX_LIVE_EVAL_POLL_ATTEMPTS
  ) {
    throw INVALID_ARGUMENT.create({
      detail: `maxAttempts must be an integer between 1 and ${MAX_LIVE_EVAL_POLL_ATTEMPTS}`,
    });
  }
  if (!Number.isSafeInteger(pollIntervalMs) || pollIntervalMs < 10) {
    throw INVALID_ARGUMENT.create({ detail: "pollIntervalMs must be an integer of at least 10" });
  }

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const listResponse = await requestFetch(listUrl, {
      headers: createLiveEvalAuthHeaders(context),
      signal: createLiveEvalRequestSignal(input),
    });

    if (!listResponse.ok) {
      await listResponse.body?.cancel();
      throw API_CLIENT_ERROR.create({
        detail: `Failed to confirm project upload fixture: HTTP ${listResponse.status}`,
      });
    }

    const payload = getProjectUploadListResponseSchema().parse(
      await readBoundedJsonResponse(listResponse),
    );
    if (payload.data?.some((upload) => upload.path === input.filePath)) {
      return input.filePath;
    }

    if (attempt + 1 < maxAttempts) {
      await waitForDelay(pollIntervalMs, input.abortSignal);
    }
  }

  throw TIMEOUT_ERROR.create({
    detail: "Project upload fixture did not appear in time",
  });
}

/** Create live eval API client. */
export function createLiveEvalApiClient(context: LiveEvalApiContext): LiveEvalApiClient {
  return {
    createConversation: (input) => createLiveEvalConversation(context, input),
    deleteConversation: (input) => deleteLiveEvalConversation(context, input),
    createProjectUploadFixture: (input) => createLiveEvalProjectUploadFixture(context, input),
    getProjectFile: (input) => getLiveEvalProjectFile(context, input),
    createRelease: (input) => createLiveEvalRelease(context, input),
    deleteProjectFile: (input) => deleteLiveEvalProjectFile(context, input),
    listOpenInputRequests: (input) => listOpenLiveEvalInputRequests(context, input),
    waitForOpenInputRequest: (input) => waitForOpenLiveEvalInputRequest(context, input),
    submitInputResponse: (input) => submitLiveEvalInputResponse(context, input),
    cancelInputRequest: (input) => cancelLiveEvalInputRequest(context, input),
  } satisfies LiveEvalApiClient;
}

/** Create live eval conversation. */
export async function createLiveEvalConversation(
  context: LiveEvalApiContext,
  input: LiveEvalCreateConversationInput,
): Promise<string> {
  assertLiveEvalText(input.title, "title");
  const response = await createFetch(context)(createApiUrl(context, "/conversations"), {
    method: "POST",
    headers: createLiveEvalJsonHeaders(context),
    body: stringifyBoundedJsonRequest({
      ...(context.projectId ? { project_id: context.projectId } : {}),
      title: input.title,
    }),
    signal: createLiveEvalRequestSignal(input),
  });

  if (!response.ok) {
    await response.body?.cancel();
    throw API_CLIENT_ERROR.create({
      detail: `Failed to create eval conversation: HTTP ${response.status}`,
    });
  }

  const payload = getLiveEvalIdResponseSchema().parse(await readBoundedJsonResponse(response));
  if (!payload.id) {
    throw INVALID_ARGUMENT.create({ detail: "Conversation creation response did not include id" });
  }

  return payload.id;
}

/** Delete live eval conversation helper. */
export async function deleteLiveEvalConversation(
  context: LiveEvalApiContext,
  input: LiveEvalConversationInput,
): Promise<void> {
  const response = await createFetch(context)(
    createApiUrl(
      context,
      `/conversations/${encodeApiPathSegment(input.conversationId, "conversationId")}`,
    ),
    {
      method: "DELETE",
      headers: createLiveEvalAuthHeaders(context),
      signal: createLiveEvalRequestSignal(input),
    },
  );

  if (!response.ok && response.status !== 404) {
    await response.body?.cancel();
    throw API_CLIENT_ERROR.create({
      detail: `Failed to delete eval conversation: HTTP ${response.status}`,
    });
  }
  await response.body?.cancel();
}

/** Create live eval project upload fixture. */
export async function createLiveEvalProjectUploadFixture(
  context: LiveEvalApiContext,
  input: LiveEvalProjectUploadFixtureInput,
): Promise<string> {
  const projectId = requireLiveEvalProjectId(
    context.projectId,
    "Project upload fixtures require a live-eval project id",
  );
  assertLiveEvalText(input.filePath, "filePath", MAX_LIVE_EVAL_PATH_LENGTH);
  assertLiveEvalText(input.contentType, "contentType", 1_024);

  const createResponse = await createFetch(context)(
    createApiUrl(
      context,
      `/projects/${encodeApiPathSegment(projectId, "projectId")}/uploads`,
    ),
    {
      method: "POST",
      headers: createLiveEvalJsonHeaders(context),
      body: stringifyBoundedJsonRequest({
        file_path: input.filePath,
        content_type: input.contentType,
        size: getProjectUploadBodySize(input.body, input.size),
      }),
      signal: createLiveEvalRequestSignal(input),
    },
  );

  if (!createResponse.ok) {
    await createResponse.body?.cancel();
    throw API_CLIENT_ERROR.create({
      detail: `Failed to create project upload URL: HTTP ${createResponse.status}`,
    });
  }

  const createPayload = getProjectUploadResponseSchema().parse(
    await readBoundedJsonResponse(createResponse),
  );
  if (!createPayload.file_upload_url) {
    throw INVALID_ARGUMENT.create({
      detail: "Project upload response did not include file_upload_url",
    });
  }

  const uploadResponse = await createFetch(context)(createPayload.file_upload_url, {
    method: "PUT",
    headers: createProjectUploadHeaders(createPayload.required_headers, input.contentType),
    body: createProjectUploadBody(input.body, input.contentType),
    signal: createLiveEvalRequestSignal(input),
  });

  if (!uploadResponse.ok) {
    await uploadResponse.body?.cancel();
    throw API_CLIENT_ERROR.create({
      detail: `Failed to upload project fixture: HTTP ${uploadResponse.status}`,
    });
  }
  await uploadResponse.body?.cancel();

  return waitForProjectUploadFixture(context, {
    projectId,
    filePath: input.filePath,
    requestTimeoutMs: input.requestTimeoutMs,
    abortSignal: input.abortSignal,
    pollIntervalMs: input.pollIntervalMs,
    maxAttempts: input.maxAttempts,
  });
}

/** Return live eval project file. */
export async function getLiveEvalProjectFile(
  context: LiveEvalApiContext,
  input: LiveEvalProjectFileInput,
): Promise<LiveEvalProjectFile | null> {
  const projectId = requireLiveEvalProjectId(
    context.projectId,
    "getLiveEvalProjectFile requires a live-eval project id",
  );
  assertLiveEvalText(input.filePath, "filePath", MAX_LIVE_EVAL_PATH_LENGTH);
  const response = await createFetch(context)(
    createApiUrl(
      context,
      `/projects/${encodeApiPathSegment(projectId, "projectId")}/files/${
        encodeApiPathSegment(input.filePath, "filePath")
      }`,
    ),
    {
      headers: createLiveEvalAuthHeaders(context),
      signal: createLiveEvalRequestSignal(input),
    },
  );

  if (response.status === 404) {
    await response.body?.cancel();
    return null;
  }

  if (!response.ok) {
    await response.body?.cancel();
    throw API_CLIENT_ERROR.create({
      detail: `Failed to read project file: HTTP ${response.status}`,
    });
  }

  const payload = getProjectFileResponseSchema().parse(await readBoundedJsonResponse(response));
  return {
    path: payload.path ?? input.filePath,
    content: payload.content,
  };
}

/** Create live eval release. */
export async function createLiveEvalRelease(
  context: LiveEvalApiContext,
  input: LiveEvalCreateReleaseInput,
): Promise<string> {
  const projectId = requireLiveEvalProjectId(
    context.projectId,
    "createLiveEvalRelease requires a live-eval project id",
  );
  if (input.description !== undefined) {
    assertLiveEvalText(input.description, "description");
  }
  const response = await createFetch(context)(
    createApiUrl(
      context,
      `/projects/${encodeApiPathSegment(projectId, "projectId")}/releases`,
    ),
    {
      method: "POST",
      headers: createLiveEvalJsonHeaders(context),
      body: stringifyBoundedJsonRequest({
        description: input.description ?? "eval platform capability release",
      }),
      signal: createLiveEvalRequestSignal(input),
    },
  );

  if (!response.ok) {
    await response.body?.cancel();
    throw API_CLIENT_ERROR.create({
      detail: `Failed to create release: HTTP ${response.status}`,
    });
  }

  const payload = getLiveEvalIdResponseSchema().parse(await readBoundedJsonResponse(response));
  if (!payload.id) {
    throw INVALID_ARGUMENT.create({ detail: "Release creation response did not include id" });
  }

  return payload.id;
}

/** Delete live eval project file helper. */
export async function deleteLiveEvalProjectFile(
  context: LiveEvalApiContext,
  input: LiveEvalProjectFileInput,
): Promise<void> {
  const projectId = context.projectId;
  if (!projectId) {
    return;
  }
  assertLiveEvalText(input.filePath, "filePath", MAX_LIVE_EVAL_PATH_LENGTH);

  const response = await createFetch(context)(
    createApiUrl(
      context,
      `/projects/${encodeApiPathSegment(projectId, "projectId")}/files/${
        encodeApiPathSegment(input.filePath, "filePath")
      }`,
    ),
    {
      method: "DELETE",
      headers: createLiveEvalAuthHeaders(context),
      signal: createLiveEvalRequestSignal(input),
    },
  );

  if (!response.ok && response.status !== 404) {
    await response.body?.cancel();
    throw API_CLIENT_ERROR.create({
      detail: `Failed to delete project file: HTTP ${response.status}`,
    });
  }
  await response.body?.cancel();
}

/** List open live eval input requests. */
export async function listOpenLiveEvalInputRequests(
  context: LiveEvalApiContext,
  input: LiveEvalConversationInput,
): Promise<LiveEvalInputRequestRecord[]> {
  const response = await createFetch(context)(
    createApiUrl(
      context,
      `/conversations/${
        encodeApiPathSegment(input.conversationId, "conversationId")
      }/input-requests?status=open`,
    ),
    {
      headers: createLiveEvalAuthHeaders(context),
      signal: createLiveEvalRequestSignal(input),
    },
  );

  if (!response.ok) {
    await response.body?.cancel();
    throw API_CLIENT_ERROR.create({
      detail: `Failed to list eval input requests: HTTP ${response.status}`,
    });
  }

  const payload = getInputRequestListResponseSchema().parse(
    await readBoundedJsonResponse(response),
  );
  return payload.data ?? [];
}

/** Request payload for wait for open live eval input. */
export async function waitForOpenLiveEvalInputRequest(
  context: LiveEvalApiContext,
  input: LiveEvalWaitForOpenInputRequestInput,
): Promise<string> {
  const timeoutMs = input.timeoutMs ?? 30_000;
  const pollIntervalMs = input.pollIntervalMs ?? 500;
  assertRequestTimeoutMs(timeoutMs);
  if (!Number.isSafeInteger(pollIntervalMs) || pollIntervalMs < 10 || pollIntervalMs > timeoutMs) {
    throw INVALID_ARGUMENT.create({
      detail: "pollIntervalMs must be an integer between 10 and timeoutMs",
    });
  }
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    if (input.abortSignal.aborted) {
      throw TIMEOUT_ERROR.create({
        detail: "Eval sidecar aborted before an input request appeared",
      });
    }

    const requests = await listOpenLiveEvalInputRequests(context, {
      ...input,
      requestTimeoutMs: Math.min(input.requestTimeoutMs, Math.max(1, deadline - Date.now())),
    });
    const request = requests[0];
    if (request) {
      return request.id;
    }

    await waitForDelay(
      Math.min(pollIntervalMs, Math.max(0, deadline - Date.now())),
      input.abortSignal,
    );
  }

  throw TIMEOUT_ERROR.create({
    detail: "Timed out while waiting for an open input request",
  });
}

/** Response payload for submit live eval input. */
export async function submitLiveEvalInputResponse(
  context: LiveEvalApiContext,
  input: LiveEvalSubmitInputResponseInput,
): Promise<void> {
  const response = await createFetch(context)(
    createApiUrl(
      context,
      `/conversations/${
        encodeApiPathSegment(input.conversationId, "conversationId")
      }/input-requests/${encodeApiPathSegment(input.inputRequestId, "inputRequestId")}/responses`,
    ),
    {
      method: "POST",
      headers: createLiveEvalJsonHeaders(context),
      body: stringifyBoundedJsonRequest({ values: input.values }),
      signal: createLiveEvalRequestSignal(input),
    },
  );

  if (!response.ok) {
    await response.body?.cancel();
    throw API_CLIENT_ERROR.create({
      detail: `Failed to submit eval input response: HTTP ${response.status}`,
    });
  }
  await response.body?.cancel();
}

/** Request payload for cancel live eval input. */
export async function cancelLiveEvalInputRequest(
  context: LiveEvalApiContext,
  input: LiveEvalInputRequestInput,
): Promise<void> {
  const response = await createFetch(context)(
    createApiUrl(
      context,
      `/conversations/${
        encodeApiPathSegment(input.conversationId, "conversationId")
      }/input-requests/${encodeApiPathSegment(input.inputRequestId, "inputRequestId")}/cancel`,
    ),
    {
      method: "POST",
      headers: createLiveEvalAuthHeaders(context),
      signal: createLiveEvalRequestSignal(input),
    },
  );

  if (!response.ok) {
    await response.body?.cancel();
    throw API_CLIENT_ERROR.create({
      detail: `Failed to cancel eval input request: HTTP ${response.status}`,
    });
  }
  await response.body?.cancel();
}
