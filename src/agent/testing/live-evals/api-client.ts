import { ensureBuiltinSchemaValidator } from "#veryfront/extensions/builtin-extensions.ts";
import type { InferSchema } from "#veryfront/extensions/schema/index.ts";
import { defineSchema } from "#veryfront/schemas/index.ts";
import type { LiveEvalProjectFile } from "./runner.ts";

ensureBuiltinSchemaValidator();

export interface LiveEvalApiContext {
  apiUrl: string;
  authToken: string;
  projectId: string | null;
  fetch?: (input: string | URL | Request, init?: RequestInit) => Promise<Response>;
}

export interface LiveEvalRequestTimeoutInput {
  requestTimeoutMs: number;
}

export interface LiveEvalCreateConversationInput extends LiveEvalRequestTimeoutInput {
  title: string;
}

export interface LiveEvalConversationInput extends LiveEvalRequestTimeoutInput {
  conversationId: string;
}

export interface LiveEvalProjectUploadFixtureInput extends LiveEvalRequestTimeoutInput {
  filePath: string;
  contentType: string;
  body: BodyInit | Uint8Array;
  size?: number;
  pollIntervalMs?: number;
  maxAttempts?: number;
}

export interface LiveEvalProjectFileInput extends LiveEvalRequestTimeoutInput {
  filePath: string;
}

export interface LiveEvalCreateReleaseInput extends LiveEvalRequestTimeoutInput {
  description?: string;
}

export interface LiveEvalWaitForOpenInputRequestInput extends LiveEvalConversationInput {
  abortSignal: AbortSignal;
  pollIntervalMs?: number;
  timeoutMs?: number;
}

export interface LiveEvalInputResponseValues {
  [key: string]: string | boolean | number | null;
}

export interface LiveEvalSubmitInputResponseInput extends LiveEvalRequestTimeoutInput {
  conversationId: string;
  inputRequestId: string;
  values: LiveEvalInputResponseValues;
}

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

export type LiveEvalInputRequestRecord = InferSchema<
  ReturnType<typeof getInputRequestRecordSchema>
>;

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
    throw new Error(errorMessage);
  }

  return projectId;
}

function createFetch(context: LiveEvalApiContext) {
  return context.fetch ?? fetch;
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
  if (typeof explicitSize === "number") {
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
  throw new Error("Project upload fixtures require size when body length cannot be inferred");
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

function getResponseText(response: Response): Promise<string> {
  return response.text();
}

async function wait(input: { ms: number }): Promise<void> {
  await new Promise((resolve) => {
    setTimeout(resolve, input.ms);
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
  const listUrl = createApiUrl(context, `/projects/${input.projectId}/uploads`);
  const requestFetch = createFetch(context);
  const maxAttempts = input.maxAttempts ?? 12;
  const pollIntervalMs = input.pollIntervalMs ?? 2_000;

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const listResponse = await requestFetch(listUrl, {
      headers: createLiveEvalAuthHeaders(context),
      signal: AbortSignal.timeout(input.requestTimeoutMs),
    });

    if (!listResponse.ok) {
      throw new Error(
        `Failed to confirm project upload fixture: ${listResponse.status} ${await getResponseText(
          listResponse,
        )}`,
      );
    }

    const payload = getProjectUploadListResponseSchema().parse(await listResponse.json());
    if (payload.data?.some((upload) => upload.path === input.filePath)) {
      return input.filePath;
    }

    if (attempt + 1 < maxAttempts) {
      await wait({ ms: pollIntervalMs });
    }
  }

  throw new Error(`Project upload fixture did not appear in time: ${input.filePath}`);
}

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

export async function createLiveEvalConversation(
  context: LiveEvalApiContext,
  input: LiveEvalCreateConversationInput,
): Promise<string> {
  const response = await createFetch(context)(createApiUrl(context, "/conversations"), {
    method: "POST",
    headers: createLiveEvalJsonHeaders(context),
    body: JSON.stringify({
      ...(context.projectId ? { project_id: context.projectId } : {}),
      title: input.title,
    }),
    signal: AbortSignal.timeout(input.requestTimeoutMs),
  });

  if (!response.ok) {
    throw new Error(
      `Failed to create eval conversation: ${response.status} ${await getResponseText(response)}`,
    );
  }

  const payload = getLiveEvalIdResponseSchema().parse(await response.json());
  if (!payload.id) {
    throw new Error("Conversation creation response did not include id");
  }

  return payload.id;
}

export async function deleteLiveEvalConversation(
  context: LiveEvalApiContext,
  input: LiveEvalConversationInput,
): Promise<void> {
  const response = await createFetch(context)(
    createApiUrl(context, `/conversations/${input.conversationId}`),
    {
      method: "DELETE",
      headers: createLiveEvalAuthHeaders(context),
      signal: AbortSignal.timeout(input.requestTimeoutMs),
    },
  );

  if (!response.ok && response.status !== 404) {
    throw new Error(
      `Failed to delete eval conversation ${input.conversationId}: ${response.status} ${await getResponseText(
        response,
      )}`,
    );
  }
}

export async function createLiveEvalProjectUploadFixture(
  context: LiveEvalApiContext,
  input: LiveEvalProjectUploadFixtureInput,
): Promise<string> {
  const projectId = requireLiveEvalProjectId(
    context.projectId,
    "Project upload fixtures require a live-eval project id",
  );

  const createResponse = await createFetch(context)(
    createApiUrl(context, `/projects/${projectId}/uploads`),
    {
      method: "POST",
      headers: createLiveEvalJsonHeaders(context),
      body: JSON.stringify({
        file_path: input.filePath,
        content_type: input.contentType,
        size: getProjectUploadBodySize(input.body, input.size),
      }),
      signal: AbortSignal.timeout(input.requestTimeoutMs),
    },
  );

  if (!createResponse.ok) {
    throw new Error(
      `Failed to create project upload URL: ${createResponse.status} ${await getResponseText(
        createResponse,
      )}`,
    );
  }

  const createPayload = getProjectUploadResponseSchema().parse(await createResponse.json());
  if (!createPayload.file_upload_url) {
    throw new Error("Project upload response did not include file_upload_url");
  }

  const uploadResponse = await createFetch(context)(createPayload.file_upload_url, {
    method: "PUT",
    headers: createProjectUploadHeaders(createPayload.required_headers, input.contentType),
    body: createProjectUploadBody(input.body, input.contentType),
    signal: AbortSignal.timeout(input.requestTimeoutMs),
  });

  if (!uploadResponse.ok) {
    throw new Error(
      `Failed to upload project fixture: ${uploadResponse.status} ${await getResponseText(
        uploadResponse,
      )}`,
    );
  }

  return waitForProjectUploadFixture(context, {
    projectId,
    filePath: input.filePath,
    requestTimeoutMs: input.requestTimeoutMs,
    pollIntervalMs: input.pollIntervalMs,
    maxAttempts: input.maxAttempts,
  });
}

export async function getLiveEvalProjectFile(
  context: LiveEvalApiContext,
  input: LiveEvalProjectFileInput,
): Promise<LiveEvalProjectFile | null> {
  const projectId = requireLiveEvalProjectId(
    context.projectId,
    "getLiveEvalProjectFile requires a live-eval project id",
  );
  const response = await createFetch(context)(
    createApiUrl(context, `/projects/${projectId}/files/${encodeURIComponent(input.filePath)}`),
    {
      headers: createLiveEvalAuthHeaders(context),
      signal: AbortSignal.timeout(input.requestTimeoutMs),
    },
  );

  if (response.status === 404) {
    return null;
  }

  if (!response.ok) {
    throw new Error(
      `Failed to read project file: ${response.status} ${await getResponseText(response)}`,
    );
  }

  const payload = getProjectFileResponseSchema().parse(await response.json());
  return {
    path: payload.path ?? input.filePath,
    content: payload.content ?? "",
  };
}

export async function createLiveEvalRelease(
  context: LiveEvalApiContext,
  input: LiveEvalCreateReleaseInput,
): Promise<string> {
  const projectId = requireLiveEvalProjectId(
    context.projectId,
    "createLiveEvalRelease requires a live-eval project id",
  );
  const response = await createFetch(context)(
    createApiUrl(context, `/projects/${projectId}/releases`),
    {
      method: "POST",
      headers: createLiveEvalJsonHeaders(context),
      body: JSON.stringify({
        description: input.description ?? "eval platform capability release",
      }),
      signal: AbortSignal.timeout(input.requestTimeoutMs),
    },
  );

  if (!response.ok) {
    throw new Error(
      `Failed to create release: ${response.status} ${await getResponseText(response)}`,
    );
  }

  const payload = getLiveEvalIdResponseSchema().parse(await response.json());
  if (!payload.id) {
    throw new Error("Release creation response did not include id");
  }

  return payload.id;
}

export async function deleteLiveEvalProjectFile(
  context: LiveEvalApiContext,
  input: LiveEvalProjectFileInput,
): Promise<void> {
  const projectId = context.projectId;
  if (!projectId) {
    return;
  }

  const response = await createFetch(context)(
    createApiUrl(context, `/projects/${projectId}/files/${encodeURIComponent(input.filePath)}`),
    {
      method: "DELETE",
      headers: createLiveEvalAuthHeaders(context),
      signal: AbortSignal.timeout(input.requestTimeoutMs),
    },
  );

  if (!response.ok && response.status !== 404) {
    throw new Error(
      `Failed to delete project file: ${response.status} ${await getResponseText(response)}`,
    );
  }
}

export async function listOpenLiveEvalInputRequests(
  context: LiveEvalApiContext,
  input: LiveEvalConversationInput,
): Promise<LiveEvalInputRequestRecord[]> {
  const response = await createFetch(context)(
    createApiUrl(context, `/conversations/${input.conversationId}/input-requests?status=open`),
    {
      headers: createLiveEvalAuthHeaders(context),
      signal: AbortSignal.timeout(input.requestTimeoutMs),
    },
  );

  if (!response.ok) {
    throw new Error(
      `Failed to list eval input requests: ${response.status} ${await getResponseText(response)}`,
    );
  }

  const payload = getInputRequestListResponseSchema().parse(await response.json());
  return (payload.data ?? []).flatMap((item) => {
    const parsed = getInputRequestRecordSchema().safeParse(item);
    return parsed.success ? [parsed.data] : [];
  });
}

export async function waitForOpenLiveEvalInputRequest(
  context: LiveEvalApiContext,
  input: LiveEvalWaitForOpenInputRequestInput,
): Promise<string> {
  const timeoutMs = input.timeoutMs ?? 30_000;
  const pollIntervalMs = input.pollIntervalMs ?? 500;
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    if (input.abortSignal.aborted) {
      throw new Error("Eval sidecar aborted before an input request appeared");
    }

    const requests = await listOpenLiveEvalInputRequests(context, input);
    const request = requests[0];
    if (request) {
      return request.id;
    }

    await wait({ ms: pollIntervalMs });
  }

  throw new Error(
    `Timed out while waiting for an open input request in conversation ${input.conversationId}`,
  );
}

export async function submitLiveEvalInputResponse(
  context: LiveEvalApiContext,
  input: LiveEvalSubmitInputResponseInput,
): Promise<void> {
  const response = await createFetch(context)(
    createApiUrl(
      context,
      `/conversations/${input.conversationId}/input-requests/${input.inputRequestId}/responses`,
    ),
    {
      method: "POST",
      headers: createLiveEvalJsonHeaders(context),
      body: JSON.stringify({ values: input.values }),
      signal: AbortSignal.timeout(input.requestTimeoutMs),
    },
  );

  if (!response.ok) {
    throw new Error(
      `Failed to submit eval input response: ${response.status} ${await getResponseText(response)}`,
    );
  }
}

export async function cancelLiveEvalInputRequest(
  context: LiveEvalApiContext,
  input: LiveEvalInputRequestInput,
): Promise<void> {
  const response = await createFetch(context)(
    createApiUrl(
      context,
      `/conversations/${input.conversationId}/input-requests/${input.inputRequestId}/cancel`,
    ),
    {
      method: "POST",
      headers: createLiveEvalAuthHeaders(context),
      signal: AbortSignal.timeout(input.requestTimeoutMs),
    },
  );

  if (!response.ok) {
    throw new Error(
      `Failed to cancel eval input request: ${response.status} ${await getResponseText(response)}`,
    );
  }
}
