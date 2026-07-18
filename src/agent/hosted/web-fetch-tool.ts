import { defineSchema } from "#veryfront/schemas/index.ts";
import {
  guardedEgressFetch,
  type ResolveWorkerHost,
} from "#veryfront/security/sandbox/worker-egress-guard.ts";
import { tool, type ToolExecutionContext } from "#veryfront/tool";
import { INVALID_ARGUMENT, NETWORK_ERROR, TIMEOUT_ERROR } from "#veryfront/errors";

const DEFAULT_MAX_CONTENT_CHARS = 500_000;
const DEFAULT_MAX_RESPONSE_BYTES = 4 * 1024 * 1024;
const DEFAULT_FETCH_TIMEOUT_MS = 30_000;

/** Input payload for hosted web_fetch. */
export type HostedWebFetchToolInput = {
  url: string;
  cursor?: string;
  max_content_chars?: number;
};

/** Output payload matching provider-native web_fetch result shape. */
export type HostedWebFetchToolOutput = {
  type: "web_fetch_result";
  url: string;
  content: {
    type: "document";
    source: {
      type: "text";
      mediaType: string;
      data: string;
    };
  };
  retrievedAt: string;
  status: number;
  complete: boolean;
  truncated: boolean;
  page_info: {
    offset: number;
    returned_chars: number;
    total_chars: number;
    next: string | null;
  };
};

/** Options accepted by hosted web_fetch. */
export type HostedWebFetchToolOptions = {
  fetch?: typeof fetch;
  resolveHost?: ResolveWorkerHost;
  maxContentChars?: number;
  maxResponseBytes?: number;
  timeoutMs?: number;
};

type ResolvedHostedWebFetchToolOptions = {
  fetch: typeof fetch;
  resolveHost?: ResolveWorkerHost;
  maxContentChars: number;
  maxResponseBytes: number;
  timeoutMs: number;
};

const getHostedWebFetchInputSchema = (maxContentChars: number) =>
  defineSchema((v) =>
    v.object({
      url: v.string().min(1),
      cursor: v.string().min(1).optional(),
      max_content_chars: v.number().int().positive(
        "web_fetch max_content_chars must be a positive integer",
      )
        .max(maxContentChars)
        .optional(),
    })
  );

function parseFetchUrl(value: string): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw INVALID_ARGUMENT.create({ detail: "web_fetch requires an absolute URL" });
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw INVALID_ARGUMENT.create({ detail: "web_fetch only supports http and https URLs" });
  }
  if (url.username || url.password) {
    throw INVALID_ARGUMENT.create({ detail: "web_fetch does not support credentials in URLs" });
  }

  return url;
}

function parseCursor(value: string | undefined): number {
  if (value === undefined) {
    return 0;
  }

  if (!/^\d+$/.test(value)) {
    throw INVALID_ARGUMENT.create({
      detail: "web_fetch cursor must be a non-negative integer offset returned by a previous web_fetch result",
    });
  }

  const offset = Number(value);
  if (!Number.isSafeInteger(offset)) {
    throw INVALID_ARGUMENT.create({
      detail: "web_fetch cursor must be a non-negative integer offset returned by a previous web_fetch result",
    });
  }

  return offset;
}

function normalizeMaxContentChars(
  value: number | undefined,
  label: string,
  fallback: number,
): number {
  if (value === undefined) {
    return fallback;
  }

  if (!Number.isSafeInteger(value) || value < 1) {
    throw INVALID_ARGUMENT.create({ detail: `web_fetch ${label} must be a positive integer` });
  }

  return value;
}

function resolveMaxContentChars(
  input: HostedWebFetchToolInput,
  options: ResolvedHostedWebFetchToolOptions,
): number {
  const optionMax = normalizeMaxContentChars(
    options.maxContentChars,
    "maxContentChars option",
    DEFAULT_MAX_CONTENT_CHARS,
  );
  if (input.max_content_chars === undefined) {
    return optionMax;
  }

  const inputMax = normalizeMaxContentChars(
    input.max_content_chars,
    "max_content_chars",
    optionMax,
  );
  return Math.min(inputMax, optionMax);
}

async function readResponseTextWithLimit(response: Response, maxBytes: number): Promise<string> {
  const contentLength = response.headers.get("content-length");
  if (contentLength && Number(contentLength) > maxBytes) {
    throw INVALID_ARGUMENT.create({ detail: "web_fetch response exceeds maximum size" });
  }

  const reader = response.body?.getReader();
  if (!reader) return "";

  const chunks: Uint8Array[] = [];
  let totalBytes = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      totalBytes += value.byteLength;
      if (totalBytes > maxBytes) {
        await reader.cancel().catch(() => undefined);
        throw INVALID_ARGUMENT.create({ detail: "web_fetch response exceeds maximum size" });
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const bytes = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(bytes);
}

function createFetchAbortScope(parent: AbortSignal | undefined, timeoutMs: number): {
  signal: AbortSignal;
  didTimeout: () => boolean;
  cleanup: () => void;
} {
  const controller = new AbortController();
  let timedOut = false;
  const abortFromParent = () => controller.abort(parent?.reason);

  if (parent?.aborted) abortFromParent();
  else parent?.addEventListener("abort", abortFromParent, { once: true });

  const timeoutId = setTimeout(() => {
    timedOut = true;
    controller.abort(new Error("web_fetch timed out"));
  }, timeoutMs);

  return {
    signal: controller.signal,
    didTimeout: () => timedOut,
    cleanup: () => {
      clearTimeout(timeoutId);
      parent?.removeEventListener("abort", abortFromParent);
    },
  };
}

async function executeHostedWebFetch(
  input: HostedWebFetchToolInput,
  options: ResolvedHostedWebFetchToolOptions,
  context?: ToolExecutionContext,
): Promise<HostedWebFetchToolOutput> {
  const url = parseFetchUrl(input.url);
  const offset = parseCursor(input.cursor);
  const maxContentChars = resolveMaxContentChars(input, options);
  const abortScope = createFetchAbortScope(context?.abortSignal, options.timeoutMs);
  let response: Response;
  let text: string;

  try {
    response = await guardedEgressFetch(
      url,
      {
        method: "GET",
        redirect: "follow",
        signal: abortScope.signal,
        headers: {
          accept:
            "text/markdown,text/plain,text/html,application/xhtml+xml,application/xml,*/*;q=0.8",
          "user-agent": "Veryfront web_fetch",
        },
      },
      {
        fetchImpl: options.fetch,
        options: { resolveHost: options.resolveHost },
      },
    );

    if (!response.ok) {
      throw NETWORK_ERROR.create({ detail: `web_fetch failed with HTTP ${response.status}` });
    }

    text = await readResponseTextWithLimit(response, options.maxResponseBytes);
  } catch (error) {
    if (abortScope.didTimeout()) {
      throw TIMEOUT_ERROR.create({ detail: `web_fetch timed out after ${options.timeoutMs}ms`, cause: error });
    }
    throw error;
  } finally {
    abortScope.cleanup();
  }

  const mediaType = response.headers.get("content-type") ?? "text/plain";
  if (offset > text.length) {
    throw INVALID_ARGUMENT.create({ detail: "web_fetch cursor exceeds fetched content length" });
  }

  const end = Math.min(text.length, offset + maxContentChars);
  const data = text.slice(offset, end);
  const next = end < text.length ? String(end) : null;
  const complete = next === null;

  return {
    type: "web_fetch_result",
    url: response.url || url.toString(),
    content: {
      type: "document",
      source: {
        type: "text",
        mediaType,
        data,
      },
    },
    retrievedAt: new Date().toISOString(),
    status: response.status,
    complete,
    truncated: !complete,
    page_info: {
      offset,
      returned_chars: data.length,
      total_chars: text.length,
      next,
    },
  };
}

/** Create hosted web_fetch tool that allows direct explicit URL fetches. */
export function createHostedWebFetchTool(options: HostedWebFetchToolOptions = {}) {
  const resolvedOptions: ResolvedHostedWebFetchToolOptions = {
    fetch: options.fetch ?? globalThis.fetch,
    resolveHost: options.resolveHost,
    maxContentChars: normalizeMaxContentChars(
      options.maxContentChars,
      "maxContentChars option",
      DEFAULT_MAX_CONTENT_CHARS,
    ),
    maxResponseBytes: normalizeMaxContentChars(
      options.maxResponseBytes,
      "maxResponseBytes option",
      DEFAULT_MAX_RESPONSE_BYTES,
    ),
    timeoutMs: normalizeMaxContentChars(
      options.timeoutMs,
      "timeoutMs option",
      DEFAULT_FETCH_TIMEOUT_MS,
    ),
  };

  return tool<HostedWebFetchToolInput, HostedWebFetchToolOutput>({
    id: "web_fetch",
    description:
      "Fetch the content of an explicit http or https URL directly. Use this for canonical documentation or pages named in the task or available context; no prior web_search is required. Returns complete, truncated, and page_info.next metadata when a response is sliced; pass cursor to continue.",
    inputSchema: getHostedWebFetchInputSchema(resolvedOptions.maxContentChars)(),
    execute: (input, context) => executeHostedWebFetch(input, resolvedOptions, context),
  });
}
