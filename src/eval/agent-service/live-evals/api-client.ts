import { ensureBuiltinSchemaValidator } from "#veryfront/extensions/builtin-extensions.ts";
import { API_CLIENT_ERROR, INVALID_ARGUMENT, TIMEOUT_ERROR } from "#veryfront/errors";
import { sleep } from "#veryfront/utils";
import { readResponseTextPrefix } from "#veryfront/utils/response-body.ts";
import type { InferSchema } from "#veryfront/extensions/schema/index.ts";
import { defineSchema } from "#veryfront/schemas/index.ts";
import type { LiveEvalProjectFile } from "./runner.ts";
import {
  assertCanonicalEvalString,
  assertEvalTimerDuration,
  assertFiniteEvalNumber,
  isEvalRecord,
  normalizeEvalString,
} from "../../validation.ts";

ensureBuiltinSchemaValidator();

const MAX_LIVE_EVAL_API_ERROR_BODY_BYTES = 4_096;

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
    content: v.string().optional(),
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
    data: v.array(v.unknown()).optional(),
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
  headers.set(
    "Authorization",
    `Bearer ${normalizeEvalString(context.authToken, "Live eval API auth token")}`,
  );
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

  return normalizeEvalString(projectId, "Live eval project id");
}

function createFetch(context: LiveEvalApiContext) {
  return context.fetch ?? fetch;
}

function createApiUrl(context: LiveEvalApiContext, path: string): URL {
  const apiUrl = normalizeEvalString(context.apiUrl, "Live eval API URL");
  const baseHref = apiUrl.endsWith("/") ? apiUrl : `${apiUrl}/`;
  const relativePath = path.startsWith("/") ? path.slice(1) : path;
  return new URL(relativePath, baseHref);
}

function encodePathSegment(value: string, label: string): string {
  return encodeURIComponent(normalizeEvalString(value, label));
}

interface RequestSignalScope {
  signal: AbortSignal;
  dispose: () => void;
}

function composeAbortSignals(signals: readonly AbortSignal[]): RequestSignalScope {
  if (typeof AbortSignal.any === "function") {
    return {
      signal: AbortSignal.any([...signals]),
      dispose: () => {},
    };
  }

  const controller = new AbortController();
  const removers: Array<() => void> = [];
  const detach = () => {
    for (const remove of removers) remove();
    removers.length = 0;
  };
  controller.signal.addEventListener("abort", detach, { once: true });
  for (const signal of signals) {
    if (signal.aborted) {
      controller.abort(signal.reason);
      return { signal: controller.signal, dispose: detach };
    }
    const forwardAbort = () => controller.abort(signal.reason);
    signal.addEventListener("abort", forwardAbort, { once: true });
    removers.push(() => signal.removeEventListener("abort", forwardAbort));
    if (signal.aborted) {
      forwardAbort();
      return { signal: controller.signal, dispose: detach };
    }
  }
  return { signal: controller.signal, dispose: detach };
}

function createRequestSignal(
  requestTimeoutMs: number,
): AbortSignal {
  assertEvalTimerDuration(requestTimeoutMs, "Live eval requestTimeoutMs", { min: 1 });
  return AbortSignal.timeout(requestTimeoutMs);
}

function createRequestSignalScope(
  requestTimeoutMs: number,
  callerSignal: AbortSignal,
): RequestSignalScope {
  return composeAbortSignals([callerSignal, createRequestSignal(requestTimeoutMs)]);
}

function validateTimerValue(
  value: number,
  label: string,
  minimum: number,
): number {
  assertEvalTimerDuration(value, label, { min: minimum });
  return value;
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
  if (explicitSize !== undefined) {
    assertFiniteEvalNumber(explicitSize, "Project upload fixture size", {
      integer: true,
      min: 0,
    });
    return explicitSize;
  }
  if (typeof body === "string") {
    return new TextEncoder().encode(body).byteLength;
  }
  if (body instanceof Blob) {
    return body.size;
  }
  if (body instanceof URLSearchParams) {
    return new TextEncoder().encode(body.toString()).byteLength;
  }
  if (body instanceof ArrayBuffer) {
    return body.byteLength;
  }
  if (ArrayBuffer.isView(body)) {
    return body.byteLength;
  }
  throw INVALID_ARGUMENT.create({
    detail: "Project upload fixtures require size when body length cannot be inferred",
  });
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

function isReadableStreamBody(body: BodyInit): body is ReadableStream<Uint8Array> {
  return typeof ReadableStream !== "undefined" && body instanceof ReadableStream;
}

function assertLiveEvalInputResponseValues(
  values: LiveEvalInputResponseValues,
): void {
  if (!isEvalRecord(values)) {
    throw INVALID_ARGUMENT.create({
      detail: "Live eval input response values must be an object",
    });
  }
  for (const [key, value] of Object.entries(values)) {
    if (
      value !== null &&
      typeof value !== "string" &&
      typeof value !== "boolean" &&
      typeof value !== "number"
    ) {
      throw INVALID_ARGUMENT.create({
        detail: `Live eval input response value "${key}" has an unsupported type`,
      });
    }
    if (typeof value === "number") {
      assertFiniteEvalNumber(value, `Live eval input response value "${key}"`);
    }
  }
}

async function getResponseText(response: Response): Promise<string> {
  const { text, truncated } = await readResponseTextPrefix(
    response,
    MAX_LIVE_EVAL_API_ERROR_BODY_BYTES,
  );
  return truncated ? `${text}…[truncated]` : text;
}

function wait(input: { ms: number; signal?: AbortSignal }): Promise<void> {
  validateTimerValue(input.ms, "Live eval poll interval", 0);
  return sleep(input.ms, input.signal);
}

async function throwLiveEvalApiError(prefix: string, response: Response): Promise<never> {
  throw API_CLIENT_ERROR.create({
    detail: `${prefix}: ${response.status} ${await getResponseText(response)}`,
    status: response.status,
  });
}

async function waitForProjectUploadFixture(
  context: LiveEvalApiContext,
  input: {
    projectId: string;
    filePath: string;
    requestTimeoutMs: number;
    pollIntervalMs?: number;
    maxAttempts?: number;
  },
): Promise<string> {
  const listUrl = createApiUrl(
    context,
    `/projects/${encodePathSegment(input.projectId, "Live eval project id")}/uploads`,
  );
  const requestFetch = createFetch(context);
  const maxAttempts = input.maxAttempts ?? 12;
  assertFiniteEvalNumber(maxAttempts, "Project upload maxAttempts", {
    integer: true,
    min: 1,
    max: Number.MAX_SAFE_INTEGER,
  });
  const pollIntervalMs = validateTimerValue(
    input.pollIntervalMs ?? 2_000,
    "Project upload pollIntervalMs",
    0,
  );

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const listResponse = await requestFetch(listUrl, {
      headers: createLiveEvalAuthHeaders(context),
      signal: createRequestSignal(input.requestTimeoutMs),
    });

    if (!listResponse.ok) {
      await throwLiveEvalApiError("Failed to confirm project upload fixture", listResponse);
    }

    const payload = getProjectUploadListResponseSchema().parse(await listResponse.json());
    if (payload.data?.some((upload) => upload.path === input.filePath)) {
      return input.filePath;
    }

    if (attempt + 1 < maxAttempts) {
      await wait({ ms: pollIntervalMs });
    }
  }

  throw TIMEOUT_ERROR.create({
    detail: `Project upload fixture did not appear in time: ${input.filePath}`,
  });
}

/** Create live eval API client. */
export function createLiveEvalApiClient(context: LiveEvalApiContext): LiveEvalApiClient {
  assertCanonicalEvalString(context.apiUrl, "Live eval API URL");
  if (!URL.canParse(context.apiUrl)) {
    throw new TypeError("Live eval API URL must be a valid absolute URL");
  }
  assertCanonicalEvalString(context.authToken, "Live eval API auth token");
  if (context.projectId !== null) {
    assertCanonicalEvalString(context.projectId, "Live eval project id");
  }
  if (context.fetch !== undefined && typeof context.fetch !== "function") {
    throw new TypeError("Live eval API fetch must be a function");
  }
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
  const title = normalizeEvalString(input.title, "Live eval conversation title");
  const projectId = context.projectId === null
    ? null
    : normalizeEvalString(context.projectId, "Live eval project id");
  const response = await createFetch(context)(createApiUrl(context, "/conversations"), {
    method: "POST",
    headers: createLiveEvalJsonHeaders(context),
    body: JSON.stringify({
      ...(projectId ? { project_id: projectId } : {}),
      title,
    }),
    signal: createRequestSignal(input.requestTimeoutMs),
  });

  if (!response.ok) {
    await throwLiveEvalApiError("Failed to create eval conversation", response);
  }

  const payload = getLiveEvalIdResponseSchema().parse(await response.json());
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
  const conversationId = encodePathSegment(
    input.conversationId,
    "Live eval conversation id",
  );
  const response = await createFetch(context)(
    createApiUrl(context, `/conversations/${conversationId}`),
    {
      method: "DELETE",
      headers: createLiveEvalAuthHeaders(context),
      signal: createRequestSignal(input.requestTimeoutMs),
    },
  );

  if (!response.ok && response.status !== 404) {
    await throwLiveEvalApiError(
      `Failed to delete eval conversation ${input.conversationId}`,
      response,
    );
  }
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
  const filePath = normalizeEvalString(input.filePath, "Project upload fixture filePath");
  const contentType = normalizeEvalString(
    input.contentType,
    "Project upload fixture contentType",
  );
  const bodySize = getProjectUploadBodySize(input.body, input.size);

  const createResponse = await createFetch(context)(
    createApiUrl(
      context,
      `/projects/${encodePathSegment(projectId, "Live eval project id")}/uploads`,
    ),
    {
      method: "POST",
      headers: createLiveEvalJsonHeaders(context),
      body: JSON.stringify({
        file_path: filePath,
        content_type: contentType,
        size: bodySize,
      }),
      signal: createRequestSignal(input.requestTimeoutMs),
    },
  );

  if (!createResponse.ok) {
    await throwLiveEvalApiError("Failed to create project upload URL", createResponse);
  }

  const createPayload = getProjectUploadResponseSchema().parse(await createResponse.json());
  if (!createPayload.file_upload_url) {
    throw INVALID_ARGUMENT.create({
      detail: "Project upload response did not include file_upload_url",
    });
  }

  const uploadBody = createProjectUploadBody(input.body, contentType);
  const uploadInit: RequestInit & { duplex?: "half" } = {
    method: "PUT",
    headers: createProjectUploadHeaders(createPayload.required_headers, contentType),
    body: uploadBody,
    signal: createRequestSignal(input.requestTimeoutMs),
    ...(isReadableStreamBody(uploadBody) ? { duplex: "half" as const } : {}),
  };
  const uploadResponse = await createFetch(context)(createPayload.file_upload_url, uploadInit);

  if (!uploadResponse.ok) {
    await throwLiveEvalApiError("Failed to upload project fixture", uploadResponse);
  }

  return waitForProjectUploadFixture(context, {
    projectId,
    filePath,
    requestTimeoutMs: input.requestTimeoutMs,
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
  const encodedProjectId = encodePathSegment(projectId, "Live eval project id");
  const encodedFilePath = encodePathSegment(input.filePath, "Live eval project file path");
  const response = await createFetch(context)(
    createApiUrl(context, `/projects/${encodedProjectId}/files/${encodedFilePath}`),
    {
      headers: createLiveEvalAuthHeaders(context),
      signal: createRequestSignal(input.requestTimeoutMs),
    },
  );

  if (response.status === 404) {
    return null;
  }

  if (!response.ok) {
    await throwLiveEvalApiError("Failed to read project file", response);
  }

  const payload = getProjectFileResponseSchema().parse(await response.json());
  return {
    path: payload.path ?? input.filePath,
    content: payload.content ?? "",
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
  const description = input.description === undefined
    ? "eval platform capability release"
    : normalizeEvalString(input.description, "Live eval release description");
  const response = await createFetch(context)(
    createApiUrl(
      context,
      `/projects/${encodePathSegment(projectId, "Live eval project id")}/releases`,
    ),
    {
      method: "POST",
      headers: createLiveEvalJsonHeaders(context),
      body: JSON.stringify({
        description,
      }),
      signal: createRequestSignal(input.requestTimeoutMs),
    },
  );

  if (!response.ok) {
    await throwLiveEvalApiError("Failed to create release", response);
  }

  const payload = getLiveEvalIdResponseSchema().parse(await response.json());
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
  const encodedProjectId = encodePathSegment(projectId, "Live eval project id");
  const encodedFilePath = encodePathSegment(input.filePath, "Live eval project file path");

  const response = await createFetch(context)(
    createApiUrl(context, `/projects/${encodedProjectId}/files/${encodedFilePath}`),
    {
      method: "DELETE",
      headers: createLiveEvalAuthHeaders(context),
      signal: createRequestSignal(input.requestTimeoutMs),
    },
  );

  if (!response.ok && response.status !== 404) {
    await throwLiveEvalApiError("Failed to delete project file", response);
  }
}

async function listOpenLiveEvalInputRequestsWithSignal(
  context: LiveEvalApiContext,
  input: LiveEvalConversationInput,
  callerSignal?: AbortSignal,
): Promise<LiveEvalInputRequestRecord[]> {
  const conversationId = encodePathSegment(
    input.conversationId,
    "Live eval conversation id",
  );
  const signalScope = callerSignal
    ? createRequestSignalScope(input.requestTimeoutMs, callerSignal)
    : { signal: createRequestSignal(input.requestTimeoutMs), dispose: () => {} };
  try {
    const response = await createFetch(context)(
      createApiUrl(context, `/conversations/${conversationId}/input-requests?status=open`),
      {
        headers: createLiveEvalAuthHeaders(context),
        signal: signalScope.signal,
      },
    );

    if (!response.ok) {
      await throwLiveEvalApiError("Failed to list eval input requests", response);
    }

    const payload = getInputRequestListResponseSchema().parse(await response.json());
    return (payload.data ?? []).flatMap((item) => {
      const parsed = getInputRequestRecordSchema().safeParse(item);
      return parsed.success && parsed.data.status === "open" ? [parsed.data] : [];
    });
  } finally {
    signalScope.dispose();
  }
}

/** List open live eval input requests. */
export function listOpenLiveEvalInputRequests(
  context: LiveEvalApiContext,
  input: LiveEvalConversationInput,
): Promise<LiveEvalInputRequestRecord[]> {
  return listOpenLiveEvalInputRequestsWithSignal(context, input);
}

/** Request payload for wait for open live eval input. */
export async function waitForOpenLiveEvalInputRequest(
  context: LiveEvalApiContext,
  input: LiveEvalWaitForOpenInputRequestInput,
): Promise<string> {
  const timeoutMs = validateTimerValue(
    input.timeoutMs ?? 30_000,
    "Live eval input request timeoutMs",
    1,
  );
  const pollIntervalMs = validateTimerValue(
    input.pollIntervalMs ?? 500,
    "Live eval input request pollIntervalMs",
    0,
  );
  const deadline = Date.now() + timeoutMs;

  try {
    while (Date.now() < deadline) {
      input.abortSignal.throwIfAborted();
      const remainingMs = Math.max(1, deadline - Date.now());
      const requests = await listOpenLiveEvalInputRequestsWithSignal(
        context,
        {
          ...input,
          requestTimeoutMs: Math.min(input.requestTimeoutMs, remainingMs),
        },
        input.abortSignal,
      );
      const request = requests[0];
      if (request) {
        return request.id;
      }

      const waitMs = Math.min(pollIntervalMs, Math.max(0, deadline - Date.now()));
      await wait({ ms: waitMs, signal: input.abortSignal });
    }
  } catch (error) {
    if (input.abortSignal.aborted) {
      throw TIMEOUT_ERROR.create({
        detail: "Eval sidecar aborted before an input request appeared",
        cause: error,
      });
    }
    if (error instanceof DOMException && error.name === "TimeoutError") {
      throw TIMEOUT_ERROR.create({
        detail:
          `Timed out while waiting for an open input request in conversation ${input.conversationId}`,
        cause: error,
      });
    }
    throw error;
  }

  throw TIMEOUT_ERROR.create({
    detail:
      `Timed out while waiting for an open input request in conversation ${input.conversationId}`,
  });
}

/** Response payload for submit live eval input. */
export async function submitLiveEvalInputResponse(
  context: LiveEvalApiContext,
  input: LiveEvalSubmitInputResponseInput,
): Promise<void> {
  assertLiveEvalInputResponseValues(input.values);
  const conversationId = encodePathSegment(
    input.conversationId,
    "Live eval conversation id",
  );
  const inputRequestId = encodePathSegment(
    input.inputRequestId,
    "Live eval input request id",
  );
  const response = await createFetch(context)(
    createApiUrl(
      context,
      `/conversations/${conversationId}/input-requests/${inputRequestId}/responses`,
    ),
    {
      method: "POST",
      headers: createLiveEvalJsonHeaders(context),
      body: JSON.stringify({ values: input.values }),
      signal: createRequestSignal(input.requestTimeoutMs),
    },
  );

  if (!response.ok) {
    await throwLiveEvalApiError("Failed to submit eval input response", response);
  }
}

/** Request payload for cancel live eval input. */
export async function cancelLiveEvalInputRequest(
  context: LiveEvalApiContext,
  input: LiveEvalInputRequestInput,
): Promise<void> {
  const conversationId = encodePathSegment(
    input.conversationId,
    "Live eval conversation id",
  );
  const inputRequestId = encodePathSegment(
    input.inputRequestId,
    "Live eval input request id",
  );
  const response = await createFetch(context)(
    createApiUrl(
      context,
      `/conversations/${conversationId}/input-requests/${inputRequestId}/cancel`,
    ),
    {
      method: "POST",
      headers: createLiveEvalAuthHeaders(context),
      signal: createRequestSignal(input.requestTimeoutMs),
    },
  );

  if (!response.ok) {
    await throwLiveEvalApiError("Failed to cancel eval input request", response);
  }
}
