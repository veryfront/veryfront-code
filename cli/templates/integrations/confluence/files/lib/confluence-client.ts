import { getAccessToken, getCloudId } from "./token-store.ts";

const CONFLUENCE_API_BASE = "https://api.atlassian.com/ex/confluence";

interface ConfluenceResponse<T> {
  results: T[];
  size?: number;
  start?: number;
  limit?: number;
  _links?: {
    next?: string;
    base?: string;
  };
}

export interface ConfluenceSpace {
  id: string;
  key: string;
  name: string;
  type: string;
  status: string;
  _links: {
    webui: string;
  };
}

export type ConfluencePageType = "page" | "blogpost";

export interface ConfluencePage {
  id: string;
  type?: ConfluencePageType;
  status: string;
  title: string;
  spaceId?: string;
  parentId?: string;
  version: {
    number: number;
    message?: string;
  };
  body?: {
    storage?: {
      value: string;
      representation: "storage";
    };
    view?: {
      value: string;
      representation: "view";
    };
  };
  _links: {
    webui: string;
    tinyui?: string;
  };
}

export interface ConfluenceSearchResult {
  content: {
    id: string;
    type: string;
    status: string;
    title: string;
    space?: {
      id: string;
      key: string;
      name: string;
    };
    history?: {
      lastUpdated: {
        when: string;
      };
    };
    _links: {
      webui: string;
    };
  };
  excerpt?: string;
  url: string;
  resultGlobalContainer?: {
    title: string;
  };
}

export class ConfluenceApiError extends Error {
  constructor(public readonly status: number, message: string) {
    super(message);
    this.name = "ConfluenceApiError";
  }
}

async function confluenceFetch<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
  const [token, cloudId] = await Promise.all([getAccessToken(), getCloudId()]);

  if (!token || !cloudId) {
    throw new Error("Not authenticated with Confluence. Please connect your Atlassian account.");
  }

  const url = `${CONFLUENCE_API_BASE}/${cloudId}${endpoint}`;

  const response = await fetch(url, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
      "Content-Type": "application/json",
      ...options.headers,
    },
  });

  if (!response.ok) {
    const error = (await response.json().catch(() => ({}))) as { message?: string };
    throw new ConfluenceApiError(
      response.status,
      `Confluence API error: ${response.status} ${error.message ?? response.statusText}`,
    );
  }

  return response.json() as Promise<T>;
}

function buildEndpoint(path: string, params?: URLSearchParams): string {
  const query = params?.toString();
  return `${path}${query ? `?${query}` : ""}`;
}

// Uses Confluence v2 — v1 /wiki/rest/api/space is deprecated alongside /content.
export async function listSpaces(options?: {
  limit?: number;
  type?: "global" | "personal";
}): Promise<ConfluenceSpace[]> {
  const params = new URLSearchParams();

  if (options?.limit) params.set("limit", options.limit.toString());
  if (options?.type) params.set("type", options.type);

  const response = await confluenceFetch<ConfluenceResponse<ConfluenceSpace>>(
    buildEndpoint("/wiki/api/v2/spaces", params),
  );

  return response.results ?? [];
}

// Direct key lookup via v2 — avoids the v1 enumeration trap that capped at 250 spaces
// and silently failed on enterprise tenancies with hundreds of spaces.
async function getSpaceIdByKey(spaceKey: string): Promise<string> {
  const params = new URLSearchParams();
  params.set("keys", spaceKey);
  params.set("limit", "1");

  const response = await confluenceFetch<ConfluenceResponse<ConfluenceSpace>>(
    buildEndpoint("/wiki/api/v2/spaces", params),
  );

  const space = response.results?.[0];
  if (!space) {
    throw new Error(`Confluence space not found: ${spaceKey}`);
  }
  return space.id;
}

export async function searchContent(
  query: string,
  options?: {
    cql?: string;
    limit?: number;
    spaceKey?: string;
  },
): Promise<ConfluenceSearchResult[]> {
  const params = new URLSearchParams();

  let cqlQuery = options?.cql ?? `title ~ "${query}" OR text ~ "${query}"`;
  if (options?.spaceKey) cqlQuery += ` AND space = "${options.spaceKey}"`;

  params.set("cql", cqlQuery);
  if (options?.limit) params.set("limit", options.limit.toString());

  const response = await confluenceFetch<ConfluenceResponse<ConfluenceSearchResult>>(
    buildEndpoint("/wiki/rest/api/search", params),
  );

  return response.results ?? [];
}

// v2 splits pages and blogposts into separate resources. Try /pages first;
// fall back to /blogposts on 404 so search-content → get-page works for both
// (searchContent returns mixed results and tools/get-page.ts has no type discriminator).
export async function getPage(pageId: string): Promise<ConfluencePage> {
  try {
    return await confluenceFetch<ConfluencePage>(
      `/wiki/api/v2/pages/${pageId}?body-format=storage`,
    );
  } catch (error) {
    if (error instanceof ConfluenceApiError && error.status === 404) {
      return await confluenceFetch<ConfluencePage>(
        `/wiki/api/v2/blogposts/${pageId}?body-format=storage`,
      );
    }
    throw error;
  }
}

export function getPageContent(pageId: string): Promise<ConfluencePage> {
  return getPage(pageId);
}

export async function createPage(options: {
  spaceKey: string;
  title: string;
  content: string;
  parentId?: string;
  type?: ConfluencePageType;
}): Promise<ConfluencePage> {
  const spaceId = await getSpaceIdByKey(options.spaceKey);
  const type: ConfluencePageType = options.type ?? "page";

  const body: Record<string, unknown> = {
    spaceId,
    title: options.title,
    status: "current",
    body: {
      representation: "storage",
      value: options.content,
    },
  };

  if (type === "blogpost") {
    // v2 blogposts cannot have a parent — surface the user error instead of dropping it silently.
    if (options.parentId) {
      throw new Error("Confluence blogposts cannot have a parentId");
    }
    return confluenceFetch<ConfluencePage>("/wiki/api/v2/blogposts", {
      method: "POST",
      body: JSON.stringify(body),
    });
  }

  if (options.parentId) body.parentId = options.parentId;

  return confluenceFetch<ConfluencePage>("/wiki/api/v2/pages", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

// v2 PUT /pages/{id} is a full replace, not PATCH — title and body are both required.
// Callers must resolve fallbacks (e.g. from a prior getPage) before invoking this.
export function updatePage(
  pageId: string,
  options: {
    title: string;
    content: string;
    version: number;
    versionMessage?: string;
  },
): Promise<ConfluencePage> {
  const body = {
    id: pageId,
    status: "current",
    title: options.title,
    body: {
      representation: "storage",
      value: options.content,
    },
    version: {
      number: options.version,
      message: options.versionMessage,
    },
  };

  return confluenceFetch<ConfluencePage>(`/wiki/api/v2/pages/${pageId}`, {
    method: "PUT",
    body: JSON.stringify(body),
  });
}

export function extractPlainText(storageHtml: string): string {
  return storageHtml
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

export function formatAsStorage(text: string): string {
  const paragraphs = text.split("\n\n").filter((p) => p.trim());
  return paragraphs.map((p) => `<p>${escapeHtml(p.trim())}</p>`).join("\n");
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
