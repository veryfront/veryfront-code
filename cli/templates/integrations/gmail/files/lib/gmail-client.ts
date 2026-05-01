/**
 * Gmail API Client
 *
 * Provides a type-safe interface to Gmail API operations
 * using the veryfront/oauth module for authentication.
 */

import { gmailConfig, OAuthService } from "veryfront/oauth";
import { tokenStore } from "./token-store.ts";
import type { OAuthToken } from "./token-store.ts";

export type GmailMessageFormat = "full" | "metadata" | "minimal" | "raw";
export type GmailLabelVisibility = "labelShow" | "labelShowIfUnread" | "labelHide";
export type GmailMessageListVisibility = "show" | "hide";
export type GmailHistoryType = "messageAdded" | "messageDeleted" | "labelAdded" | "labelRemoved";

export interface GmailMessagePartBody {
  attachmentId?: string;
  data?: string;
  size: number;
}

export interface GmailMessagePart {
  partId?: string;
  mimeType: string;
  filename?: string;
  headers?: Array<{ name: string; value: string }>;
  body?: GmailMessagePartBody;
  parts?: GmailMessagePart[];
}

export interface GmailMessage {
  id: string;
  threadId: string;
  labelIds?: string[];
  snippet?: string;
  payload?: GmailMessagePart;
  internalDate?: string;
  historyId?: string;
  sizeEstimate?: number;
  raw?: string;
}

export interface GmailMessageList {
  messages?: Array<{ id: string; threadId: string }>;
  nextPageToken?: string;
  resultSizeEstimate: number;
}

export interface GmailLabel {
  id: string;
  name: string;
  messageListVisibility?: GmailMessageListVisibility;
  labelListVisibility?: GmailLabelVisibility;
  type?: "system" | "user";
  messagesTotal?: number;
  messagesUnread?: number;
  threadsTotal?: number;
  threadsUnread?: number;
  color?: {
    textColor: string;
    backgroundColor: string;
  };
}

export interface GmailLabelList {
  labels: GmailLabel[];
}

export interface GmailThread {
  id: string;
  snippet?: string;
  historyId?: string;
  messages?: GmailMessage[];
}

export interface GmailThreadList {
  threads?: Array<{ id: string; historyId?: string; snippet?: string }>;
  nextPageToken?: string;
  resultSizeEstimate: number;
}

export interface GmailDraft {
  id: string;
  message: GmailMessage;
}

export interface GmailDraftList {
  drafts?: Array<{ id: string; message: { id: string; threadId: string } }>;
  nextPageToken?: string;
  resultSizeEstimate: number;
}

export interface GmailAttachment {
  attachmentId?: string;
  size: number;
  data: string;
}

export interface GmailProfile {
  emailAddress: string;
  messagesTotal: number;
  threadsTotal: number;
  historyId: string;
}

export interface GmailHistoryList {
  history?: Array<{
    id: string;
    messages?: GmailMessage[];
    messagesAdded?: Array<{ message: GmailMessage }>;
    messagesDeleted?: Array<{ message: GmailMessage }>;
    labelsAdded?: Array<{ message: GmailMessage; labelIds: string[] }>;
    labelsRemoved?: Array<{ message: GmailMessage; labelIds: string[] }>;
  }>;
  nextPageToken?: string;
  historyId: string;
}

export interface GmailWatchResponse {
  historyId: string;
  expiration: string;
}

export interface SendEmailOptions {
  to: string | string[];
  subject: string;
  body: string;
  cc?: string | string[];
  bcc?: string | string[];
  replyTo?: string;
  isHtml?: boolean;
  threadId?: string;
}

export type DraftEmailOptions = SendEmailOptions;

export interface ModifyLabelsOptions {
  addLabelIds?: string[];
  removeLabelIds?: string[];
}

export interface ListOptions {
  maxResults?: number;
  pageToken?: string;
}

export interface ListMessagesOptions extends ListOptions {
  query?: string;
  labelIds?: string[];
}

export interface ListHistoryOptions extends ListOptions {
  startHistoryId: string;
  labelId?: string;
  historyTypes?: GmailHistoryType[];
}

export interface WatchMailboxOptions {
  topicName: string;
  labelIds?: string[];
  labelFilterBehavior?: "include" | "exclude";
}

export interface GmailClient {
  isConnected(): Promise<boolean>;
  listMessages(options?: ListMessagesOptions): Promise<GmailMessageList>;
  getMessage(messageId: string, format?: GmailMessageFormat): Promise<GmailMessage>;
  sendEmail(options: SendEmailOptions): Promise<{ id: string; threadId: string }>;
  searchEmails(query: string, maxResults?: number): Promise<GmailMessage[]>;
  getUnreadEmails(maxResults?: number): Promise<GmailMessage[]>;
  markAsRead(messageId: string): Promise<void>;
  archiveEmail(messageId: string): Promise<void>;
  listLabels(): Promise<GmailLabelList>;
  getLabel(labelId: string): Promise<GmailLabel>;
  createLabel(label: Partial<GmailLabel> & { name: string }): Promise<GmailLabel>;
  updateLabel(labelId: string, label: Partial<GmailLabel> & { name: string }): Promise<GmailLabel>;
  patchLabel(labelId: string, label: Partial<GmailLabel>): Promise<GmailLabel>;
  deleteLabel(labelId: string): Promise<void>;
  modifyMessageLabels(messageId: string, labels: ModifyLabelsOptions): Promise<GmailMessage>;
  trashMessage(messageId: string): Promise<GmailMessage>;
  untrashMessage(messageId: string): Promise<GmailMessage>;
  deleteMessage(messageId: string): Promise<void>;
  batchModifyMessages(messageIds: string[], labels: ModifyLabelsOptions): Promise<void>;
  batchDeleteMessages(messageIds: string[]): Promise<void>;
  listThreads(options?: ListMessagesOptions): Promise<GmailThreadList>;
  getThread(threadId: string, format?: GmailMessageFormat): Promise<GmailThread>;
  modifyThreadLabels(threadId: string, labels: ModifyLabelsOptions): Promise<GmailThread>;
  trashThread(threadId: string): Promise<GmailThread>;
  untrashThread(threadId: string): Promise<GmailThread>;
  deleteThread(threadId: string): Promise<void>;
  createDraft(options: DraftEmailOptions): Promise<GmailDraft>;
  listDrafts(options?: ListMessagesOptions): Promise<GmailDraftList>;
  getDraft(draftId: string, format?: GmailMessageFormat): Promise<GmailDraft>;
  updateDraft(draftId: string, options: DraftEmailOptions): Promise<GmailDraft>;
  sendDraft(draftId: string): Promise<{ id: string; threadId: string }>;
  deleteDraft(draftId: string): Promise<void>;
  getAttachment(messageId: string, attachmentId: string): Promise<GmailAttachment>;
  getProfile(): Promise<GmailProfile>;
  listHistory(options: ListHistoryOptions): Promise<GmailHistoryList>;
  watchMailbox(options: WatchMailboxOptions): Promise<GmailWatchResponse>;
  stopMailboxWatch(): Promise<void>;
}

// TokenStore adapter keyed by (serviceId, userId). All API calls must pass
// the authenticated user's id. Never use a shared "current-user" constant
// in production; that re-introduces VULN-AUTH-2.
const tokenStoreAdapter = {
  async getTokens(serviceId: string, userId: string): Promise<OAuthToken | null> {
    return tokenStore.getToken(userId, serviceId);
  },
  async setTokens(
    serviceId: string,
    userId: string,
    tokens: { accessToken: string; refreshToken?: string; expiresAt?: number },
  ): Promise<void> {
    await tokenStore.setToken(userId, serviceId, tokens);
  },
  async clearTokens(serviceId: string, userId: string): Promise<void> {
    await tokenStore.revokeToken(userId, serviceId);
  },
  async setState(): Promise<void> {},
  async consumeState(): Promise<null> {
    return null;
  },
};

const gmailService = new OAuthService(gmailConfig, tokenStoreAdapter);

function formatAddresses(addresses: string | string[] | undefined): string {
  if (!addresses) return "";
  return Array.isArray(addresses) ? addresses.join(", ") : addresses;
}

function encodeEmail(options: SendEmailOptions): string {
  const toAddresses = formatAddresses(options.to);
  const ccAddresses = formatAddresses(options.cc);
  const bccAddresses = formatAddresses(options.bcc);

  const headers = [
    `To: ${toAddresses}`,
    `Subject: ${options.subject}`,
    options.isHtml
      ? "Content-Type: text/html; charset=utf-8"
      : "Content-Type: text/plain; charset=utf-8",
  ];

  if (ccAddresses) headers.push(`Cc: ${ccAddresses}`);
  if (bccAddresses) headers.push(`Bcc: ${bccAddresses}`);
  if (options.replyTo) headers.push(`Reply-To: ${options.replyTo}`);

  const email = `${headers.join("\r\n")}\r\n\r\n${options.body}`;
  return btoa(email).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function addListParams(params: URLSearchParams, options: ListMessagesOptions = {}): void {
  if (options.maxResults != null) params.set("maxResults", String(options.maxResults));
  if (options.query) params.set("q", options.query);
  if (options.labelIds?.length) {
    for (const labelId of options.labelIds) params.append("labelIds", labelId);
  }
  if (options.pageToken) params.set("pageToken", options.pageToken);
}

function withQuery(path: string, params: URLSearchParams): string {
  const query = params.toString();
  return query ? `${path}?${query}` : path;
}

function encodedMessage(options: SendEmailOptions): { raw: string; threadId?: string } {
  return {
    raw: encodeEmail(options),
    ...(options.threadId ? { threadId: options.threadId } : {}),
  };
}

/**
 * Create a Gmail client scoped to a specific user. Pass the authenticated
 * user's id (from your session). Tokens are looked up and stored per-user.
 */
export function createGmailClient(userId: string): GmailClient {
  async function apiRequest<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
    const token = await gmailService.getAccessToken(userId);
    if (!token) {
      throw new Error("Gmail not connected");
    }

    const url = endpoint.startsWith("http") ? endpoint : `${gmailConfig.apiBaseUrl}${endpoint}`;
    const response = await fetch(url, {
      ...options,
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        ...options.headers,
      },
    });

    if (!response.ok) {
      const detail = await response.text();
      throw new Error(`Gmail API error: ${response.status} ${detail}`);
    }

    const text = await response.text();
    return (text ? JSON.parse(text) : undefined) as T;
  }

  return {
    async isConnected(): Promise<boolean> {
      const token = await gmailService.getAccessToken(userId);
      return token !== null;
    },

    listMessages(options: ListMessagesOptions = {}): Promise<GmailMessageList> {
      const params = new URLSearchParams();
      addListParams(params, options);
      return apiRequest<GmailMessageList>(withQuery("/users/me/messages", params));
    },

    getMessage(messageId: string, format: GmailMessageFormat = "full"): Promise<GmailMessage> {
      return apiRequest<GmailMessage>(`/users/me/messages/${messageId}?format=${format}`);
    },

    sendEmail(options: SendEmailOptions): Promise<{ id: string; threadId: string }> {
      return apiRequest<{ id: string; threadId: string }>("/users/me/messages/send", {
        method: "POST",
        body: JSON.stringify(encodedMessage(options)),
      });
    },

    async searchEmails(query: string, maxResults = 10): Promise<GmailMessage[]> {
      const list = await this.listMessages({ query, maxResults });
      if (!list.messages?.length) return [];
      return Promise.all(list.messages.map((m) => this.getMessage(m.id, "metadata")));
    },

    getUnreadEmails(maxResults = 10): Promise<GmailMessage[]> {
      return this.searchEmails("is:unread", maxResults);
    },

    async markAsRead(messageId: string): Promise<void> {
      await this.modifyMessageLabels(messageId, { removeLabelIds: ["UNREAD"] });
    },

    async archiveEmail(messageId: string): Promise<void> {
      await this.modifyMessageLabels(messageId, { removeLabelIds: ["INBOX"] });
    },

    listLabels(): Promise<GmailLabelList> {
      return apiRequest<GmailLabelList>("/users/me/labels");
    },

    getLabel(labelId: string): Promise<GmailLabel> {
      return apiRequest<GmailLabel>(`/users/me/labels/${labelId}`);
    },

    createLabel(label: Partial<GmailLabel> & { name: string }): Promise<GmailLabel> {
      return apiRequest<GmailLabel>("/users/me/labels", {
        method: "POST",
        body: JSON.stringify(label),
      });
    },

    updateLabel(
      labelId: string,
      label: Partial<GmailLabel> & { name: string },
    ): Promise<GmailLabel> {
      return apiRequest<GmailLabel>(`/users/me/labels/${labelId}`, {
        method: "PUT",
        body: JSON.stringify(label),
      });
    },

    patchLabel(labelId: string, label: Partial<GmailLabel>): Promise<GmailLabel> {
      return apiRequest<GmailLabel>(`/users/me/labels/${labelId}`, {
        method: "PATCH",
        body: JSON.stringify(label),
      });
    },

    async deleteLabel(labelId: string): Promise<void> {
      await apiRequest<void>(`/users/me/labels/${labelId}`, { method: "DELETE" });
    },

    modifyMessageLabels(messageId: string, labels: ModifyLabelsOptions): Promise<GmailMessage> {
      return apiRequest<GmailMessage>(`/users/me/messages/${messageId}/modify`, {
        method: "POST",
        body: JSON.stringify(labels),
      });
    },

    trashMessage(messageId: string): Promise<GmailMessage> {
      return apiRequest<GmailMessage>(`/users/me/messages/${messageId}/trash`, { method: "POST" });
    },

    untrashMessage(messageId: string): Promise<GmailMessage> {
      return apiRequest<GmailMessage>(`/users/me/messages/${messageId}/untrash`, {
        method: "POST",
      });
    },

    async deleteMessage(messageId: string): Promise<void> {
      await apiRequest<void>(`/users/me/messages/${messageId}`, { method: "DELETE" });
    },

    async batchModifyMessages(messageIds: string[], labels: ModifyLabelsOptions): Promise<void> {
      await apiRequest<void>("/users/me/messages/batchModify", {
        method: "POST",
        body: JSON.stringify({ ids: messageIds, ...labels }),
      });
    },

    async batchDeleteMessages(messageIds: string[]): Promise<void> {
      await apiRequest<void>("/users/me/messages/batchDelete", {
        method: "POST",
        body: JSON.stringify({ ids: messageIds }),
      });
    },

    listThreads(options: ListMessagesOptions = {}): Promise<GmailThreadList> {
      const params = new URLSearchParams();
      addListParams(params, options);
      return apiRequest<GmailThreadList>(withQuery("/users/me/threads", params));
    },

    getThread(threadId: string, format: GmailMessageFormat = "full"): Promise<GmailThread> {
      return apiRequest<GmailThread>(`/users/me/threads/${threadId}?format=${format}`);
    },

    modifyThreadLabels(threadId: string, labels: ModifyLabelsOptions): Promise<GmailThread> {
      return apiRequest<GmailThread>(`/users/me/threads/${threadId}/modify`, {
        method: "POST",
        body: JSON.stringify(labels),
      });
    },

    trashThread(threadId: string): Promise<GmailThread> {
      return apiRequest<GmailThread>(`/users/me/threads/${threadId}/trash`, { method: "POST" });
    },

    untrashThread(threadId: string): Promise<GmailThread> {
      return apiRequest<GmailThread>(`/users/me/threads/${threadId}/untrash`, { method: "POST" });
    },

    async deleteThread(threadId: string): Promise<void> {
      await apiRequest<void>(`/users/me/threads/${threadId}`, { method: "DELETE" });
    },

    createDraft(options: DraftEmailOptions): Promise<GmailDraft> {
      return apiRequest<GmailDraft>("/users/me/drafts", {
        method: "POST",
        body: JSON.stringify({ message: encodedMessage(options) }),
      });
    },

    listDrafts(options: ListMessagesOptions = {}): Promise<GmailDraftList> {
      const params = new URLSearchParams();
      addListParams(params, options);
      return apiRequest<GmailDraftList>(withQuery("/users/me/drafts", params));
    },

    getDraft(draftId: string, format: GmailMessageFormat = "full"): Promise<GmailDraft> {
      return apiRequest<GmailDraft>(`/users/me/drafts/${draftId}?format=${format}`);
    },

    updateDraft(draftId: string, options: DraftEmailOptions): Promise<GmailDraft> {
      return apiRequest<GmailDraft>(`/users/me/drafts/${draftId}`, {
        method: "PUT",
        body: JSON.stringify({ id: draftId, message: encodedMessage(options) }),
      });
    },

    sendDraft(draftId: string): Promise<{ id: string; threadId: string }> {
      return apiRequest<{ id: string; threadId: string }>("/users/me/drafts/send", {
        method: "POST",
        body: JSON.stringify({ id: draftId }),
      });
    },

    async deleteDraft(draftId: string): Promise<void> {
      await apiRequest<void>(`/users/me/drafts/${draftId}`, { method: "DELETE" });
    },

    getAttachment(messageId: string, attachmentId: string): Promise<GmailAttachment> {
      return apiRequest<GmailAttachment>(
        `/users/me/messages/${messageId}/attachments/${attachmentId}`,
      );
    },

    getProfile(): Promise<GmailProfile> {
      return apiRequest<GmailProfile>("/users/me/profile");
    },

    listHistory(options: ListHistoryOptions): Promise<GmailHistoryList> {
      const params = new URLSearchParams();
      params.set("startHistoryId", options.startHistoryId);
      if (options.maxResults != null) params.set("maxResults", String(options.maxResults));
      if (options.pageToken) params.set("pageToken", options.pageToken);
      if (options.labelId) params.set("labelId", options.labelId);
      if (options.historyTypes?.length) {
        for (const historyType of options.historyTypes) params.append("historyTypes", historyType);
      }
      return apiRequest<GmailHistoryList>(withQuery("/users/me/history", params));
    },

    watchMailbox(options: WatchMailboxOptions): Promise<GmailWatchResponse> {
      return apiRequest<GmailWatchResponse>("/users/me/watch", {
        method: "POST",
        body: JSON.stringify(options),
      });
    },

    async stopMailboxWatch(): Promise<void> {
      await apiRequest<void>("/users/me/stop", { method: "POST" });
    },
  };
}

export function parseEmailHeaders(
  headers: Array<{ name: string; value: string }>,
): { from: string; to: string; subject: string; date: string } {
  function getHeader(name: string): string {
    return headers.find((h) => h.name.toLowerCase() === name.toLowerCase())?.value ?? "";
  }

  return {
    from: getHeader("From"),
    to: getHeader("To"),
    subject: getHeader("Subject"),
    date: getHeader("Date"),
  };
}
