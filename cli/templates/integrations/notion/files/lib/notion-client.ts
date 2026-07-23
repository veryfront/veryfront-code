import { fetchOAuthJson } from "./oauth.ts";

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
  url: string;
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

export function createNotionClient(userId: string) {
  function notionFetch<T>(
    endpoint: string,
    options: RequestInit = {},
  ): Promise<T> {
    return fetchOAuthJson<T>(
      userId,
      "notion",
      `${NOTION_BASE_URL}${endpoint}`,
      {
        ...options,
        headers: {
          "Notion-Version": NOTION_API_VERSION,
          "Content-Type": "application/json",
          ...options.headers,
        },
      },
    );
  }

  async function searchNotion(
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

    const response = await notionFetch<
      NotionResponse<NotionPage | NotionDatabase>
    >("/search", {
      method: "POST",
      body: JSON.stringify(body),
    });

    return response.results ?? [];
  }

  function getPage(pageId: string): Promise<NotionPage> {
    return notionFetch<NotionPage>(`/pages/${pageId}`);
  }

  async function getPageContent(pageId: string): Promise<NotionBlock[]> {
    const response = await notionFetch<NotionResponse<NotionBlock>>(
      `/blocks/${pageId}/children`,
    );
    return response.results ?? [];
  }

  async function queryDatabase(
    databaseId: string,
    options?: {
      filter?: Record<string, unknown>;
      sorts?: Array<
        { property: string; direction: "ascending" | "descending" }
      >;
      pageSize?: number;
    },
  ): Promise<NotionPage[]> {
    const body: Record<string, unknown> = {
      ...(options?.filter ? { filter: options.filter } : {}),
      ...(options?.sorts ? { sorts: options.sorts } : {}),
      ...(options?.pageSize ? { page_size: options.pageSize } : {}),
    };

    const response = await notionFetch<NotionResponse<NotionPage>>(
      `/databases/${databaseId}/query`,
      { method: "POST", body: JSON.stringify(body) },
    );

    return response.results ?? [];
  }

  function createPage(options: {
    parentId: string;
    parentType: "database" | "page";
    title: string;
    content?: string;
    properties?: Record<string, unknown>;
  }): Promise<NotionPage> {
    const parent = options.parentType === "database"
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

    return notionFetch<NotionPage>("/pages", {
      method: "POST",
      body: JSON.stringify({
        parent,
        properties,
        children: children.length ? children : undefined,
      }),
    });
  }

  function extractPlainText(blocks: NotionBlock[]): string {
    const texts: string[] = [];

    for (const block of blocks) {
      const content = block[block.type] as {
        rich_text?: Array<{ plain_text: string }>;
      } | undefined;
      const text = content?.rich_text?.map((t) => t.plain_text).join("");
      if (text) texts.push(text);
    }

    return texts.join("\n\n");
  }

  function getPageTitle(page: NotionPage): string {
    for (const prop of Object.values(page.properties)) {
      if (prop.type === "title" && prop.title) {
        return prop.title.map((t) => t.plain_text).join("");
      }
    }

    return "Untitled";
  }

  function getDatabase(databaseId: string): Promise<NotionDatabase> {
    return notionFetch<NotionDatabase>(`/databases/${databaseId}`);
  }

  async function appendBlocks(options: {
    blockId: string;
    children: Array<Record<string, unknown>>;
    after?: string;
  }): Promise<NotionBlock[]> {
    const response = await notionFetch<NotionResponse<NotionBlock>>(
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

  function updatePage(options: {
    pageId: string;
    properties?: Record<string, unknown>;
    archived?: boolean;
    icon?: Record<string, unknown>;
    cover?: Record<string, unknown>;
  }): Promise<NotionPage> {
    return notionFetch<NotionPage>(`/pages/${options.pageId}`, {
      method: "PATCH",
      body: JSON.stringify({
        properties: options.properties,
        archived: options.archived,
        icon: options.icon,
        cover: options.cover,
      }),
    });
  }

  return {
    searchNotion,
    getPage,
    getPageContent,
    queryDatabase,
    createPage,
    extractPlainText,
    getPageTitle,
    getDatabase,
    appendBlocks,
    updatePage,
  };
}
