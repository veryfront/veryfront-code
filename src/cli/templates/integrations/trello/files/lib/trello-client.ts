import { getAccessToken } from "./token-store.ts";

const TRELLO_BASE_URL = "https://api.trello.com/1";

interface TrelloBoard {
  id: string;
  name: string;
  desc: string;
  closed: boolean;
  url: string;
  prefs: {
    background: string;
    backgroundColor: string;
  };
  dateLastActivity: string;
}

interface TrelloList {
  id: string;
  name: string;
  closed: boolean;
  idBoard: string;
  pos: number;
}

interface TrelloCard {
  id: string;
  name: string;
  desc: string;
  closed: boolean;
  idBoard: string;
  idList: string;
  idMembers: string[];
  labels: Array<{
    id: string;
    name: string;
    color: string;
  }>;
  due: string | null;
  dueComplete: boolean;
  url: string;
  dateLastActivity: string;
}

interface TrelloMember {
  id: string;
  fullName: string;
  username: string;
  avatarUrl: string;
}

async function trelloFetch<T>(
  endpoint: string,
  options: RequestInit = {},
): Promise<T> {
  const token = await getAccessToken();
  if (!token) {
    throw new Error("Not authenticated with Trello. Please connect your account.");
  }

  const clientId = process.env.TRELLO_CLIENT_ID;
  if (!clientId) {
    throw new Error("TRELLO_CLIENT_ID environment variable is not set.");
  }

  const url = new URL(`${TRELLO_BASE_URL}${endpoint}`);
  url.searchParams.set("key", clientId);
  url.searchParams.set("token", token);

  const response = await fetch(url.toString(), {
    ...options,
    headers: {
      "Accept": "application/json",
      "Content-Type": "application/json",
      ...options.headers,
    },
  });

  if (!response.ok) {
    const error = await response.text().catch(() => "");
    throw new Error(
      `Trello API error: ${response.status} ${error || response.statusText}`,
    );
  }

  return response.json();
}

export async function listBoards(): Promise<TrelloBoard[]> {
  const boards = await trelloFetch<TrelloBoard[]>(
    "/members/me/boards?fields=name,desc,closed,url,prefs,dateLastActivity",
  );
  return boards;
}

export async function getBoard(boardId: string): Promise<TrelloBoard> {
  const board = await trelloFetch<TrelloBoard>(
    `/boards/${boardId}?fields=name,desc,closed,url,prefs,dateLastActivity`,
  );
  return board;
}

export async function listLists(boardId: string): Promise<TrelloList[]> {
  const lists = await trelloFetch<TrelloList[]>(
    `/boards/${boardId}/lists?fields=name,closed,idBoard,pos`,
  );
  return lists;
}

export async function listCards(options: {
  boardId?: string;
  listId?: string;
  limit?: number;
}): Promise<TrelloCard[]> {
  const { boardId, listId, limit = 50 } = options;

  let endpoint: string;
  if (listId) {
    endpoint = `/lists/${listId}/cards`;
  } else if (boardId) {
    endpoint = `/boards/${boardId}/cards`;
  } else {
    throw new Error("Either boardId or listId must be provided");
  }

  const cards = await trelloFetch<TrelloCard[]>(
    `${endpoint}?fields=name,desc,closed,idBoard,idList,idMembers,labels,due,dueComplete,url,dateLastActivity&limit=${limit}`,
  );
  return cards;
}

export async function getCard(cardId: string): Promise<TrelloCard> {
  const card = await trelloFetch<TrelloCard>(
    `/cards/${cardId}?fields=name,desc,closed,idBoard,idList,idMembers,labels,due,dueComplete,url,dateLastActivity`,
  );
  return card;
}

export async function createCard(options: {
  listId: string;
  name: string;
  desc?: string;
  due?: string;
  pos?: string | number;
  idMembers?: string[];
  idLabels?: string[];
}): Promise<TrelloCard> {
  const params = new URLSearchParams({
    idList: options.listId,
    name: options.name,
  });

  if (options.desc) params.set("desc", options.desc);
  if (options.due) params.set("due", options.due);
  if (options.pos !== undefined) params.set("pos", String(options.pos));
  if (options.idMembers) params.set("idMembers", options.idMembers.join(","));
  if (options.idLabels) params.set("idLabels", options.idLabels.join(","));

  const card = await trelloFetch<TrelloCard>(`/cards?${params}`, {
    method: "POST",
  });
  return card;
}

export async function updateCard(
  cardId: string,
  updates: {
    name?: string;
    desc?: string;
    closed?: boolean;
    idList?: string;
    due?: string | null;
    dueComplete?: boolean;
    idMembers?: string[];
    idLabels?: string[];
    pos?: string | number;
  },
): Promise<TrelloCard> {
  const params = new URLSearchParams();

  if (updates.name !== undefined) params.set("name", updates.name);
  if (updates.desc !== undefined) params.set("desc", updates.desc);
  if (updates.closed !== undefined) params.set("closed", String(updates.closed));
  if (updates.idList !== undefined) params.set("idList", updates.idList);
  if (updates.due !== undefined) params.set("due", updates.due === null ? "" : updates.due);
  if (updates.dueComplete !== undefined) params.set("dueComplete", String(updates.dueComplete));
  if (updates.idMembers !== undefined) params.set("idMembers", updates.idMembers.join(","));
  if (updates.idLabels !== undefined) params.set("idLabels", updates.idLabels.join(","));
  if (updates.pos !== undefined) params.set("pos", String(updates.pos));

  const card = await trelloFetch<TrelloCard>(`/cards/${cardId}?${params}`, {
    method: "PUT",
  });
  return card;
}

export async function getMe(): Promise<TrelloMember> {
  const member = await trelloFetch<TrelloMember>(
    "/members/me?fields=fullName,username,avatarUrl",
  );
  return member;
}
