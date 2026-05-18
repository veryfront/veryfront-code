import { defineSchema } from "#veryfront/schemas/index.ts";

const DEFAULT_RUNTIME_UPLOAD_URL_TIMEOUT_MS = 15_000;

const getRuntimeUploadUrlResponseSchema = defineSchema((v) =>
  v.object({
    signed_url: v.string(),
  })
);

const getApiErrorBodySchema = defineSchema((v) =>
  v.object({
    detail: v.string().optional(),
    message: v.string().optional(),
    error: v.string().optional(),
  }).passthrough()
);

/** Public API contract for runtime upload URL fetch. */
export type RuntimeUploadUrlFetch = (url: string, init: RequestInit) => Promise<Response>;

/** Options accepted by runtime upload URL client. */
export type RuntimeUploadUrlClientOptions = {
  apiUrl: string | URL;
  fetch?: RuntimeUploadUrlFetch;
  timeoutMs?: number;
};

/** Options accepted by runtime upload URL. */
export type RuntimeUploadUrlOptions = RuntimeUploadUrlClientOptions & {
  authToken: string;
  uploadId: string;
  projectId?: string | null;
};

/** Return runtime upload URL. */
export async function getRuntimeUploadUrl(options: RuntimeUploadUrlOptions): Promise<string> {
  const url = createRuntimeUploadUrl(options);
  const response = await (options.fetch ?? fetch)(url.toString(), {
    headers: {
      Authorization: `Bearer ${options.authToken}`,
    },
    signal: AbortSignal.timeout(options.timeoutMs ?? DEFAULT_RUNTIME_UPLOAD_URL_TIMEOUT_MS),
  });

  if (!response.ok) {
    throw new Error(
      `Failed to fetch signed upload URL for ${options.uploadId}: ${await readApiErrorMessage(
        response,
      )}`,
    );
  }

  const parsed = getRuntimeUploadUrlResponseSchema().safeParse(await response.json());
  if (!parsed.success) {
    throw new Error(
      `Failed to fetch signed upload URL for ${options.uploadId}: invalid API response`,
    );
  }

  return parsed.data.signed_url;
}

function createRuntimeUploadUrl(input: {
  apiUrl: string | URL;
  uploadId: string;
  projectId?: string | null;
}): URL {
  const apiUrl = new URL(input.apiUrl);
  const encodedUploadId = encodeURIComponent(input.uploadId);
  const pathname = input.projectId
    ? `/projects/${encodeURIComponent(input.projectId)}/uploads/${encodedUploadId}/url`
    : `/uploads/${encodedUploadId}/url`;
  return new URL(pathname, apiUrl.origin);
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
