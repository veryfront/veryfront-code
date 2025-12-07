import { getAccessToken } from "./token-store.ts";

const NOTION_API_VERSION = "2022-06-28";
const NOTION_BASE_URL = "https://api.notion.com/v1";

interface NotionResponse<T> {
  object: string;
  results?: T[];
  next_cursor?: string | null;
  has_more?: boolean;
}

interface NotionPage {
  id: string;
  object: "page";
  created_time: string;
  last_edited_time: string;
  parent: { type: string; database_id?: string; page_id?: string };
  properties: Record<string, NotionProperty>;
  url: string;
}

interface NotionDatabase {
  id: string;
  object: "database";
  title: Array<{ plain_text: string }>;
  properties: Record<string, { type: string }>;
}

interface NotionBlock {
  id: string;
  type: string;
  [key: string]: unknown;
}

interface NotionProperty {
  type: string;
  title?: Array<{ plain_text: string }>;
  rich_text?: Array<{ plain_text: string }>;
  [key: string]: unknown;
}

async function notionFetch<T>(
  endpoint: string,
  options: RequestInit = {},
): Promise<T> {
  const token = await getAccessToken();
  if (!token) {
    throw new Error("Not authenticated with Notion. Please connect your account.");
  }

  const response = await fetch(`${NOTION_BASE_URL}${endpoint}`, {
    ...options,
    headers: {
      "Authorization": `Bearer ${token}`,
      "Notion-Version": NOTION_API_VERSION,
      "Content-Type": "application/json",
      ...options.headers,
    },
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(
      `Notion API error: ${response.status} ${error.message || response.statusText}`,
    );
  }

  return response.json();
}

export async function searchNotion(
  query: string,
  options?: {
    filter?: { property: "object"; value: "page" | "database" };
    pageSize?: number;
  },
): Promise<Array<NotionPage | NotionDatabase>> {
  const body: Record<string, unknown> = { query };

  if (options?.filter) {
    body.filter = options.filter;
  }
  if (options?.pageSize) {
    body.page_size = options.pageSize;
  }

  const response = await notionFetch<NotionResponse<NotionPage | NotionDatabase>>(
    "/search",
    { method: "POST", body: JSON.stringify(body) },
  );

  return response.results || [];
}

export async function getPage(pageId: string): Promise<NotionPage> {
  return notionFetch<NotionPage>(`/pages/${pageId}`);
}

export async function getPageContent(pageId: string): Promise<NotionBlock[]> {
  const response = await notionFetch<NotionResponse<NotionBlock>>(
    `/blocks/${pageId}/children`,
  );
  return response.results || [];
}

export async function queryDatabase(
  databaseId: string,
  options?: {
    filter?: Record<string, unknown>;
    sorts?: Array<{ property: string; direction: "ascending" | "descending" }>;
    pageSize?: number;
  },
): Promise<NotionPage[]> {
  const body: Record<string, unknown> = {};

  if (options?.filter) {
    body.filter = options.filter;
  }
  if (options?.sorts) {
    body.sorts = options.sorts;
  }
  if (options?.pageSize) {
    body.page_size = options.pageSize;
  }

  const response = await notionFetch<NotionResponse<NotionPage>>(
    `/databases/${databaseId}/query`,
    { method: "POST", body: JSON.stringify(body) },
  );

  return response.results || [];
}

export async function createPage(options: {
  parentId: string;
  parentType: "database" | "page";
  title: string;
  content?: string;
  properties?: Record<string, unknown>;
}): Promise<NotionPage> {
  const parent = options.parentType === "database"
    ? { database_id: options.parentId }
    : { page_id: options.parentId };

  const properties: Record<string, unknown> = options.properties || {};

  // Set title based on parent type
  if (options.parentType === "database") {
    // For database pages, title goes in the title property
    properties.title = properties.title || {
      title: [{ text: { content: options.title } }],
    };
  }

  const children: Array<Record<string, unknown>> = [];

  // Add title as heading for page children
  if (options.parentType === "page") {
    children.push({
      object: "block",
      type: "heading_1",
      heading_1: {
        rich_text: [{ type: "text", text: { content: options.title } }],
      },
    });
  }

  // Add content as paragraph blocks
  if (options.content) {
    const paragraphs = options.content.split("\n\n");
    for (const paragraph of paragraphs) {
      if (paragraph.trim()) {
        children.push({
          object: "block",
          type: "paragraph",
          paragraph: {
            rich_text: [{ type: "text", text: { content: paragraph.trim() } }],
          },
        });
      }
    }
  }

  return notionFetch<NotionPage>("/pages", {
    method: "POST",
    body: JSON.stringify({
      parent,
      properties,
      children: children.length > 0 ? children : undefined,
    }),
  });
}

// Helper to extract plain text from Notion rich text
export function extractPlainText(blocks: NotionBlock[]): string {
  const texts: string[] = [];

  for (const block of blocks) {
    const blockType = block.type;
    const blockContent = block[blockType] as { rich_text?: Array<{ plain_text: string }> };

    if (blockContent?.rich_text) {
      const text = blockContent.rich_text.map((t) => t.plain_text).join("");
      if (text) texts.push(text);
    }
  }

  return texts.join("\n\n");
}

// Helper to get page title
export function getPageTitle(page: NotionPage): string {
  for (const prop of Object.values(page.properties)) {
    if (prop.type === "title" && prop.title) {
      return prop.title.map((t) => t.plain_text).join("");
    }
  }
  return "Untitled";
}
