import { getAccessToken } from "./token-store.ts";

const GRAPH_API_BASE = "https://graph.microsoft.com/v1.0";

interface GraphResponse<T> {
  "@odata.context"?: string;
  "@odata.nextLink"?: string;
  value?: T[];
}

export interface TeamsChat {
  id: string;
  topic: string | null;
  createdDateTime: string;
  lastUpdatedDateTime: string;
  chatType: "oneOnOne" | "group" | "meeting";
  webUrl?: string;
  members?: ChatMember[];
}

export interface ChatMember {
  "@odata.type": string;
  id: string;
  displayName?: string;
  userId?: string;
  email?: string;
}

export interface ChatMessage {
  id: string;
  messageType: "message" | "chatEvent" | "typing";
  createdDateTime: string;
  lastModifiedDateTime?: string;
  deletedDateTime?: string;
  subject?: string | null;
  summary?: string | null;
  importance: "normal" | "high" | "urgent";
  locale?: string;
  from: {
    user?: {
      id: string;
      displayName?: string;
      userIdentityType?: string;
    };
  };
  body: {
    contentType: "text" | "html";
    content: string;
  };
  attachments?: Array<{
    id: string;
    contentType: string;
    contentUrl?: string;
    content?: string;
    name?: string;
  }>;
  mentions?: Array<{
    id: number;
    mentionText: string;
    mentioned: {
      user: {
        id: string;
        displayName?: string;
      };
    };
  }>;
  reactions?: Array<{
    reactionType: string;
    createdDateTime: string;
    user: {
      id: string;
      displayName?: string;
    };
  }>;
}

export interface Team {
  id: string;
  displayName: string;
  description?: string;
  createdDateTime?: string;
  webUrl?: string;
  isArchived?: boolean;
  visibility?: "private" | "public";
}

export interface Channel {
  id: string;
  displayName: string;
  description?: string;
  email?: string;
  webUrl?: string;
  membershipType?: "standard" | "private" | "shared";
  createdDateTime?: string;
}

function buildEndpoint(path: string, params?: URLSearchParams): string {
  const queryString = params?.toString();
  return `${path}${queryString ? `?${queryString}` : ""}`;
}

async function graphFetch<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
  const token = await getAccessToken();
  if (!token) {
    throw new Error("Not authenticated with Microsoft Teams. Please connect your account.");
  }

  const url = endpoint.startsWith("http") ? endpoint : `${GRAPH_API_BASE}${endpoint}`;

  const response = await fetch(url, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...options.headers,
    },
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({} as any));
    throw new Error(
      `Microsoft Graph API error: ${response.status} ${error?.error?.message ?? response.statusText}`,
    );
  }

  return response.json();
}

export async function listChats(options?: { limit?: number; expand?: string[] }): Promise<TeamsChat[]> {
  const params = new URLSearchParams();
  if (options?.limit) params.set("$top", options.limit.toString());
  if (options?.expand?.length) params.set("$expand", options.expand.join(","));

  const response = await graphFetch<GraphResponse<TeamsChat>>(buildEndpoint("/me/chats", params));
  return response.value ?? [];
}

export async function getChatMessages(
  chatId: string,
  options?: { limit?: number; orderBy?: string },
): Promise<ChatMessage[]> {
  const params = new URLSearchParams();
  if (options?.limit) params.set("$top", options.limit.toString());
  params.set("$orderby", options?.orderBy ?? "createdDateTime desc");

  const response = await graphFetch<GraphResponse<ChatMessage>>(
    buildEndpoint(`/me/chats/${chatId}/messages`, params),
  );
  return response.value ?? [];
}

export function sendChatMessage(
  chatId: string,
  content: string,
  contentType: "text" | "html" = "text",
): Promise<ChatMessage> {
  return graphFetch<ChatMessage>(`/me/chats/${chatId}/messages`, {
    method: "POST",
    body: JSON.stringify({
      body: { contentType, content },
    }),
  });
}

export async function listTeams(options?: { limit?: number }): Promise<Team[]> {
  const params = new URLSearchParams();
  if (options?.limit) params.set("$top", options.limit.toString());

  const response = await graphFetch<GraphResponse<Team>>(buildEndpoint("/me/joinedTeams", params));
  return response.value ?? [];
}

export async function listChannels(
  teamId: string,
  options?: { limit?: number },
): Promise<Channel[]> {
  const params = new URLSearchParams();
  if (options?.limit) params.set("$top", options.limit.toString());

  const response = await graphFetch<GraphResponse<Channel>>(
    buildEndpoint(`/teams/${teamId}/channels`, params),
  );
  return response.value ?? [];
}

export function sendChannelMessage(
  teamId: string,
  channelId: string,
  content: string,
  contentType: "text" | "html" = "text",
  subject?: string,
): Promise<ChatMessage> {
  const body: Record<string, unknown> = {
    body: { contentType, content },
    ...(subject ? { subject } : {}),
  };

  return graphFetch<ChatMessage>(`/teams/${teamId}/channels/${channelId}/messages`, {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export async function getChannelMessages(
  teamId: string,
  channelId: string,
  options?: { limit?: number; orderBy?: string },
): Promise<ChatMessage[]> {
  const params = new URLSearchParams();
  if (options?.limit) params.set("$top", options.limit.toString());
  params.set("$orderby", options?.orderBy ?? "createdDateTime desc");

  const response = await graphFetch<GraphResponse<ChatMessage>>(
    buildEndpoint(`/teams/${teamId}/channels/${channelId}/messages`, params),
  );
  return response.value ?? [];
}

export function getCurrentUser(): Promise<{
  id: string;
  displayName: string;
  mail?: string;
  userPrincipalName?: string;
}> {
  return graphFetch("/me");
}

export function getChatDisplayName(chat: TeamsChat): string {
  if (chat.topic) return chat.topic;

  const memberNames = chat.members
    ?.map((m) => m.displayName)
    .filter(Boolean)
    .join(", ");

  if (memberNames) return memberNames;

  return chat.chatType === "oneOnOne" ? "Direct Chat" : "Group Chat";
}

export function getPlainTextContent(message: ChatMessage): string {
  if (message.body.contentType === "text") return message.body.content;

  return message.body.content
    .replace(/<[^>]*>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .trim();
}
