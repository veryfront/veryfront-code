import { notionConfig, OAuthService } from "veryfront/oauth";
import { tokenStore } from "./token-store.ts";

// OAuthService refreshes expired tokens under the store's refresh lock.
const notionService = new OAuthService(notionConfig, tokenStore);

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
  url: string;
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
  userId: string,
  endpoint: string,
  options: RequestInit = {},
): Promise<T> {
  const token = await notionService.getAccessToken(userId);
  if (!token) {
    throw new Error("Not authenticated with Notion. Please connect your account.");
  }

  const response = await fetch(`${NOTION_BASE_URL}${endpoint}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      "Notion-Version": NOTION_API_VERSION,
      "Content-Type": "application/json",
      ...options.headers,
    },
  });

  if (!response.ok) {
    const error = (await response.json().catch(() => ({} as { message?: string }))) as {
      message?: string;
    };
    throw new Error(
      `Notion API error: ${response.status} ${error.message ?? response.statusText}`,
    );
  }

  return response.json();
}

export async function searchNotion(
  userId: string,
  query: string,
  options?: {
    filter?: { property: "object"; value: "page" | "database" };
    pageSize?: number;
  },
): Promise<Array<NotionPage | NotionDatabase>> {
  const body: Record<string, unknown> = {
    query,
    ...(options?.filter ? { filter: options.filter } : {}),
    ...(options?.pageSize ? { page_size: options.pageSize } : {}),
  };

  const response = await notionFetch<NotionResponse<NotionPage | NotionDatabase>>(
    userId,
    "/search",
    {
      method: "POST",
      body: JSON.stringify(body),
    },
  );

  return response.results ?? [];
}

export function getPage(userId: string, pageId: string): Promise<NotionPage> {
  return notionFetch<NotionPage>(userId, `/pages/${pageId}`);
}

export async function getPageContent(userId: string, pageId: string): Promise<NotionBlock[]> {
  const response = await notionFetch<NotionResponse<NotionBlock>>(
    userId,
    `/blocks/${pageId}/children`,
  );
  return response.results ?? [];
}

export async function queryDatabase(
  userId: string,
  databaseId: string,
  options?: {
    filter?: Record<string, unknown>;
    sorts?: Array<{ property: string; direction: "ascending" | "descending" }>;
    pageSize?: number;
  },
): Promise<NotionPage[]> {
  const body: Record<string, unknown> = {
    ...(options?.filter ? { filter: options.filter } : {}),
    ...(options?.sorts ? { sorts: options.sorts } : {}),
    ...(options?.pageSize ? { page_size: options.pageSize } : {}),
  };

  const response = await notionFetch<NotionResponse<NotionPage>>(
    userId,
    `/databases/${databaseId}/query`,
    { method: "POST", body: JSON.stringify(body) },
  );

  return response.results ?? [];
}

export function createPage(userId: string, options: {
  parentId: string;
  parentType: "database" | "page";
  title: string;
  content?: string;
  properties?: Record<string, unknown>;
}): Promise<NotionPage> {
  const parent =
    options.parentType === "database"
      ? { database_id: options.parentId }
      : { page_id: options.parentId };

  const properties: Record<string, unknown> = options.properties ?? {};

  if (options.parentType === "database") {
    properties.title ??= { title: [{ text: { content: options.title } }] };
  }

  const children: Array<Record<string, unknown>> = [];

  if (options.parentType === "page") {
    children.push({
      object: "block",
      type: "heading_1",
      heading_1: {
        rich_text: [{ type: "text", text: { content: options.title } }],
      },
    });
  }

  for (const paragraph of options.content?.split("\n\n") ?? []) {
    const trimmed = paragraph.trim();
    if (!trimmed) continue;

    children.push({
      object: "block",
      type: "paragraph",
      paragraph: {
        rich_text: [{ type: "text", text: { content: trimmed } }],
      },
    });
  }

  return notionFetch<NotionPage>(userId, "/pages", {
    method: "POST",
    body: JSON.stringify({
      parent,
      properties,
      children: children.length ? children : undefined,
    }),
  });
}

export function extractPlainText(blocks: NotionBlock[]): string {
  const texts: string[] = [];

  for (const block of blocks) {
    const content = block[block.type] as { rich_text?: Array<{ plain_text: string }> } | undefined;
    const text = content?.rich_text?.map((t) => t.plain_text).join("");
    if (text) texts.push(text);
  }

  return texts.join("\n\n");
}

export function getPageTitle(page: NotionPage): string {
  for (const prop of Object.values(page.properties)) {
    if (prop.type === "title" && prop.title) {
      return prop.title.map((t) => t.plain_text).join("");
    }
  }

  return "Untitled";
}

export function getDatabase(userId: string, databaseId: string): Promise<NotionDatabase> {
  return notionFetch<NotionDatabase>(userId, `/databases/${databaseId}`);
}

export async function appendBlocks(userId: string, options: {
  blockId: string;
  children: Array<Record<string, unknown>>;
  after?: string;
}): Promise<NotionBlock[]> {
  const response = await notionFetch<NotionResponse<NotionBlock>>(
    userId,
    `/blocks/${options.blockId}/children`,
    {
      method: "PATCH",
      body: JSON.stringify({
        children: options.children,
        after: options.after,
      }),
    },
  );

  return response.results ?? [];
}

export function updatePage(userId: string, options: {
  pageId: string;
  properties?: Record<string, unknown>;
  archived?: boolean;
  icon?: Record<string, unknown>;
  cover?: Record<string, unknown>;
}): Promise<NotionPage> {
  return notionFetch<NotionPage>(userId, `/pages/${options.pageId}`, {
    method: "PATCH",
    body: JSON.stringify({
      properties: options.properties,
      archived: options.archived,
      icon: options.icon,
      cover: options.cover,
    }),
  });
}
