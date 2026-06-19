import { defineSchema } from "#veryfront/schemas/index.ts";
import { tool, type ToolExecutionContext } from "#veryfront/tool";

const DEFAULT_MAX_CONTENT_CHARS = 500_000;

/** Input payload for hosted web_fetch. */
export type HostedWebFetchToolInput = {
  url: string;
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
  truncated?: boolean;
};

/** Options accepted by hosted web_fetch. */
export type HostedWebFetchToolOptions = {
  fetch?: typeof fetch;
  maxContentChars?: number;
};

const getHostedWebFetchInputSchema = defineSchema((v) =>
  v.object({
    url: v.string().min(1),
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

async function executeHostedWebFetch(
  input: HostedWebFetchToolInput,
  options: Required<HostedWebFetchToolOptions>,
  context?: ToolExecutionContext,
): Promise<HostedWebFetchToolOutput> {
  const url = parseFetchUrl(input.url);
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
  const truncated = text.length > options.maxContentChars;

  return {
    type: "web_fetch_result",
    url: response.url || url.toString(),
    content: {
      type: "document",
      source: {
        type: "text",
        mediaType,
        data: truncated ? text.slice(0, options.maxContentChars) : text,
      },
    },
    retrievedAt: new Date().toISOString(),
    status: response.status,
    ...(truncated ? { truncated } : {}),
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
      "Fetch the content of an explicit http or https URL directly. Use this for canonical documentation or pages named in the task or available context; no prior web_search is required.",
    inputSchema: getHostedWebFetchInputSchema(),
    execute: (input, context) => executeHostedWebFetch(input, resolvedOptions, context),
  });
}
