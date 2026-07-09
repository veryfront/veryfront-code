import { defineSchema } from "#veryfront/schemas/index.ts";
import { tool, type ToolExecutionContext } from "#veryfront/tool";

const DEFAULT_MAX_CONTENT_CHARS = 500_000;

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
  maxContentChars?: number;
};

const getHostedWebFetchInputSchema = defineSchema((v) =>
  v.object({
    url: v.string().min(1),
    cursor: v.string().min(1).optional(),
    max_content_chars: v.number().int().positive(
      "web_fetch max_content_chars must be a positive integer",
    )
      .max(DEFAULT_MAX_CONTENT_CHARS)
      .optional(),
  })
);

function parseFetchUrl(value: string): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("web_fetch requires an absolute URL");
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("web_fetch only supports http and https URLs");
  }
  if (url.username || url.password) {
    throw new Error("web_fetch does not support credentials in URLs");
  }

  return url;
}

function parseCursor(value: string | undefined): number {
  if (value === undefined) {
    return 0;
  }

  if (!/^\d+$/.test(value)) {
    throw new Error(
      "web_fetch cursor must be a non-negative integer offset returned by a previous web_fetch result",
    );
  }

  const offset = Number(value);
  if (!Number.isSafeInteger(offset)) {
    throw new Error(
      "web_fetch cursor must be a non-negative integer offset returned by a previous web_fetch result",
    );
  }

  return offset;
}

function normalizeMaxContentChars(value: number | undefined, label: string): number {
  if (value === undefined) {
    return DEFAULT_MAX_CONTENT_CHARS;
  }

  if (!Number.isSafeInteger(value) || value < 1) {
    throw new Error(`web_fetch ${label} must be a positive integer`);
  }

  return Math.min(value, DEFAULT_MAX_CONTENT_CHARS);
}

function resolveMaxContentChars(
  input: HostedWebFetchToolInput,
  options: Required<HostedWebFetchToolOptions>,
): number {
  const optionMax = normalizeMaxContentChars(options.maxContentChars, "maxContentChars option");
  if (input.max_content_chars === undefined) {
    return optionMax;
  }

  const inputMax = normalizeMaxContentChars(input.max_content_chars, "max_content_chars");
  return Math.min(inputMax, optionMax);
}

async function executeHostedWebFetch(
  input: HostedWebFetchToolInput,
  options: Required<HostedWebFetchToolOptions>,
  context?: ToolExecutionContext,
): Promise<HostedWebFetchToolOutput> {
  const url = parseFetchUrl(input.url);
  const offset = parseCursor(input.cursor);
  const maxContentChars = resolveMaxContentChars(input, options);
  const response = await options.fetch(url.toString(), {
    method: "GET",
    redirect: "follow",
    signal: context?.abortSignal,
    headers: {
      accept: "text/markdown,text/plain,text/html,application/xhtml+xml,application/xml,*/*;q=0.8",
      "user-agent": "Veryfront web_fetch",
    },
  });

  if (!response.ok) {
    throw new Error(`web_fetch failed with HTTP ${response.status}`);
  }

  const mediaType = response.headers.get("content-type") ?? "text/plain";
  const text = await response.text();
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
  const resolvedOptions: Required<HostedWebFetchToolOptions> = {
    fetch: options.fetch ?? globalThis.fetch,
    maxContentChars: options.maxContentChars ?? DEFAULT_MAX_CONTENT_CHARS,
  };

  return tool<HostedWebFetchToolInput, HostedWebFetchToolOutput>({
    id: "web_fetch",
    description:
      "Fetch the content of an explicit http or https URL directly. Use this for canonical documentation or pages named in the task or available context; no prior web_search is required. Returns complete, truncated, and page_info.next metadata when a response is sliced; pass cursor to continue.",
    inputSchema: getHostedWebFetchInputSchema(),
    execute: (input, context) => executeHostedWebFetch(input, resolvedOptions, context),
  });
}
