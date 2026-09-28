import { OAuthService, outlookConfig } from "veryfront/oauth";
import { tokenStore } from "./token-store.ts";

// OAuthService refreshes expired tokens under the store's refresh lock.
const outlookService = new OAuthService(outlookConfig, tokenStore);

const GRAPH_BASE_URL = "https://graph.microsoft.com/v1.0";

interface GraphResponse<T> {
  value?: T[];
  "@odata.nextLink"?: string;
}

interface OutlookEmailAddress {
  name?: string;
  address?: string;
}

export interface OutlookContact {
  emailAddress?: OutlookEmailAddress | null;
}

export interface OutlookMessage {
  id: string;
  subject: string;
  bodyPreview: string;
  body: {
    contentType: "text" | "html";
    content: string;
  };
  from?: OutlookContact | null;
  toRecipients: OutlookContact[];
  ccRecipients?: OutlookContact[] | null;
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

async function graphFetch<T>(
  userId: string,
  endpoint: string,
  options: RequestInit = {},
): Promise<T> {
  const token = await outlookService.getAccessToken(userId);
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

export async function listEmails(userId: string, options?: {
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

  const response = await graphFetch<GraphResponse<OutlookMessage>>(userId, endpoint);
  return response.value ?? [];
}

export function getEmail(userId: string, messageId: string): Promise<OutlookMessage> {
  return graphFetch<OutlookMessage>(userId, `/messages/${messageId}`);
}

export async function sendEmail(userId: string, options: SendEmailOptions): Promise<void> {
  const message = buildMessage(options);

  await graphFetch(userId, "/sendMail", {
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

export async function createDraft(
  userId: string,
  options: CreateDraftOptions,
): Promise<OutlookMessage> {
  return graphFetch<OutlookMessage>(userId, "/messages", {
    method: "POST",
    body: JSON.stringify(buildMessage(options)),
  });
}

export async function searchEmails(userId: string, options: {
  query: string;
  top?: number;
  skip?: number;
}): Promise<OutlookMessage[]> {
  const params = new URLSearchParams({ $search: `"${options.query}"` });

  if (options.top != null) params.set("$top", options.top.toString());
  if (options.skip != null) params.set("$skip", options.skip.toString());

  const response = await graphFetch<GraphResponse<OutlookMessage>>(
    userId,
    `/messages?${params.toString()}`,
  );
  return response.value ?? [];
}

export async function listFolders(userId: string): Promise<OutlookFolder[]> {
  const response = await graphFetch<GraphResponse<OutlookFolder>>(userId, "/mailFolders");
  return response.value ?? [];
}

export async function listThreads(userId: string, options?: {
  folderId?: string;
  top?: number;
  filter?: string;
  orderBy?: string;
}): Promise<OutlookMessage[]> {
  const messages = await listEmails(userId, {
    folderId: options?.folderId ?? "inbox",
    top: options?.top,
    filter: options?.filter,
    orderBy: options?.orderBy ?? "receivedDateTime desc",
  });

  const seenConversationIds = new Set<string>();
  return messages.filter((message) => {
    const conversationId = message.conversationId || message.id;
    if (seenConversationIds.has(conversationId)) return false;
    seenConversationIds.add(conversationId);
    return true;
  });
}

export async function getThread(
  userId: string,
  threadId: string,
  limit = 25,
): Promise<OutlookMessage[]> {
  const safeThreadId = threadId.replaceAll("'", "''");
  const params = new URLSearchParams({
    $filter: `conversationId eq '${safeThreadId}'`,
    $top: String(limit),
    $select:
      "id,conversationId,internetMessageId,subject,body,bodyPreview,from,sender,toRecipients,ccRecipients,bccRecipients,replyTo,receivedDateTime,sentDateTime,categories,isRead,importance,hasAttachments,webLink,flag",
  });

  const response = await graphFetch<GraphResponse<OutlookMessage>>(userId, `/messages?${params}`);
  return response.value ?? [];
}

async function setReadState(userId: string, messageId: string, isRead: boolean): Promise<void> {
  await graphFetch(userId, `/messages/${messageId}`, {
    method: "PATCH",
    body: JSON.stringify({ isRead }),
  });
}

export async function markAsRead(userId: string, messageId: string): Promise<void> {
  await setReadState(userId, messageId, true);
}

export async function markAsUnread(userId: string, messageId: string): Promise<void> {
  await setReadState(userId, messageId, false);
}

export async function deleteEmail(userId: string, messageId: string): Promise<void> {
  await graphFetch(userId, `/messages/${messageId}`, { method: "DELETE" });
}

export async function moveEmail(
  userId: string,
  messageId: string,
  destinationFolderId: string,
): Promise<void> {
  await graphFetch(userId, `/messages/${messageId}/move`, {
    method: "POST",
    body: JSON.stringify({ destinationId: destinationFolderId }),
  });
}

export function formatEmail(message: OutlookMessage): string {
  const fromContact = summarizeContact(message.from);
  const from = fromContact.name || fromContact.email || "Unknown sender";
  const to = summarizeContacts(message.toRecipients).map((r) => r.email).filter(Boolean).join(", ");
  const date = new Date(message.receivedDateTime).toLocaleString();
  const read = message.isRead ? "Yes" : "No";

  return `From: ${from}
To: ${to}
Subject: ${message.subject}
Date: ${date}
Read: ${read}

${message.bodyPreview}`;
}

export function summarizeContact(contact?: OutlookContact | null): { name: string; email: string } {
  const emailAddress = contact?.emailAddress;
  const email = emailAddress?.address ?? "";
  return {
    name: emailAddress?.name ?? email,
    email,
  };
}

export function summarizeContacts(contacts?: OutlookContact[] | null): Array<{
  name: string;
  email: string;
}> {
  return (contacts ?? []).map(summarizeContact);
}
