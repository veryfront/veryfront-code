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

async function graphFetch<T>(
  endpoint: string,
  options: RequestInit = {},
): Promise<T> {
  const token = await getAccessToken();
  if (!token) {
    throw new Error("Not authenticated with Microsoft Teams. Please connect your account.");
  }

  const url = endpoint.startsWith("http") ? endpoint : `${GRAPH_API_BASE}${endpoint}`;

  const response = await fetch(url, {
    ...options,
    headers: {
      "Authorization": `Bearer ${token}`,
      "Content-Type": "application/json",
      ...options.headers,
    },
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(
      `Microsoft Graph API error: ${response.status} ${
        error.error?.message || response.statusText
      }`,
    );
  }

  return response.json();
}

/**
 * List recent chats for the authenticated user
 */
export async function listChats(options?: {
  limit?: number;
  expand?: string[];
}): Promise<TeamsChat[]> {
  const params = new URLSearchParams();
  if (options?.limit) {
    params.set("$top", options.limit.toString());
  }
  if (options?.expand) {
    params.set("$expand", options.expand.join(","));
  }

  const queryString = params.toString();
  const endpoint = `/me/chats${queryString ? `?${queryString}` : ""}`;

  const response = await graphFetch<GraphResponse<TeamsChat>>(endpoint);
  return response.value || [];
}

/**
 * Get messages from a specific chat
 */
export async function getChatMessages(
  chatId: string,
  options?: {
    limit?: number;
    orderBy?: string;
  },
): Promise<ChatMessage[]> {
  const params = new URLSearchParams();
  if (options?.limit) {
    params.set("$top", options.limit.toString());
  }
  if (options?.orderBy) {
    params.set("$orderby", options.orderBy);
  } else {
    params.set("$orderby", "createdDateTime desc");
  }

  const queryString = params.toString();
  const endpoint = `/me/chats/${chatId}/messages${queryString ? `?${queryString}` : ""}`;

  const response = await graphFetch<GraphResponse<ChatMessage>>(endpoint);
  return response.value || [];
}

/**
 * Send a message to a chat
 */
export function sendChatMessage(
  chatId: string,
  content: string,
  contentType: "text" | "html" = "text",
): Promise<ChatMessage> {
  const endpoint = `/me/chats/${chatId}/messages`;

  return graphFetch<ChatMessage>(endpoint, {
    method: "POST",
    body: JSON.stringify({
      body: {
        contentType,
        content,
      },
    }),
  });
}

/**
 * List all teams the user is a member of
 */
export async function listTeams(options?: {
  limit?: number;
}): Promise<Team[]> {
  const params = new URLSearchParams();
  if (options?.limit) {
    params.set("$top", options.limit.toString());
  }

  const queryString = params.toString();
  const endpoint = `/me/joinedTeams${queryString ? `?${queryString}` : ""}`;

  const response = await graphFetch<GraphResponse<Team>>(endpoint);
  return response.value || [];
}

/**
 * List channels in a team
 */
export async function listChannels(
  teamId: string,
  options?: {
    limit?: number;
  },
): Promise<Channel[]> {
  const params = new URLSearchParams();
  if (options?.limit) {
    params.set("$top", options.limit.toString());
  }

  const queryString = params.toString();
  const endpoint = `/teams/${teamId}/channels${queryString ? `?${queryString}` : ""}`;

  const response = await graphFetch<GraphResponse<Channel>>(endpoint);
  return response.value || [];
}

/**
 * Send a message to a team channel
 */
export function sendChannelMessage(
  teamId: string,
  channelId: string,
  content: string,
  contentType: "text" | "html" = "text",
  subject?: string,
): Promise<ChatMessage> {
  const endpoint = `/teams/${teamId}/channels/${channelId}/messages`;

  const body: Record<string, unknown> = {
    body: {
      contentType,
      content,
    },
  };

  if (subject) {
    body.subject = subject;
  }

  return graphFetch<ChatMessage>(endpoint, {
    method: "POST",
    body: JSON.stringify(body),
  });
}

/**
 * Get channel messages
 */
export async function getChannelMessages(
  teamId: string,
  channelId: string,
  options?: {
    limit?: number;
    orderBy?: string;
  },
): Promise<ChatMessage[]> {
  const params = new URLSearchParams();
  if (options?.limit) {
    params.set("$top", options.limit.toString());
  }
  if (options?.orderBy) {
    params.set("$orderby", options.orderBy);
  } else {
    params.set("$orderby", "createdDateTime desc");
  }

  const queryString = params.toString();
  const endpoint = `/teams/${teamId}/channels/${channelId}/messages${
    queryString ? `?${queryString}` : ""
  }`;

  const response = await graphFetch<GraphResponse<ChatMessage>>(endpoint);
  return response.value || [];
}

/**
 * Get current user's profile
 */
export function getCurrentUser(): Promise<{
  id: string;
  displayName: string;
  mail?: string;
  userPrincipalName?: string;
}> {
  return graphFetch("/me");
}

/**
 * Helper to format chat display name
 */
export function getChatDisplayName(chat: TeamsChat): string {
  if (chat.topic) {
    return chat.topic;
  }

  if (chat.members && chat.members.length > 0) {
    const memberNames = chat.members
      .map((m) => m.displayName)
      .filter(Boolean)
      .join(", ");
    return memberNames || "Unnamed Chat";
  }

  return chat.chatType === "oneOnOne" ? "Direct Chat" : "Group Chat";
}

/**
 * Helper to extract plain text from message body
 */
export function getPlainTextContent(message: ChatMessage): string {
  if (message.body.contentType === "text") {
    return message.body.content;
  }

  // Basic HTML stripping for html content
  return message.body.content
    .replace(/<[^>]*>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .trim();
}
