import { getAccessToken } from "./token-store.ts";

const MONDAY_API_URL = "https://api.monday.com/v2";

interface MondayResponse<T> {
  data: T;
  account_id?: number;
  errors?: Array<{ message: string; locations?: unknown[] }>;
}

interface MondayBoard {
  id: string;
  name: string;
  description?: string;
  board_kind: string;
  state: string;
  workspace_id?: string;
  created_at?: string;
  updated_at?: string;
}

interface MondayItem {
  id: string;
  name: string;
  state?: string;
  board?: {
    id: string;
    name: string;
  };
  group?: {
    id: string;
    title: string;
  };
  column_values?: Array<{
    id: string;
    text?: string;
    title?: string;
    type?: string;
    value?: string;
  }>;
  created_at?: string;
  updated_at?: string;
}

interface MondayUser {
  id: string;
  name: string;
  email: string;
  account: {
    id: string;
    name: string;
  };
}

async function mondayFetch<T>(query: string, variables: Record<string, unknown> = {}): Promise<T> {
  const token = await getAccessToken();
  if (!token) {
    throw new Error("Not authenticated with Monday.com. Please connect your account.");
  }

  const response = await fetch(MONDAY_API_URL, {
    method: "POST",
    headers: {
      Authorization: token,
      "Content-Type": "application/json",
      "API-Version": "2024-10",
    },
    body: JSON.stringify({ query, variables }),
  });

  if (!response.ok) {
    throw new Error(`Monday.com API error: ${response.status} ${response.statusText}`);
  }

  const result: MondayResponse<T> = await response.json();
  const errorMessage = result.errors?.[0]?.message;
  if (errorMessage) {
    throw new Error(`Monday.com GraphQL error: ${errorMessage}`);
  }

  return result.data;
}

export async function getMe(): Promise<MondayUser> {
  const query = `
    query {
      me {
        id
        name
        email
        account {
          id
          name
        }
      }
    }
  `;

  const data = await mondayFetch<{ me: MondayUser }>(query);
  return data.me;
}

export async function listBoards(options?: {
  limit?: number;
  page?: number;
  workspaceIds?: string[];
}): Promise<MondayBoard[]> {
  const limit = options?.limit ?? 50;
  const page = options?.page ?? 1;

  const workspaceIds = options?.workspaceIds?.length
    ? options.workspaceIds.map((id) => parseInt(id, 10))
    : null;

  const workspaceFilter = workspaceIds ? `, workspace_ids: [${workspaceIds.join(",")}]` : "";

  const query = `
    query {
      boards(limit: ${limit}, page: ${page}${workspaceFilter}) {
        id
        name
        description
        board_kind
        state
        workspace_id
      }
    }
  `;

  const data = await mondayFetch<{ boards: MondayBoard[] }>(query);
  return data.boards;
}

export async function getBoard(boardId: string): Promise<MondayBoard> {
  const query = `
    query {
      boards(ids: [${boardId}]) {
        id
        name
        description
        board_kind
        state
        workspace_id
      }
    }
  `;

  const data = await mondayFetch<{ boards: MondayBoard[] }>(query);
  const board = data.boards?.[0];
  if (!board) {
    throw new Error(`Board with ID ${boardId} not found`);
  }
  return board;
}

export async function listItems(options: {
  boardId: string;
  limit?: number;
  page?: number;
}): Promise<MondayItem[]> {
  const limit = options.limit ?? 50;
  const page = options.page ?? 1;

  const query = `
    query {
      boards(ids: [${options.boardId}]) {
        items_page(limit: ${limit}, query_params: {page: ${page}}) {
          items {
            id
            name
            state
            board {
              id
              name
            }
            group {
              id
              title
            }
            column_values {
              id
              text
              title
              type
              value
            }
            created_at
            updated_at
          }
        }
      }
    }
  `;

  const data = await mondayFetch<{ boards: Array<{ items_page: { items: MondayItem[] } }> }>(query);
  return data.boards?.[0]?.items_page.items ?? [];
}

export async function getItem(itemId: string): Promise<MondayItem> {
  const query = `
    query {
      items(ids: [${itemId}]) {
        id
        name
        state
        board {
          id
          name
        }
        group {
          id
          title
        }
        column_values {
          id
          text
          title
          type
          value
        }
        created_at
        updated_at
      }
    }
  `;

  const data = await mondayFetch<{ items: MondayItem[] }>(query);
  const item = data.items?.[0];
  if (!item) {
    throw new Error(`Item with ID ${itemId} not found`);
  }
  return item;
}

export async function createItem(options: {
  boardId: string;
  groupId?: string;
  itemName: string;
  columnValues?: Record<string, unknown>;
}): Promise<MondayItem> {
  const groupId = options.groupId ? `group_id: "${options.groupId}",` : "";
  const columnValues = options.columnValues
    ? `column_values: ${JSON.stringify(JSON.stringify(options.columnValues))},`
    : "";

  const query = `
    mutation {
      create_item(
        board_id: ${options.boardId},
        ${groupId}
        item_name: "${options.itemName}",
        ${columnValues}
      ) {
        id
        name
        state
        board {
          id
          name
        }
        group {
          id
          title
        }
        created_at
      }
    }
  `;

  const data = await mondayFetch<{ create_item: MondayItem }>(query);
  return data.create_item;
}

export async function updateItem(
  itemId: string,
  updates: {
    columnValues?: Record<string, unknown>;
    name?: string;
  },
): Promise<MondayItem> {
  if (updates.name) {
    const nameQuery = `
      mutation {
        change_simple_column_value(
          item_id: ${itemId},
          column_id: "name",
          value: "${updates.name}"
        ) {
          id
          name
        }
      }
    `;
    await mondayFetch<{ change_simple_column_value: MondayItem }>(nameQuery);
  }

  if (updates.columnValues) {
    const columnValuesStr = JSON.stringify(JSON.stringify(updates.columnValues));
    const query = `
      mutation {
        change_multiple_column_values(
          item_id: ${itemId},
          column_values: ${columnValuesStr}
        ) {
          id
          name
          state
          column_values {
            id
            text
            title
            type
            value
          }
        }
      }
    `;
    const data = await mondayFetch<{ change_multiple_column_values: MondayItem }>(query);
    return data.change_multiple_column_values;
  }

  return getItem(itemId);
}
