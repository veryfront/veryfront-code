import { OAuthService, teamsConfig } from "veryfront/oauth";
import { tokenStore } from "./token-store.ts";
import { htmlToPlainText } from "./teams-plain-text.ts";

// OAuthService refreshes expired tokens under the store's refresh lock.
const teamsService = new OAuthService(teamsConfig, tokenStore);

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
  return queryString ? `${path}?${queryString}` : path;
}

async function graphFetch<T>(
  userId: string,
  endpoint: string,
  options: RequestInit = {},
): Promise<T> {
  const token = await teamsService.getAccessToken(userId);
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
    const error = await response.json().catch(() => ({}));
    throw new Error(
      `Microsoft Graph API error: ${response.status} ${error?.error?.message ?? response.statusText}`,
    );
  }

  return response.json();
}

export async function listChats(
  userId: string,
  options?: { limit?: number; expand?: string[] },
): Promise<TeamsChat[]> {
  const params = new URLSearchParams();
  if (options?.limit) params.set("$top", options.limit.toString());
  if (options?.expand?.length) params.set("$expand", options.expand.join(","));

  const response = await graphFetch<GraphResponse<TeamsChat>>(
    userId,
    buildEndpoint("/me/chats", params),
  );
  return response.value ?? [];
}

export async function getChatMessages(
  userId: string,
  chatId: string,
  options?: { limit?: number; orderBy?: string },
): Promise<ChatMessage[]> {
  const params = new URLSearchParams();
  if (options?.limit) params.set("$top", options.limit.toString());
  params.set("$orderby", options?.orderBy ?? "createdDateTime desc");

  const response = await graphFetch<GraphResponse<ChatMessage>>(
    userId,
    buildEndpoint(`/me/chats/${chatId}/messages`, params),
  );
  return response.value ?? [];
}

export function sendChatMessage(
  userId: string,
  chatId: string,
  content: string,
  contentType: "text" | "html" = "text",
): Promise<ChatMessage> {
  return graphFetch<ChatMessage>(userId, `/me/chats/${chatId}/messages`, {
    method: "POST",
    body: JSON.stringify({ body: { contentType, content } }),
  });
}

export async function listTeams(userId: string, options?: { limit?: number }): Promise<Team[]> {
  const params = new URLSearchParams();
  if (options?.limit) params.set("$top", options.limit.toString());

  const response = await graphFetch<GraphResponse<Team>>(
    userId,
    buildEndpoint("/me/joinedTeams", params),
  );
  return response.value ?? [];
}

export async function listChannels(
  userId: string,
  teamId: string,
  options?: { limit?: number },
): Promise<Channel[]> {
  const params = new URLSearchParams();
  if (options?.limit) params.set("$top", options.limit.toString());

  const response = await graphFetch<GraphResponse<Channel>>(
    userId,
    buildEndpoint(`/teams/${teamId}/channels`, params),
  );
  return response.value ?? [];
}

export function sendChannelMessage(
  userId: string,
  teamId: string,
  channelId: string,
  content: string,
  contentType: "text" | "html" = "text",
  subject?: string,
): Promise<ChatMessage> {
  const body: Record<string, unknown> = { body: { contentType, content } };
  if (subject) body.subject = subject;

  return graphFetch<ChatMessage>(userId, `/teams/${teamId}/channels/${channelId}/messages`, {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export async function getChannelMessages(
  userId: string,
  teamId: string,
  channelId: string,
  options?: { limit?: number; orderBy?: string },
): Promise<ChatMessage[]> {
  const params = new URLSearchParams();
  if (options?.limit) params.set("$top", options.limit.toString());
  params.set("$orderby", options?.orderBy ?? "createdDateTime desc");

  const response = await graphFetch<GraphResponse<ChatMessage>>(
    userId,
    buildEndpoint(`/teams/${teamId}/channels/${channelId}/messages`, params),
  );
  return response.value ?? [];
}

export function getCurrentUser(userId: string): Promise<{
  id: string;
  displayName: string;
  mail?: string;
  userPrincipalName?: string;
}> {
  return graphFetch(userId, "/me");
}

export function getChatDisplayName(chat: TeamsChat): string {
  if (chat.topic) return chat.topic;

  const memberNames = chat.members?.flatMap((m) => (m.displayName ? [m.displayName] : [])).join(", ");
  if (memberNames) return memberNames;

  return chat.chatType === "oneOnOne" ? "Direct Chat" : "Group Chat";
}

export function getPlainTextContent(message: ChatMessage): string {
  if (message.body.contentType === "text") return message.body.content;
  return htmlToPlainText(message.body.content);
}
