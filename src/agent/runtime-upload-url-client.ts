import { z } from "zod";

const DEFAULT_RUNTIME_UPLOAD_URL_TIMEOUT_MS = 15_000;

const runtimeUploadUrlResponseSchema = z.object({
  signed_url: z.string(),
});

const apiErrorBodySchema = z
  .object({
    detail: z.string().optional(),
    message: z.string().optional(),
    error: z.string().optional(),
  })
  .passthrough();

export type RuntimeUploadUrlFetch = (url: string, init: RequestInit) => Promise<Response>;

export type RuntimeUploadUrlClientOptions = {
  apiUrl: string | URL;
  fetch?: RuntimeUploadUrlFetch;
  timeoutMs?: number;
};

export type RuntimeUploadUrlOptions = RuntimeUploadUrlClientOptions & {
  authToken: string;
  uploadId: string;
  projectId?: string | null;
};

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

  const parsed = runtimeUploadUrlResponseSchema.safeParse(await response.json());
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
