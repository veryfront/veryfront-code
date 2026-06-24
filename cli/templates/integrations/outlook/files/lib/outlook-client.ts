import { getAccessToken } from "./token-store.ts";

const GRAPH_BASE_URL = "https://graph.microsoft.com/v1.0";

interface GraphResponse<T> {
  value?: T[];
  "@odata.nextLink"?: string;
}

export interface OutlookMessage {
  id: string;
  subject: string;
  bodyPreview: string;
  body: {
    contentType: "text" | "html";
    content: string;
  };
  from: {
    emailAddress: {
      name: string;
      address: string;
    };
  };
  toRecipients: Array<{
    emailAddress: {
      name: string;
      address: string;
    };
  }>;
  ccRecipients?: Array<{
    emailAddress: {
      name: string;
      address: string;
    };
  }>;
  receivedDateTime: string;
  sentDateTime: string;
  isRead: boolean;
  hasAttachments: boolean;
  importance: "low" | "normal" | "high";
  conversationId: string;
  webLink: string;
}

export interface OutlookFolder {
  id: string;
  displayName: string;
  parentFolderId: string;
  childFolderCount: number;
  unreadItemCount: number;
  totalItemCount: number;
}

export interface SendEmailOptions {
  to: string[];
  subject: string;
  body: string;
  cc?: string[];
  bcc?: string[];
  importance?: "low" | "normal" | "high";
  bodyType?: "text" | "html";
}

export interface CreateDraftOptions extends SendEmailOptions {
  replyTo?: string[];
  categories?: string[];
}

async function graphFetch<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
  const token = await getAccessToken();
  if (!token) {
    throw new Error("Not authenticated with Microsoft. Please connect your account.");
  }

  const response = await fetch(`${GRAPH_BASE_URL}${endpoint}`, {
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
      `Microsoft Graph API error: ${response.status} ${error.error?.message ?? response.statusText}`,
    );
  }

  return response.json();
}

export async function listEmails(options?: {
  folderId?: string;
  top?: number;
  skip?: number;
  filter?: string;
  orderBy?: string;
}): Promise<OutlookMessage[]> {
  const params = new URLSearchParams();

  if (options?.top != null) params.set("$top", options.top.toString());
  if (options?.skip != null) params.set("$skip", options.skip.toString());
  if (options?.filter) params.set("$filter", options.filter);
  if (options?.orderBy) params.set("$orderby", options.orderBy);

  const folderPath = options?.folderId
    ? `/mailFolders/${options.folderId}/messages`
    : "/messages";

  const queryString = params.toString();
  const endpoint = queryString ? `${folderPath}?${queryString}` : folderPath;

  const response = await graphFetch<GraphResponse<OutlookMessage>>(endpoint);
  return response.value ?? [];
}

export function getEmail(messageId: string): Promise<OutlookMessage> {
  return graphFetch<OutlookMessage>(`/messages/${messageId}`);
}

export async function sendEmail(options: SendEmailOptions): Promise<void> {
  const message = buildMessage(options);

  await graphFetch("/sendMail", {
    method: "POST",
    body: JSON.stringify({ message }),
  });
}

function buildMessage(options: CreateDraftOptions) {
  return {
    subject: options.subject,
    body: {
      contentType: options.bodyType ?? "text",
      content: options.body,
    },
    toRecipients: options.to.map((email) => ({
      emailAddress: { address: email },
    })),
    ccRecipients: options.cc?.map((email) => ({
      emailAddress: { address: email },
    })),
    bccRecipients: options.bcc?.map((email) => ({
      emailAddress: { address: email },
    })),
    replyTo: options.replyTo?.map((email) => ({
      emailAddress: { address: email },
    })),
    importance: options.importance ?? "normal",
    categories: options.categories,
  };
}

export async function createDraft(options: CreateDraftOptions): Promise<OutlookMessage> {
  return graphFetch<OutlookMessage>("/messages", {
    method: "POST",
    body: JSON.stringify(buildMessage(options)),
  });
}

export async function searchEmails(options: {
  query: string;
  top?: number;
  skip?: number;
}): Promise<OutlookMessage[]> {
  const params = new URLSearchParams({ $search: `"${options.query}"` });

  if (options.top != null) params.set("$top", options.top.toString());
  if (options.skip != null) params.set("$skip", options.skip.toString());

  const response = await graphFetch<GraphResponse<OutlookMessage>>(`/messages?${params.toString()}`);
  return response.value ?? [];
}

export async function listFolders(): Promise<OutlookFolder[]> {
  const response = await graphFetch<GraphResponse<OutlookFolder>>("/mailFolders");
  return response.value ?? [];
}

export async function listThreads(options?: {
  folderId?: string;
  top?: number;
  filter?: string;
  orderBy?: string;
}): Promise<OutlookMessage[]> {
  return listEmails({
    folderId: options?.folderId ?? "inbox",
    top: options?.top,
    filter: options?.filter,
    orderBy: options?.orderBy ?? "receivedDateTime desc",
  });
}

export async function getThread(threadId: string, limit = 25): Promise<OutlookMessage[]> {
  const safeThreadId = threadId.replaceAll("'", "''");
  const params = new URLSearchParams({
    $filter: `conversationId eq '${safeThreadId}'`,
    $top: String(limit),
    $select:
      "id,conversationId,internetMessageId,subject,body,bodyPreview,from,sender,toRecipients,ccRecipients,bccRecipients,replyTo,receivedDateTime,sentDateTime,categories,isRead,importance,hasAttachments,webLink,flag",
  });

  const response = await graphFetch<GraphResponse<OutlookMessage>>(`/messages?${params}`);
  return response.value ?? [];
}

async function setReadState(messageId: string, isRead: boolean): Promise<void> {
  await graphFetch(`/messages/${messageId}`, {
    method: "PATCH",
    body: JSON.stringify({ isRead }),
  });
}

export async function markAsRead(messageId: string): Promise<void> {
  await setReadState(messageId, true);
}

export async function markAsUnread(messageId: string): Promise<void> {
  await setReadState(messageId, false);
}

export async function deleteEmail(messageId: string): Promise<void> {
  await graphFetch(`/messages/${messageId}`, { method: "DELETE" });
}

export async function moveEmail(messageId: string, destinationFolderId: string): Promise<void> {
  await graphFetch(`/messages/${messageId}/move`, {
    method: "POST",
    body: JSON.stringify({ destinationId: destinationFolderId }),
  });
}

export function formatEmail(message: OutlookMessage): string {
  const from = message.from.emailAddress.name || message.from.emailAddress.address;
  const to = message.toRecipients.map((r) => r.emailAddress.address).join(", ");
  const date = new Date(message.receivedDateTime).toLocaleString();
  const read = message.isRead ? "Yes" : "No";

  return `From: ${from}
To: ${to}
Subject: ${message.subject}
Date: ${date}
Read: ${read}

${message.bodyPreview}`;
}
